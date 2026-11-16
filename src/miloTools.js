// Herramientas del agente de Milo (src/financeAgent.js).
//
// Las de consulta son de solo lectura. Las proponer_* (WRITE_TOOLS, Telegram y
// web) tampoco escriben datos financieros: dejan una propuesta pendiente en
// milo_acciones y el cambio ocurre solo cuando el usuario toca "Confirmar"
// (ver src/miloAcciones.js). La unica que escribe sin boton es registrar_gasto
// (solo Telegram): un movimiento nuevo en formato claro, ver abajo.
//
// Los numeros de dinero salen de src/lib/finanzas-quincena.js, la copia
// probada al centavo de la matematica del dashboard
// (scripts/test-milo-finanzas.js). Si Milo y el panel "¿Cuadra tu dinero?"
// dijeran cosas distintas de la misma quincena, nadie sabria a cual creerle.

const prisma = require('./lib/prisma')
const { fechaMexico, dbDate, normalize } = require('./financeUtils')
const finanzas = require('./lib/finanzas-quincena')
const miloAcciones = require('./miloAcciones')

const { formatMXN } = finanzas

const TIPOS_MOVIMIENTO = ['Gasto', 'Ingreso', 'Ahorro']
const ESTATUS_PAGO = ['Pagado', 'Pendiente']
const ESTADOS_LINEA = ['Abierta', 'Cumplida', 'Absorbida', 'Cancelada']

// El modelo manda "gasto" o "pendiente": se acepta sin importar mayusculas.
function enumValido(valor, opciones) {
  const t = normalize(String(valor ?? ''))
  return opciones.find(o => normalize(o) === t) || null
}

function fechaValida(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor).trim())
  if (!m) return false
  const d = new Date(`${m[0]}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === m[0]
}

function num(value) {
  return value == null ? null : Number(value)
}

function dateOnly(date) {
  return date ? new Date(date).toISOString().slice(0, 10) : null
}

function redondear(n) {
  return Math.round(Number(n) * 100) / 100
}

function clampLimit(value, fallback = 20, max = 50) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

// "5,000", "$5000", "5 mil", 5000 -> 5000. null si no hay numero.
function parseMonto(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  const texto = String(value).toLowerCase().replace(/\$/g, '').trim()
  const mil = /\bmil\b|k$/.test(texto)
  const limpio = texto.replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  if (!limpio) return null
  const n = Number(limpio[0]) * (mil ? 1000 : 1)
  return Number.isFinite(n) && n > 0 ? n : null
}

// ---- Periodos ----------------------------------------------------------------

const ALIAS_ACTUAL = new Set(['', 'current', 'actual', 'activa', 'active', 'this', 'esta', 'esta quincena', 'quincena actual', 'hoy', 'ahorita'])
const ALIAS_ANTERIOR = new Set(['anterior', 'pasada', 'previous', 'prev', 'last', 'ultima', 'la pasada', 'la anterior', 'quincena pasada', 'quincena anterior', 'la quincena pasada', 'la quincena anterior'])
const ALIAS_SIGUIENTE = new Set(['siguiente', 'next', 'proxima', 'la siguiente', 'la proxima', 'quincena siguiente', 'proxima quincena', 'la que viene'])

// La MISMA quincena que abre el dashboard (getDefaultQuincenaId en
// dashboard/src/lib/quincena-selection.ts): la activa (la mas antigua si se
// enciman); si hoy cae entre dos quincenas (los rangos siguen las fechas
// reales de pago y a veces dejan huecos, ver isDateInQuincenaGap), la
// siguiente; y si ya no hay siguiente, la ultima. Antes, en un hueco, Milo
// decia "No encontré el periodo actual" mientras el panel mostraba un cuadre.
async function quincenaActual() {
  const today = dbDate(fechaMexico())
  const activa = await prisma.quincena.findFirst({
    where: { fechaInicio: { lte: today }, fechaFin: { gte: today } },
    orderBy: { fechaInicio: 'asc' },
  })
  if (activa) return activa
  const siguiente = await prisma.quincena.findFirst({
    where: { fechaFin: { gte: today } },
    orderBy: { fechaInicio: 'asc' },
  })
  if (siguiente) return siguiente
  return prisma.quincena.findFirst({ orderBy: { fechaInicio: 'desc' } })
}

async function quincenaAnteriorA(q) {
  const ancla = q ? q.fechaInicio : dbDate(fechaMexico())
  return prisma.quincena.findFirst({
    where: { fechaInicio: { lt: ancla } },
    orderBy: { fechaInicio: 'desc' },
  })
}

async function resolvePeriod(period) {
  const requested = String(period ?? 'current').trim()
  const n = normalize(requested)

  if (ALIAS_ACTUAL.has(n)) return quincenaActual()

  if (ALIAS_ANTERIOR.has(n)) return quincenaAnteriorA(await quincenaActual())

  if (ALIAS_SIGUIENTE.has(n)) {
    const actual = await quincenaActual()
    const ancla = actual ? actual.fechaFin : dbDate(fechaMexico())
    return prisma.quincena.findFirst({
      where: { fechaInicio: { gt: ancla } },
      orderBy: { fechaInicio: 'asc' },
    })
  }

  // "Q38", "q 38", "38"
  const codigo = /^q?\s*(\d{1,3})$/.exec(n)
  const buscado = codigo ? `Q${codigo[1]}` : requested
  return prisma.quincena.findFirst({
    where: { codigo: { equals: buscado, mode: 'insensitive' } },
  })
}

// Dias que faltan de la quincena CONTANDO HOY: el 12 de una quincena que cierra
// el 12 queda 1 dia, no 0. Fuera de la quincena: 0 si ya paso, todos si no ha
// empezado.
function infoPeriodo(q, hoy = fechaMexico()) {
  const start = dateOnly(q.fechaInicio)
  const end = dateOnly(q.fechaFin)
  const daysTotal = finanzas.diasEntre(start, end) + 1
  let daysLeft
  if (hoy > end) daysLeft = 0
  else if (hoy < start) daysLeft = daysTotal
  else daysLeft = finanzas.diasEntre(hoy, end) + 1
  return {
    code: q.codigo,
    start,
    end,
    isCurrent: hoy >= start && hoy <= end,
    daysTotal,
    daysLeft,
    daysElapsed: daysTotal - daysLeft,
  }
}

async function getCurrentPeriod() {
  const period = await quincenaActual()
  const today = fechaMexico()
  if (!period) return { ok: false, today, error: 'No encontré un periodo activo para hoy.' }

  return {
    ok: true,
    today,
    period: {
      id: period.id,
      ...infoPeriodo(period, today),
      type: period.tipo,
      closedAt: period.fechaCierre ? new Date(period.fechaCierre).toISOString() : null,
    },
  }
}

// ---- Dinero: la herramienta principal ----------------------------------------

// "¿Cuánto me queda?", "¿me alcanza para X?", "¿cómo voy?", "¿cuadra?".
// Es el panel "¿Cuadra tu dinero?" del dashboard, mismo calculo y mismas
// palabras, mas lo que el panel no dice: cuanto puedes gastar al dia y si te
// alcanza para un monto.
async function getMoneyStatus(args = {}) {
  const period = await resolvePeriod(args.period)
  if (!period) return { ok: false, error: `No encontré el periodo ${args.period || 'actual'}.` }

  const hoy = fechaMexico()
  const info = infoPeriodo(period, hoy)
  const datos = await finanzas.cargarQuincena(prisma, period.id)
  const entrada = {
    ingresosTotales: datos.ingresosTotales,
    gastoTotal: datos.gastoTotal,
    presupuestos: datos.presupuestos,
  }
  const teorico = finanzas.calcularLibreDeQuincena(entrada)
  const porPagar = finanzas.calcularFaltaPorPagar(datos.presupuestos)
  const cuadre = finanzas.calcularCuadre({ ...entrada, liquidezTotal: datos.liquidez ? datos.liquidez.total : null })

  const hasCut = cuadre != null
  // Con corte, el veredicto es "segun tus cuentas" (cuadre.real), igual que el
  // titular del panel. Sin corte solo existe el lado "segun tu presupuesto".
  const base = hasCut ? cuadre.real : teorico
  const verdict = base < 0 ? 'falta' : 'sobra'
  const cutDate = datos.liquidez?.fechaCorte ?? null
  const cutAgeDays = cutDate ? finanzas.diasEntre(cutDate, hoy) : null
  const cutIsOld = cutAgeDays != null && cutAgeDays >= finanzas.DIAS_CORTE_VIEJO

  const headline = hasCut
    ? finanzas.titularCuadre(cuadre.real)
    : `Según tu presupuesto: ${teorico < 0 ? 'Falta' : 'Sobra'} ${formatMXN(Math.abs(teorico))}.` +
      (info.isCurrent ? ' Captura tu corte de cuentas para saber si te alcanza.' : ` (${info.code} no tiene corte de cuentas.)`)

  const resumen = [headline]
  if (hasCut) {
    resumen.push(`Según tus cuentas: ${formatMXN(cuadre.enCuentas)} en cuentas − ${formatMXN(cuadre.porPagar)} por pagar (corte del ${cutDate}).`)
    resumen.push(`Según tu presupuesto: ${teorico < 0 ? 'Falta' : 'Sobra'} ${formatMXN(Math.abs(teorico))}.`)
    resumen.push(`Contra tu presupuesto: ${finanzas.textoContra(cuadre)}.`)
  }

  // Disponible por dia: solo si sobra y la quincena sigue corriendo. Con
  // faltante no hay "por dia" que repartir.
  let perDay = null
  if (base > 0 && info.isCurrent && info.daysLeft > 0) {
    perDay = redondear(base / info.daysLeft)
    resumen.push(`Puedes gastar unos ${formatMXN(perDay)} al día durante ${info.daysLeft} día(s) que quedan de la quincena.`)
  }
  if (cutIsOld) resumen.push(`Ojo: el corte de cuentas es de hace ${cutAgeDays} días; actualízalo para un veredicto confiable.`)

  let affordability = null
  const monto = parseMonto(args.amount)
  if (monto != null) {
    const despues = base - monto
    affordability = {
      amount: monto,
      fits: despues >= 0,
      leftAfter: redondear(despues),
      basis: hasCut ? 'cuentas' : 'presupuesto',
      text: despues >= 0
        ? `Sí te alcanza para ${formatMXN(monto)}: después te sobrarían ${formatMXN(despues)}.`
        : base < 0
          ? `No te alcanza para ${formatMXN(monto)}: ya te faltan ${formatMXN(Math.abs(base))} y con eso te faltarían ${formatMXN(Math.abs(despues))}.`
          : `No te alcanza para ${formatMXN(monto)}: te faltarían ${formatMXN(Math.abs(despues))}.`,
    }
    resumen.unshift(affordability.text)
  }

  return {
    ok: true,
    period: info.code,
    periodStart: info.start,
    periodEnd: info.end,
    today: hoy,
    isCurrent: info.isCurrent,
    daysLeft: info.daysLeft,
    verdict,
    amount: redondear(Math.abs(base)),
    hasCut,
    inAccounts: hasCut ? redondear(cuadre.enCuentas) : null,
    toPay: redondear(porPagar),
    cutDate,
    cutAgeDays,
    cutIsOld,
    byBudget: {
      verdict: teorico < 0 ? 'falta' : 'sobra',
      amount: redondear(Math.abs(teorico)),
      income: redondear(datos.ingresosTotales),
      committed: redondear(datos.ingresosTotales - teorico),
    },
    vsBudget: hasCut
      ? { matches: cuadre.cuadra, better: cuadre.mejor, amount: redondear(Math.abs(cuadre.delta)), text: finanzas.textoContra(cuadre) }
      : null,
    perDay,
    affordability,
    // Frases ya redactadas con las palabras del dashboard. Usalas tal cual.
    summary: resumen,
  }
}

// ---- Proximos pagos ----------------------------------------------------------

// Fecha (YYYY-MM-DD) dentro de la quincena que cae en el dia del mes `dia`.
function fechaConDiaDelMes(q, dia) {
  if (!dia) return null
  const d = new Date(q.fechaInicio)
  const fin = new Date(q.fechaFin).getTime()
  for (let i = 0; i < 40 && d.getTime() <= fin; i++) {
    if (d.getUTCDate() === Number(dia)) return d.toISOString().slice(0, 10)
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return null
}

async function getUpcomingPayments(args = {}) {
  const period = await resolvePeriod(args.period)
  if (!period) return { ok: false, error: `No encontré el periodo ${args.period || 'actual'}.` }

  const hoy = fechaMexico()
  const lineas = await finanzas.cargarLineasDeQuincena(prisma, period.id)

  const pagos = lineas
    .map(p => ({ p, toPay: finanzas.porPagarDeLinea(p) }))
    .filter(({ toPay }) => toPay > 0.004)
    .map(({ p, toPay }) => {
      const dueDate = dateOnly(p.fechaVencimiento) || fechaConDiaDelMes(period, p.diaCobro)
      return {
        name: p.descripcion,
        category: p.categoria?.nombre || null,
        toPay: redondear(toPay),
        pending: redondear(p.pendiente),
        notYetRecorded: redondear(Math.max(p.montoEfectivo - p.real, 0)),
        dueDate,
        overdue: dueDate != null && dueDate < hoy,
      }
    })
    .sort((a, b) =>
      (b.overdue - a.overdue) ||
      ((a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : (a.dueDate || '9999') > (b.dueDate || '9999') ? 1 : 0) ||
      (b.toPay - a.toPay))

  // Abonos de credito de la quincena que NO estan ligados a una linea (los
  // ligados ya van dentro de su linea). Mismo filtro que calcularPagosQuincena
  // en dashboard/src/lib/pagos-quincena.ts.
  const abonos = await prisma.creditoPago.findMany({
    where: { quincenaId: period.id, estatus: 'Pendiente', presupuestoId: null },
    include: { credito: true },
    orderBy: { fechaPagoProgramada: 'asc' },
  })

  const limit = clampLimit(args.limit, 10, 50)
  const total = finanzas.calcularFaltaPorPagar(lineas)
  return {
    ok: true,
    period: period.codigo,
    today: hoy,
    totalToPay: redondear(total),
    totalToPayText: `${formatMXN(total)} por pagar en ${period.codigo}`,
    count: pagos.length,
    overdueCount: pagos.filter(p => p.overdue).length,
    payments: pagos.slice(0, limit),
    truncated: pagos.length > limit,
    creditInstallments: abonos.map(a => ({
      credit: a.credito?.nombre || null,
      amount: redondear(Number(a.montoTotal)),
      dueDate: dateOnly(a.fechaPagoProgramada),
      overdue: dateOnly(a.fechaPagoProgramada) < hoy,
      installment: a.numeroPago && a.totalPagos ? `${a.numeroPago}/${a.totalPagos}` : null,
    })),
    note: 'totalToPay es el "por pagar" del dashboard (pendiente + lo presupuestado sin registrar de las líneas de Gasto). creditInstallments son abonos de crédito sin línea, informativos: no se suman a totalToPay.',
  }
}

// ---- Comparar quincenas --------------------------------------------------------

async function resumenDePeriodo(q, hoy) {
  const [datos, porCategoria, categorias] = await Promise.all([
    finanzas.cargarQuincena(prisma, q.id),
    prisma.transaccion.groupBy({
      by: ['categoriaId'],
      where: { quincenaId: q.id, tipo: 'Gasto' },
      _sum: { monto: true },
    }),
    prisma.categoria.findMany({ select: { id: true, nombre: true } }),
  ])
  const nombre = new Map(categorias.map(c => [c.id, c.nombre]))
  const info = infoPeriodo(q, hoy)
  return {
    code: q.codigo,
    start: info.start,
    end: info.end,
    isCurrent: info.isCurrent,
    daysElapsed: info.daysElapsed,
    daysTotal: info.daysTotal,
    income: redondear(datos.totales.Ingreso),
    expenses: redondear(datos.totales.Gasto),
    savings: redondear(datos.totales.Ahorro),
    toPay: redondear(finanzas.calcularFaltaPorPagar(datos.presupuestos)),
    byBudget: redondear(finanzas.calcularLibreDeQuincena({
      ingresosTotales: datos.ingresosTotales, gastoTotal: datos.gastoTotal, presupuestos: datos.presupuestos,
    })),
    byCategory: porCategoria
      .map(r => ({ category: nombre.get(r.categoriaId) ?? `#${r.categoriaId}`, total: redondear(Number(r._sum.monto ?? 0)) }))
      .sort((a, b) => b.total - a.total),
  }
}

async function comparePeriods(args = {}) {
  const a = await resolvePeriod(args.period)
  if (!a) return { ok: false, error: `No encontré el periodo ${args.period || 'actual'}.` }
  const b = args.against ? await resolvePeriod(args.against) : await quincenaAnteriorA(a)
  if (!b) return { ok: false, error: `No encontré con qué periodo comparar ${a.codigo}.` }

  const hoy = fechaMexico()
  const [actual, otra] = await Promise.all([resumenDePeriodo(a, hoy), resumenDePeriodo(b, hoy)])

  const cats = new Set([...actual.byCategory, ...otra.byCategory].map(c => c.category))
  const byCategoryDiff = [...cats].map(category => {
    const x = actual.byCategory.find(c => c.category === category)?.total ?? 0
    const y = otra.byCategory.find(c => c.category === category)?.total ?? 0
    return { category, [actual.code]: x, [otra.code]: y, diff: redondear(x - y) }
  }).sort((p, q) => Math.abs(q.diff) - Math.abs(p.diff))

  return {
    ok: true,
    period: actual,
    against: otra,
    diff: {
      income: redondear(actual.income - otra.income),
      expenses: redondear(actual.expenses - otra.expenses),
      savings: redondear(actual.savings - otra.savings),
    },
    byCategoryDiff,
    note: actual.isCurrent
      ? `${actual.code} sigue en curso (${actual.daysElapsed} de ${actual.daysTotal} días): sus gastos todavía van a subir.`
      : null,
  }
}

// ---- Lineas de presupuesto ---------------------------------------------------

async function listBudgetLines(args = {}) {
  const period = await resolvePeriod(args.period)
  if (!period) return { ok: false, error: `No encontré el periodo ${args.period || 'actual'}.` }

  // Tipo y nombre se filtran contra la categoria, no contra el `tipo` copiado
  // en la fila: misma regla que tipoDeLinea del dashboard. Van en el mismo
  // objeto `categoria` para que pedir tipo y categoria a la vez no descarte
  // uno de los dos filtros.
  const where = {}
  const categoriaWhere = {}
  if (args.type && String(args.type).toLowerCase() !== 'all') {
    const tipo = enumValido(args.type, TIPOS_MOVIMIENTO)
    if (!tipo) return { ok: false, error: `type debe ser uno de: ${TIPOS_MOVIMIENTO.join(", ")} o all.` }
    categoriaWhere.tipo = tipo
  } else if (!args.type) categoriaWhere.tipo = 'Gasto'
  if (args.status) {
    const estado = enumValido(args.status, ESTADOS_LINEA)
    if (!estado) return { ok: false, error: `status debe ser uno de: ${ESTADOS_LINEA.join(", ")}.` }
    where.estadoLinea = estado
  }
  if (args.category) categoriaWhere.nombre = { contains: String(args.category), mode: 'insensitive' }
  if (Object.keys(categoriaWhere).length > 0) where.categoria = categoriaWhere
  if (args.search) where.descripcion = { contains: String(args.search), mode: 'insensitive' }

  const todas = await finanzas.cargarLineasDeQuincena(prisma, period.id, where)
  // Una Cancelada "nunca paso" (cuentaParaAgregados): no se lista ni se suma,
  // salvo que la pregunta sea justo por las canceladas.
  const lines = args.status === 'Cancelada' ? todas : todas.filter(finanzas.cuentaParaAgregados)

  if (!lines.length) {
    return { ok: true, period: period.codigo, count: 0, lines: [], message: 'No encontré líneas con esos filtros.' }
  }

  const mapped = lines.map(line => {
    const tipo = finanzas.tipoDeLinea(line)
    return {
      id: line.id,
      name: line.descripcion,
      category: line.categoria?.nombre || null,
      type: tipo,
      status: line.estadoLinea,
      originalBudget: Number(line.montoPresupuestado),
      revisedBudget: num(line.montoRevisado),
      effectiveBudget: redondear(line.montoEfectivo),
      spent: redondear(line.real),
      pending: redondear(line.pendiente),
      // Restante de la linea: presupuesto que aun no se ejerce (piso 0).
      remaining: redondear(Math.max(line.montoEfectivo - line.real, 0)),
      exceeded: redondear(line.excedido),
      // Lo que todavia sale de caja por esta linea (solo Gasto).
      toPay: tipo === 'Gasto' ? redondear(finanzas.porPagarDeLinea(line)) : null,
      dueDate: dateOnly(line.fechaVencimiento),
      dueDay: line.diaCobro,
      recurrent: line.recurrente,
    }
  })

  const limit = clampLimit(args.limit, 30, 100)
  const suma = campo => redondear(mapped.reduce((s, l) => s + (l[campo] || 0), 0))

  return {
    ok: true,
    period: period.codigo,
    count: mapped.length,
    totals: {
      budget: suma('effectiveBudget'),
      spent: suma('spent'),
      pending: suma('pending'),
      remaining: suma('remaining'),
      exceeded: suma('exceeded'),
      toPay: suma('toPay'),
    },
    lines: mapped.slice(0, limit),
    truncated: mapped.length > limit,
    note: 'remaining = presupuesto de la línea aún sin ejercer. toPay = lo que todavía sale de caja (pendiente + no registrado). Para "cuánto me queda" de dinero usa get_money_status, no esto.',
  }
}

async function getBudgetSummary(args = {}) {
  const result = await listBudgetLines({ ...args, limit: 100 })
  if (!result.ok || !result.count) return result

  return {
    ok: true,
    period: result.period,
    count: result.count,
    totals: result.totals,
    openCount: result.lines.filter(line => line.status === 'Abierta').length,
    exceeded: result.lines.filter(line => line.exceeded > 0)
      .map(line => ({ name: line.name, category: line.category, amount: line.exceeded })),
    unused: result.lines.filter(line => line.spent === 0 && line.effectiveBudget > 0)
      .map(line => ({ name: line.name, category: line.category, budget: line.effectiveBudget })),
    note: result.note,
  }
}

// ---- Movimientos ----------------------------------------------------------------

async function searchTransactions(args = {}) {
  const where = {}
  let period = null

  if (args.period) {
    period = await resolvePeriod(args.period)
    if (!period) return { ok: false, error: `No encontré el periodo ${args.period}.` }
    where.quincenaId = period.id
  }

  // Valores que van directo a un enum de Prisma: uno invalido tronaba la
  // consulta y le costaba un paso al agente. Se avisa con las opciones.
  if (args.type) {
    const tipo = enumValido(args.type, TIPOS_MOVIMIENTO)
    if (!tipo) return { ok: false, error: `type debe ser uno de: ${TIPOS_MOVIMIENTO.join(", ")}.` }
    where.tipo = tipo
  }
  if (args.status) {
    const estatus = enumValido(args.status, ESTATUS_PAGO)
    if (!estatus) return { ok: false, error: `status debe ser uno de: ${ESTATUS_PAGO.join(", ")}.` }
    where.estatus = estatus
  }
  if (args.unassigned === true || args.unassigned === 'true') where.presupuestoId = null
  if (args.unassigned === false || args.unassigned === 'false') where.presupuestoId = { not: null }

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
    for (const campo of ["dateFrom", "dateTo"]) {
      if (args[campo] && !fechaValida(args[campo])) return { ok: false, error: `${campo} debe ser YYYY-MM-DD.` }
    }
    if (args.dateFrom) where.fecha.gte = dbDate(args.dateFrom)
    if (args.dateTo) where.fecha.lte = dbDate(args.dateTo)
  }

  const limit = clampLimit(args.limit, 20, 50)

  // Orden configurable. Sin esto la herramienta siempre devolvia los mas
  // recientes, asi que para "cual es el gasto mas alto" el agente solo podia
  // mirar los ultimos 20 movimientos -- y el mas alto podia no estar ahi.
  const ORDENES = {
    amount_desc: [{ monto: 'desc' }, { id: 'desc' }],
    amount_asc: [{ monto: 'asc' }, { id: 'asc' }],
    date_desc: [{ fecha: 'desc' }, { id: 'desc' }],
    date_asc: [{ fecha: 'asc' }, { id: 'asc' }],
  }
  const orderBy = ORDENES[String(args.sort || 'date_desc')] || ORDENES.date_desc

  // Los totales se sacan de un agregado sobre TODO el filtro, no de la pagina
  // devuelta: si se calcularan sobre `txs`, un limit de 20 daria un "total"
  // que solo suma esos 20 y el agente lo reportaria como si fuera el total real.
  const [txs, agregado, porCategoria] = await Promise.all([
    prisma.transaccion.findMany({
      where,
      include: {
        categoria: true,
        user: true,
        metodoPago: true,
        presupuesto: true,
        quincena: true,
      },
      orderBy,
      take: limit,
    }),
    prisma.transaccion.aggregate({
      where,
      _sum: { monto: true },
      _count: { _all: true },
      _max: { monto: true },
      _min: { monto: true },
      _avg: { monto: true },
    }),
    // Por categoria Y direccion: un retiro de ahorro se guarda con monto
    // positivo y solo la direccion dice que RESTA. Sin esto "cuanto ahorramos"
    // sumaba los retiros y se separaba del dashboard (GET /api/transacciones
    // netea igual) por el doble de lo retirado.
    prisma.transaccion.groupBy({
      by: ['categoriaId', 'tipo', 'direccion'],
      where,
      _sum: { monto: true },
      _count: { _all: true },
    }),
  ])

  const nombrePorCategoria = new Map(
    (await prisma.categoria.findMany({ select: { id: true, nombre: true } }))
      .map(c => [c.id, c.nombre]),
  )

  const conSigno = row => {
    const monto = Number(row._sum?.monto ?? 0)
    return row.tipo === 'Ahorro' && row.direccion === 'Retiro' ? -monto : monto
  }
  const porCategoriaNeto = new Map()
  for (const row of porCategoria) {
    const acc = porCategoriaNeto.get(row.categoriaId) ?? { total: 0, count: 0 }
    acc.total += conSigno(row)
    acc.count += row._count?._all ?? 0
    porCategoriaNeto.set(row.categoriaId, acc)
  }
  const tiposEnFiltro = new Set(porCategoria.map(row => row.tipo).filter(Boolean))

  const totales = {
    // Sobre todos los movimientos que cumplen el filtro, no solo los devueltos.
    count: agregado._count._all,
    // Neto: los retiros de ahorro restan. max/min/avg son por movimiento, sin
    // signo.
    sum: porCategoria.reduce((total, row) => total + conSigno(row), 0),
    savingsWithdrawalsSubtracted: tiposEnFiltro.has('Ahorro'),
    // Por tipo, con los mismos netos que el dashboard (finanzas.totalesDeTransacciones).
    byType: (() => {
      const t = finanzas.totalesDeTransacciones(porCategoria)
      return { Gasto: t.Gasto, Ingreso: t.Ingreso, Ahorro: t.Ahorro }
    })(),
    max: agregado._max.monto == null ? null : Number(agregado._max.monto),
    min: agregado._min.monto == null ? null : Number(agregado._min.monto),
    avg: agregado._avg.monto == null ? null : Number(agregado._avg.monto),
    byCategory: [...porCategoriaNeto]
      .map(([categoriaId, v]) => ({
        category: nombrePorCategoria.get(categoriaId) ?? `#${categoriaId}`,
        total: v.total,
        count: v.count,
      }))
      .sort((a, b) => b.total - a.total),
  }

  return {
    ok: true,
    period: period?.codigo || null,
    sort: args.sort || 'date_desc',
    count: txs.length,
    truncated: agregado._count._all > txs.length,
    totals: totales,
    // Se conserva `total` por compatibilidad, pero ahora es el del filtro
    // completo (antes era la suma de la pagina, que confundia al agente).
    total: totales.sum,
    transactions: txs.map(tx => ({
      id: tx.id,
      date: dateOnly(tx.fecha),
      period: tx.quincena?.codigo || null,
      type: tx.tipo,
      // Solo en Ahorro: 'Retiro' resta aunque amount venga positivo.
      direction: tx.tipo === 'Ahorro' ? (tx.direccion || 'Aporte') : null,
      status: tx.estatus,
      amount: Number(tx.monto),
      description: tx.descripcion,
      category: tx.categoria?.nombre || null,
      user: tx.user?.nombre || null,
      paymentMethod: tx.metodoPago?.nombre || null,
      budgetLine: tx.presupuesto?.descripcion || null,
      source: tx.source,
    })),
  }
}

// ---- Liquidez ----------------------------------------------------------------

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
    account: row.cuenta?.nombre || null,
    type: row.cuenta?.tipo || null,
    amount: Number(row.monto),
    note: row.nota || null,
  }))
  const cash = finanzas.sumLiquidez(snapshot.montos)

  // El "falta por pagar" guardado en el corte se congela al capturarlo y deja
  // de servir en cuanto se registra un pago. El vivo sale de las lineas de
  // hoy, igual que lo recalcula el dashboard (calcularEfectivoDisponible).
  const lineas = await finanzas.cargarLineasDeQuincena(prisma, snapshot.quincenaId)
  const vivo = finanzas.calcularFaltaPorPagar(lineas)
  const cutDate = finanzas.fechaISO(snapshot.fechaCorte)

  return {
    ok: true,
    snapshotId: snapshot.id,
    period: snapshot.quincena?.codigo || null,
    cutDate,
    cutAgeDays: finanzas.diasEntre(cutDate, fechaMexico()),
    validated: snapshot.validado,
    cash: redondear(cash),
    remainingToPay: redondear(vivo),
    available: redondear(cash - vivo),
    remainingToPayAtCut: Number(snapshot.faltaPagar),
    periodPaymentsAtCut: Number(snapshot.pagosQuincena),
    actualExpensesAtCut: num(snapshot.gastosReales),
    forecastExpensesAtCut: num(snapshot.gastosPronosticados),
    accounts,
    note: 'cash es el saldo real del último corte. remainingToPay es el por pagar EN VIVO; los campos *AtCut son lo que se guardó al capturar el corte. Para "cuánto me queda" usa get_money_status.',
  }
}

// Los ultimos cortes, para elegir cual corregir o borrar.
async function listLiquidityCuts(args = {}) {
  const limit = Math.min(Math.max(Number.parseInt(args.limit, 10) || 5, 1), 20)
  const cortes = await prisma.liquidezSnapshot.findMany({
    include: { quincena: true, montos: true },
    orderBy: [{ fechaCorte: 'desc' }, { fechaRegistro: 'desc' }, { id: 'desc' }],
    take: limit,
  })
  return {
    ok: true,
    count: cortes.length,
    cuts: cortes.map(c => ({
      snapshotId: c.id,
      cutDate: finanzas.fechaISO(c.fechaCorte),
      period: c.quincena?.codigo || null,
      cash: redondear(finanzas.sumLiquidez(c.montos)),
      validated: c.validado,
      notes: c.notas || null,
    })),
  }
}

// ---- Catalogos -----------------------------------------------------------------

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
  const period = await quincenaActual()
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
    availableDomains: ['money', 'transactions', 'budget', 'liquidity', 'accounts', 'categories', 'debts', 'credits', 'savings'],
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

const PERIODO = 'current (default), anterior/pasada, siguiente, o un código como Q38'

const TOOL_DEFINITIONS = [
  {
    name: 'get_money_status',
    description: 'LA PRINCIPAL. Contesta "cuánto me queda", "cuánto dinero tengo", "me alcanza", "me alcanza para X", "cuánto puedo gastar al día", "cómo voy", "cuadra mi dinero". Es el panel "¿Cuadra tu dinero?" del dashboard: veredicto Te sobran/Te faltan, en cuentas, por pagar, según tu presupuesto, Vas $X mejor/peor, días que faltan y disponible por día. Con amount dice si alcanza para ese monto. Trae `summary` con frases ya redactadas: úsalas.',
    args: { period: PERIODO, amount: 'opcional: monto a evaluar para "me alcanza para X"' },
  },
  {
    name: 'get_upcoming_payments',
    description: 'Qué pagos vienen / qué falta pagar / qué está vencido: líneas de Gasto con algo por pagar, vencidas primero y luego por fecha, más abonos de crédito pendientes de la quincena.',
    args: { period: PERIODO, limit: 'opcional, default 10' },
  },
  {
    name: 'compare_periods',
    description: 'Compara una quincena contra otra (por default la actual contra la anterior): ingresos, gastos, ahorro, gasto por categoría y diferencias. Para "cómo voy vs la pasada", "gasté más que la quincena pasada", "y la quincena pasada?".',
    args: { period: PERIODO, against: 'opcional: con qué periodo comparar; default la anterior a period' },
  },
  {
    name: 'get_current_period',
    description: 'La quincena activa: código, fechas, días que faltan (contando hoy) y la fecha de hoy.',
    args: {},
  },
  {
    name: 'list_budget_lines',
    description: 'Lista las líneas de presupuesto de un periodo con presupuesto, gastado (spent), pendiente, restante de la línea (remaining, piso 0), excedido y por pagar (toPay). Sin Canceladas. Para "cuánto queda en la línea X" o "qué líneas tengo de transporte".',
    args: { period: PERIODO, category: 'opcional', status: 'Abierta|Cumplida|Cancelada|Absorbida opcional', type: 'Gasto|Ingreso|Ahorro|all opcional (default Gasto)', search: 'texto opcional', limit: 'opcional' },
  },
  {
    name: 'get_budget_summary',
    description: 'Resumen del presupuesto de un periodo: totales (presupuesto, gastado, pendiente, restante, excedido, por pagar), líneas excedidas y líneas sin uso.',
    args: { period: PERIODO, category: 'opcional' },
  },
  {
    name: 'search_transactions',
    description: 'Busca movimientos reales por periodo, categoría, usuario, tipo, estatus, texto, fechas o si están sin línea (unassigned=true: "gastos sin asignar/sueltos"). Devuelve totals con count, sum, max, min, avg, byType y byCategory sobre TODOS los movimientos del filtro; en Ahorro, sum, byType y byCategory ya restan los retiros (direction=Retiro), igual que el dashboard. "El gasto más alto": sort=amount_desc, limit=1. "En qué gasté más": totals.byCategory con type=Gasto. "Cuánto gasté hoy": dateFrom=dateTo=hoy, type=Gasto. "Últimos movimientos": sin filtros, limit 10.',
    args: { period: 'opcional (' + PERIODO + ')', category: 'opcional', user: 'opcional', type: 'Gasto|Ingreso|Ahorro opcional', status: 'Pagado|Pendiente opcional', unassigned: 'boolean opcional', search: 'texto opcional', dateFrom: 'YYYY-MM-DD opcional', dateTo: 'YYYY-MM-DD opcional', sort: 'amount_desc|amount_asc|date_desc|date_asc opcional (default date_desc)', limit: '1-50 opcional' },
  },
  {
    name: 'get_liquidity',
    description: 'El último corte de liquidez: saldo por cuenta, total en cuentas y el por pagar en vivo. Para "cuánto hay en cada cuenta" o "cuánto tenemos en el banco". Para "cuánto me queda" usa get_money_status.',
    args: { period: 'opcional: ' + PERIODO },
  },
  {
    name: 'list_liquidity_cuts',
    description: 'Los últimos cortes de liquidez (id, fecha, quincena, total, validado). Para elegir cuál corregir o borrar.',
    args: { limit: 'opcional, default 5' },
  },
  {
    name: 'list_accounts',
    description: 'Catálogo de cuentas financieras configuradas en Milo. Son las cuentas de un corte de liquidez.',
    args: { includeInactive: 'boolean opcional' },
  },
  {
    name: 'list_categories',
    description: 'Categorías configuradas y su tipo.',
    args: { type: 'Gasto|Ingreso|Ahorro opcional', includeInactive: 'boolean opcional' },
  },
  {
    name: 'list_debts',
    description: 'Deudas simples activas registradas en Milo.',
    args: { includeInactive: 'boolean opcional' },
  },
  {
    name: 'list_credits',
    description: 'Créditos estructurados, propietario, pagos y saldo principal estimado.',
    args: { includeInactive: 'boolean opcional' },
  },
  {
    name: 'list_savings',
    description: 'Apartados/metas de ahorro y su saldo calculado con aportes y retiros.',
    args: { includeInactive: 'boolean opcional' },
  },
  {
    name: 'get_system_overview',
    description: 'Mapa general de qué datos existen en Milo. Solo para preguntas muy amplias.',
    args: {},
  },
]

const TOOL_HANDLERS = {
  get_money_status: getMoneyStatus,
  get_upcoming_payments: getUpcomingPayments,
  compare_periods: comparePeriods,
  get_current_period: getCurrentPeriod,
  list_budget_lines: listBudgetLines,
  get_budget_summary: getBudgetSummary,
  search_transactions: searchTransactions,
  get_liquidity: getLiquidity,
  list_liquidity_cuts: listLiquidityCuts,
  list_accounts: listAccounts,
  list_categories: listCategories,
  list_debts: listDebts,
  list_credits: listCredits,
  list_savings: listSavings,
  get_system_overview: getSystemOverview,
}

// ---- Proponer cambios (Telegram y web) ---------------------------------------
//
// Ninguna escribe datos financieros: validan, resuelven nombres a ids y dejan
// una fila pendiente en milo_acciones. El usuario confirma con un boton.

const WRITE_TOOL_DEFINITIONS = [
  {
    name: 'proponer_registrar_movimiento',
    description: 'Propone REGISTRAR un movimiento nuevo (gasto, ingreso o ahorro; el tipo sale de la categoría). Úsalo cuando pidan anotar algo que no tiene el formato "200 super", p. ej. "registra un ingreso de 5000 de nómina ayer". No se guarda hasta que el usuario toca Confirmar.',
    args: { amount: 'monto, requerido', description: 'texto corto, requerido', category: 'nombre de la categoría, requerido (list_categories)', date: 'YYYY-MM-DD, hoy o ayer; default hoy', paymentMethod: 'opcional', status: 'Pagado (default) o Pendiente', budgetLine: 'nombre de la línea, opcional', user: 'persona, opcional (default quien escribe)' },
  },
  {
    name: 'proponer_editar_movimiento',
    description: 'Propone CAMBIAR un movimiento existente: monto, descripción, fecha, categoría, forma de pago, estatus (Pagado/Pendiente) o línea (budgetLine="ninguna" la quita). Necesita el id: búscalo antes con search_transactions. Manda solo los campos que cambian. No se aplica hasta que el usuario toca Confirmar.',
    args: { id: 'id del movimiento, requerido', amount: 'opcional', description: 'opcional', date: 'opcional', category: 'opcional', paymentMethod: 'opcional', status: 'Pagado|Pendiente opcional', budgetLine: 'opcional; "ninguna" para quitarla' },
  },
  {
    name: 'proponer_borrar_movimiento',
    description: 'Propone BORRAR un movimiento. Necesita el id: búscalo antes con search_transactions. Si hay varios candidatos, NO adivines: lista los candidatos y pregunta cuál. No se borra hasta que el usuario toca Confirmar.',
    args: { id: 'id del movimiento, requerido' },
  },
  {
    name: 'proponer_corte_liquidez',
    description: 'Propone un corte de liquidez NUEVO: el saldo de hoy de cada cuenta. Va UNA sola propuesta con TODAS las cuentas activas (list_accounts). Si faltan saldos la herramienta te dice cuáles: pregúntalos. Si el usuario dice "las demás igual que el corte pasado" manda others="previous"; si dice que las demás están en cero, others="zero". No se guarda hasta que el usuario toca Confirmar.',
    args: { balances: 'requerido: lista [{"account":"BBVA","amount":0,"note":"opcional"}]', date: 'YYYY-MM-DD, hoy o ayer; default hoy', others: 'opcional: "previous" o "zero" para las cuentas que no vienen en balances', notes: 'opcional', validated: 'boolean opcional (default false)' },
  },
  {
    name: 'proponer_editar_corte_liquidez',
    description: 'Propone CORREGIR un corte de liquidez existente: el saldo de una o varias cuentas, la fecha, las notas o marcarlo validado. Sin id corrige el último corte. Manda solo lo que cambia. No se aplica hasta que el usuario toca Confirmar.',
    args: { id: 'opcional: snapshotId (get_liquidity o list_liquidity_cuts); default el último corte', balances: 'opcional: lista [{"account":"Banamex","amount":4690.34}] solo con las cuentas que cambian', date: 'opcional', notes: 'opcional', validated: 'boolean opcional' },
  },
  {
    name: 'proponer_borrar_corte_liquidez',
    description: 'Propone BORRAR un corte de liquidez. Necesita el id (snapshotId de get_liquidity o list_liquidity_cuts). No se borra hasta que el usuario toca Confirmar.',
    args: { id: 'snapshotId, requerido' },
  },
  // ---- Presupuesto ----
  {
    name: 'proponer_crear_linea',
    description: 'Propone CREAR una línea de presupuesto (sola o recurrente). El tipo sale de la categoría. Si ya existe una parecida, el resumen lo avisa. No se crea hasta que el usuario toca Confirmar.',
    args: { description: 'nombre de la línea, requerido', amount: 'monto, requerido', category: 'categoría, requerido (list_categories)', period: '"actual" (default), "siguiente" o código "Q40"', classification: 'Fijo|Variable, opcional', dueDate: 'YYYY-MM-DD, opcional', recurrent: 'boolean, opcional', frequency: 'quincenal|mensual (si recurrent)', occurrences: 'número de veces; vacío = sin fin', payDay: 'día de cobro 1-31, opcional' },
  },
  {
    name: 'proponer_ajustar_linea',
    description: 'Propone CAMBIAR una línea de presupuesto: el monto vigente (el original queda en el historial), el nombre, la clasificación o el vencimiento. Sin id, búscala por nombre en la quincena. En una serie recurrente, scope "en adelante" aplica a esta y las siguientes; si no, solo a esta. No se aplica hasta que el usuario toca Confirmar.',
    args: { id: 'id de la línea (list_budget_lines), o usa line+period', line: 'nombre de la línea', period: 'quincena de la línea; default la actual', amount: 'nuevo monto vigente, opcional', description: 'nuevo nombre, opcional', classification: 'Fijo|Variable|ninguna, opcional', dueDate: 'YYYY-MM-DD o "ninguna", opcional', scope: '"solo esta" (default) o "en adelante" (series)', reason: 'motivo, opcional' },
  },
  {
    name: 'proponer_cancelar_linea',
    description: 'Propone CANCELAR (retirar del plan) una línea de presupuesto; no se borra, queda como Cancelada. En una serie: scope "futuras" (las siguientes) o "toda la serie". Una línea con movimientos no se puede cancelar: la herramienta lo dice. No se aplica hasta que el usuario toca Confirmar.',
    args: { id: 'id de la línea, o usa line+period', line: 'nombre', period: 'quincena; default la actual', scope: '"solo esta" (default), "futuras" o "toda la serie"' },
  },
  {
    name: 'proponer_traspaso',
    description: 'Propone un TRASPASO de presupuesto: pasar monto de una línea a otra de la MISMA quincena (from -> to), o cubrir una línea con dinero sin asignar (sin from). La línea origen no puede quedar con menos de lo que ya gastó. No se aplica hasta que el usuario toca Confirmar.',
    args: { amount: 'monto, requerido', to: 'línea destino (nombre) o toId', toId: 'id de la línea destino', from: 'línea origen (nombre), o "sin asignar"', fromId: 'id de la línea origen', period: 'quincena; default la actual', reason: 'nota, opcional' },
  },
  {
    name: 'proponer_mover_linea',
    description: 'Propone MOVER una línea de presupuesto (sin movimientos) a otra quincena, p. ej. un pago que se recorre a la siguiente. No se aplica hasta que el usuario toca Confirmar.',
    args: { id: 'id de la línea, o usa line+period', line: 'nombre', period: 'quincena actual de la línea; default la actual', toPeriod: '"siguiente" o código "Q40", requerido' },
  },
  // ---- Configuracion ----
  {
    name: 'proponer_crear_cuenta',
    description: 'Propone CREAR una cuenta (banco, efectivo, vales, inversión...). Sale en los cortes de liquidez. No se crea hasta que el usuario toca Confirmar.',
    args: { name: 'nombre, requerido', type: 'Debito|Credito|Efectivo|Vales|Inversion|Otro, opcional' },
  },
  {
    name: 'proponer_editar_cuenta',
    description: 'Propone CAMBIAR una cuenta: nombre, tipo, o activarla/desactivarla (active). Desactivar es lo correcto para una cuenta que ya no se usa. No se aplica hasta que el usuario toca Confirmar.',
    args: { id: 'id (list_accounts) o usa name', name: 'nombre actual', newName: 'opcional', type: 'opcional', active: 'true|false, opcional' },
  },
  {
    name: 'proponer_borrar_cuenta',
    description: 'Propone BORRAR una cuenta. Solo si nunca se usó en cortes ni créditos; si sí, la herramienta lo dice y hay que desactivarla. No se borra hasta que el usuario toca Confirmar.',
    args: { id: 'id o usa name', name: 'nombre' },
  },
  {
    name: 'proponer_crear_categoria',
    description: 'Propone CREAR una categoría de Gasto, Ingreso o Ahorro. No se crea hasta que el usuario toca Confirmar.',
    args: { name: 'nombre, requerido', type: 'Gasto|Ingreso|Ahorro, requerido', classification: 'Fijo|Variable, opcional', examples: 'palabras de ejemplo, opcional' },
  },
  {
    name: 'proponer_editar_categoria',
    description: 'Propone CAMBIAR una categoría: nombre, clasificación, ejemplos, activarla/desactivarla o si cuenta para el límite de gasto. El TIPO no se cambia desde aquí. No se aplica hasta que el usuario toca Confirmar.',
    args: { id: 'id (list_categories) o usa name', name: 'nombre actual', newName: 'opcional', classification: 'Fijo|Variable|ninguna, opcional', examples: 'opcional', active: 'true|false, opcional', countsForLimit: 'true|false, opcional' },
  },
  {
    name: 'proponer_referencias_quincena',
    description: 'Propone fijar el ingreso de referencia y/o el límite de gasto de UNA quincena ("ninguna" la quita y se usa la general). No se aplica hasta que el usuario toca Confirmar.',
    args: { period: '"actual" (default), "siguiente" o código', income: 'monto o "ninguna", opcional', spendingLimit: 'monto o "ninguna", opcional' },
  },
  {
    name: 'proponer_crear_usuario',
    description: 'Propone dar de ALTA a una persona (sale como persona en los movimientos; no es un acceso al dashboard). No se crea hasta que el usuario toca Confirmar.',
    args: { name: 'nombre, requerido', phone: 'WhatsApp, opcional' },
  },
  {
    name: 'proponer_editar_usuario',
    description: 'Propone CAMBIAR a una persona: nombre, WhatsApp o activarla/desactivarla. No se aplica hasta que el usuario toca Confirmar.',
    args: { id: 'id o usa name', name: 'nombre actual', newName: 'opcional', phone: 'opcional', active: 'true|false, opcional' },
  },
  {
    name: 'proponer_crear_forma_pago',
    description: 'Propone CREAR una forma de pago (p. ej. "Tarjeta Nu"). No se crea hasta que el usuario toca Confirmar.',
    args: { name: 'nombre, requerido' },
  },
]

function herramientaDePropuesta(tipo) {
  return (args, ctx) => miloAcciones.proponer(tipo, args, ctx)
}

const WRITE_TOOL_HANDLERS = {
  proponer_registrar_movimiento: herramientaDePropuesta('transaccion.registrar'),
  proponer_editar_movimiento: herramientaDePropuesta('transaccion.editar'),
  proponer_borrar_movimiento: herramientaDePropuesta('transaccion.borrar'),
  proponer_corte_liquidez: herramientaDePropuesta('liquidez.registrar'),
  proponer_editar_corte_liquidez: herramientaDePropuesta('liquidez.editar'),
  proponer_borrar_corte_liquidez: herramientaDePropuesta('liquidez.borrar'),
  proponer_crear_linea: herramientaDePropuesta('presupuesto.crear'),
  proponer_ajustar_linea: herramientaDePropuesta('presupuesto.ajustar'),
  proponer_cancelar_linea: herramientaDePropuesta('presupuesto.cancelar'),
  proponer_traspaso: herramientaDePropuesta('presupuesto.traspasar'),
  proponer_mover_linea: herramientaDePropuesta('presupuesto.mover'),
  proponer_crear_cuenta: herramientaDePropuesta('cuenta.crear'),
  proponer_editar_cuenta: herramientaDePropuesta('cuenta.editar'),
  proponer_borrar_cuenta: herramientaDePropuesta('cuenta.borrar'),
  proponer_crear_categoria: herramientaDePropuesta('categoria.crear'),
  proponer_editar_categoria: herramientaDePropuesta('categoria.editar'),
  proponer_referencias_quincena: herramientaDePropuesta('quincena.referencias'),
  proponer_crear_usuario: herramientaDePropuesta('usuario.crear'),
  proponer_editar_usuario: herramientaDePropuesta('usuario.editar'),
  proponer_crear_forma_pago: herramientaDePropuesta('metodo_pago.crear'),
}

// Registro directo de un gasto nuevo en formato claro (solo Telegram). Es la
// unica herramienta que escribe sin boton: reemplaza al parser que antes
// registraba ANTES de que Milo viera el mensaje. El agente decide con la
// platica a la vista si el mensaje es un gasto nuevo; quien la ejecuta es
// index.js (ctx.registrarGasto), con el mismo flujo de siempre: reglas +
// clasificador, y la confirmacion con los botones de linea.
const REGISTRO_DIRECTO_DEFINITION = {
  name: 'registrar_gasto',
  description: 'Registra AL MOMENTO (sin botón) un movimiento NUEVO escrito en formato claro: monto + qué ("200 super", "1581, 3b", "uber 85 ayer", "me pagaron 5000"). Pasa el texto tal cual lo escribió el usuario. NO lo uses para saldos de cuentas, respuestas a tus preguntas ni nada dudoso.',
  args: { text: 'el mensaje del usuario tal cual, requerido' },
}

// "el gasto de suerox mandalo a diversion", "pon la gasolina en transporte":
// mover un gasto que YA existe a otra linea. Usa el flujo de Telegram de
// siempre (index.js, handleReassign): busca el movimiento, arma botones con
// las lineas candidatas y solo escribe con el toque.
const REASIGNAR_DEFINITION = {
  name: 'proponer_reasignar_gasto',
  description: 'Para mover un gasto que YA existe a otra línea de presupuesto o categoría ("el gasto de suerox mándalo a diversión", "pon la gasolina en transporte"). Busca el movimiento y manda botones con las líneas candidatas; nada cambia hasta el toque.',
  args: { reference: 'qué gasto (descripción o monto), requerido', destination: 'línea o categoría destino, requerido' },
}

async function registrarGastoDirecto(args, registrarGasto) {
  const texto = String(args.text ?? args.texto ?? '').trim().slice(0, 300)
  if (!texto) return { ok: false, error: 'Falta text: el mensaje del usuario tal cual.' }
  if (!/\d/.test(texto)) return { ok: false, error: 'Ese texto no trae monto. Pregunta cuánto fue.' }
  const r = await registrarGasto(texto)
  if (!r?.ok) return { ok: false, error: r?.error || 'No se registró.' }
  return { ok: true, registrado: r.movimiento, nota: 'Ya quedó guardado y el bot ya mandó la confirmación con sus botones. Contesta con una línea corta o nada que agregar.' }
}

// `ctx.acciones` lo pasan Telegram y la web (chatId, userId, solicitante). Sin
// el, las proponer_* no existen: WhatsApp sigue siendo de solo lectura.
// `ctx.registrarGasto` solo lo pasa Telegram: habilita registrar_gasto.
async function executeTool(name, args = {}, ctx = {}) {
  if (name === REASIGNAR_DEFINITION.name) {
    if (!ctx.reasignarGasto) return { ok: false, error: `Herramienta no permitida: ${name}` }
    const referencia = String(args?.reference ?? args?.referencia ?? '').trim().slice(0, 100)
    const destino = String(args?.destination ?? args?.destino ?? '').trim().slice(0, 100)
    if (!referencia || !destino) return { ok: false, error: 'Faltan reference (qué gasto) y destination (a qué línea).' }
    try {
      const ok = await ctx.reasignarGasto(referencia, destino)
      return ok
        ? { ok: true, nota: 'El bot ya mandó las opciones con botones. Contesta con una línea corta o nada que agregar.' }
        : { ok: false, error: 'No hay quincena activa para reasignar.' }
    } catch (error) {
      console.error(`MILO_TOOL_ERROR ${name}:`, error.message)
      return { ok: false, error: `No pude reasignar: ${error.message}` }
    }
  }
  if (name === REGISTRO_DIRECTO_DEFINITION.name) {
    if (!ctx.registrarGasto) return { ok: false, error: `Herramienta no permitida: ${name}` }
    try {
      return await registrarGastoDirecto(args || {}, ctx.registrarGasto)
    } catch (error) {
      console.error(`MILO_TOOL_ERROR ${name}:`, error.message)
      return { ok: false, error: `No pude registrar: ${error.message}` }
    }
  }

  const esPropuesta = Object.prototype.hasOwnProperty.call(WRITE_TOOL_HANDLERS, name)
  const handler = esPropuesta
    ? (ctx.acciones ? WRITE_TOOL_HANDLERS[name] : null)
    : TOOL_HANDLERS[name]
  if (!handler) return { ok: false, error: `Herramienta no permitida: ${name}` }

  try {
    return esPropuesta ? await handler(args || {}, ctx.acciones) : await handler(args || {})
  } catch (error) {
    console.error(`MILO_TOOL_ERROR ${name}:`, error.message)
    return { ok: false, error: `No pude ejecutar ${name}: ${error.message}` }
  }
}

function getToolDefinitions({ acciones = false, registroDirecto = false } = {}) {
  if (!acciones) return TOOL_DEFINITIONS
  return registroDirecto
    ? [...TOOL_DEFINITIONS, REGISTRO_DIRECTO_DEFINITION, REASIGNAR_DEFINITION, ...WRITE_TOOL_DEFINITIONS]
    : [...TOOL_DEFINITIONS, ...WRITE_TOOL_DEFINITIONS]
}

function esHerramientaDePropuesta(name) {
  return Object.prototype.hasOwnProperty.call(WRITE_TOOL_HANDLERS, name)
}

module.exports = { executeTool, getToolDefinitions, esHerramientaDePropuesta, resolvePeriod, infoPeriodo, parseMonto, _interno: { enumValido, fechaValida } }
