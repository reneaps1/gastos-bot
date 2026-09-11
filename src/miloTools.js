const prisma = require('./lib/prisma')

function num(value) {
  return value == null ? null : Number(value)
}

function dateOnly(date) {
  return date ? date.toISOString().slice(0, 10) : null
}

function mexicoDateString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dbDate(value) {
  return new Date(`${value}T00:00:00.000Z`)
}

function clampLimit(value, fallback = 20, max = 50) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

async function resolvePeriod(period) {
  const requested = String(period || 'current').trim()
  const normalized = requested.toLowerCase()

  if (['current', 'actual', 'activa', 'active', 'this'].includes(normalized)) {
    const today = dbDate(mexicoDateString())
    return prisma.quincena.findFirst({
      where: { fechaInicio: { lte: today }, fechaFin: { gte: today } },
      orderBy: { fechaInicio: 'desc' },
    })
  }

  return prisma.quincena.findFirst({
    where: { codigo: { equals: requested, mode: 'insensitive' } },
  })
}

async function getCurrentPeriod() {
  const period = await resolvePeriod('current')
  if (!period) return { ok: false, error: 'No encontré un periodo activo.' }

  return {
    ok: true,
    period: {
      id: period.id,
      code: period.codigo,
      start: dateOnly(period.fechaInicio),
      end: dateOnly(period.fechaFin),
      type: period.tipo,
      closedAt: period.fechaCierre?.toISOString() || null,
    },
  }
}

async function listBudgetLines(args = {}) {
  const period = await resolvePeriod(args.period)
  if (!period) return { ok: false, error: `No encontré el periodo ${args.period || 'actual'}.` }

  const where = { quincenaId: period.id }
  if (args.type && String(args.type).toLowerCase() !== 'all') where.tipo = args.type
  else if (!args.type) where.tipo = 'Gasto'

  if (args.status) where.estadoLinea = args.status
  if (args.category) {
    where.categoria = { nombre: { contains: String(args.category), mode: 'insensitive' } }
  }
  if (args.search) {
    where.descripcion = { contains: String(args.search), mode: 'insensitive' }
  }

  const lines = await prisma.presupuesto.findMany({
    where,
    include: { categoria: true },
    orderBy: [{ categoriaId: 'asc' }, { id: 'asc' }],
  })

  if (!lines.length) {
    return {
      ok: true,
      period: period.codigo,
      count: 0,
      lines: [],
      message: 'No encontré líneas con esos filtros.',
    }
  }

  const ids = lines.map(line => line.id)
  const spendRows = await prisma.transaccion.groupBy({
    by: ['presupuestoId'],
    where: { presupuestoId: { in: ids }, tipo: 'Gasto' },
    _sum: { monto: true },
  })
  const spentByLine = new Map(spendRows.map(row => [row.presupuestoId, Number(row._sum.monto || 0)]))

  const mapped = lines.map(line => {
    const original = Number(line.montoPresupuestado)
    const revised = line.montoRevisado == null ? null : Number(line.montoRevisado)
    const effective = revised ?? original
    const spent = spentByLine.get(line.id) || 0
    return {
      id: line.id,
      name: line.descripcion,
      category: line.categoria.nombre,
      classification: line.clasificacion,
      type: line.tipo,
      status: line.estadoLinea,
      originalBudget: original,
      revisedBudget: revised,
      effectiveBudget: effective,
      spent,
      remaining: effective - spent,
      recurrent: line.recurrente,
      dueDay: line.diaCobro,
    }
  })

  const limit = clampLimit(args.limit, 30, 100)
  const totalBudget = mapped.reduce((sum, line) => sum + line.effectiveBudget, 0)
  const totalSpent = mapped.reduce((sum, line) => sum + line.spent, 0)

  return {
    ok: true,
    period: period.codigo,
    count: mapped.length,
    totals: {
      budget: totalBudget,
      spent: totalSpent,
      remaining: totalBudget - totalSpent,
    },
    lines: mapped.slice(0, limit),
    truncated: mapped.length > limit,
  }
}

async function getBudgetSummary(args = {}) {
  const result = await listBudgetLines({ ...args, limit: 100 })
  if (!result.ok) return result

  const open = result.lines.filter(line => line.status === 'Abierta')
  const exceeded = result.lines.filter(line => line.remaining < 0)
  const unused = result.lines.filter(line => line.spent === 0 && line.effectiveBudget > 0)

  return {
    ok: true,
    period: result.period,
    count: result.count,
    totals: result.totals,
    openCount: open.length,
    exceeded: exceeded.map(line => ({ name: line.name, category: line.category, amount: Math.abs(line.remaining) })),
    unused: unused.map(line => ({ name: line.name, category: line.category, budget: line.effectiveBudget })),
  }
}

async function searchTransactions(args = {}) {
  const where = {}
  let period = null

  if (args.period) {
    period = await resolvePeriod(args.period)
    if (!period) return { ok: false, error: `No encontré el periodo ${args.period}.` }
    where.quincenaId = period.id
  }

  if (args.type) where.tipo = args.type
  if (args.status) where.estatus = args.status
  if (args.unassigned === true) where.presupuestoId = null
  if (args.unassigned === false) where.presupuestoId = { not: null }

  if (args.category) {
    where.categoria = { nombre: { contains: String(args.category), mode: 'insensitive' } }
  }
  if (args.user) {
    where.user = { nombre: { contains: String(args.user), mode: 'insensitive' } }
  }
  if (args.search) {
    where.descripcion = { contains: String(args.search), mode: 'insensitive' }
  }

  if (args.dateFrom || args.dateTo) {
    where.fecha = {}
    if (args.dateFrom) where.fecha.gte = dbDate(args.dateFrom)
    if (args.dateTo) where.fecha.lte = dbDate(args.dateTo)
  }

  const limit = clampLimit(args.limit, 20, 50)
  const txs = await prisma.transaccion.findMany({
    where,
    include: {
      categoria: true,
      user: true,
      metodoPago: true,
      presupuesto: true,
      quincena: true,
    },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    take: limit,
  })

  const total = txs.reduce((sum, tx) => sum + Number(tx.monto), 0)

  return {
    ok: true,
    period: period?.codigo || null,
    count: txs.length,
    total,
    transactions: txs.map(tx => ({
      id: tx.id,
      date: dateOnly(tx.fecha),
      period: tx.quincena.codigo,
      type: tx.tipo,
      status: tx.estatus,
      amount: Number(tx.monto),
      description: tx.descripcion,
      category: tx.categoria.nombre,
      user: tx.user?.nombre || null,
      paymentMethod: tx.metodoPago?.nombre || null,
      budgetLine: tx.presupuesto?.descripcion || null,
      source: tx.source,
    })),
  }
}

async function getLiquidity(args = {}) {
  const where = {}
  if (args.period) {
    const period = await resolvePeriod(args.period)
    if (!period) return { ok: false, error: `No encontré el periodo ${args.period}.` }
    where.quincenaId = period.id
  }

  const snapshot = await prisma.liquidezSnapshot.findFirst({
    where,
    include: {
      quincena: true,
      montos: { include: { cuenta: true } },
    },
    orderBy: [{ fechaCorte: 'desc' }, { fechaRegistro: 'desc' }, { id: 'desc' }],
  })

  if (!snapshot) return { ok: false, error: 'No hay cortes de liquidez disponibles.' }

  const accounts = snapshot.montos.map(row => ({
    account: row.cuenta.nombre,
    type: row.cuenta.tipo,
    amount: Number(row.monto),
    note: row.nota || null,
  }))
  const cash = accounts.reduce((sum, row) => sum + row.amount, 0)

  return {
    ok: true,
    period: snapshot.quincena.codigo,
    cutDate: snapshot.fechaCorte.toISOString(),
    validated: snapshot.validado,
    cash,
    remainingToPay: Number(snapshot.faltaPagar),
    periodPayments: Number(snapshot.pagosQuincena),
    actualExpenses: num(snapshot.gastosReales),
    forecastExpenses: num(snapshot.gastosPronosticados),
    theoretical: num(snapshot.teorico),
    accounts,
    note: 'cash es el saldo real del último corte; no debe confundirse con presupuesto restante.',
  }
}

async function listAccounts(args = {}) {
  const where = args.includeInactive ? {} : { activo: true }
  const accounts = await prisma.cuenta.findMany({
    where,
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
  })

  return {
    ok: true,
    count: accounts.length,
    accounts: accounts.map(account => ({
      id: account.id,
      name: account.nombre,
      type: account.tipo,
      active: account.activo,
    })),
  }
}

async function listCategories(args = {}) {
  const where = args.includeInactive ? {} : { activo: true }
  if (args.type) where.tipo = args.type

  const categories = await prisma.categoria.findMany({
    where,
    orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }],
  })

  return {
    ok: true,
    count: categories.length,
    categories: categories.map(category => ({
      id: category.id,
      name: category.nombre,
      type: category.tipo,
      classification: category.clasificacion,
      countsTowardLimit: category.cuentaParaLimite,
      examples: category.ejemplos,
    })),
  }
}

async function listDebts(args = {}) {
  const debts = await prisma.deuda.findMany({
    where: args.includeInactive ? {} : { activo: true },
    orderBy: { acreedor: 'asc' },
  })

  return {
    ok: true,
    count: debts.length,
    debts: debts.map(debt => ({
      id: debt.id,
      creditor: debt.acreedor,
      originalDebt: Number(debt.deudaOriginal),
      monthlyPayment: num(debt.abonoMensual),
      active: debt.activo,
      startDate: dateOnly(debt.fechaInicio),
      notes: debt.notas,
    })),
  }
}

async function listCredits(args = {}) {
  const credits = await prisma.credito.findMany({
    where: args.includeInactive ? {} : { activo: true },
    include: { user: true, cuentaPago: true },
    orderBy: { nombre: 'asc' },
  })

  const ids = credits.map(credit => credit.id)
  const paidRows = ids.length
    ? await prisma.creditoPago.groupBy({
        by: ['creditoId'],
        where: { creditoId: { in: ids }, estatus: 'Pagado' },
        _sum: { montoCapital: true, montoInteres: true, montoTotal: true },
      })
    : []
  const paid = new Map(paidRows.map(row => [row.creditoId, row._sum]))

  return {
    ok: true,
    count: credits.length,
    credits: credits.map(credit => {
      const sums = paid.get(credit.id)
      const capitalPaid = Number(sums?.montoCapital || 0)
      const initial = num(credit.saldoInicial) ?? num(credit.montoOriginal)
      return {
        id: credit.id,
        name: credit.nombre,
        creditor: credit.acreedor,
        type: credit.tipoCredito,
        owner: credit.user?.nombre || null,
        originalAmount: num(credit.montoOriginal),
        initialBalance: num(credit.saldoInicial),
        estimatedRemainingPrincipal: initial == null ? null : Math.max(initial - capitalPaid, 0),
        capitalPaid,
        interestPaid: Number(sums?.montoInteres || 0),
        totalPaid: Number(sums?.montoTotal || 0),
        fixedPayment: num(credit.montoPagoFijo),
        paymentDay: credit.diaPago,
        paymentAccount: credit.cuentaPago?.nombre || null,
        active: credit.activo,
      }
    }),
  }
}

async function listSavings(args = {}) {
  const where = args.includeInactive ? {} : { activo: true }
  const savings = await prisma.apartado.findMany({ where, orderBy: { nombre: 'asc' } })
  const ids = savings.map(item => item.id)

  const rows = ids.length
    ? await prisma.transaccion.groupBy({
        by: ['apartadoId', 'direccion'],
        where: { tipo: 'Ahorro', apartadoId: { in: ids } },
        _sum: { monto: true },
      })
    : []

  const balances = new Map()
  for (const row of rows) {
    const current = balances.get(row.apartadoId) || 0
    const amount = Number(row._sum.monto || 0)
    balances.set(row.apartadoId, current + (row.direccion === 'Retiro' ? -amount : amount))
  }

  const items = savings.map(item => {
    const balance = balances.get(item.id) || 0
    const goal = num(item.metaMonto)
    return {
      id: item.id,
      name: item.nombre,
      balance,
      goal,
      remainingToGoal: goal == null ? null : Math.max(goal - balance, 0),
      active: item.activo,
    }
  })

  return {
    ok: true,
    count: items.length,
    totalBalance: items.reduce((sum, item) => sum + item.balance, 0),
    savings: items,
  }
}

async function getSystemOverview() {
  const period = await resolvePeriod('current')
  const [budgetCount, accountCount, categoryCount, debtCount, creditCount, savingsCount] = await Promise.all([
    period ? prisma.presupuesto.count({ where: { quincenaId: period.id } }) : 0,
    prisma.cuenta.count({ where: { activo: true } }),
    prisma.categoria.count({ where: { activo: true } }),
    prisma.deuda.count({ where: { activo: true } }),
    prisma.credito.count({ where: { activo: true } }),
    prisma.apartado.count({ where: { activo: true } }),
  ])

  return {
    ok: true,
    currentPeriod: period
      ? { code: period.codigo, start: dateOnly(period.fechaInicio), end: dateOnly(period.fechaFin) }
      : null,
    availableDomains: ['transactions', 'budget', 'liquidity', 'accounts', 'categories', 'debts', 'credits', 'savings'],
    counts: {
      currentBudgetLines: budgetCount,
      activeAccounts: accountCount,
      activeCategories: categoryCount,
      activeDebts: debtCount,
      activeCredits: creditCount,
      activeSavingsBuckets: savingsCount,
    },
  }
}

const TOOL_DEFINITIONS = [
  {
    name: 'get_current_period',
    description: 'Obtiene la quincena/periodo activo actual y sus fechas.',
    args: {},
  },
  {
    name: 'list_budget_lines',
    description: 'Lista las líneas de presupuesto reales de un periodo con categoría, monto, gastado y restante. Úsala para preguntas como qué líneas existen, cuáles son de transporte, cuáles están abiertas o cuánto queda en cada línea.',
    args: { period: 'current o código como Q34', category: 'opcional', status: 'Abierta|Cumplida|Cancelada|Absorbida opcional', type: 'Gasto|Ingreso|Ahorro|all opcional', search: 'texto opcional', limit: 'opcional' },
  },
  {
    name: 'get_budget_summary',
    description: 'Resume el presupuesto de un periodo: total, gastado, restante, líneas excedidas y líneas sin uso.',
    args: { period: 'current o código como Q34', category: 'opcional' },
  },
  {
    name: 'search_transactions',
    description: 'Busca movimientos reales por periodo, categoría, usuario, tipo, estatus, texto, fechas o si están sin línea de presupuesto.',
    args: { period: 'opcional', category: 'opcional', user: 'opcional', type: 'Gasto|Ingreso|Ahorro opcional', status: 'Pagado|Pendiente opcional', unassigned: 'boolean opcional', search: 'texto opcional', dateFrom: 'YYYY-MM-DD opcional', dateTo: 'YYYY-MM-DD opcional', limit: '1-50 opcional' },
  },
  {
    name: 'get_liquidity',
    description: 'Obtiene el último corte de liquidez real, cuentas y saldos. Úsala para cuánto dinero hay realmente, no para presupuesto restante.',
    args: { period: 'opcional: current o Qxx' },
  },
  {
    name: 'list_accounts',
    description: 'Lista el catálogo de cuentas financieras configuradas en Milo.',
    args: { includeInactive: 'boolean opcional' },
  },
  {
    name: 'list_categories',
    description: 'Lista categorías configuradas y su tipo.',
    args: { type: 'Gasto|Ingreso|Ahorro opcional', includeInactive: 'boolean opcional' },
  },
  {
    name: 'list_debts',
    description: 'Lista deudas simples activas registradas en Milo.',
    args: { includeInactive: 'boolean opcional' },
  },
  {
    name: 'list_credits',
    description: 'Lista créditos estructurados, propietario, pagos y saldo principal estimado.',
    args: { includeInactive: 'boolean opcional' },
  },
  {
    name: 'list_savings',
    description: 'Lista apartados/metas de ahorro y su saldo calculado a partir de aportes y retiros.',
    args: { includeInactive: 'boolean opcional' },
  },
  {
    name: 'get_system_overview',
    description: 'Da un mapa general de qué dominios y datos existen actualmente en Milo. Úsala cuando la pregunta sea muy amplia o necesites descubrir qué consultar.',
    args: {},
  },
]

const TOOL_HANDLERS = {
  get_current_period: getCurrentPeriod,
  list_budget_lines: listBudgetLines,
  get_budget_summary: getBudgetSummary,
  search_transactions: searchTransactions,
  get_liquidity: getLiquidity,
  list_accounts: listAccounts,
  list_categories: listCategories,
  list_debts: listDebts,
  list_credits: listCredits,
  list_savings: listSavings,
  get_system_overview: getSystemOverview,
}

async function executeTool(name, args = {}) {
  const handler = TOOL_HANDLERS[name]
  if (!handler) return { ok: false, error: `Herramienta no permitida: ${name}` }

  try {
    return await handler(args || {})
  } catch (error) {
    console.error(`MILO_TOOL_ERROR ${name}:`, error.message)
    return { ok: false, error: `No pude ejecutar ${name}: ${error.message}` }
  }
}

function getToolDefinitions() {
  return TOOL_DEFINITIONS
}

module.exports = { executeTool, getToolDefinitions }
