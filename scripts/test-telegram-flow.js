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

// Ingresos va AL FINAL a proposito: mas abajo hay fixtures que referencian
// `categorias[1]` (Personal) por indice, y meterla antes las movia en silencio.
const categorias = [
  { id: 3, nombre: 'Familia', tipo: 'Gasto', activo: true },
  { id: 7, nombre: 'Personal', tipo: 'Gasto', activo: true },
  { id: 1, nombre: 'Ingresos', tipo: 'Ingreso', activo: true },
]
const catPorNombre = nombre => categorias.find(c => c.nombre === nombre)
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
const escrituras = []   // cada update a transaccion, para detectar escrituras dobles
let nextTxId = 1

// Solo lo que toca el camino de Telegram. Cualquier consulta que no este aqui
// truena el test a proposito: si el handler empieza a usar otra tabla, el doble
// tiene que enterarse.
// Lineas de presupuesto en memoria. Arranca VACIO a proposito: los casos A-H
// dependen de que no haya lineas (sin candidatas no hay botones), y los casos
// de asignacion las agregan justo antes de usarlas.
const presupuestos = []

const fakePrisma = {
  transaccion: {
    create: async ({ data }) => {
      const row = { id: nextTxId++, ...data }
      creadas.push(row)
      return row
    },
    // `categoria` hidratada porque alignTransactionCategory la pide con
    // include para poder nombrar la categoria vieja en el mensaje.
    findUnique: async ({ where }) => {
      const row = creadas.find(t => t.id === where.id)
      return row ? { ...row, categoria: categorias.find(c => c.id === row.categoriaId) || null } : null
    },
    update: async ({ where, data }) => {
      const row = creadas.find(t => t.id === where.id)
      if (!row) throw new Error('transaccion no encontrada')
      Object.assign(row, data)
      escrituras.push({ id: where.id, ...data })
      return row
    },
    // Solo responde a la firma de findTransactionsByReference (la unica que
    // filtra por descripcion). Los demas llamadores siguen viendo [] para no
    // cambiar el comportamiento de los casos A-H.
    findMany: async ({ where } = {}) => {
      const texto = where?.descripcion?.contains
      if (!texto) return []
      return creadas.filter(t =>
        (where.quincenaId === undefined || t.quincenaId === where.quincenaId) &&
        (where.tipo === undefined || t.tipo === where.tipo) &&
        String(t.descripcion).toLowerCase().includes(String(texto).toLowerCase()))
        .sort((a, b) => b.id - a.id)
        .slice(0, 4)
    },
    // getBudgetLineStatus suma lo gastado de una linea agrupando por direccion,
    // porque en una linea de Ahorro un Retiro resta (ver src/tipoAhorro.js).
    // El mock agrupa de verdad: si devolviera [] siempre, el bot reportaria
    // cero gastado en cada linea y ningun caso de "excedido" se probaria.
    groupBy: async ({ by, where } = {}) => {
      if (!Array.isArray(by) || by.length !== 1 || by[0] !== 'direccion') return []
      if (where?.presupuestoId === undefined) return []
      const porDireccion = new Map()
      for (const t of creadas) {
        if (t.presupuestoId !== where.presupuestoId) continue
        const dir = t.direccion ?? null
        porDireccion.set(dir, (porDireccion.get(dir) ?? 0) + Number(t.monto))
      }
      return [...porDireccion].map(([direccion, monto]) => ({ direccion, _sum: { monto } }))
    },
    aggregate: async ({ where } = {}) => {
      if (where?.presupuestoId === undefined) return { _sum: { monto: 0 }, _count: 0 }
      const total = creadas
        .filter(t => t.presupuestoId === where.presupuestoId)
        .reduce((sum, t) => sum + Number(t.monto), 0)
      return { _sum: { monto: total }, _count: 0 }
    },
  },
  presupuesto: {
    // OJO CON ESTE DOBLE: antes ignoraba por completo el filtro ANIDADO
    // `categoria: { tipo }` y resolvia `estadoLinea` a mano. Con el `where` que
    // usa hoy getActiveBudgetLines eso no era un detalle: una linea de Ingreso
    // se habria colado entre las candidatas de un Gasto y el caso AB -- el que
    // vigila que el dinero no desaparezca de los agregados -- habria pasado en
    // verde sin probar nada. Si aparece un filtro nuevo en el `where`, tiene
    // que aparecer aqui tambien.
    findMany: async ({ where } = {}) => presupuestos.filter(l =>
      (where?.quincenaId === undefined || l.quincenaId === where.quincenaId) &&
      (where?.categoriaId === undefined || l.categoriaId === where.categoriaId) &&
      (where?.categoria?.tipo === undefined || l.categoria?.tipo === where.categoria.tipo) &&
      (where?.tipo === undefined || l.tipo === where.tipo) &&
      (where?.estadoLinea === undefined
        ? true
        : where.estadoLinea.not !== undefined
          ? l.estadoLinea !== where.estadoLinea.not
          : l.estadoLinea === where.estadoLinea)),
    findUnique: async ({ where }) => presupuestos.find(l => l.id === where.id) || null,
  },
  quincena: { findFirst: async () => ({ id: 1, codigo: 'QTEST', fechaInicio: inicioRango, fechaFin: finRango }) },
  liquidezSnapshot: { findFirst: async () => null },
}

// De src/telegram.js se conserva TODA la logica pura (lista blanca, markdown,
// extraccion del update, deteccion de migracion) y solo se corta la red.
const realTelegram = require(path.join(SRC, 'telegram.js'))
const enviados = []
const editados = []
const contestados = []
const fakeTelegram = {
  ...realTelegram,
  sendTelegramMessage: async (chatId, message, replyToMessageId, opts = {}) => {
    enviados.push({ chatId, message, replyToMessageId, buttons: opts.buttons || null })
    return { ok: true, data: {} }
  },
  editMessageText: async (chatId, messageId, message, opts = {}) => {
    editados.push({ chatId, messageId, message, buttons: opts.buttons || null })
    return { ok: true, data: {} }
  },
  answerCallbackQuery: async callbackId => {
    contestados.push(callbackId)
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

function callbackUpdate(data, chatId = CHAT_PERMITIDO) {
  updateId++
  return {
    update_id: updateId,
    callback_query: {
      id: `cb${updateId}`,
      data,
      from: { id: 42, first_name: 'Rene', username: 'rene' },
      message: {
        message_id: updateId,
        chat: { id: Number(chatId), type: 'supergroup', title: 'Control de gastos' },
      },
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

  console.log('\n=== H: TELEGRAM_REGISTER_WEBHOOK=false no reclama el webhook ===')
  // Se prueba contra el modulo REAL (no el doble): con el flag en false la
  // funcion sale antes de tocar la red, asi que el test no sale a internet.
  process.env.TELEGRAM_REGISTER_WEBHOOK = 'false'
  check('shouldRegisterWebhook() es false', realTelegram.shouldRegisterWebhook() === false)
  const optOut = await realTelegram.registerWebhook()
  check('registerWebhook no registra', optOut.skipped === true && optOut.optedOut === true, JSON.stringify(optOut))
  check('describeAccess lo reporta', realTelegram.describeAccess().registersWebhook === false, JSON.stringify(realTelegram.describeAccess()))

  delete process.env.TELEGRAM_REGISTER_WEBHOOK
  check('por default SI reclama el webhook', realTelegram.shouldRegisterWebhook() === true)

  // --- A partir de aqui SI hay lineas de presupuesto ---
  presupuestos.push(
    { id: 10, quincenaId: 1, categoriaId: 7, descripcion: 'Gastos Personales', tipo: 'Gasto', montoPresupuestado: 1000, montoRevisado: null, estadoLinea: 'Abierta', categoria: categorias[1], quincena: quincenas[0] },
    { id: 11, quincenaId: 1, categoriaId: 7, descripcion: 'Niñera', tipo: 'Gasto', montoPresupuestado: 750, montoRevisado: null, estadoLinea: 'Abierta', categoria: categorias[1], quincena: quincenas[0] },
    { id: 99, quincenaId: 2, categoriaId: 7, descripcion: 'Linea de otra quincena', tipo: 'Gasto', montoPresupuestado: 500, montoRevisado: null, estadoLinea: 'Abierta', categoria: categorias[1], quincena: { id: 2, codigo: 'QOTRA' } },
    // La linea CRUZADA: misma quincena y mismo tipo, otra categoria. Antes de
    // quitar la compuerta por categoria era inalcanzable para un gasto de
    // Personal; ahora tiene que aparecer entre las candidatas (caso AA).
    { id: 12, quincenaId: 1, categoriaId: 3, descripcion: 'Colegiatura', tipo: 'Gasto', montoPresupuestado: 2000, montoRevisado: null, estadoLinea: 'Abierta', categoria: catPorNombre('Familia'), quincena: quincenas[0] },
    // El negativo de TIPO: misma quincena, tipo distinto. Nunca debe ofrecerse
    // a un Gasto (caso AB). Es la unica linea de esta lista cuyo cruce haria
    // que el monto desaparezca de los agregados en vez de cambiar de columna.
    { id: 13, quincenaId: 1, categoriaId: 1, descripcion: 'Sueldo', tipo: 'Ingreso', montoPresupuestado: 20000, montoRevisado: null, estadoLinea: 'Abierta', categoria: catPorNombre('Ingresos'), quincena: quincenas[0] },
    // Segunda linea de Ingreso: con una sola, resolveBudgetLine la elegiria
    // sola y el caso AI no llegaria a ver botones.
    { id: 14, quincenaId: 1, categoriaId: 1, descripcion: 'Bono', tipo: 'Ingreso', montoPresupuestado: 3000, montoRevisado: null, estadoLinea: 'Abierta', categoria: catPorNombre('Ingresos'), quincena: quincenas[0] },
  )

  console.log('\n=== I: gasto ambiguo ofrece botones en vez de una lista muerta ===')
  await post(textUpdate('115, convivio'))
  const txAmbiguo = creadas.at(-1)
  const msgAmbiguo = enviados.at(-1)
  check('registro el gasto', Number(txAmbiguo?.monto) === 115, txAmbiguo?.monto)
  check('no lo vinculo solo (hay ambiguedad)', txAmbiguo?.presupuestoId == null, txAmbiguo?.presupuestoId)
  check('la respuesta trae botones', Array.isArray(msgAmbiguo?.buttons), JSON.stringify(msgAmbiguo?.buttons))
  // La asercion es sobre CONTENIDO, no sobre cuantos botones hay: el numero
  // depende del ranking y de la paginacion, y fijarlo obligaria a reescribir
  // este caso cada vez que se agrega una linea a las fixtures.
  const cbsI = msgAmbiguo?.buttons?.flat().map(b => b.callback_data) || []
  check('ofrece la linea de su categoria', cbsI.includes(`pl:${txAmbiguo.id}:10`), JSON.stringify(cbsI))
  check('deja dejarlo sin asignar', cbsI.includes(`pn:${txAmbiguo.id}`), JSON.stringify(cbsI))
  check('callback_data cabe en los 64 bytes de Telegram', msgAmbiguo.buttons.every(f => f.every(b => Buffer.byteLength(b.callback_data || '') <= 64)))

  console.log('\n=== AA: las candidatas cruzan la frontera de categoria ===')
  // El punto entero del cambio: un gasto que el parser mando a Personal tiene
  // que poder llegar a una linea de Familia sin pasar por el dashboard.
  check('ofrece una linea de OTRA categoria', cbsI.includes(`pl:${txAmbiguo.id}:12`), JSON.stringify(cbsI))
  const etiquetasI = msgAmbiguo?.buttons?.flat().map(b => b.text) || []
  check('la etiqueta dice de que categoria es', etiquetasI.some(t => /Colegiatura/.test(t) && /Familia/.test(t)), JSON.stringify(etiquetasI))

  console.log('\n=== AB: las candidatas NUNCA cruzan la frontera de TIPO ===')
  // El test mas importante de este cambio. Un Gasto colgado de una linea de
  // Ingreso no lo cuenta ningun agregado (calcularFaltaPorPagar y
  // cierre-quincena filtran por categoria.tipo), asi que el monto no cambiaria
  // de columna: desapareceria. Antes esto era imposible porque 'Gasto' estaba
  // hardcodeado en los dos lados; ahora lo unico que lo impide es el filtro por
  // tipo de getActiveBudgetLines y la comparacion de linkTransactionToBudget.
  check('no ofrece la linea de Ingreso', !cbsI.includes(`pl:${txAmbiguo.id}:13`), JSON.stringify(cbsI))

  console.log('\n=== AC: enlazar a una linea cruzada NO mueve la categoria sola ===')
  // La decision de negocio es literal: elegir la linea enlaza, y nada mas.
  // Mover la categoria es una segunda escritura que el usuario confirma aparte
  // (alignTransactionCategory). Si algun dia enlazar recategoriza en silencio,
  // este caso truena.
  await post(textUpdate('80, convivio de la escuela'))
  const txCruzado = creadas.at(-1)
  const catAntesAC = txCruzado.categoriaId
  await post(callbackUpdate(`pl:${txCruzado.id}:12`))
  check('enlazo a la linea de otra categoria', txCruzado.presupuestoId === 12, txCruzado.presupuestoId)
  check('la categoria NO se movio sola', txCruzado.categoriaId === catAntesAC, `${catAntesAC} -> ${txCruzado.categoriaId}`)

  console.log('\n=== AI: un Ingreso tambien recibe linea (antes solo Gasto) ===')
  await post(textUpdate('cobro 5000 reembolso'))
  const txIngreso = creadas.at(-1)
  const msgIngreso = enviados.at(-1)
  const cbsAI = msgIngreso?.buttons?.flat().map(b => b.callback_data) || []
  check('lo registro como Ingreso', txIngreso?.tipo === 'Ingreso', txIngreso?.tipo)
  check('le ofrece lineas de presupuesto', cbsAI.some(cb => cb.startsWith(`pl:${txIngreso.id}:`)), JSON.stringify(cbsAI))
  check('solo lineas de Ingreso', !cbsAI.includes(`pl:${txIngreso.id}:10`) && !cbsAI.includes(`pl:${txIngreso.id}:12`), JSON.stringify(cbsAI))

  console.log('\n=== J: tocar el boton vincula y reescribe el mensaje sin botones ===')
  const antesJ = editados.length
  await post(callbackUpdate(`pl:${txAmbiguo.id}:10`))
  check('acuso recibo del boton', contestados.length > 0, contestados.length)
  check('vinculo la transaccion', txAmbiguo.presupuestoId === 10, txAmbiguo.presupuestoId)
  check('edito el mensaje original', editados.length === antesJ + 1, editados.length)
  check('el texto confirma la linea', /Gastos Personales/.test(editados.at(-1)?.message || ''), editados.at(-1)?.message)
  check('ya no quedan botones que tocar', !editados.at(-1)?.buttons, JSON.stringify(editados.at(-1)?.buttons))

  console.log('\n=== K2: tocar dos veces no escribe dos veces ===')
  const escrituasAntes = escrituras.length
  await post(callbackUpdate(`pl:${txAmbiguo.id}:10`))
  check('no hubo segunda escritura', escrituras.length === escrituasAntes, escrituras.length)
  check('avisa que ya estaba asignado', /[Yy]a estaba/.test(editados.at(-1)?.message || ''), editados.at(-1)?.message)

  console.log('\n=== P: callback_data forjado con una linea de OTRA quincena se rechaza ===')
  // callback_data viaja por el cliente: un cliente modificado puede mandar
  // cualquier par de ids. Sin esta validacion el presupuesto dejaria de cuadrar.
  await post(textUpdate('60, otro convivio'))
  const txP = creadas.at(-1)
  await post(callbackUpdate(`pl:${txP.id}:99`))
  check('NO lo vinculo a la linea de otra quincena', txP.presupuestoId == null, txP.presupuestoId)
  check('explica por que', /otra quincena/i.test(editados.at(-1)?.message || ''), editados.at(-1)?.message)

  console.log('\n=== Q: callback sobre un gasto que ya no existe no truena ===')
  await post(callbackUpdate('pl:999999:10'))
  check('responde algo claro', /ya no existe/i.test(editados.at(-1)?.message || ''), editados.at(-1)?.message)

  console.log('\n=== R: un callback de un chat ajeno se descarta igual que un mensaje ===')
  const antesR = editados.length
  await post(callbackUpdate(`pl:${txP.id}:10`, CHAT_AJENO))
  check('no lo proceso', editados.length === antesR, editados.length)
  check('no lo vinculo', txP.presupuestoId == null, txP.presupuestoId)
  check('lo logueo', logsIncluyen('TELEGRAM_UNAUTHORIZED_CHAT'), 'sin log no hay rastro')

  console.log('\n=== S: "Dejar sin asignar" cierra el mensaje con salida al dashboard ===')
  await post(callbackUpdate(`pn:${txP.id}`))
  check('sigue sin linea', txP.presupuestoId == null, txP.presupuestoId)
  check('lo dice explicitamente', /sin línea de presupuesto/i.test(editados.at(-1)?.message || ''), editados.at(-1)?.message)
  check('deja un boton al dashboard', editados.at(-1)?.buttons?.[0]?.[0]?.url?.includes('/presupuesto'), JSON.stringify(editados.at(-1)?.buttons))

  console.log('\n=== T: un gasto que rebasa la linea avisa y ofrece cubrirlo ===')
  // La linea 11 tiene $750. Un gasto de 800 la rebasa por 50.
  //
  // ESTE CASO FIJA LA FRONTERA DEL AUTO-ENLACE. Solo se auto-vincula porque
  // resolveBudgetLine sigue acotado a la categoria de la transaccion: dentro de
  // Personal, "niñera" gana con holgura. Si alguien abre tambien el auto-enlace
  // a toda la quincena, "niñera" empieza a competir con lineas de otras
  // categorias, deja de superar los umbrales 0.75/0.15 y este caso truena.
  // Cuando eso pase, la respuesta es revertir esa apertura, no bajar umbrales.
  await post(textUpdate('800, niñera'))
  const txT = creadas.at(-1)
  check('se auto-vinculo a Niñera', txT?.presupuestoId === 11, txT?.presupuestoId)
  const msgT = enviados.at(-1)?.message || ''
  check('avisa del excedido', /[Ee]xcedido/.test(msgT), msgT)
  check('dice que rebaso la linea', /rebasó la línea/i.test(msgT), msgT)
  check('ofrece boton al dashboard', enviados.at(-1)?.buttons?.[0]?.[0]?.url?.includes('/presupuesto'), JSON.stringify(enviados.at(-1)?.buttons))

  console.log('\n=== U: "el gasto de X mandalo a Y" encuentra el movimiento y PROPONE ===')
  // Antes las descripciones de estos casos TENIAN que caer en Personal, porque
  // fuera de la categoria de la transaccion no habia candidatas y el caso no
  // probaba nada. Eso ya no aplica: las candidatas salen de toda la quincena.
  // El caso U2 prueba justo lo que esa restriccion impedia probar.
  await post(textUpdate('45, boliche'))
  const txU = creadas.at(-1)
  const escriturasAntesU = escrituras.length
  await post(textUpdate('el gasto de boliche mandalo a gastos personales'))
  const propuesta = enviados.at(-1)
  check('encontro el movimiento y lo muestra', /boliche/i.test(propuesta?.message || ''), propuesta?.message)
  check('menciona la linea destino', /Gastos Personales/i.test(propuesta?.message || ''), propuesta?.message)
  check('ofrece un boton de confirmar', propuesta?.buttons?.[0]?.[0]?.callback_data === `pl:${txU.id}:10`, JSON.stringify(propuesta?.buttons))
  check('NO escribio nada todavia: solo propuso', escrituras.length === escriturasAntesU, escrituras.length)
  check('el movimiento sigue sin linea', txU.presupuestoId == null, txU.presupuestoId)

  console.log('\n=== V: al confirmar SI escribe, por el mismo camino ya probado ===')
  await post(callbackUpdate(`pl:${txU.id}:10`))
  check('ahora si lo vinculo', txU.presupuestoId === 10, txU.presupuestoId)

  console.log('\n=== U2: reasignar a una linea de OTRA categoria ===')
  // Lo que la restriccion vieja del caso U hacia imposible probar. El gasto de
  // "tamales" cae en Familia o Personal segun el parser; "colegiatura" es la
  // linea 12, de Familia. Antes, si los dos no coincidian, el bot contestaba
  // "no encontré una línea que se parezca en su categoría" y no habia salida
  // desde Telegram.
  await post(textUpdate('60, tamales de la esquina'))
  const txU2 = creadas.at(-1)
  const escriturasAntesU2 = escrituras.length
  await post(textUpdate('el gasto de tamales mandalo a colegiatura'))
  const propuestaU2 = enviados.at(-1)
  const cbsU2 = propuestaU2?.buttons?.flat().map(b => b.callback_data) || []
  check('propone la linea aunque sea de otra categoria', cbsU2.includes(`pl:${txU2.id}:12`), JSON.stringify(cbsU2))
  check('propone, no escribe', escrituras.length === escriturasAntesU2, escrituras.length)

  console.log('\n=== W: referencia que no empata con nada ===')
  const antesW = escrituras.length
  await post(textUpdate('el gasto de tlalpan mandalo a diversion'))
  check('lo dice claro', /no encontré ningún gasto/i.test(enviados.at(-1)?.message || ''), enviados.at(-1)?.message)
  check('sin escrituras', escrituras.length === antesW, escrituras.length)

  console.log('\n=== X: varios movimientos empatan -> pregunta cual, sin escribir ===')
  await post(textUpdate('20, chelas centro'))
  await post(textUpdate('35, chelas norte'))
  const antesX = escrituras.length
  await post(textUpdate('el gasto de chelas mandalo a gastos personales'))
  const multi = enviados.at(-1)
  check('pregunta cual de los dos', /¿Cuál quieres mover\?/i.test(multi?.message || ''), multi?.message)
  check('un boton por movimiento', multi?.buttons?.length === 2, multi?.buttons?.length)
  check('los botones eligen movimiento, no escriben', multi?.buttons?.every(f => f[0].callback_data.startsWith('ps:')), JSON.stringify(multi?.buttons))
  check('sin escrituras', escrituras.length === antesX, escrituras.length)

  console.log('\n=== Y: elegir el movimiento muestra las lineas, todavia sin escribir ===')
  const txChelas = creadas.at(-1)
  const antesY = escrituras.length
  await post(callbackUpdate(`ps:${txChelas.id}`))
  check('ahora ofrece las lineas', editados.at(-1)?.buttons?.some(f => f[0].callback_data?.startsWith('pl:')), JSON.stringify(editados.at(-1)?.buttons))
  check('sigue sin escribir', escrituras.length === antesY, escrituras.length)

  console.log('\n=== Z: destino que no empata con ninguna linea ===')
  await post(textUpdate('70, mariscos'))
  await post(textUpdate('el gasto de mariscos mandalo a vacaciones en europa'))
  const sinDestino = enviados.at(-1)?.message || ''
  check('no inventa una linea', !/Sí, mandarlo/i.test(sinDestino), sinDestino)
  check('ofrece las candidatas o lo dice', /¿A cuál línea lo mando\?|No encontré una línea/i.test(sinDestino), sinDestino)

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('El harness truono:', e); process.exit(1) })
