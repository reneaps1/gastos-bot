// Prueba de integracion del flujo de Telegram, sin red ni Postgres.
//
// Mismo patron que scripts/test-bot-flow.js: levanta el servidor real de
// src/index.js y le manda updates de Telegram simulados, reemplazando
// src/database.js, src/lib/prisma.js y la capa de red de src/telegram.js por
// dobles en memoria.
//
// POR QUE EXISTE: el handler de /telegram/webhook tiene tres caminos que
// descartan el mensaje sin contestar nada en el chat (secreto del webhook que
// no coincide, chat fuera de la lista blanca, y grupo migrado a supergrupo).
// Son justo los que dejaron al bot mudo el 2026-09-12 sin una sola linea de
// log. Estos casos fijan el contrato: descartar esta bien, descartar EN
// SILENCIO no.

process.env.TZ = 'America/Mexico_City'
process.env.DATABASE_URL = 'postgresql://x:x@localhost:0/x'
process.env.GOOGLE_SHEETS_ENABLED = 'false'
process.env.SKIP_PRISMA_BOOTSTRAP = '1'
process.env.PORT = process.env.TEST_PORT || '34568'
process.env.TELEGRAM_BOT_TOKEN = 'test:token'
process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto-de-prueba'
process.env.TELEGRAM_ALLOWED_CHAT_IDS = '-1001111111111'
// Sin DEEPSEEK_API_KEY ni GEMINI_API_KEY: aiRouter queda deshabilitado y el
// mensaje lo resuelve el parser local, sin salir a la red.
delete process.env.DEEPSEEK_API_KEY
delete process.env.GEMINI_API_KEY

const path = require('path')
const SRC = path.join(__dirname, '..', 'src')

const CHAT_PERMITIDO = '-1001111111111'
const CHAT_AJENO = '-1009999999999'

// --- Dobles ---

const hoy = new Date()
const inicioRango = new Date(hoy); inicioRango.setDate(inicioRango.getDate() - 5)
const finRango = new Date(hoy); finRango.setDate(finRango.getDate() + 25)

const categorias = [
  { id: 3, nombre: 'Familia', tipo: 'Gasto', activo: true },
  { id: 7, nombre: 'Personal', tipo: 'Gasto', activo: true },
]
const quincenas = [{ id: 1, codigo: 'QTEST', tipo: 'QUINCENAL', fechaInicio: inicioRango, fechaFin: finRango }]

const fakeDb = {
  findUserByPhone: async () => null,
  findUserByName: async () => null,
  findCategoria: async nombre => (nombre
    ? categorias.find(c => c.nombre.toLowerCase() === String(nombre).toLowerCase()) || null
    : null),
  findMetodoPago: async nombre => (nombre ? { id: 1, nombre } : null),
  findQuincenaByCodigo: async codigo => quincenas.find(q => q.codigo === codigo) || null,
  listQuincenas: async () => quincenas,
  messageExists: async () => false,
  saveMessage: async data => ({ id: 1, ...data }),
  saveTransaccion: async data => ({ id: 1, ...data }),
  getTransaccionesByQuincena: async () => [],
  getResumenQuincena: async () => ({ ingresos: 0, gastos: 0, ahorro: 0 }),
}

const creadas = []
let nextTxId = 1

// Solo lo que toca el camino de Telegram. Cualquier consulta que no este aqui
// truena el test a proposito: si el handler empieza a usar otra tabla, el doble
// tiene que enterarse.
const fakePrisma = {
  transaccion: {
    create: async ({ data }) => {
      const row = { id: nextTxId++, ...data }
      creadas.push(row)
      return row
    },
    findMany: async () => [],
    groupBy: async () => [],
    aggregate: async () => ({ _sum: { monto: 0 }, _count: 0 }),
  },
  presupuesto: { findMany: async () => [] },
  quincena: { findFirst: async () => ({ id: 1, codigo: 'QTEST', fechaInicio: inicioRango, fechaFin: finRango }) },
  liquidezSnapshot: { findFirst: async () => null },
}

// De src/telegram.js se conserva TODA la logica pura (lista blanca, markdown,
// extraccion del update, deteccion de migracion) y solo se corta la red.
const realTelegram = require(path.join(SRC, 'telegram.js'))
const enviados = []
const fakeTelegram = {
  ...realTelegram,
  sendTelegramMessage: async (chatId, message, replyToMessageId) => {
    enviados.push({ chatId, message, replyToMessageId })
    return { ok: true, data: {} }
  },
  registerWebhook: async () => ({ ok: true, skipped: true }),
  getWebhookInfo: async () => ({ ok: true, data: { result: {} } }),
  getMe: async () => ({ ok: true, data: { result: { username: 'milo_test', can_read_all_group_messages: true } } }),
  checkGroupPrivacyMode: async () => ({ ok: true, skipped: true }),
}

for (const [rel, exports] of [
  ['database.js', fakeDb],
  ['lib/prisma.js', fakePrisma],
  ['telegram.js', fakeTelegram],
]) {
  const p = require.resolve(path.join(SRC, rel))
  require.cache[p] = { id: p, filename: p, loaded: true, exports }
}

// --- Captura de logs: el punto de estos tests es que el descarte deje rastro ---

const logs = []
for (const nivel of ['log', 'warn', 'error']) {
  const original = console[nivel].bind(console)
  console[nivel] = (...args) => {
    logs.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
    original(...args)
  }
}
function logsIncluyen(fragmento) {
  return logs.some(l => l.includes(fragmento))
}

// --- Runner ---

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
let updateId = 1000

function textUpdate(text, chatId = CHAT_PERMITIDO) {
  updateId++
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      chat: { id: Number(chatId), type: 'supergroup', title: 'Control de gastos' },
      from: { id: 42, first_name: 'Rene', username: 'rene' },
      text,
    },
  }
}

async function post(update, { secret = process.env.TELEGRAM_WEBHOOK_SECRET } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (secret !== null) headers['X-Telegram-Bot-Api-Secret-Token'] = secret
  const res = await fetch(`http://localhost:${process.env.PORT}/telegram/webhook`, {
    method: 'POST',
    headers,
    body: JSON.stringify(update),
  })
  await sleep(200) // el handler responde 200 antes de terminar de procesar
  return res.status
}

async function main() {
  require(path.join(SRC, 'index.js'))
  await sleep(300)

  console.log('\n=== A: chat autorizado registra el gasto y contesta ===')
  const antesA = enviados.length
  const statusA = await post(textUpdate('30, suerox'))
  check('responde 200', statusA === 200, statusA)
  check('creo la transaccion', creadas.length === 1, creadas.length)
  check('monto = 30', Number(creadas.at(-1)?.monto) === 30, creadas.at(-1)?.monto)
  check('source = telegram', creadas.at(-1)?.source === 'telegram', creadas.at(-1)?.source)
  check('contesto al chat', enviados.length === antesA + 1, enviados.length)
  check('la respuesta confirma el registro', /registrado/i.test(enviados.at(-1)?.message || ''), enviados.at(-1)?.message)
  check('dejo traza de entrada', logsIncluyen('TELEGRAM_UPDATE_IN'), 'falta TELEGRAM_UPDATE_IN')

  console.log('\n=== B: una pregunta SIEMPRE recibe respuesta (nunca silencio) ===')
  const antesB = enviados.length
  const creadasB = creadas.length
  await post(textUpdate('Cuánto queda en súper?'))
  check('contesto algo', enviados.length > antesB, `enviados=${enviados.length} antes=${antesB}`)
  check('no registro un gasto fantasma', creadas.length === creadasB, creadas.length)

  console.log('\n=== C: chat fuera de la lista blanca se descarta, pero deja log con el id ===')
  const antesC = enviados.length
  const creadasC = creadas.length
  const statusC = await post(textUpdate('500, gasolina', CHAT_AJENO))
  check('responde 200 (no le confirma nada al desconocido)', statusC === 200, statusC)
  check('no contesta al chat ajeno', enviados.length === antesC, enviados.length)
  check('no registra nada', creadas.length === creadasC, creadas.length)
  check('logueo TELEGRAM_UNAUTHORIZED_CHAT', logsIncluyen('TELEGRAM_UNAUTHORIZED_CHAT'), 'sin log no hay forma de saber que paso')
  check('el log trae el chat id para pegarlo en la lista blanca', logsIncluyen(CHAT_AJENO), 'falta el id en el log')

  console.log('\n=== D: secreto que no coincide -> 403 con log explicito ===')
  const antesD = enviados.length
  const statusD = await post(textUpdate('100, cine'), { secret: 'otro-secreto' })
  check('responde 403', statusD === 403, statusD)
  check('no contesta', enviados.length === antesD, enviados.length)
  check('logueo TELEGRAM_SECRET_MISMATCH', logsIncluyen('TELEGRAM_SECRET_MISMATCH'), 'este era el fallo invisible')

  console.log('\n=== E: sin header de secreto tambien es 403 y queda registrado ===')
  const statusE = await post(textUpdate('100, cine'), { secret: null })
  check('responde 403', statusE === 403, statusE)
  check('el log dice que Telegram no mando secreto', logsIncluyen('no mando secreto'), logs.at(-1))

  console.log('\n=== F: migracion a supergrupo avisa el id nuevo ===')
  updateId++
  await post({
    update_id: updateId,
    message: {
      message_id: updateId,
      chat: { id: -4444444, type: 'group', title: 'Control de gastos' },
      from: { id: 42, first_name: 'Rene' },
      migrate_to_chat_id: -1002222222222,
    },
  })
  check('logueo TELEGRAM_CHAT_MIGRATED', logsIncluyen('TELEGRAM_CHAT_MIGRATED'), 'sin esto el bot se queda mudo al migrar el grupo')
  check('el log trae el id nuevo', logsIncluyen('-1002222222222'), 'falta el id nuevo')

  console.log('\n=== G: /telegram/status expone las dos puertas ===')
  const status = await fetch(`http://localhost:${process.env.PORT}/telegram/status`).then(r => r.json()).catch(e => ({ error: e.message }))
  check('reporta secretConfigured', status.secretConfigured === true, JSON.stringify(status))
  check('reporta allowedChatIdCount', status.allowedChatIdCount === 1, JSON.stringify(status))

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('El harness truono:', e); process.exit(1) })
