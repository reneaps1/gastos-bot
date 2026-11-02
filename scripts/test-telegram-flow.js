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
let nextLineaId = 200
// Cada fila que el bot escriba en presupuesto_cambios. El caso AH lee esto.
const cambiosPresupuesto = []

// Retroalimentacion del clasificador (tabla clasificacion_feedback).
// `feedbackFalla` simula que la tabla no responde: el gasto se tiene que
// registrar igual, solo que sin la pregunta (caso CL10).
const feedbacks = []
const historicoLineas = []
let feedbackFalla = false
let nextFeedbackId = 1

function cumpleFeedback(f, where = {}) {
  return Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && Array.isArray(v.in) ? v.in.includes(f[k]) : f[k] === v))
}

// Palabras sueltas del modo "Yo te escribo palabras" (clasificador_ejemplos).
const ejemplos = []
let nextEjemploId = 1
const fakePrisma = {
  clasificadorEjemplo: {
    create: async ({ data }) => {
      const row = { id: nextEjemploId++, estado: 'pendiente', lineaDescripcion: null, categoriaId: null, acerto: null, createdAt: new Date(), resueltoEn: null, ...data }
      ejemplos.push(row)
      return row
    },
    findUnique: async ({ where }) => ejemplos.find(e => e.id === where.id) || null,
    update: async ({ where, data }) => Object.assign(ejemplos.find(e => e.id === where.id), data),
    findMany: async ({ where } = {}) => ejemplos.filter(e =>
      (where?.estado === undefined || e.estado === where.estado) &&
      (where?.createdAt?.gte === undefined || e.createdAt >= where.createdAt.gte)),
  },
  clasificacionFeedback: {
    create: async ({ data }) => {
      if (feedbackFalla) throw new Error('relation "clasificacion_feedback" does not exist')
      if (feedbacks.some(f => f.transaccionId === data.transaccionId)) throw new Error('unique violation')
      const row = { id: nextFeedbackId++, categoriaFinalId: null, resueltaEn: null, createdAt: new Date(), ...data }
      feedbacks.push(row)
      return row
    },
    findUnique: async ({ where }) => feedbacks.find(f => f.transaccionId === where.transaccionId) || null,
    findMany: async ({ where } = {}) => feedbacks.filter(f => cumpleFeedback(f, where)),
    updateMany: async ({ where, data }) => {
      const filas = feedbacks.filter(f => cumpleFeedback(f, where))
      for (const f of filas) Object.assign(f, data)
      return { count: filas.length }
    },
  },
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
      return row ? {
        ...row,
        categoria: categorias.find(c => c.id === row.categoriaId) || null,
        // La sesion de entrenamiento pide la linea para nombrarla.
        presupuesto: row.presupuestoId == null ? null : presupuestos.find(l => l.id === row.presupuestoId) || null,
      } : null
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
    findMany: async ({ where, select, orderBy, take } = {}) => {
      // La firma del entrenamiento del modelo de LINEAS (src/clasificador):
      // los gastos que ya tienen linea, con el nombre de la linea. Devuelve
      // `historicoLineas`, que arranca vacio (el modelo no opina) y el caso
      // CL11 llena.
      if (where?.presupuestoId?.not === null && select?.presupuesto) return historicoLineas
      // La firma de la sesion de entrenamiento: gastos por id descendente.
      if (where?.tipo === 'Gasto' && orderBy?.id === 'desc') {
        return creadas
          .filter(t => t.tipo === 'Gasto' && (where.presupuestoId !== null || t.presupuestoId == null) && (where.id?.lt === undefined || t.id < where.id.lt))
          .sort((a, b) => b.id - a.id)
          .slice(0, take ?? Infinity)
          .map(t => ({ ...t, categoria: categorias.find(c => c.id === t.categoriaId) || null }))
      }
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
    create: async ({ data }) => {
      const fila = {
        id: nextLineaId++, ...data,
        categoria: categorias.find(c => c.id === data.categoriaId) || null,
        quincena: quincenas.find(q => q.id === data.quincenaId) || null,
      }
      presupuestos.push(fila)
      return fila
    },
  },
  categoria: {
    findUnique: async ({ where }) => categorias.find(c => c.id === where.id) || null,
    findMany: async ({ where } = {}) => categorias.filter(c =>
      (where?.activo === undefined || c.activo === where.activo) &&
      (where?.tipo === undefined || c.tipo === where.tipo)),
  },
  // $transaction e $executeRaw existen para que el caso AH pueda comprobar que
  // la linea y su fila CREACION se escriben JUNTAS. Un doble que ignorara
  // $executeRaw dejaria pasar exactamente el defecto que ese caso vigila:
  // lineas creadas sin bitacora, invisibles para el timeline del dashboard.
  $transaction: async fn => fn(fakePrisma),
  $executeRaw: async (strings, ...valores) => {
    cambiosPresupuesto.push({ sql: strings.join('?'), valores })
    return 1
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
const acciones = []
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
  // "Escribiendo...": se registra en vez de salir a la red.
  sendChatAction: async (chatId, action = 'typing') => {
    acciones.push({ chatId, action })
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

  check('mando "escribiendo..." al chat', acciones.some(a => String(a.chatId) === CHAT_PERMITIDO && a.action === 'typing'), JSON.stringify(acciones))
  check('dejo la linea TELEGRAM_QA con la ruta', logsIncluyen('TELEGRAM_QA') && logsIncluyen('"route":"gasto"'), 'falta TELEGRAM_QA')

  console.log('\n=== B: una pregunta SIEMPRE recibe respuesta (nunca silencio) ===')
  // Sin proveedor de IA el agente no puede contestar. Lo que importa: lo dice,
  // y la pregunta NO se registra como gasto (antes caia al parser).
  const antesB = enviados.length
  const creadasB = creadas.length
  await post(textUpdate('Cuánto queda en súper?'))
  check('contesto algo', enviados.length > antesB, `enviados=${enviados.length} antes=${antesB}`)
  check('no registro un gasto fantasma', creadas.length === creadasB, creadas.length)
  check('dice que no pudo, en vez de inventar', /No pude contestar eso ahora/.test(enviados.at(-1)?.message || ''), enviados.at(-1)?.message)

  console.log('\n=== B2: una pregunta con monto NUNCA se registra como gasto ===')
  const creadasB2 = creadas.length
  await post(textUpdate('me alcanza para los 5000 de la tarjeta?'))
  check('no registro los 5000', creadas.length === creadasB2, JSON.stringify(creadas.at(-1)))
  check('contesto algo', /No pude contestar/.test(enviados.at(-1)?.message || ''), enviados.at(-1)?.message)

  console.log('\n=== B3: numero sin formato claro y sin IA -> pide el formato, no adivina ===')
  const creadasB3 = creadas.length
  await post(textUpdate('super 200 ayer'))
  check('no lo registro a ciegas', creadas.length === creadasB3, creadas.length)
  check('explica como mandarlo', /empezando con el monto/.test(enviados.at(-1)?.message || ''), enviados.at(-1)?.message)

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

  console.log('\n=== AC: enlazar a una linea de otra categoria MUEVE la categoria, sin preguntar ===')
  // Decision del 2026-11-02: en Telegram lo util es la linea; la categoria la
  // sigue (assignLine en src/budgetActions.js). Antes esto preguntaba
  // "¿Muevo tambien la categoria?".
  await post(textUpdate('80, convivio de la escuela'))
  const txCruzado = creadas.at(-1)
  check('nace en Personal', txCruzado.categoriaId === 7, txCruzado.categoriaId)
  await post(callbackUpdate(`pl:${txCruzado.id}:12`))
  check('enlazo a la linea de otra categoria', txCruzado.presupuestoId === 12, txCruzado.presupuestoId)
  check('la categoria se movio a la de la linea (Familia)', txCruzado.categoriaId === 3, txCruzado.categoriaId)
  check('re-derivo la clasificacion', txCruzado.clasificacion === 'Variable', txCruzado.clasificacion)
  const msgAC = editados.at(-1)
  const cbsAC = msgAC?.buttons?.flat().map(b => b.callback_data).filter(Boolean) || []
  check('ya no pregunta', !/¿Muevo también la categoría\?/.test(msgAC?.message || '') && !cbsAC.some(cb => /^p[km]:/.test(cb)), msgAC?.message)
  check('avisa el cambio de categoria', /Categoría: Personal → Familia/.test(msgAC?.message || ''), msgAC?.message)
  const escriturasAC = escrituras.length
  await post(callbackUpdate(`pl:${txCruzado.id}:12`))
  check('tocar dos veces no escribe dos veces', escrituras.length === escriturasAC, escrituras.length)

  console.log('\n=== AD: el boton viejo "Si, moverlo" (pk) sigue funcionando y no escribe de mas ===')
  await post(callbackUpdate(`pk:${txCruzado.id}:12`))
  check('ahora si movio la categoria', txCruzado.categoriaId === 3, txCruzado.categoriaId)
  check('re-derivo la clasificacion de la categoria nueva', txCruzado.clasificacion === 'Variable', txCruzado.clasificacion)
  check('no toco el enlace', txCruzado.presupuestoId === 12, txCruzado.presupuestoId)
  const escriturasAntesAD2 = escrituras.length
  await post(callbackUpdate(`pk:${txCruzado.id}:12`))
  check('tocar dos veces no escribe dos veces', escrituras.length === escriturasAntesAD2, escrituras.length)

  console.log('\n=== AE: el boton viejo "No, dejarlo" (pm) no escribe nada ===')
  // Un mensaje de antes del 2026-11-02 dejo el gasto cruzado y pregunto: se
  // simula el enlace viejo directo en la fila.
  await post(textUpdate('90, convivio del salon'))
  const txMantiene = creadas.at(-1)
  txMantiene.presupuestoId = 12
  const escriturasAntesAE = escrituras.length
  await post(callbackUpdate(`pm:${txMantiene.id}:12`))
  check('la categoria sigue siendo la suya', txMantiene.categoriaId === 7, txMantiene.categoriaId)
  check('no hubo escritura', escrituras.length === escriturasAntesAE, escrituras.length)
  check('lo deja por escrito', /lo dejé en su categoría/i.test(editados.at(-1)?.message || ''), editados.at(-1)?.message)

  console.log('\n=== AF: un pk forjado sobre una linea que no es la suya se rechaza ===')
  // Espejo del caso P para el prefijo nuevo. txMantiene esta en la linea 12;
  // un callback que diga 10 no puede mover su categoria a la de la 10.
  const catAntesAF = txMantiene.categoriaId
  const escriturasAntesAF = escrituras.length
  await post(callbackUpdate(`pk:${txMantiene.id}:10`))
  check('no escribio nada', escrituras.length === escriturasAntesAF, escrituras.length)
  check('la categoria quedo intacta', txMantiene.categoriaId === catAntesAF, txMantiene.categoriaId)

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

  console.log('\n=== T0: NUNCA se auto-asigna, ni con la coincidencia mas obvia ===')
  // La linea 11 se llama "Niñera" y el gasto dice "niñera": es el caso donde
  // resolveBudgetLine acierta con mas holgura, y por eso mismo es el que
  // atrapa una regresion. Antes esto se enlazaba solo Y el mensaje salia SIN
  // BOTONES, asi que ademas de no preguntar, cuando se equivocaba no habia
  // forma de corregirlo desde Telegram.
  //
  // La sugerencia sigue viva, pero como propuesta: primera y con estrella.
  await post(textUpdate('800, niñera'))
  const txT = creadas.at(-1)
  check('el gasto nace SIN linea', txT?.presupuestoId == null, txT?.presupuestoId)
  const botonesT = enviados.at(-1)?.buttons || []
  check('pregunta con botones', botonesT.length > 0, JSON.stringify(botonesT))
  // Sin la pregunta de categoria (se quito el 2026-11-01): las lineas van
  // directo, y la sugerida es la primera.
  check('no hay fila de pregunta de categoria', !botonesT.flat().some(b => /^k[abc]:/.test(b.callback_data || '')), JSON.stringify(botonesT[0]))
  check('sin botones de categoria (la categoria sigue a la linea)', !botonesT.flat().some(b => /^k/.test(b.callback_data || '')), JSON.stringify(botonesT.at(-1)))
  const filasLineaT = botonesT.filter(f => f[0]?.callback_data?.startsWith('pl:'))
  check('la sugerida va primera y marcada', /^⭐ /.test(filasLineaT[0]?.[0]?.text || ''), filasLineaT[0]?.[0]?.text)
  check('la sugerida es Niñera', filasLineaT[0]?.[0]?.callback_data === `pl:${txT.id}:11`, filasLineaT[0]?.[0]?.callback_data)
  check('ofrece salida si no es ninguna', botonesT.flat().some(b => b.callback_data === `pd:${txT.id}:0`), JSON.stringify(botonesT.flat().map(b => b.callback_data)))

  console.log('\n=== T: al confirmar, avisa del excedido y ofrece cubrirlo ===')
  // La linea 11 tiene $750. Un gasto de 800 la rebasa por 50. El aviso ya no
  // llega al registrar sino al confirmar, que es cuando el enlace existe.
  await post(callbackUpdate(`pl:${txT.id}:11`))
  check('ahora si lo vinculo', txT.presupuestoId === 11, txT.presupuestoId)
  const msgT = editados.at(-1)?.message || ''
  check('avisa del excedido', /[Ee]xcedido/.test(msgT), msgT)
  check('dice que rebaso la linea', /rebasó la línea/i.test(msgT), msgT)
  check('ofrece boton al dashboard', editados.at(-1)?.buttons?.[0]?.[0]?.url?.includes('/presupuesto'), JSON.stringify(editados.at(-1)?.buttons))

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

  console.log('\n=== AG: paginacion -- ninguna linea queda inalcanzable ===')
  // Las lineas extra van AL FINAL del archivo a proposito: metidas antes,
  // cambiarian el ranking de los casos I/AA/AB, que dependen de que linea sale
  // en la primera pagina.
  for (let i = 0; i < 6; i++) {
    presupuestos.push({
      id: 30 + i, quincenaId: 1, categoriaId: 3, descripcion: `Partida extra ${i}`,
      tipo: 'Gasto', montoPresupuestado: 100 + i, montoRevisado: null,
      estadoLinea: 'Abierta', categoria: catPorNombre('Familia'), quincena: quincenas[0],
    })
  }

  await post(textUpdate('55, algo sin parecido'))
  const txPag = creadas.at(-1)
  const lineasGastoQ1 = presupuestos
    .filter(l => l.quincenaId === 1 && l.categoria?.tipo === 'Gasto' && l.estadoLinea !== 'Cancelada')
    .map(l => l.id)

  const vistos = new Set()
  let pagina = 0
  let botonesPag = enviados.at(-1)?.buttons || []
  for (let guard = 0; guard < 10; guard++) {
    for (const b of botonesPag.flat()) {
      const m = /^pl:\d+:(\d+)$/.exec(b.callback_data || '')
      if (m) vistos.add(Number(m[1]))
    }
    const siguiente = botonesPag.flat().find(b => b.callback_data === `pp:${txPag.id}:${pagina + 1}`)
    if (!siguiente) break
    pagina += 1
    await post(callbackUpdate(`pp:${txPag.id}:${pagina}`))
    botonesPag = editados.at(-1)?.buttons || []
  }

  check('hubo mas de una pagina', pagina > 0, pagina)
  // Sin este numero, ver seis botones se lee como "estas son las que hay" y el
  // "Ver más" parece decoracion en vez de la forma de llegar a las otras.
  const textoPag = enviados.at(-1)?.message || ''
  check('dice cuantas lineas hay en total', new RegExp(`Hay ${lineasGastoQ1.length} líneas`).test(textoPag), textoPag)
  check('nombra las dos salidas', /Ver más/.test(textoPag) && /Buscar por categoría/.test(textoPag), textoPag)
  check('la union de las paginas trae TODAS las lineas',
    lineasGastoQ1.every(id => vistos.has(id)), `faltaron ${lineasGastoQ1.filter(id => !vistos.has(id))}`)
  check('nunca ofrecio la linea de Ingreso', !vistos.has(13) && !vistos.has(14), [...vistos].join(','))
  check('todos los callback_data caben en 64 bytes',
    botonesPag.every(f => f.every(b => Buffer.byteLength(b.callback_data || '') <= 64)))

  console.log('\n=== AG2: el menu por categoria lleva a las lineas de esa categoria ===')
  await post(callbackUpdate(`pc:${txPag.id}:0`))
  const menu = editados.at(-1)
  const cbsMenu = menu?.buttons?.flat().map(b => b.callback_data) || []
  check('lista las categorias, no las lineas', cbsMenu.includes(`pc:${txPag.id}:3`) && cbsMenu.includes(`pc:${txPag.id}:7`), JSON.stringify(cbsMenu))
  check('no ofrece la categoria de Ingresos', !cbsMenu.includes(`pc:${txPag.id}:1`), JSON.stringify(cbsMenu))

  await post(callbackUpdate(`pc:${txPag.id}:7`))
  const soloPersonal = editados.at(-1)?.buttons?.flat().map(b => b.callback_data) || []
  check('ahora si muestra lineas de Personal', soloPersonal.includes(`pl:${txPag.id}:10`), JSON.stringify(soloPersonal))
  check('y ninguna de Familia', !soloPersonal.includes(`pl:${txPag.id}:12`), JSON.stringify(soloPersonal))

  console.log('\n=== AH: crear linea desde el bot escribe TAMBIEN su bitacora ===')
  await post(textUpdate('123, concierto raro'))
  const txNueva = creadas.at(-1)
  await post(callbackUpdate(`pd:${txNueva.id}:0`))
  const menuCats = editados.at(-1)?.buttons?.flat().map(b => b.callback_data) || []
  check('ofrece categorias del mismo tipo', menuCats.includes(`pd:${txNueva.id}:7`), JSON.stringify(menuCats))
  check('no ofrece categorias de otro tipo', !menuCats.includes(`pd:${txNueva.id}:1`), JSON.stringify(menuCats))

  const cambiosAntes = cambiosPresupuesto.length
  await post(callbackUpdate(`pd:${txNueva.id}:7`))
  const lineaNueva = presupuestos.at(-1)
  check('creo la linea', lineaNueva?.descripcion === txNueva.descripcion, lineaNueva?.descripcion)
  check('con el monto del movimiento', Number(lineaNueva?.montoPresupuestado) === Number(txNueva.monto), lineaNueva?.montoPresupuestado)
  check('el tipo sale de la categoria', lineaNueva?.tipo === 'Gasto', lineaNueva?.tipo)
  check('enlazo el movimiento a la linea nueva', txNueva.presupuestoId === lineaNueva?.id, txNueva.presupuestoId)
  check('escribio la fila de bitacora', cambiosPresupuesto.length === cambiosAntes + 1, cambiosPresupuesto.length)
  const cambio = cambiosPresupuesto.at(-1)
  check('la bitacora es un CREACION', cambio?.valores?.includes('CREACION'), JSON.stringify(cambio?.valores))
  check('la bitacora trae el monto de la linea', cambio?.valores?.includes(Number(txNueva.monto)), JSON.stringify(cambio?.valores))

  console.log('\n=== AH2: no se puede crear una linea de otro tipo ===')
  // Espejo de AB para el camino de creacion: si esto se colara, el bot seria el
  // unico lugar capaz de fabricar el cruce de tipo que hace desaparecer el monto.
  const cambiosAntesAH2 = cambiosPresupuesto.length
  const lineasAntesAH2 = presupuestos.length
  await post(callbackUpdate(`pd:${txNueva.id}:1`))
  check('no creo la linea', presupuestos.length === lineasAntesAH2, presupuestos.length)
  check('no escribio bitacora', cambiosPresupuesto.length === cambiosAntesAH2, cambiosPresupuesto.length)

  // --- Clasificador: "¿Es correcta la categoria?" (src/clasificador) ---
  const fbDe = tx => feedbacks.find(f => f.transaccionId === tx.id)
  const cbsDe = msg => msg?.buttons?.flat().map(b => b.callback_data).filter(Boolean) || []

  console.log('\n=== CL1: un gasto NO pregunta la categoria, pero registra la propuesta ===')
  await post(textUpdate('250 croquetas'))
  const txCL1 = creadas.at(-1)
  const msgCL1 = enviados.at(-1)
  check('registro el gasto con la categoria de las reglas', txCL1?.categoriaId === 3, txCL1?.categoriaId)
  check('no pregunta por la categoria', !/¿Es correcta la categoría/.test(msgCL1?.message || ''), msgCL1?.message)
  check('sin botones Si / No', !cbsDe(msgCL1).some(cb => /^k[abc]:/.test(cb)), JSON.stringify(cbsDe(msgCL1)))
  check('ni filas extra: "✏️ Categoría" comparte fila', msgCL1?.buttons?.every(f => !(f.length === 1 && f[0].callback_data === `kn:${txCL1.id}`)), JSON.stringify(msgCL1?.buttons?.at(-1)))
  check('la primera fila es una linea', msgCL1?.buttons?.[0]?.[0]?.callback_data?.startsWith(`pl:${txCL1.id}:`), JSON.stringify(msgCL1?.buttons?.[0]))
  check('guardo la propuesta pendiente', fbDe(txCL1)?.estado === 'pendiente' && fbDe(txCL1)?.categoriaPropuestaId === 3, JSON.stringify(fbDe(txCL1)))
  check('sin modelo entrenado, la fuente son las reglas', fbDe(txCL1)?.fuente === 'reglas' && fbDe(txCL1)?.confianza == null, JSON.stringify(fbDe(txCL1)))
  check('callback_data cabe en 64 bytes', cbsDe(msgCL1).every(cb => Buffer.byteLength(cb) <= 64))

  // CL2-CL4: los botones ka/kn/kc/kb ya no se dibujan, pero siguen
  // funcionando para los mensajes viejos que todavia los tienen.
  console.log('\n=== CL2: "Si" (mensaje viejo) la marca aceptada y pasa a las lineas ===')
  const escriturasCL2 = escrituras.length
  await post(callbackUpdate(`ka:${txCL1.id}`))
  check('feedback aceptada', fbDe(txCL1)?.estado === 'aceptada' && fbDe(txCL1)?.categoriaFinalId === 3, JSON.stringify(fbDe(txCL1)))
  check('no toco la transaccion', escrituras.length === escriturasCL2, escrituras.length)
  check('lo confirma en el mensaje', /Categoría confirmada: \*Familia\*/.test(editados.at(-1)?.message || ''), editados.at(-1)?.message)
  check('ahora ofrece las lineas, sin la pregunta', cbsDe(editados.at(-1)).some(cb => cb.startsWith('pl:')) && !cbsDe(editados.at(-1)).some(cb => /^k[abc]:/.test(cb)), JSON.stringify(cbsDe(editados.at(-1))))
  await post(callbackUpdate(`ka:${txCL1.id}`))
  check('contestar dos veces no cambia nada', fbDe(txCL1)?.estado === 'aceptada', fbDe(txCL1)?.estado)

  console.log('\n=== CL3: "No" muestra las otras categorias del mismo tipo ===')
  await post(textUpdate('300 tenis'))
  const txCL3 = creadas.at(-1)
  await post(callbackUpdate(`kn:${txCL3.id}`))
  const menuCL3 = cbsDe(editados.at(-1))
  check('ofrece Familia', menuCL3.includes(`kc:${txCL3.id}:3`), JSON.stringify(menuCL3))
  check('no ofrece la que ya tiene', !menuCL3.includes(`kc:${txCL3.id}:7`), JSON.stringify(menuCL3))
  check('no ofrece categorias de otro tipo', !menuCL3.includes(`kc:${txCL3.id}:1`), JSON.stringify(menuCL3))
  check('permite volver', menuCL3.includes(`kb:${txCL3.id}`), JSON.stringify(menuCL3))
  await post(callbackUpdate(`kb:${txCL3.id}`))
  check('volver regresa a las lineas', cbsDe(editados.at(-1))[0]?.startsWith(`pl:${txCL3.id}:`), JSON.stringify(cbsDe(editados.at(-1))))

  console.log('\n=== CL4: elegir otra categoria la corrige y aprende ===')
  await post(callbackUpdate(`kc:${txCL3.id}:3`))
  check('cambio la categoria', txCL3.categoriaId === 3, txCL3.categoriaId)
  check('re-derivo la clasificacion', txCL3.clasificacion === 'Variable', txCL3.clasificacion)
  check('no cambio el tipo', txCL3.tipo === 'Gasto', txCL3.tipo)
  check('feedback corregida', fbDe(txCL3)?.estado === 'corregida' && fbDe(txCL3)?.categoriaFinalId === 3, JSON.stringify(fbDe(txCL3)))
  check('lo dice en el mensaje', /Lo cambié a \*Familia\*/.test(editados.at(-1)?.message || ''), editados.at(-1)?.message)
  check('sigue con las lineas', cbsDe(editados.at(-1)).some(cb => cb.startsWith(`pl:${txCL3.id}:`)), JSON.stringify(cbsDe(editados.at(-1))))
  check('dejo traza', logsIncluyen('CLASIFICADOR_FEEDBACK: tx=' + txCL3.id + '; estado=corregida'), 'falta CLASIFICADOR_FEEDBACK')

  console.log('\n=== CL5: un kc forjado hacia otro TIPO se rechaza ===')
  await post(textUpdate('70 croquetas'))
  const txCL5 = creadas.at(-1)
  const escriturasCL5 = escrituras.length
  await post(callbackUpdate(`kc:${txCL5.id}:1`))
  check('no escribio nada', escrituras.length === escriturasCL5, escrituras.length)
  check('la categoria quedo intacta', txCL5.categoriaId === 3, txCL5.categoriaId)
  check('el feedback sigue pendiente', fbDe(txCL5)?.estado === 'pendiente', fbDe(txCL5)?.estado)
  await post(callbackUpdate(`kc:${txCL5.id}:9999`))
  check('una categoria inexistente tampoco', txCL5.categoriaId === 3 && escrituras.length === escriturasCL5, txCL5.categoriaId)

  console.log('\n=== CL6: elegir una linea de la misma categoria cuenta como "si" ===')
  await post(callbackUpdate(`pl:${txCL5.id}:12`))
  check('enlazo', txCL5.presupuestoId === 12, txCL5.presupuestoId)
  check('feedback aceptada', fbDe(txCL5)?.estado === 'aceptada' && fbDe(txCL5)?.categoriaFinalId === 3, JSON.stringify(fbDe(txCL5)))
  const escriturasCL6 = escrituras.length
  await post(callbackUpdate(`kc:${txCL5.id}:7`))
  check('ya enlazado: no se cambia la categoria por fuera', txCL5.categoriaId === 3 && escrituras.length === escriturasCL6, txCL5.categoriaId)

  console.log('\n=== CL7: con cruce, "mover la categoria" es una correccion ===')
  await post(textUpdate('40 tenis'))
  const txCL7 = creadas.at(-1)
  await post(callbackUpdate(`pl:${txCL7.id}:12`))
  check('con cruce, el toque ya es la correccion (Familia)', fbDe(txCL7)?.estado === 'corregida' && fbDe(txCL7)?.categoriaFinalId === 3 && txCL7.categoriaId === 3, JSON.stringify(fbDe(txCL7)))

  console.log('\n=== CL8: un ingreso no pregunta ===')
  await post(textUpdate('cobro 1200 reembolso'))
  const txCL8 = creadas.at(-1)
  check('es ingreso', txCL8?.tipo === 'Ingreso', txCL8?.tipo)
  check('sin pregunta', !cbsDe(enviados.at(-1)).some(cb => cb.startsWith('ka:')), JSON.stringify(cbsDe(enviados.at(-1))))
  check('sin feedback', !fbDe(txCL8), JSON.stringify(fbDe(txCL8)))

  console.log('\n=== CL9: con respuestas confirmadas, el modelo propone y gana a las reglas ===')
  // "convivio" no esta en las palabras clave: las reglas lo mandan a Personal
  // por default. En las respuestas Si/No del usuario, los convivios son de
  // Familia. (El modelo de categoria aprende SOLO de esas respuestas.)
  let hid = 90000
  for (let i = 0; i < 3; i++) {
    for (const d of ['convivio escuela', 'convivio kinder', 'convivio salon', 'convivio fin de curso', 'croquetas']) feedbacks.push({ id: hid, transaccionId: hid++, texto: d, categoriaPropuestaId: 3, categoriaFinalId: 3, fuente: 'reglas', estado: 'aceptada' })
    for (const d of ['ropa', 'gym', 'tenis', 'corte pelo', 'yoga']) feedbacks.push({ id: hid, transaccionId: hid++, texto: d, categoriaPropuestaId: 7, categoriaFinalId: 7, fuente: 'reglas', estado: 'aceptada' })
  }
  require(path.join(SRC, 'clasificador'))._reiniciar()
  await post(textUpdate('95 convivio'))
  const txCL9 = creadas.at(-1)
  check('lo registro en Familia', txCL9?.categoriaId === 3, txCL9?.categoriaId)
  check('la fuente es el modelo', fbDe(txCL9)?.fuente === 'modelo' && fbDe(txCL9)?.confianza > 0.6, JSON.stringify(fbDe(txCL9)))
  check('dejo traza de que difirio de las reglas', logsIncluyen('CLASIFICADOR_DIFIERE: reglas=Personal; modelo=Familia'), 'falta CLASIFICADOR_DIFIERE')
  check('tampoco pregunta', !cbsDe(enviados.at(-1)).some(cb => cb.startsWith('ka:')), JSON.stringify(cbsDe(enviados.at(-1))))

  console.log('\n=== CL10: si la tabla de feedback falla, el gasto se registra igual ===')
  feedbackFalla = true
  const antesCL10 = creadas.length
  await post(textUpdate('60 croquetas'))
  feedbackFalla = false
  check('registro el gasto', creadas.length === antesCL10 + 1, creadas.length)
  check('confirmo el registro', /registrado/i.test(enviados.at(-1)?.message || ''), enviados.at(-1)?.message)
  check('sin pregunta (no hay donde guardar la respuesta)', !cbsDe(enviados.at(-1)).some(cb => cb.startsWith('ka:')), JSON.stringify(cbsDe(enviados.at(-1))))

  console.log('\n=== CL11: la ⭐ de linea la pone el modelo cuando la regla no opina ===')
  // "kermes" no se parece a ningun nombre de linea, y la regla solo mira las
  // lineas de SU categoria (Personal). En el historico, las kermes van a
  // Colegiatura (linea 12, de Familia).
  for (let i = 0; i < 25; i++) historicoLineas.push({ descripcion: i % 2 ? 'kermes escuela' : 'kermes', presupuesto: { descripcion: 'Colegiatura' } })
  for (let i = 0; i < 10; i++) historicoLineas.push({ descripcion: 'ropa', presupuesto: { descripcion: 'Gastos Personales' } })
  require(path.join(SRC, 'clasificador'))._reiniciar()
  await post(textUpdate('55 kermes'))
  const txCL11 = creadas.at(-1)
  const msgCL11 = enviados.at(-1)
  const filasLineaCL11 = (msgCL11?.buttons || []).filter(f => f[0]?.callback_data?.startsWith('pl:'))
  check('la ⭐ es Colegiatura', filasLineaCL11[0]?.[0]?.callback_data === `pl:${txCL11.id}:12` && /^⭐ /.test(filasLineaCL11[0]?.[0]?.text || ''), JSON.stringify(filasLineaCL11[0]))
  check('el texto la propone con su confianza', /¿Lo mando a \*Colegiatura\*\? _\(\d+ % seguro\)_/.test(msgCL11?.message || ''), msgCL11?.message)
  check('nunca dice "100 % seguro"', !/100 % seguro/.test(msgCL11?.message || '') && /99 % seguro/.test(msgCL11?.message || ''), msgCL11?.message)
  await post(callbackUpdate(`pp:${txCL11.id}:0`))
  check('paginar conserva la misma ⭐ (orden determinista)', editados.at(-1)?.buttons?.find(f => f[0]?.callback_data?.startsWith('pl:'))?.[0]?.callback_data === `pl:${txCL11.id}:12`, JSON.stringify(editados.at(-1)?.buttons?.[0]))

  console.log('\n=== CL12: elegir una linea le ensena al modelo ===')
  // "rifa" es nueva para el modelo: no hay ⭐. Despues de mandarla dos veces
  // a Colegiatura... la tercera ya la sugiere.
  await post(textUpdate('20 rifa'))
  const txR1 = creadas.at(-1)
  check('al principio no la conoce', !(enviados.at(-1)?.buttons || []).some(f => /^⭐ /.test(f[0]?.text || '')), JSON.stringify(enviados.at(-1)?.buttons?.[1]))
  await post(callbackUpdate(`pl:${txR1.id}:12`))
  await post(textUpdate('20 rifa'))
  await post(callbackUpdate(`pl:${creadas.at(-1).id}:12`))
  await post(textUpdate('20 rifa'))
  const txR3 = creadas.at(-1)
  const filasR3 = (enviados.at(-1)?.buttons || []).filter(f => f[0]?.callback_data?.startsWith('pl:'))
  check('despues de dos toques ya la sugiere', filasR3[0]?.[0]?.callback_data === `pl:${txR3.id}:12` && /^⭐ /.test(filasR3[0]?.[0]?.text || ''), JSON.stringify(filasR3[0]))

  // --- Sesion de entrenamiento (src/entrenamiento.js): solo la LINEA ---
  const sinLinea = () => creadas.filter(t => t.tipo === 'Gasto' && t.presupuestoId == null && /[a-z]/i.test(t.descripcion)).sort((x, y) => y.id - x.id)

  console.log('\n=== E1: "vamos a entrenar" muestra el gasto sin linea mas reciente, con su linea propuesta ===')
  // "ropa" -> Gastos Personales (linea 10) en el historico de lineas (CL11).
  await post(textUpdate('45 ropa'))
  const txE1 = creadas.at(-1)
  const escriturasE1 = escrituras.length
  const antesE1 = creadas.length
  await post(textUpdate('Vamos a entrenar'))
  const menuE1 = enviados.at(-1)
  check('primero pregunta el estilo', /¿Cómo entrenamos\?/.test(menuE1?.message || '') && cbsDe(menuE1).join() === 'em:g,em:p', JSON.stringify(cbsDe(menuE1)))
  await post(callbackUpdate('em:g'))
  const msgE1 = editados.at(-1)
  const cbsE1 = cbsDe(msgE1)
  check('no registro nada', creadas.length === antesE1 && escrituras.length === escriturasE1, creadas.length)
  check('es la sesion, con ese gasto', /Entrenamiento/.test(msgE1?.message || '') && (msgE1?.message || '').includes('ropa'), msgE1?.message)
  check('propone la linea Gastos Personales', /📂 ¿\*Gastos Personales\*\?/.test(msgE1?.message || '') && cbsE1.includes(`ea:${txE1.id}:10`), `${cbsE1} / ${msgE1?.message}`)
  check('ni una palabra de categoria', !/Categor/.test(msgE1?.message || ''), msgE1?.message)
  check('botones: Si, Otra linea / Saltar, Terminar (dos filas)', msgE1?.buttons?.length === 2 && cbsE1.includes(`el:${txE1.id}:0`) && cbsE1.includes(`es:${txE1.id}`) && cbsE1.includes('ef:0'), JSON.stringify(cbsE1))
  check('callback_data cabe en 64 bytes', cbsE1.every(cb => Buffer.byteLength(cb) <= 64))

  console.log('\n=== E2: "Si" asigna la linea, la categoria la sigue y pasa al siguiente ===')
  await post(callbackUpdate(`ea:${txE1.id}:10`))
  check('enlazo la linea', txE1.presupuestoId === 10, txE1.presupuestoId)
  check('la categoria es la de la linea (Personal)', txE1.categoriaId === 7, txE1.categoriaId)
  check('la categoria quedo como respuesta del modelo de categoria', ['aceptada', 'corregida'].includes(feedbacks.find(f => f.transaccionId === txE1.id)?.estado) && feedbacks.find(f => f.transaccionId === txE1.id)?.categoriaFinalId === 7, JSON.stringify(feedbacks.find(f => f.transaccionId === txE1.id)))
  const msgE2 = editados.at(-1)
  check('lo dice', /✅ «ropa» → Gastos Personales/.test(msgE2?.message || ''), msgE2?.message)
  const sigE2 = sinLinea().find(t => t.id < txE1.id)
  check('edita el MISMO mensaje con el siguiente sin linea', cbsDe(msgE2).some(cb => cb.endsWith(`:${sigE2.id}:0`) || cb.startsWith(`ea:${sigE2.id}:`) || cb === `es:${sigE2.id}`), JSON.stringify(cbsDe(msgE2)))

  console.log('\n=== E3: "Otra linea" -> menu paginado de la quincena; elegir una mueve tambien la categoria ===')
  await post(textUpdate('60 tenis'))
  const txE3 = creadas.at(-1)
  await post(textUpdate('vamos a entrenar'))
  await post(callbackUpdate(`el:${txE3.id}:0`))
  const cbsMenuE3 = cbsDe(editados.at(-1))
  check('menu con lineas y volver', cbsMenuE3.some(cb => cb.startsWith(`en:${txE3.id}:`)) && cbsMenuE3.includes(`eb:${txE3.id}`), JSON.stringify(cbsMenuE3))
  check('nunca ofrece lineas de otro tipo', !cbsMenuE3.includes(`en:${txE3.id}:13`), JSON.stringify(cbsMenuE3))
  check('pagina si no caben', cbsMenuE3.includes(`el:${txE3.id}:1`), JSON.stringify(cbsMenuE3))
  await post(callbackUpdate(`eb:${txE3.id}`))
  check('volver redibuja el gasto', cbsDe(editados.at(-1)).includes(`es:${txE3.id}`), JSON.stringify(cbsDe(editados.at(-1))))
  await post(callbackUpdate(`en:${txE3.id}:12`))
  check('enlazo Colegiatura', txE3.presupuestoId === 12, txE3.presupuestoId)
  check('y la categoria paso a Familia', txE3.categoriaId === 3, txE3.categoriaId)
  check('feedback corregida a Familia', feedbacks.find(f => f.transaccionId === txE3.id)?.estado === 'corregida', JSON.stringify(feedbacks.find(f => f.transaccionId === txE3.id)))

  console.log('\n=== E4: un en forjado hacia una linea de otro tipo se rechaza ===')
  await post(textUpdate('35 tenis'))
  const txE4 = creadas.at(-1)
  const escriturasE4 = escrituras.length
  await post(callbackUpdate(`en:${txE4.id}:13`))
  check('no enlazo ni movio nada', txE4.presupuestoId == null && txE4.categoriaId === 7 && escrituras.length === escriturasE4, `${txE4.presupuestoId} / ${txE4.categoriaId}`)
  check('lo dice', /⚠️/.test(editados.at(-1)?.message || ''), editados.at(-1)?.message)

  console.log('\n=== E5: "Saltar" no escribe nada ===')
  const feedbacksE5 = JSON.stringify(feedbacks)
  const escriturasE5 = escrituras.length
  await post(callbackUpdate(`es:${txE4.id}`))
  check('ni feedback ni transacciones', JSON.stringify(feedbacks) === feedbacksE5 && escrituras.length === escriturasE5)
  check('pasa a uno mas viejo', cbsDe(editados.at(-1)).every(cb => cb === 'ef:0' || Number(cb.split(':')[1]) < txE4.id), JSON.stringify(cbsDe(editados.at(-1))))

  console.log('\n=== E6: "Terminar" cierra ===')
  await post(callbackUpdate('ef:0'))
  check('cierra sin botones', /Entrenamiento terminado/.test(editados.at(-1)?.message || '') && !editados.at(-1)?.buttons, editados.at(-1)?.message)

  console.log('\n=== E7: un boton de categoria de la version anterior no rompe nada ===')
  const escriturasE7 = escrituras.length
  await post(callbackUpdate(`ec:${txE4.id}:3:7:r`))
  check('no escribio', escrituras.length === escriturasE7 && txE4.categoriaId === 7)
  check('redibuja el gasto en el formato nuevo', cbsDe(editados.at(-1)).includes(`es:${txE4.id}`), JSON.stringify(cbsDe(editados.at(-1))))

  console.log('\n=== E8: un gasto con linea nunca sale ===')
  check('ninguno de los gastos con linea aparecio', ![txE1.id, txE3.id].some(id => editados.slice(-3).some(m => (m.buttons || []).flat().some(b => b.callback_data === `es:${id}`))))

  console.log('\n=== E9: sin nada por revisar, lo dice ===')
  for (const t of creadas.filter(t => t.tipo === 'Gasto' && t.presupuestoId == null)) t.presupuestoId = 10
  await post(textUpdate('/entrenar'))
  await post(callbackUpdate('em:g'))
  check('"/entrenar" tambien funciona, y avisa que no hay nada', /No hay gastos sin línea/.test(editados.at(-1)?.message || ''), editados.at(-1)?.message)

  // --- Modo "Yo te escribo palabras" (src/entrenamientoPalabras.js) ---
  console.log('\n=== W1: elegir el modo palabras ===')
  await post(textUpdate('vamos a entrenar'))
  await post(callbackUpdate('em:p'))
  check('explica el modo y que no registra gastos', /Modo palabras/.test(editados.at(-1)?.message || '') && /No se registra ningún gasto/.test(editados.at(-1)?.message || ''), editados.at(-1)?.message)

  console.log('\n=== W2: una palabra NO registra gasto y el bot adivina la linea ===')
  const antesW2 = creadas.length
  await post(textUpdate('kermes'))
  const msgW2 = enviados.at(-1)
  const ejW2 = ejemplos.at(-1)
  check('no registro ningun gasto', creadas.length === antesW2, creadas.length)
  check('guardo la palabra como ejemplo pendiente', ejW2?.texto === 'kermes' && ejW2?.estado === 'pendiente', JSON.stringify(ejW2))
  check('adivina Colegiatura', /«kermes» → ¿\*Colegiatura\*\?/.test(msgW2?.message || '') && cbsDe(msgW2).includes(`wa:${ejW2.id}:12`), `${cbsDe(msgW2)} / ${msgW2?.message}`)
  check('callback_data cabe en 64 bytes', cbsDe(msgW2).every(cb => Buffer.byteLength(cb) <= 64))

  console.log('\n=== W3: "Si" -> acerto, se guarda y aprende ===')
  await post(callbackUpdate(`wa:${ejW2.id}:12`))
  check('ejemplo confirmado, con la linea y su categoria', ejW2.estado === 'confirmado' && ejW2.lineaDescripcion === 'Colegiatura' && ejW2.categoriaId === 3 && ejW2.acerto === true, JSON.stringify(ejW2))
  check('lo celebra y pide otra', /¡Acerté!/.test(editados.at(-1)?.message || '') && /Escríbeme otra/.test(editados.at(-1)?.message || ''), editados.at(-1)?.message)
  const escriturasW3 = escrituras.length
  await post(callbackUpdate(`wa:${ejW2.id}:12`))
  check('contestar dos veces no cambia nada', escrituras.length === escriturasW3 && ejemplos.filter(e => e.estado === 'confirmado').length === 1)

  console.log('\n=== W4: palabra desconocida -> elegir linea -> no acerto, pero aprende ===')
  await post(textUpdate('piñata'))
  const ejW4 = ejemplos.at(-1)
  const msgW4 = enviados.at(-1)
  check('no sabe y ofrece elegir', /no sé a qué línea va/.test(msgW4?.message || '') && cbsDe(msgW4).includes(`wl:${ejW4.id}:0:0`), `${cbsDe(msgW4)} / ${msgW4?.message}`)
  await post(callbackUpdate(`wl:${ejW4.id}:0:0`))
  const menuW4 = cbsDe(editados.at(-1))
  check('menu de lineas de gasto de la quincena', menuW4.includes(`wn:${ejW4.id}:12:0`) && !menuW4.some(cb => cb.startsWith(`wn:${ejW4.id}:13:`)) && menuW4.includes(`wb:${ejW4.id}`), JSON.stringify(menuW4))
  await post(callbackUpdate(`wn:${ejW4.id}:12:0`))
  check('confirmado sin acierto', ejW4.estado === 'confirmado' && ejW4.lineaDescripcion === 'Colegiatura' && ejW4.acerto === false, JSON.stringify(ejW4))
  check('dice que lo aprendio', /Aprendido: «piñata»/.test(editados.at(-1)?.message || ''), editados.at(-1)?.message)
  await post(textUpdate('piñata'))
  check('la siguiente vez ya la adivina', /«piñata» → ¿\*Colegiatura\*\?/.test(enviados.at(-1)?.message || ''), enviados.at(-1)?.message)

  console.log('\n=== W5: un wn forjado hacia una linea de ingreso se rechaza ===')
  const ejW5 = ejemplos.at(-1)
  await post(callbackUpdate(`wn:${ejW5.id}:13:0`))
  check('no lo confirmo', ejW5.estado === 'pendiente', JSON.stringify(ejW5))
  check('lo dice', /⚠️/.test(editados.at(-1)?.message || ''), editados.at(-1)?.message)

  console.log('\n=== W6: en modo palabras, un mensaje con monto SI se registra como gasto ===')
  const antesW6 = creadas.length
  const ejemplosW6 = ejemplos.length
  await post(textUpdate('150 croquetas'))
  check('registro el gasto', creadas.length === antesW6 + 1 && Number(creadas.at(-1).monto) === 150, creadas.length)
  check('y no lo tomo como palabra', ejemplos.length === ejemplosW6, ejemplos.length)

  console.log('\n=== W7: "listo" termina con el marcador ===')
  await post(textUpdate('listo'))
  check('marcador de la ronda', /Acerté 1 de 2\./.test(enviados.at(-1)?.message || ''), enviados.at(-1)?.message)
  const ejemplosW7 = ejemplos.length
  await post(textUpdate('kermes'))
  check('fuera del modo, una palabra ya no es entrenamiento', ejemplos.length === ejemplosW7, ejemplos.length)

  console.log('\n=== W8: el modo se apaga solo tras la inactividad ===')
  const palabrasMod = require(path.join(SRC, 'entrenamientoPalabras'))
  await post(textUpdate('vamos a entrenar'))
  await post(callbackUpdate('em:p'))
  for (const s of palabrasMod._sesiones.values()) s.ultimo -= palabrasMod.INACTIVIDAD_MS + 1000
  const ejemplosW8 = ejemplos.length
  await post(textUpdate('kermes'))
  check('tras 15 min sin escribir, ya no toma palabras', ejemplos.length === ejemplosW8, ejemplos.length)

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('El harness truono:', e); process.exit(1) })
