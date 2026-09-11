const { GoogleGenerativeAI } = require('@google/generative-ai')
const prisma = require('./lib/prisma')

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash'
let model = null

function isEnabled() {
  // El cerebro financiero tiene un router local que funciona aun si Gemini
  // esta caido. Gemini queda como respaldo para lenguaje realmente ambiguo.
  return true
}

function getModel() {
  if (!GEMINI_API_KEY) return null
  if (!model) {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    model = genAI.getGenerativeModel({ model: GEMINI_MODEL })
  }
  return model
}

function money(value) {
  return Number(value || 0).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function mexicoDateString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dbDate(dateString) {
  return new Date(`${dateString}T00:00:00.000Z`)
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenSet(value) {
  const aliases = {
    gasolina: 'gas',
    combustible: 'gas',
    super: 'supermercado',
    despensa: 'supermercado',
  }
  const tokens = normalize(value).split(' ').filter(t => t.length >= 3)
  return new Set(tokens.flatMap(t => [t, aliases[t]].filter(Boolean)))
}

function similarity(a, b) {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.95
  const aa = tokenSet(na)
  const bb = tokenSet(nb)
  if (!aa.size || !bb.size) return 0
  let common = 0
  for (const t of aa) if (bb.has(t)) common += 1
  return common / Math.max(aa.size, bb.size)
}

function inferScope(normalized) {
  if (/\b(nos|nosotros|tenemos|nuestro|nuestra|familia|casa)\b/.test(normalized)) return 'household'
  if (/\b(yo|me|mi|mis|tengo|gaste|gasto|llevo|hice)\b/.test(normalized)) return 'me'
  return 'household'
}

function extractBudgetSubject(normalized) {
  const patterns = [
    /(?:presupuesto|linea)(?: de| del| para)? (.+)$/,
    /(?:cuanto|cuanta).*?(?:queda|resta|disponible)(?: de| del| para)? (.+)$/,
    /(?:como voy|como vamos)(?: con| en)? (.+)$/,
  ]
  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (match?.[1]) {
      const subject = match[1]
        .replace(/\b(presupuesto|esta quincena|la quincena|ahorita|hoy)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (subject && subject.length >= 3) return subject
    }
  }
  return null
}

function classifyQuestionLocally(text) {
  const n = normalize(text)
  if (!n) return null
  const scope = inferScope(n)

  if (
    /\b(sin asignar|sin asignacion|no asignad|sin presupuesto|sin linea|sin una linea|no vinculad|sueltos?|huerfanos?)\b/.test(n) ||
    (/\bgastos?\b/.test(n) && /\b(asignar|presupuesto)\b/.test(n) && /\b(que|cuales|cuantos|tengo|tenemos)\b/.test(n))
  ) {
    return { intent: 'unassigned_expenses', subject: null, scope }
  }

  if (/\bhoy\b/.test(n) && /\b(gaste|gasto|gastado|gastos|compras|movimientos)\b/.test(n)) {
    return { intent: 'expenses_today', subject: null, scope }
  }

  if (
    /\b(liquidez|saldo en cuentas|dinero real|dinero disponible|efectivo disponible|cuanto dinero|cuanta lana tenemos|cuanta lana tengo)\b/.test(n)
  ) {
    return { intent: 'liquidity', subject: null, scope }
  }

  if (
    (/\bquincena\b/.test(n) && /\b(como|resumen|vamos|va|estado|balance)\b/.test(n)) ||
    /^como (vamos|voy)$/.test(n)
  ) {
    return { intent: 'quincena_summary', subject: null, scope }
  }

  if (/\b(ultimos movimientos|movimientos recientes|gastos recientes|ultimas compras|que he registrado|que hemos registrado)\b/.test(n)) {
    return { intent: 'recent_transactions', subject: null, scope }
  }

  if (
    /\bpresupuesto\b/.test(n) && /\b(cuanto|cuanta|queda|resta|disponible|voy|vamos|estado)\b/.test(n) ||
    /\bcuanto me queda de\b/.test(n) ||
    /\bcuanto queda de\b/.test(n)
  ) {
    return { intent: 'budget_remaining', subject: extractBudgetSubject(n), scope }
  }

  return null
}

async function currentQuincena() {
  const today = dbDate(mexicoDateString())
  return prisma.quincena.findFirst({
    where: { fechaInicio: { lte: today }, fechaFin: { gte: today } },
    orderBy: { fechaInicio: 'desc' },
  })
}

async function classifyQuestion(text) {
  // Primero resolvemos localmente las preguntas frecuentes. Esto evita una
  // llamada redundante a Gemini y mantiene funcionando las consultas clave
  // incluso si Google responde 503 por alta demanda.
  const local = classifyQuestionLocally(text)
  if (local) {
    console.log('TELEGRAM_BRAIN_LOCAL_INTENT:', JSON.stringify(local))
    return local
  }

  const m = getModel()
  if (!m) return null

  const prompt = `Eres el router de intenciones financieras de Milo.
Analiza la pregunta del usuario y responde SOLO JSON válido, sin markdown.

Intenciones permitidas:
- expenses_today: gasto(s) hechos hoy
- unassigned_expenses: gastos sin línea de presupuesto / sueltos / sin asignar
- budget_remaining: cuánto queda de presupuesto, de una línea o del presupuesto general
- liquidity: cuánto dinero hay realmente disponible / saldo en cuentas / liquidez
- quincena_summary: cómo va la quincena / resumen del periodo
- recent_transactions: últimos movimientos / qué se ha registrado recientemente
- generic_finance: cualquier otra pregunta financiera

Además devuelve:
- subject: concepto o línea relevante, por ejemplo "gasolina Corolla", "guardería", "super"; null si no aplica
- scope: "me" si habla en primera persona (yo, me, gasté, tengo), "household" si habla de nosotros, casa, familia o es general

Ejemplos:
"cuánta lana me gasté hoy" => {"intent":"expenses_today","subject":null,"scope":"me"}
"qué gastos tengo sueltos" => {"intent":"unassigned_expenses","subject":null,"scope":"me"}
"qué tenemos sin asignar al presupuesto" => {"intent":"unassigned_expenses","subject":null,"scope":"household"}
"cuánto me queda de gasolina Corolla" => {"intent":"budget_remaining","subject":"gasolina Corolla","scope":"household"}
"cuánto presupuesto queda" => {"intent":"budget_remaining","subject":null,"scope":"household"}
"cuánto dinero tenemos ahorita" => {"intent":"liquidity","subject":null,"scope":"household"}
"cómo vamos esta quincena" => {"intent":"quincena_summary","subject":null,"scope":"household"}

Pregunta: ${JSON.stringify(text)}

Formato exacto:
{"intent":"...","subject":null,"scope":"me|household"}`

  try {
    const result = await m.generateContent(prompt)
    const raw = result.response.text().trim().replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(raw)
    const intents = new Set([
      'expenses_today',
      'unassigned_expenses',
      'budget_remaining',
      'liquidity',
      'quincena_summary',
      'recent_transactions',
      'generic_finance',
    ])
    if (!intents.has(parsed.intent)) parsed.intent = 'generic_finance'
    parsed.scope = parsed.scope === 'me' ? 'me' : 'household'
    parsed.subject = typeof parsed.subject === 'string' && parsed.subject.trim() ? parsed.subject.trim() : null
    return parsed
  } catch (error) {
    console.error('TELEGRAM_BRAIN_CLASSIFY_ERROR:', error.message)
    return null
  }
}

function scopedWhere(user, scope) {
  return scope === 'me' && user?.id ? { userId: user.id } : {}
}

async function expensesToday(user, scope) {
  const today = mexicoDateString()
  const txs = await prisma.transaccion.findMany({
    where: {
      fecha: dbDate(today),
      tipo: 'Gasto',
      ...scopedWhere(user, scope),
    },
    include: { categoria: true, user: true },
    orderBy: [{ monto: 'desc' }, { id: 'desc' }],
  })

  if (!txs.length) return scope === 'me' ? 'Hoy no tienes gastos registrados.' : 'Hoy no hay gastos registrados.'
  const total = txs.reduce((sum, tx) => sum + Number(tx.monto), 0)
  const who = scope === 'me' ? 'Tus gastos de hoy' : 'Gastos de hoy'
  const lines = txs.slice(0, 8).map(tx => `• $${money(tx.monto)} — ${tx.descripcion} (${tx.categoria.nombre})`)
  return [`📅 *${who}*`, `Total: *$${money(total)}* en ${txs.length} movimiento(s).`, '', ...lines].join('\n')
}

async function unassignedExpenses(user, scope) {
  const q = await currentQuincena()
  if (!q) return 'No encontré una quincena activa para consultar.'

  const txs = await prisma.transaccion.findMany({
    where: {
      quincenaId: q.id,
      tipo: 'Gasto',
      presupuestoId: null,
      ...scopedWhere(user, scope),
    },
    include: { categoria: true, user: true },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
  })

  if (!txs.length) return `✅ No hay gastos sin asignar en ${q.codigo}.`
  const total = txs.reduce((sum, tx) => sum + Number(tx.monto), 0)
  const lines = txs.slice(0, 10).map(tx => {
    const owner = scope === 'household' && tx.user?.nombre ? ` — ${tx.user.nombre}` : ''
    return `• $${money(tx.monto)} — ${tx.descripcion} (${tx.categoria.nombre})${owner}`
  })
  return [
    `🧩 *Gastos sin línea de presupuesto — ${q.codigo}*`,
    `Total: *$${money(total)}* en ${txs.length} movimiento(s).`,
    '',
    ...lines,
    ...(txs.length > 10 ? [`… y ${txs.length - 10} más.`] : []),
  ].join('\n')
}

async function budgetRemaining(subject) {
  const q = await currentQuincena()
  if (!q) return 'No encontré una quincena activa para consultar.'

  const lines = await prisma.presupuesto.findMany({
    where: {
      quincenaId: q.id,
      tipo: 'Gasto',
      estadoLinea: { not: 'Cancelada' },
    },
    include: { categoria: true },
    orderBy: { id: 'asc' },
  })

  if (!lines.length) return `No hay líneas de gasto presupuestadas en ${q.codigo}.`

  const ids = lines.map(line => line.id)
  const spendRows = await prisma.transaccion.groupBy({
    by: ['presupuestoId'],
    where: { presupuestoId: { in: ids }, tipo: 'Gasto' },
    _sum: { monto: true },
  })
  const spent = new Map(spendRows.map(row => [row.presupuestoId, Number(row._sum.monto || 0)]))

  const status = lines.map(line => {
    const budget = Number(line.montoRevisado ?? line.montoPresupuestado ?? 0)
    const used = spent.get(line.id) || 0
    return {
      id: line.id,
      descripcion: line.descripcion,
      categoria: line.categoria.nombre,
      budget,
      used,
      remaining: budget - used,
      score: subject ? similarity(subject, `${line.descripcion} ${line.categoria.nombre}`) : 0,
    }
  })

  if (subject) {
    const ranked = [...status].sort((a, b) => b.score - a.score)
    const best = ranked[0]
    if (best && best.score >= 0.45) {
      return [
        `📂 *${best.descripcion}*`,
        `Presupuesto: $${money(best.budget)}`,
        `Gastado: $${money(best.used)}`,
        best.remaining >= 0
          ? `Disponible: *$${money(best.remaining)}*`
          : `Excedido: *$${money(Math.abs(best.remaining))}*`,
      ].join('\n')
    }

    const options = ranked.slice(0, 5).map(x => `• ${x.descripcion} (${x.categoria})`).join('\n')
    return `No identifiqué con seguridad la línea "${subject}". Las líneas más cercanas son:\n${options}`
  }

  const totalBudget = status.reduce((sum, x) => sum + x.budget, 0)
  const totalUsed = status.reduce((sum, x) => sum + x.used, 0)
  const remaining = totalBudget - totalUsed
  return [
    `📊 *Presupuesto de ${q.codigo}*`,
    `Presupuestado: $${money(totalBudget)}`,
    `Gastado vinculado: $${money(totalUsed)}`,
    remaining >= 0 ? `Restante: *$${money(remaining)}*` : `Excedido: *$${money(Math.abs(remaining))}*`,
  ].join('\n')
}

async function liquidity() {
  const snapshot = await prisma.liquidezSnapshot.findFirst({
    include: { montos: { include: { cuenta: true } }, quincena: true },
    orderBy: [{ fechaCorte: 'desc' }, { fechaRegistro: 'desc' }, { id: 'desc' }],
  })

  if (!snapshot) {
    return 'Todavía no hay un corte de liquidez. Sin ese corte no puedo decirte cuánto dinero hay realmente en cuentas.'
  }

  const total = snapshot.montos.reduce((sum, row) => sum + Number(row.monto), 0)
  const date = snapshot.fechaCorte.toISOString().slice(0, 10)
  const accounts = snapshot.montos
    .filter(row => Number(row.monto) !== 0)
    .slice(0, 8)
    .map(row => `• ${row.cuenta.nombre}: $${money(row.monto)}`)

  return [
    `💵 *Liquidez del último corte*`,
    `Saldo en cuentas: *$${money(total)}*`,
    `Corte: ${date}${snapshot.quincena?.codigo ? ` · ${snapshot.quincena.codigo}` : ''}`,
    '',
    ...accounts,
    '',
    '_Este dato depende del último corte de liquidez; no lo confundo con presupuesto disponible._',
  ].join('\n')
}

async function quincenaSummary() {
  const q = await currentQuincena()
  if (!q) return 'No encontré una quincena activa para consultar.'

  const rows = await prisma.transaccion.groupBy({
    by: ['tipo'],
    where: { quincenaId: q.id },
    _sum: { monto: true },
  })
  const totals = Object.fromEntries(rows.map(row => [row.tipo, Number(row._sum.monto || 0)]))
  const unassigned = await prisma.transaccion.aggregate({
    where: { quincenaId: q.id, tipo: 'Gasto', presupuestoId: null },
    _sum: { monto: true },
    _count: true,
  })

  return [
    `📊 *Resumen ${q.codigo}*`,
    `Ingresos: $${money(totals.Ingreso || 0)}`,
    `Gastos: $${money(totals.Gasto || 0)}`,
    `Ahorro: $${money(totals.Ahorro || 0)}`,
    `Gastos sin asignar: $${money(unassigned._sum.monto || 0)} (${unassigned._count})`,
  ].join('\n')
}

async function recentTransactions(user, scope) {
  const txs = await prisma.transaccion.findMany({
    where: scopedWhere(user, scope),
    include: { categoria: true, user: true },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    take: 10,
  })
  if (!txs.length) return 'No hay movimientos registrados todavía.'

  return [
    '📋 *Últimos movimientos*',
    '',
    ...txs.map(tx => {
      const owner = scope === 'household' && tx.user?.nombre ? ` · ${tx.user.nombre}` : ''
      return `• ${tx.tipo === 'Ingreso' ? '📈' : tx.tipo === 'Ahorro' ? '🐷' : '📉'} $${money(tx.monto)} — ${tx.descripcion}${owner}`
    }),
  ].join('\n')
}

async function answerQuestion(text, user) {
  const routing = await classifyQuestion(text)
  if (!routing) return null

  console.log('TELEGRAM_BRAIN_INTENT:', JSON.stringify(routing))

  switch (routing.intent) {
    case 'expenses_today':
      return expensesToday(user, routing.scope)
    case 'unassigned_expenses':
      return unassignedExpenses(user, routing.scope)
    case 'budget_remaining':
      return budgetRemaining(routing.subject)
    case 'liquidity':
      return liquidity()
    case 'quincena_summary':
      return quincenaSummary()
    case 'recent_transactions':
      return recentTransactions(user, routing.scope)
    default:
      return null
  }
}

module.exports = { isEnabled, classifyQuestion, answerQuestion }
