// Banco de preguntas reales de Milo (Telegram), sin red ni Postgres.
//
// POR QUE EXISTE: Rene pregunto "cuanto queda de dinero" y Milo no entendio.
// Un regex se comia la pregunta antes de que la viera la IA, y cuando la IA
// fallaba, el texto caia al parser y "¿me alcanza para los 5000 de la
// tarjeta?" quedaba registrado como un gasto de $5000.
//
// Que fija:
//   1. El ruteo de frases reales en espanol: pregunta -> agente, gasto con
//      formato claro -> parser, numero sin formato -> clasificador.
//   2. Con el servidor real (src/index.js) y un modelo FALSO guionizado:
//      ninguna pregunta se registra como gasto, los gastos si se registran, y
//      la respuesta de "cuanto me queda" trae el MISMO veredicto y los MISMOS
//      numeros que el panel "¿Cuadra tu dinero?" del dashboard (calcularCuadre
//      de dashboard/src/lib/presupuesto-totales.ts, corrido aqui de verdad).
//   3. "¿y la quincena pasada?" usa la conversacion anterior.
//   4. "Escribiendo..." sale antes de la primera llamada a la IA.
//   5. Si el agente falla, Milo lo dice y NO registra nada.
//
// El modelo falso no pretende ser inteligente: elige herramienta por palabras
// clave y redacta con lo que la herramienta devolvio. Lo que se prueba es la
// tuberia (ruteo, herramientas, numeros, memoria), no la calidad del LLM.

process.env.TZ = 'America/Mexico_City'
process.env.DATABASE_URL = 'postgresql://x:x@localhost:0/x'
process.env.GOOGLE_SHEETS_ENABLED = 'false'
process.env.SKIP_PRISMA_BOOTSTRAP = '1'
process.env.PORT = process.env.TEST_PORT || '34571'
process.env.TELEGRAM_BOT_TOKEN = 'test:token'
process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto-de-prueba'
process.env.TELEGRAM_ALLOWED_CHAT_IDS = '-1001111111111'
process.env.DEEPSEEK_API_KEY = 'falsa-nunca-sale-a-la-red'
delete process.env.GEMINI_API_KEY

const path = require('path')
const SRC = path.join(__dirname, '..', 'src')
const { crearFakePrisma } = require('./fake-prisma')
const { datosMilo } = require('./fixture-milo')
const { cuadreSegunDashboard } = require('./dashboard-ts')
const { clasificarMensaje } = require(path.join(SRC, 'telegramRouting'))
const { formatMXN } = require(path.join(SRC, 'lib', 'finanzas-quincena'))
const { normalize } = require(path.join(SRC, 'financeUtils'))

const CHAT = '-1001111111111'

// Las pruebas escriben directo a stdout: console.* queda capturado para leer
// los logs del servidor (TELEGRAM_QA) y solo se reimprime con VERBOSE=1.
const salida = (...a) => process.stdout.write(`${a.join(' ')}\n`)

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; salida(`  OK    ${label}`) }
  else { fail++; salida(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}
const centavos = n => Math.round(Number(n) * 100)
const igual = (a, b) => centavos(a) === centavos(b)

// ---- Datos ------------------------------------------------------------------

const fixture = datosMilo()
// Categorias extra para que el parser encuentre todas las que puede adivinar.
fixture.tablas.categoria.push(
  { id: 5, nombre: 'Salud', tipo: 'Gasto', activo: true, cuentaParaLimite: true },
  { id: 6, nombre: 'Suscripciones', tipo: 'Gasto', activo: true, cuentaParaLimite: true },
  { id: 7, nombre: 'Deudas', tipo: 'Gasto', activo: true, cuentaParaLimite: true },
)
const fakePrisma = crearFakePrisma(fixture.tablas)
const T = fixture.tablas

const fakeDb = {
  findUserByPhone: async () => null,
  findUserByName: async nombre => (String(nombre).toLowerCase() === 'rene' ? { id: 1, nombre: 'Rene' } : null),
  findCategoria: async nombre => T.categoria.find(c => c.nombre.toLowerCase() === String(nombre || '').toLowerCase()) || null,
  findMetodoPago: async nombre => (nombre ? { id: 1, nombre } : null),
  findQuincenaByCodigo: async codigo => T.quincena.find(q => q.codigo === codigo) || null,
  listQuincenas: async () => T.quincena,
  checkDatabase: async () => ({ ok: true }),
  messageExists: async () => false,
  saveMessage: async data => ({ id: 1, ...data }),
  saveTransaccion: async data => ({ id: 1, ...data }),
}

// ---- Telegram sin red ----------------------------------------------------------

const eventos = []   // orden de lo que pasa: typing, llamadas al modelo, envios
const enviados = []
const realTelegram = require(path.join(SRC, 'telegram.js'))
const fakeTelegram = {
  ...realTelegram,
  sendTelegramMessage: async (chatId, message, replyTo, opts = {}) => {
    eventos.push('send')
    enviados.push({ chatId, message, buttons: opts.buttons || null, plain: !!opts.plain })
    return { ok: true, data: {} }
  },
  sendChatAction: async (chatId, action = 'typing') => {
    eventos.push(`action:${action}`)
    return { ok: true, data: {} }
  },
  editMessageText: async () => ({ ok: true, data: {} }),
  answerCallbackQuery: async () => ({ ok: true, data: {} }),
  registerWebhook: async () => ({ ok: true, skipped: true }),
  getWebhookInfo: async () => ({ ok: true, data: { result: {} } }),
  getMe: async () => ({ ok: true, data: { result: { username: 'milo_test', can_read_all_group_messages: true } } }),
  checkGroupPrivacyMode: async () => ({ ok: true, skipped: true }),
}

// ---- Modelo falso guionizado ---------------------------------------------------

const herramientasPedidas = []
let modeloCaido = false

function preguntaActual(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user' && !m.content.startsWith('TOOL_RESULT') && !m.content.startsWith('SYSTEM:')) return m.content
  }
  return ''
}

function elegirHerramienta(pregunta, messages) {
  const n = normalize(pregunta)
  const monto = /(\d[\d,]*)/.exec(pregunta.replace(/,/g, ''))
  const huboDinero = messages.some(m => m.role === 'assistant' && /Te (faltan|sobran)/.test(m.content))
  if (/alcanza/.test(n)) return { tool: 'get_money_status', args: monto ? { amount: Number(monto[1]) } : {} }
  if (/pasada|anterior/.test(n) && /\b(vs|contra|comparad)/.test(n)) return { tool: 'compare_periods', args: {} }
  if (/pasada|anterior/.test(n)) {
    return huboDinero
      ? { tool: 'get_money_status', args: { period: 'anterior' } }
      : { tool: 'compare_periods', args: {} }
  }
  if (/pagos|falta pagar|vencid|por pagar/.test(n)) return { tool: 'get_upcoming_payments', args: {} }
  if (/gaste mas|gastamos mas|en que gaste/.test(n)) return { tool: 'search_transactions', args: { period: 'current', type: 'Gasto', limit: 1 } }
  if (/sin asignar|sueltos/.test(n)) return { tool: 'search_transactions', args: { period: 'current', type: 'Gasto', unassigned: true } }
  if (/\bhoy\b/.test(n) && /gast/.test(n)) return { tool: 'search_transactions', args: { dateFrom: fixture.hoy, dateTo: fixture.hoy, type: 'Gasto' } }
  if (/cuentas|banco/.test(n)) return { tool: 'get_liquidity', args: {} }
  return { tool: 'get_money_status', args: {} }
}

function redactar(tool, r) {
  if (!r?.ok) return `No encontré el dato: ${r?.error || 'sin detalle'}`
  switch (tool) {
    case 'get_money_status': {
      const lineas = [...r.summary]
      if (r.perDay == null && r.verdict === 'falta' && r.isCurrent) lineas.push('Hoy no hay margen para gastar por día.')
      return `${r.period}: ${lineas.slice(0, 4).join('\n')}`
    }
    case 'get_upcoming_payments':
      return [r.totalToPayText, ...r.payments.slice(0, 3).map(p => `• ${p.name}: ${formatMXN(p.toPay)}${p.overdue ? ' (vencido)' : ''}`)].join('\n')
    case 'compare_periods':
      return `${r.period.code} vs ${r.against.code}: gastos ${formatMXN(r.period.expenses)} contra ${formatMXN(r.against.expenses)}.`
    case 'search_transactions': {
      const top = r.totals.byCategory[0]
      return top ? `Donde más gastaste: ${top.category}, ${formatMXN(top.total)}. Total ${formatMXN(r.totals.sum)}.` : 'No hay gastos con ese filtro.'
    }
    case 'get_liquidity':
      return `En cuentas: ${formatMXN(r.cash)}. Por pagar: ${formatMXN(r.remainingToPay)}.`
    default:
      return 'Listo.'
  }
}

const fakeDeepseek = {
  isEnabled: () => true,
  complete: async (messages) => {
    eventos.push('ia')
    if (modeloCaido) return null
    const ultimo = messages[messages.length - 1].content
    if (ultimo.startsWith('TOOL_RESULT')) {
      const m = /^TOOL_RESULT (\w+):\n([\s\S]*?)\n\nContinúa/.exec(ultimo)
      return JSON.stringify({ action: 'answer', answer: redactar(m[1], JSON.parse(m[2])) })
    }
    const eleccion = elegirHerramienta(preguntaActual(messages), messages)
    herramientasPedidas.push(eleccion)
    return JSON.stringify({ action: 'tool', ...eleccion })
  },
  // El clasificador decide lo ambiguo ("super 200 ayer", "me pagaron 5000"),
  // enriquece los gastos claros ("200 suerox" -> Salud) y reconoce las
  // reasignaciones que la regex no entiende. Para todo lo demas dice
  // 'question', que en un gasto claro NO impide registrarlo.
  classify: async (text) => {
    eventos.push('ia')
    if (modeloCaido) return null
    const n = normalize(text)
    const monto = /(\d+)/.exec(n)
    if (/^super \d+ ayer$/.test(n)) {
      return { type: 'expense', monto: Number(monto[1]), descripcion: 'super', categoria: 'Familia', formaPago: 'Efectivo', tipo: 'Gasto', estatus: 'Pagado' }
    }
    if (/^200 suerox$/.test(n)) {
      return { type: 'expense', monto: 200, descripcion: 'suerox', categoria: 'Salud', formaPago: 'Efectivo', tipo: 'Gasto', estatus: 'Pagado' }
    }
    if (/^me pagaron \d+$/.test(n)) {
      return { type: 'expense', monto: Number(monto[1]), descripcion: 'pago', categoria: 'Ingresos', formaPago: 'Transferencia', tipo: 'Ingreso', estatus: 'Pagado' }
    }
    if (/^pon la gasolina en transporte$/.test(n)) {
      return { type: 'reassign', referencia: 'gasolina', destino: 'transporte' }
    }
    return { type: 'question', intent: 'generic_finance', subject: null, scope: 'household' }
  },
}

for (const [rel, exports] of [
  ['database.js', fakeDb],
  ['lib/prisma.js', fakePrisma],
  ['telegram.js', fakeTelegram],
  ['deepseek.js', fakeDeepseek],
]) {
  const p = require.resolve(path.join(SRC, rel))
  require.cache[p] = { id: p, filename: p, loaded: true, exports }
}

const logs = []
for (const nivel of ['log', 'warn', 'error']) {
  const original = console[nivel].bind(console)
  console[nivel] = (...args) => {
    logs.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
    if (process.env.VERBOSE) original(...args)
  }
}

// ---- Harness HTTP ----------------------------------------------------------------

const sleep = ms => new Promise(r => setTimeout(r, ms))
let updateId = 5000

async function preguntar(text) {
  updateId++
  const antes = enviados.length
  await fetch(`http://localhost:${process.env.PORT}/telegram/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': process.env.TELEGRAM_WEBHOOK_SECRET },
    body: JSON.stringify({
      update_id: updateId,
      message: {
        message_id: updateId,
        chat: { id: Number(CHAT), type: 'private' },
        from: { id: 42, first_name: 'Rene', username: 'rene' },
        text,
      },
    }),
  })
  for (let i = 0; i < 100 && enviados.length === antes; i++) await sleep(20)
  await sleep(20)
  return enviados.at(-1)
}

const creadas = () => fakePrisma._escrituras.filter(([tabla, op]) => tabla === 'transaccion' && op === 'create')

// ---- Casos -----------------------------------------------------------------------

const PREGUNTAS = [
  'cuanto queda de dinero',
  'cuánto me queda',
  'cuanto me queda?',
  'me alcanza para 5000 de la tarjeta?',
  '¿me alcanza para los 2,000 del súper?',
  'cuánto puedo gastar al día',
  'qué pagos vienen',
  'que falta por pagar?',
  'y la quincena pasada?',
  'en qué gasté más',
  'cómo voy',
  'como vamos esta quincena',
  'resumen',
  'dame el resumen',
  'cuadra mi dinero?',
  'cuánto dinero tenemos en cuentas',
  'qué gastos tengo sin asignar',
  'cuánto gasté hoy',
  'cómo voy vs la quincena pasada',
  'tengo 3000 en la cartera, me alcanza?',
  'oye milo cuanto llevo gastado',
  '5000 me alcanza',
]

const GASTOS = [
  { texto: '200 super', monto: 200 },
  { texto: '$150, uber', monto: 150 },
  { texto: '300 sueltos', monto: 300 },
  { texto: '200 de saldo para celular', monto: 200 },
  { texto: 'gasté 350 en gasolina', monto: 350 },
  { texto: 'uber 150', monto: 150 },
]

const AMBIGUOS = [{ texto: 'super 200 ayer', monto: 200 }]

// Preguntas SIN "?" que empiezan con monto: antes salian como gasto claro.
const PREGUNTAS_CON_MONTO = [
  '5000 sobra',
  '5000 para la renta alcanza',
  '5000 de tarjeta me queda',
  '5000 de la tarjeta, alcanza',
  '500 en super esta bien o no',
  '200 super que tal',
]

// Consultas cortas "palabra + numero": parecen "uber 150" y son consultas.
// Nunca pueden ser gasto claro; las decide el clasificador.
const CONSULTAS_CORTAS = [
  'quincena 37', 'gastos quincena 37', 'qna 38', 'ppto 38', 'ppto 5000', 'presupuesto 5000',
  'saldo 5000', 'saldo bbva 17886', 'saldo hoy 17886', 'movimientos 15', 'ultimos 10', 'top 5',
  'sueltos 3', 'dia 15', 'faltan 9075', 'quedan 500',
]

// Gastos claros que antes caian en ambiguo (y sin IA no se guardaban).
const GASTOS_CON_RUIDO = [
  '🛒 200 super', '💸200 super', 'gasolina 500 🚗', 'oye milo 200 super',
  'me gaste 500 en super', 'gasto 500 super', 'abono 2000 a la tarjeta',
]

// Ingresos, ahorros y retiros: el parser local los tipaba como Gasto. Los
// decide el clasificador, que si devuelve el tipo.
const MOVIMIENTOS_NO_GASTO = [
  'me pagaron 5000', 'cobre 1500 reembolso', 'ahorre 500', 'nos depositaron 8000',
  '5000 me pagaron', 'retire 1000 del ahorro',
]

// "mandalo a X" con monto o verbo al inicio: es una reasignacion, no un gasto.
const REASIGNACIONES = [
  '30 suerox mandalo a diversion', '150 uber pasalo a transporte', '200 de super mandalo a comida',
  '200 de uber pasalo a transporte', 'gaste 350 en gasolina, ponlo en transporte',
]

async function main() {
  console.log('\n[1] Ruteo de frases reales (sin red)')
  for (const p of PREGUNTAS) check(`pregunta -> agente: "${p}"`, clasificarMensaje(p).ruta === 'agente', JSON.stringify(clasificarMensaje(p)))
  for (const p of PREGUNTAS_CON_MONTO) check(`pregunta con monto -> agente: "${p}"`, clasificarMensaje(p).ruta === 'agente', JSON.stringify(clasificarMensaje(p)))
  for (const g of GASTOS) check(`gasto -> parser: "${g.texto}"`, clasificarMensaje(g.texto).ruta === 'gasto', JSON.stringify(clasificarMensaje(g.texto)))
  for (const g of GASTOS_CON_RUIDO) check(`gasto con emoji/relleno/verbo -> parser: "${g}"`, clasificarMensaje(g).ruta === 'gasto', JSON.stringify(clasificarMensaje(g)))
  for (const a of AMBIGUOS) check(`ambiguo -> clasificador: "${a.texto}"`, clasificarMensaje(a.texto).ruta === 'ambiguo', JSON.stringify(clasificarMensaje(a.texto)))
  for (const c of CONSULTAS_CORTAS) check(`consulta corta NO es gasto: "${c}"`, clasificarMensaje(c).ruta === 'ambiguo', JSON.stringify(clasificarMensaje(c)))
  for (const m of MOVIMIENTOS_NO_GASTO) check(`ingreso/ahorro -> clasificador: "${m}"`, clasificarMensaje(m).ruta === 'ambiguo', JSON.stringify(clasificarMensaje(m)))
  for (const r of REASIGNACIONES) check(`reasignacion con monto/verbo -> reasignar: "${r}"`, clasificarMensaje(r).ruta === 'reasignar', JSON.stringify(clasificarMensaje(r)))
  check('"pon el uber en transporte" -> lo ve el clasificador', clasificarMensaje('pon el uber en transporte').ruta === 'quiza-reasignar', JSON.stringify(clasificarMensaje('pon el uber en transporte')))
  check('"puedes mandar el gasto de suerox a diversion?" -> lo ve el clasificador',
    clasificarMensaje('puedes mandar el gasto de suerox a diversion?').ruta === 'quiza-reasignar', JSON.stringify(clasificarMensaje('puedes mandar el gasto de suerox a diversion?')))

  require(path.join(SRC, 'index.js'))
  await sleep(300)

  // Lo que dice el dashboard, calculado con SU codigo.
  const dash = await cuadreSegunDashboard(fakePrisma, 38)
  const c = dash.cuadre
  const titularDashboard = `Te faltan ${formatMXN(Math.abs(c.real))}`

  console.log('\n[2] get_money_status da el mismo veredicto y numeros que calcularCuadre')
  {
    const { executeTool } = require(path.join(SRC, 'miloTools'))
    const r = await executeTool('get_money_status', {})
    check('veredicto: falta (como el panel)', r.verdict === (c.real < 0 ? 'falta' : 'sobra'), r.verdict)
    check('monto = |cuadre.real|', igual(r.amount, Math.abs(c.real)), `${r.amount} vs ${c.real}`)
    check('en cuentas = cuadre.enCuentas', igual(r.inAccounts, c.enCuentas), r.inAccounts)
    check('por pagar = cuadre.porPagar', igual(r.toPay, c.porPagar), r.toPay)
    check('segun tu presupuesto = cuadre.teorico', igual(r.byBudget.amount, Math.abs(c.teorico)) && r.byBudget.verdict === (c.teorico < 0 ? 'falta' : 'sobra'), JSON.stringify(r.byBudget))
    check('Vas $X mejor/peor = cuadre.delta', igual(r.vsBudget.amount, Math.abs(c.delta)) && r.vsBudget.better === c.mejor, JSON.stringify(r.vsBudget))
    check('los numeros del panel de Q38', r.summary[0] === 'Te faltan $9,075.39 para cubrir lo que te queda por pagar esta quincena.', r.summary[0])
    check('dias que faltan contando hoy (12)', r.daysLeft === 12, r.daysLeft)
    check('con faltante no inventa un "por dia"', r.perDay === null, r.perDay)

    const alcanza = await executeTool('get_money_status', { amount: '5,000' })
    check('"me alcanza para 5000": no', alcanza.affordability?.fits === false, JSON.stringify(alcanza.affordability))
    check('te faltarian real - 5000', igual(alcanza.affordability.leftAfter, c.real - 5000), alcanza.affordability.leftAfter)

    // "cuanto ahorramos" por search_transactions: el retiro RESTA, igual que el
    // GET /api/transacciones del dashboard (500 de aporte - 300 de retiro).
    const ahorro = await executeTool('search_transactions', { period: 'current', type: 'Ahorro' })
    check('search_transactions Ahorro: sum resta el retiro (= dashboard)', igual(ahorro.totals.sum, dash.totales.Ahorro) && igual(ahorro.totals.sum, 200), `${ahorro.totals.sum} vs ${dash.totales.Ahorro}`)
    check('search_transactions Ahorro: byCategory y byType netos', igual(ahorro.totals.byCategory[0]?.total, 200) && igual(ahorro.totals.byType.Ahorro, 200), JSON.stringify(ahorro.totals))
    check('search_transactions marca la direccion de cada movimiento de ahorro',
      ahorro.transactions.some(t => t.direction === 'Retiro') && ahorro.transactions.some(t => t.direction === 'Aporte'), JSON.stringify(ahorro.transactions.map(t => t.direction)))
    const todo = await executeTool('search_transactions', { period: 'current' })
    check('search_transactions sin tipo: byType = totales del dashboard',
      igual(todo.totals.byType.Gasto, dash.totales.Gasto) && igual(todo.totals.byType.Ingreso, dash.totales.Ingreso) && igual(todo.totals.byType.Ahorro, dash.totales.Ahorro),
      JSON.stringify({ bot: todo.totals.byType, dash: dash.totales }))
  }

  console.log('\n[3] Ninguna pregunta se registra como gasto (servidor real, modelo falso)')
  const antesPreguntas = creadas().length
  const respuestas = {}
  for (const p of [...PREGUNTAS, ...PREGUNTAS_CON_MONTO]) {
    if (p === 'y la quincena pasada?') continue // va en [5], depende de la memoria
    const r = await preguntar(p)
    respuestas[p] = r
    check(`contesta "${p}"`, !!r?.message && !/No pude contestar/.test(r.message), r?.message)
  }
  check('CERO transacciones creadas por preguntas', creadas().length === antesPreguntas, JSON.stringify(creadas().slice(antesPreguntas)))
  check('las respuestas del agente van en texto plano', Object.values(respuestas).every(r => r.plain), JSON.stringify(Object.values(respuestas).filter(r => !r.plain)))

  console.log('\n[4] Las respuestas dicen lo mismo que el panel')
  check('"cuanto queda de dinero" -> Te faltan $9,075.39', respuestas['cuanto queda de dinero']?.message.includes(titularDashboard), respuestas['cuanto queda de dinero']?.message)
  check('"cuánto me queda" -> mismo veredicto', respuestas['cuánto me queda']?.message.includes(titularDashboard), respuestas['cuánto me queda']?.message)
  check('trae en cuentas y por pagar del panel',
    respuestas['cuánto me queda']?.message.includes(`${formatMXN(c.enCuentas)} en cuentas − ${formatMXN(c.porPagar)} por pagar`), respuestas['cuánto me queda']?.message)
  check('"me alcanza para 5000" -> no alcanza', /No te alcanza para \$5,000\.00/.test(respuestas['me alcanza para 5000 de la tarjeta?']?.message || ''), respuestas['me alcanza para 5000 de la tarjeta?']?.message)
  check('"qué pagos vienen" -> total por pagar del panel', respuestas['qué pagos vienen']?.message.includes(formatMXN(c.porPagar)), respuestas['qué pagos vienen']?.message)
  check('el vencido sale primero', /Tarjeta de credito.*vencido/.test((respuestas['qué pagos vienen']?.message || '').split('\n')[1] || ''), respuestas['qué pagos vienen']?.message)
  check('"en qué gasté más" -> Hogar', /Hogar/.test(respuestas['en qué gasté más']?.message || ''), respuestas['en qué gasté más']?.message)
  check('"cómo voy vs la quincena pasada" -> compara Q38 con Q37', /Q38 vs Q37/.test(respuestas['cómo voy vs la quincena pasada']?.message || ''), respuestas['cómo voy vs la quincena pasada']?.message)
  check('cada pregunta dejo TELEGRAM_QA con ruta agente y herramientas',
    logs.filter(l => l.startsWith('TELEGRAM_QA') && l.includes('"route":"agente"') && l.includes('"tools":["')).length >= PREGUNTAS.length - 1,
    logs.filter(l => l.startsWith('TELEGRAM_QA')).length)

  console.log('\n[5] Memoria: "¿y la quincena pasada?" sigue la conversacion')
  {
    const { olvidar } = require(path.join(SRC, 'financeAgent'))
    olvidar(null)
    await preguntar('cuánto me queda')
    const r = await preguntar('y la quincena pasada?')
    const ultima = herramientasPedidas.at(-1)
    check('pidio la misma herramienta para la anterior', ultima.tool === 'get_money_status' && ultima.args.period === 'anterior', JSON.stringify(ultima))
    check('contesta de Q37', /^Q37:/.test(r?.message || ''), r?.message)
  }

  console.log('\n[6] Los gastos SI se registran (y nacen sin linea)')
  for (const g of [...GASTOS, ...AMBIGUOS]) {
    const antes = creadas().length
    const r = await preguntar(g.texto)
    const tx = creadas().at(-1)?.[2]
    check(`"${g.texto}" se registra con $${g.monto}`, creadas().length === antes + 1 && Number(tx?.monto) === g.monto, `${creadas().length - antes} / ${tx?.monto}`)
    check(`"${g.texto}" nace sin linea (la asigna un toque)`, tx?.presupuestoId == null, tx?.presupuestoId)
    check(`"${g.texto}" confirma el registro`, /registrado/i.test(r?.message || ''), r?.message)
  }

  console.log('\n[6b] Lo que parece gasto y no lo es, y los gastos con ruido')
  {
    const antes = creadas().length
    for (const c of CONSULTAS_CORTAS) await preguntar(c)
    check('las consultas cortas ("quincena 37", "saldo 5000"...) no registran nada', creadas().length === antes, JSON.stringify(creadas().slice(antes).map(x => x[2].descripcion)))

    for (const r of [...REASIGNACIONES, '1813 gasolina mandalo a personal']) {
      const n = creadas().length
      const resp = await preguntar(r)
      check(`"${r}" NO registra un gasto nuevo`, creadas().length === n && !/registrado/i.test(resp?.message || ''), resp?.message)
    }
    const propuesta = enviados.at(-1)
    // En [6] ya se registro "gaste 350 en gasolina": hay dos, asi que pregunta cual.
    check('"1813 gasolina mandalo a personal" encuentra los gastos de gasolina y solo PROPONE con botones',
      /gasolina/i.test(propuesta?.message || '') && (propuesta?.buttons || []).length > 0, propuesta?.message)

    const resp = await preguntar('pon la gasolina en transporte')
    check('"pon la gasolina en transporte": el clasificador la reconoce y se propone con boton',
      /gasolina/i.test(resp?.message || '') && (resp?.buttons || []).length > 0 && logs.some(l => l.startsWith('TELEGRAM_QA') && l.includes('"route":"reasignar-clasificado"')), resp?.message)
    check('...sin escribir nada', creadas().length === antes)

    const n1 = creadas().length
    await preguntar('200 suerox')
    const suerox = creadas().at(-1)?.[2]
    check('"200 suerox": la IA enriquece la categoria de un gasto claro (Salud)', creadas().length === n1 + 1 && suerox?.categoriaId === 5, JSON.stringify({ cat: suerox?.categoriaId, tipo: suerox?.tipo }))

    const n2 = creadas().length
    await preguntar('me pagaron 5000')
    const pago = creadas().at(-1)?.[2]
    check('"me pagaron 5000" se registra como Ingreso, no como Gasto', creadas().length === n2 + 1 && pago?.tipo === 'Ingreso' && Number(pago?.monto) === 5000, JSON.stringify({ tipo: pago?.tipo, monto: pago?.monto }))

    const n3 = creadas().length
    await preguntar('🛒 200 super')
    check('"🛒 200 super" se registra', creadas().length === n3 + 1 && Number(creadas().at(-1)?.[2]?.monto) === 200, creadas().length - n3)
  }

  console.log('\n[7] "Escribiendo..." sale antes de cualquier llamada a la IA')
  {
    eventos.length = 0
    await preguntar('cuánto me queda')
    const iTyping = eventos.indexOf('action:typing')
    const iIa = eventos.indexOf('ia')
    check('hubo typing', iTyping >= 0, JSON.stringify(eventos))
    check('typing antes de la primera llamada al modelo', iTyping >= 0 && iIa > iTyping, JSON.stringify(eventos))
  }

  console.log('\n[8] Si la IA falla, lo dice y no registra nada')
  {
    modeloCaido = true
    const antes = creadas().length
    const r1 = await preguntar('me alcanza para 5000 de la tarjeta?')
    check('pregunta con monto + IA caida -> "No pude contestar"', /No pude contestar eso ahora, ¿lo intentas otra vez\?/.test(r1?.message || ''), r1?.message)
    const r2 = await preguntar('super 200 ayer')
    check('ambiguo + IA caida -> pide el formato', /empezando con el monto/.test(r2?.message || ''), r2?.message)
    const r4 = await preguntar('me pagaron 5000')
    check('ingreso + IA caida -> no lo adivina como Gasto', /empezando con el monto/.test(r4?.message || ''), r4?.message)
    check('nada se registro', creadas().length === antes, creadas().length - antes)
    const r3 = await preguntar('200 super')
    check('un gasto claro se registra aunque la IA este caida', creadas().length === antes + 1 && /registrado/i.test(r3?.message || ''), r3?.message)
    modeloCaido = false
  }

  console.log('\n[9] La IA nunca escribe: solo hubo creates de los gastos')
  {
    const otras = fakePrisma._escrituras.filter(([tabla, op]) => !(tabla === 'transaccion' && op === 'create'))
    check('ninguna escritura fuera de registrar gastos', otras.length === 0, JSON.stringify(otras))
  }

  salida(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { salida(`El harness truono: ${e.stack}`); process.exit(1) })
