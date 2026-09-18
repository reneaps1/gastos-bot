process.env.TZ = 'America/Mexico_City'
require('dotenv').config()

// Render no preserva node_modules/.prisma entre build y runtime.
// Prisma 7 necesita DATABASE_URL para generate (prisma.config.ts), aunque no conecta a la DB.
// SKIP_PRISMA_BOOTSTRAP=1 lo salta (scripts/test-bot-flow.js, que no toca Postgres).
if (process.env.SKIP_PRISMA_BOOTSTRAP !== '1') {
  const { execSync } = require('child_process')
  const realDbUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = realDbUrl || 'postgresql://x:x@localhost:0/x'
  // Un generate fallido mata el arranque, y en Render eso es un crash loop:
  // el webhook deja de existir y el bot se queda mudo sin mandar nada al chat.
  // Un reintento cubre el fallo transitorio (red, disco lento en cold start).
  let generated = false
  for (let attempt = 1; attempt <= 2 && !generated; attempt++) {
    try {
      execSync('node_modules/.bin/prisma generate', { stdio: 'inherit' })
      generated = true
    } catch (e) {
      console.error(`prisma generate failed (attempt ${attempt}/2):`, e.message)
    }
  }
  if (!generated) process.exit(1)
  process.env.DATABASE_URL = realDbUrl
  if (realDbUrl) {
    try {
      execSync('node_modules/.bin/prisma migrate deploy', { stdio: 'inherit' })
    } catch (e) {
      console.error('prisma migrate deploy failed:', e.message)
    }
  } else {
    console.warn('DATABASE_URL not set — skipping prisma migrate deploy')
  }
}

const express = require('express')
const { appendRow, messageExists: sheetsMessageExists } = require('./sheets')
const { parseMessage, formatConfirmation, cleanDescription, isShorthandExpense } = require('./parser')
const { sendWhatsAppMessage, extractPhoneNumber, markAsRead, react, downloadMedia } = require('./whatsapp')
const { handleQuestion, detectIntent, getData } = require('./analytics')
const { getCurrentQuincena, ensureFreshQuincenas } = require('./quincenas')
const gemini = require('./gemini')
const todoist = require('./todoist')
const media = require('./media')
const db = require('./database')
const prisma = require('./lib/prisma')
const { resolverTipoYDireccion } = require('./tipoAhorro')
const { CLASIFICACION_POR_CATEGORIA } = require('./clasificacion')
const telegram = require('./telegram')
const telegramBrain = require('./telegramBrain')
const aiRouter = require('./aiRouter')
const financeAgent = require('./financeAgent')
const {
  TIPOS_CON_LINEA,
  resolveBudgetLine,
  resolveBudgetLineByName,
  getBudgetCandidates,
  getBudgetLineStatus,
  formatBudgetStatus,
} = require('./budgetTracker')
const {
  linkTransactionToBudget,
  alignTransactionCategory,
  unlinkTransaction,
  findTransactionsByReference,
  describeRechazo,
} = require('./budgetActions')
const { detectReassign } = require('./reassignIntent')

// A donde mandar a la gente cuando hay que cubrir un excedido: el traspaso entre
// lineas es una operacion auditada que vive en el dashboard, no en el bot.
const DASHBOARD_URL = (process.env.DASHBOARD_URL || 'https://gastos-dashboard.onrender.com').replace(/\/$/, '')

const app = express()
app.use(express.json())

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN
const SHEETS_ENABLED = process.env.GOOGLE_SHEETS_ENABLED !== 'false'

// Previene race condition cuando Meta envía el mismo webhook dos veces en rápida sucesión
const processingMessages = new Set()
// Mismo proposito que processingMessages, pero para updates de Telegram
// (update_id numerico, espacio de ids distinto al de WhatsApp)
const processingUpdates = new Set()

async function assuredSend(to, message, context) {
  const result = await sendWhatsAppMessage(to, message)
  if (!result.ok) {
    console.error(`MESSAGE_NOT_DELIVERED to=${to} context=${context} error=`, JSON.stringify(result.error))
  }
  return result
}

function parseMessageFromMedia(analysis, senderName, senderPhone, messageId) {
  const categoria = analysis.categoria || 'Personal'
  const now = new Date()
  const fechaMexico = new Date(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T00:00:00.000Z`)
  return {
    timestamp: now,
    fecha: fechaMexico,
    usuario: senderName || 'Rene',
    phone: senderPhone || null,
    monto: analysis.monto || 0,
    descripcion: analysis.descripcion || 'Sin descripcion',
    categoria,
    formaPago: 'Efectivo',
    tipo: categoria === 'Ingresos' ? 'Ingreso' : categoria === 'Ahorro' ? 'Ahorro' : 'Gasto',
    clasificacion: CLASIFICACION_POR_CATEGORIA[categoria] || null,
    quincena: getCurrentQuincena(),
    estatus: 'Pagado',
    messageId: messageId || null,
  }
}

async function registerAndConfirm(parsed, senderPhone, messageId, senderName, user) {
  const categoria = await db.findCategoria(parsed.categoria)
  const metodoPago = await db.findMetodoPago(parsed.formaPago)
  const quincena = await db.findQuincenaByCodigo(parsed.quincena)

  if (!categoria || !quincena) {
    console.error(`No se encontro categoria (${parsed.categoria}) o quincena (${parsed.quincena})`)
    await react(senderPhone, messageId, '❌')
    await assuredSend(senderPhone, 'Error: categoria o quincena no encontrada.', 'media:error_cat')
    return
  }

  const tx = await db.saveTransaccion({
    fecha: parsed.fecha,
    quincenaId: quincena.id,
    userId: user?.id || null,
    descripcion: parsed.descripcion,
    categoriaId: categoria.id,
    clasificacion: parsed.clasificacion,
    tipo: parsed.tipo,
    direccion: parsed.direccion,
    monto: parsed.monto,
    metodoPagoId: metodoPago?.id || null,
    estatus: parsed.estatus,
    notas: null,
    source: 'whatsapp_media',
  })

  await db.saveMessage({
    waMessageId: messageId,
    fromNumber: senderPhone,
    fromName: senderName,
    userId: user?.id || null,
    body: parsed.descripcion,
    tipo: parsed.tipo.toLowerCase(),
    procesado: true,
    transaccionId: tx.id,
    fechaMensaje: new Date(),
  })

  const confirmation = `Registrado desde imagen/audio:\n${parsed.tipo}: $${parsed.monto} - ${parsed.descripcion} (${parsed.categoria})`
  await assuredSend(senderPhone, confirmation, 'media:success')
  await react(senderPhone, messageId, '✅')
  console.log('Media transaccion guardada:', tx.id)
}

// ---- Telegram ----

function normalizeSimpleText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¡!¿?.,]+/g, '')
    .replace(/\s+/g, ' ')
}

function expandFinanceShorthand(text) {
  return String(text || '')
    .replace(/\bx\b/gi, 'por')
    .replace(/\bppto\b/gi, 'presupuesto')
    .replace(/\bqna\b/gi, 'quincena')
    .replace(/\bgastos?\s+(?:pendientes?\s+)?por\s+asignar\b/gi, 'gastos sin asignar')
}

function getSimpleConversationReply(text) {
  const normalized = normalizeSimpleText(text)

  if (/^(hola+|holi+|hi+|hey+|buenas+|buenos dias+|buenas tardes+|buenas noches+|que onda)$/.test(normalized)) {
    return '¡Hola! Soy Milo 👋\n\nPuedo registrar gastos y consultar tus datos de Milo. Prueba: “¿cuánto gasté hoy?” o “¿qué gastos tenemos sin asignar?”.'
  }

  if (/^(gracias+|muchas gracias+|thanks+)$/.test(normalized)) {
    return '¡De nada! 🙌 Aquí estoy para ayudarte con tus gastos y presupuesto.'
  }

  if (/^(ayuda|help|\/help|que puedes hacer)$/.test(normalized)) {
    return [
      'Puedo entender preguntas en lenguaje natural, por ejemplo:',
      '',
      '• “gasté 350 en gasolina”',
      '• “¿cuánto gasté hoy?”',
      '• “¿qué gastos tengo sin asignar?”',
      '• “¿cuánto queda del presupuesto de gasolina?”',
      '• “¿cuánto dinero tenemos realmente?”',
      '• “¿cómo vamos esta quincena?”',
    ].join('\n')
  }

  if (/^(\/start|start)$/.test(normalized)) {
    return '¡Hola! Soy Milo. Puedo registrar movimientos y responder preguntas sobre tus finanzas. Prueba: “gasté 150 en gasolina” o “¿cómo vamos esta quincena?”.'
  }

  return null
}

function looksLikeFinanceQuestion(text) {
  const normalized = normalizeSimpleText(text)
  return /\b(cuanto|cuanta|cuantos|cuantas|que gastos|cuales|como vamos|como voy|resumen|saldo|liquidez|presupuesto|sin asignar|sin linea|sueltos|ultimos movimientos|movimientos recientes)\b/.test(normalized)
}

function formatTelegramDate(date) {
  return date.toLocaleDateString('es-MX', { timeZone: 'UTC' })
}

function formatTelegramConfirmation(parsed) {
  return [
    `✅ *${parsed.tipo} registrado*`,
    '',
    `📅 ${formatTelegramDate(parsed.fecha)}`,
    `👤 ${telegram.escapeMarkdown(parsed.usuario)}`,
    `$${parsed.monto}`,
    `📝 ${telegram.escapeMarkdown(parsed.descripcion)}`,
    `🏷️ ${parsed.categoria}`,
    `💳 ${parsed.formaPago}`,
    `📊 ${parsed.quincena} - ${parsed.clasificacion || ''}`,
    `✅ ${parsed.estatus}`,
  ].join('\n')
}

// Etiqueta de un boton de linea. Vive aparte para que los tests puedan fijarla
// y para que el formato no se reinvente en cada lugar que dibuja botones.
//
// La CATEGORIA es parte de la etiqueta, no decoracion: ahora se ofrecen lineas
// de todas las categorias de la quincena, asi que sin ella el usuario estaria
// eligiendo a ciegas entre partidas que pueden llamarse parecido en categorias
// distintas. La descripcion se trunca porque Telegram corta los botones largos
// por el unico lado que importa: el final.
const LARGO_DESC_BOTON = 20

function etiquetaLinea(c) {
  const desc = c.descripcion.length > LARGO_DESC_BOTON
    ? `${c.descripcion.slice(0, LARGO_DESC_BOTON - 1)}…`
    : c.descripcion
  const categoria = c.categoriaNombre ? ` · ${c.categoriaNombre}` : ''
  return `${desc}${categoria} — $${c.presupuesto.toFixed(2)}`
}

// callback_data tiene un limite de 64 bytes, de ahi los prefijos de dos letras.
// Todos caben de sobra (`pl:1234567:1234567` son 18 bytes); la restriccion real
// es el ancho del boton en un telefono, no los bytes.
//
//   pl:<tx>:<linea>   enlazar
//   pn:<tx>           dejar sin asignar
//   ps:<tx>           elegir cual movimiento (reasignacion ambigua)
//   pp:<tx>:<pagina>  paginar la lista de lineas
//   pc:<tx>:<cat>     categorias; cat 0 = el menu, cat real = sus lineas
//   pk:<tx>:<linea>   confirmar el cambio de categoria (ok)
//   pm:<tx>:<linea>   mantener mi categoria
//
// `0` funciona como centinela en `pc:` porque ninguna categoria tiene id 0.
const PAGE_SIZE = 6
const MAX_LINEAS_POR_CATEGORIA = 10

// Una pagina de lineas mas sus filas de navegacion.
//
// La paginacion NO GUARDA ESTADO: `pp:<tx>:<pagina>` vuelve a pedir las
// candidatas y corta otra vez. Eso funciona solo porque getBudgetCandidates
// ordena de forma total y determinista (ver su comentario); con un orden que
// pudiera variar entre dos llamadas habria lineas que no salen en ninguna
// pagina.
function budgetButtons(transaccionId, candidates, { pagina = 0 } = {}) {
  const totalPaginas = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE))
  const p = Math.min(Math.max(0, Number(pagina) || 0), totalPaginas - 1)

  const rows = candidates.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE).map(c => [{
    text: etiquetaLinea(c),
    callback_data: `pl:${transaccionId}:${c.id}`,
  }])

  if (totalPaginas > 1) {
    const nav = []
    if (p > 0) nav.push({ text: '« Anterior', callback_data: `pp:${transaccionId}:${p - 1}` })
    if (p < totalPaginas - 1) nav.push({ text: `Ver más » (${p + 1}/${totalPaginas})`, callback_data: `pp:${transaccionId}:${p + 1}` })
    rows.push(nav)
  }

  // Atajo por categoria: con muchas lineas, saltar al grupo es mejor que
  // recorrer paginas. Solo aparece si de verdad hay mas de una categoria.
  if (new Set(candidates.map(c => c.categoriaId)).size > 1) {
    rows.push([{ text: '📂 Buscar por categoría', callback_data: `pc:${transaccionId}:0` }])
  }

  rows.push([{ text: 'Dejar sin asignar', callback_data: `pn:${transaccionId}` }])
  return rows
}

// El menu de categorias, con cuantas lineas tiene cada una.
function categoryMenuButtons(transaccionId, candidates) {
  const porCategoria = new Map()
  for (const c of candidates) {
    const actual = porCategoria.get(c.categoriaId)
    if (actual) actual.n += 1
    else porCategoria.set(c.categoriaId, { nombre: c.categoriaNombre || `#${c.categoriaId}`, n: 1 })
  }

  const rows = [...porCategoria]
    .sort((a, b) => a[1].nombre.localeCompare(b[1].nombre))
    .map(([id, { nombre, n }]) => [{ text: `${nombre} (${n})`, callback_data: `pc:${transaccionId}:${id}` }])

  rows.push([{ text: '◀ Volver a las sugeridas', callback_data: `pp:${transaccionId}:0` }])
  rows.push([{ text: 'Dejar sin asignar', callback_data: `pn:${transaccionId}` }])
  return rows
}

// Las lineas de UNA categoria. Sin paginar: un tope basta, y quien tenga mas
// lineas que eso en una sola categoria las sigue alcanzando por la lista
// principal, que si pagina.
function categoryLinesButtons(transaccionId, candidates, categoriaId) {
  const rows = candidates
    .filter(c => c.categoriaId === categoriaId)
    .slice(0, MAX_LINEAS_POR_CATEGORIA)
    .map(c => [{ text: etiquetaLinea(c), callback_data: `pl:${transaccionId}:${c.id}` }])

  rows.push([{ text: '◀ Volver a las categorías', callback_data: `pc:${transaccionId}:0` }])
  return rows
}

// La pregunta de cruce. Alinear va PRIMERO porque es la respuesta por default:
// lo normal es que la linea que elegiste sea la correcta y la categoria que
// adivino el parser sea la que estaba mal.
function crossCategoryButtons(transaccionId, lineaId, nombreCatLinea, nombreCatTx) {
  return [
    [{ text: `Sí, moverlo a ${nombreCatLinea}`, callback_data: `pk:${transaccionId}:${lineaId}` }],
    [{ text: `No, dejarlo en ${nombreCatTx}`, callback_data: `pm:${transaccionId}:${lineaId}` }],
  ]
}

// Boton que lleva al dashboard a cubrir el excedido. Es un boton `url`, no un
// callback: no ejecuta nada en el bot.
function dashboardButton(texto = 'Abrir presupuesto en el dashboard') {
  return [[{ text: texto, url: `${DASHBOARD_URL}/presupuesto` }]]
}

// Un gasto que rebasa su linea se avisa en el momento, no en el cierre de
// quincena. formatBudgetStatus ya redacta el "Excedido: $X"; aqui solo se decide
// si ademas hay que ofrecer el camino para resolverlo.
function budgetStatusBlock(status) {
  const texto = formatBudgetStatus(status)
  if (!texto) return { texto: null, buttons: null }
  if (!status?.excedido) return { texto, buttons: null }

  return {
    texto: `${texto}\n\n⚠️ Este gasto rebasó la línea. Puedes cubrirlo con un traspaso desde otra línea.`,
    buttons: dashboardButton('Cubrir el excedido en el dashboard'),
  }
}

function telegramUserMap() {
  try {
    return JSON.parse(process.env.TELEGRAM_USER_MAP || '{}')
  } catch {
    console.error('TELEGRAM_USER_MAP is not valid JSON')
    return {}
  }
}

async function resolveMiloUser(message) {
  const mappedName = telegramUserMap()[message.telegramUserId]
  if (mappedName) {
    const mapped = await db.findUserByName(mappedName)
    if (mapped) return mapped
  }

  const candidates = [message.senderName, message.senderName.split(' ')[0], message.username].filter(Boolean)
  for (const candidate of candidates) {
    const user = await db.findUserByName(candidate)
    if (user) return user
  }

  return null
}

async function saveTelegramTransaction(parsed, user, categoria, metodoPago, quincena, presupuesto) {
  const { tipo, direccion } = resolverTipoYDireccion(categoria.tipo, parsed.tipo, parsed.direccion ?? null)

  return prisma.transaccion.create({
    data: {
      fecha: parsed.fecha,
      quincenaId: quincena.id,
      quincenaConsumoId: quincena.id,
      userId: user?.id || null,
      descripcion: parsed.descripcion,
      categoriaId: categoria.id,
      clasificacion: parsed.clasificacion,
      tipo,
      direccion,
      monto: parsed.monto,
      metodoPagoId: metodoPago?.id || null,
      presupuestoId: presupuesto?.id || null,
      estatus: parsed.estatus,
      notas: null,
      source: 'telegram',
    },
  })
}

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified successfully')
    res.status(200).send(challenge)
  } else {
    console.log('Webhook verification failed')
    res.sendStatus(403)
  }
})

app.post('/webhook', async (req, res) => {
  res.sendStatus(200)

  try {
    const body = req.body

    if (body.object !== 'whatsapp_business_account') return

    const entry = body.entry?.[0]
    if (!entry) return

    const changes = entry.changes?.[0]
    if (!changes) return

    const messages = changes.value?.messages
    if (!messages || messages.length === 0) return

    for (const message of messages) {
      let text = null
      let mediaMeta = null

      if (message.type === 'text') {
        text = message.text?.body?.trim()
      } else if (message.type === 'audio') {
        mediaMeta = { type: 'audio', id: message.audio?.id, mimeType: message.audio?.mime_type }
      } else if (message.type === 'image') {
        mediaMeta = { type: 'image', id: message.image?.id, mimeType: message.image?.mime_type }
      } else if (message.type === 'document') {
        mediaMeta = { type: 'document', id: message.document?.id, mimeType: message.document?.mime_type, filename: message.document?.filename }
      } else {
        continue
      }

      if (!text && !mediaMeta) continue

      if (processingMessages.has(message.id)) continue
      processingMessages.add(message.id)

      try {
        const senderPhone = extractPhoneNumber(message.from)
        const senderName = changes.value.contacts?.[0]?.profile?.name || 'Rene'
        const user = await db.findUserByPhone(senderPhone) || await db.findUserByName(senderName)
        await ensureFreshQuincenas()

        if (mediaMeta) {
          console.log(`Media from ${senderName} (${senderPhone}): ${mediaMeta.type} ${mediaMeta.id}`)
          await markAsRead(message.id)
          await react(senderPhone, message.id, '⏳')

          const dl = await downloadMedia(mediaMeta.id)
          if (!dl) {
            await assuredSend(senderPhone, 'No pude descargar ese archivo. Intentá de nuevo.', 'media:download_fail')
            await react(senderPhone, message.id, '❌')
            continue
          }

          if (mediaMeta.type === 'audio') {
            const transcribed = await media.transcribeAudio(dl.buffer, dl.mimeType || mediaMeta.mimeType)
            if (transcribed) {
              text = transcribed
              console.log(`Audio transcribed: "${text}"`)
            }
          } else if (mediaMeta.type === 'image' || mediaMeta.type === 'document') {
            const analysis = await media.analyzeImage(dl.buffer, dl.mimeType || mediaMeta.mimeType)
            if (analysis?.type === 'expense' && analysis.monto) {
              await db.saveMessage({
                waMessageId: message.id,
                fromNumber: senderPhone,
                fromName: senderName,
                userId: user?.id || null,
                body: `[${mediaMeta.type}] ${analysis.textoExtraido || analysis.descripcion}`,
                tipo: 'media',
                procesado: true,
                fechaMensaje: new Date(),
              })
              const parsed = parseMessageFromMedia(analysis, senderName, senderPhone, message.id)
              await registerAndConfirm(parsed, senderPhone, message.id, senderName, user)
              continue
            } else if (analysis?.type === 'no_financiero') {
              await db.saveMessage({
                waMessageId: message.id,
                fromNumber: senderPhone,
                fromName: senderName,
                userId: user?.id || null,
                body: `[${mediaMeta.type}] imagen no financiera`,
                tipo: 'media',
                procesado: false,
                fechaMensaje: new Date(),
              })
              await assuredSend(senderPhone, 'Esa imagen no parece ser un ticket o documento financiero. Mandame un ticket, factura o comprobante y lo registro.', 'media:no_financiero')
              await react(senderPhone, message.id, '❓')
              continue
            }
          }

          if (!text) {
            await db.saveMessage({
              waMessageId: message.id,
              fromNumber: senderPhone,
              fromName: senderName,
              userId: user?.id || null,
              body: `[${mediaMeta.type}] sin texto extraible`,
              tipo: 'media',
              procesado: false,
              error: 'no se pudo extraer texto del media',
              fechaMensaje: new Date(),
            })
            await assuredSend(senderPhone, 'No pude extraer informacion de ese archivo. Intentá enviar un mensaje de texto o un audio mas claro.', 'media:no_text')
            await react(senderPhone, message.id, '❌')
            continue
          }
        }

        console.log(`Message from ${senderName} (${senderPhone}): ${text}`)

        await markAsRead(message.id)

        const existsInDb = await db.messageExists(message.id)
        const existsInSheets = SHEETS_ENABLED ? await sheetsMessageExists(message.id) : false

        if (existsInDb || existsInSheets) {
          console.log(`Mensaje duplicado detectado: ${message.id}. Ignorando.`)
          await react(senderPhone, message.id, '✅')
          continue
        }

        // 1. Analytics con regex (rápido, sin costo de API)
        const intent = detectIntent(text)
        if (intent) {
          try {
            const answer = await handleQuestion(text, senderName)
            if (answer) {
              await assuredSend(senderPhone, answer, `analytics:${intent}`)
              await react(senderPhone, message.id, '✅')
              await db.saveMessage({
                waMessageId: message.id,
                fromNumber: senderPhone,
                fromName: senderName,
                userId: user?.id || null,
                body: text,
                tipo: 'analytics',
                procesado: true,
                fechaMensaje: new Date(),
              })
              console.log('Analytics answer sent for intent:', intent)
              continue
            }
          } catch (error) {
            console.error('Analytics error:', error)
          }
        }

        // 2. Gemini: clasifica el mensaje (expense / question / chat)
        // Excepto el atajo "<monto>, <codigo>" (ej. "930, 3B"): siempre es un registro
        // de gasto y se procesa directo con el parser determinista, sin pasar por
        // Gemini. Evita que el clasificador lo confunda con chat y responda que ya
        // quedo registrado sin haber tocado la base de datos.
        let geminiData = null
        if (!isShorthandExpense(text) && gemini.isEnabled()) {
          try {
            const sysCtx = await gemini.getSystemContext(prisma)
            geminiData = await gemini.classify(text, sysCtx)

            if (geminiData?.type === 'chat') {
              const chatReply = await gemini.chat(text, senderName, sysCtx)
              if (chatReply) {
                await assuredSend(senderPhone, chatReply, 'gemini:chat')
                await react(senderPhone, message.id, '✅')
                await db.saveMessage({
                  waMessageId: message.id,
                  fromNumber: senderPhone,
                  fromName: senderName,
                  userId: user?.id || null,
                  body: text,
                  tipo: 'chat',
                  procesado: true,
                  fechaMensaje: new Date(),
                })
                console.log('Gemini handled chat message')
                continue
              }
            }

            if (geminiData?.type === 'question') {
              const data = await getData()
              const geminiAnswer = await gemini.answer(text, data, senderName, sysCtx)
              if (geminiAnswer) {
                await assuredSend(senderPhone, geminiAnswer, 'gemini:question')
                await react(senderPhone, message.id, '✅')
                await db.saveMessage({
                  waMessageId: message.id,
                  fromNumber: senderPhone,
                  fromName: senderName,
                  userId: user?.id || null,
                  body: text,
                  tipo: 'analytics',
                  procesado: true,
                  fechaMensaje: new Date(),
                })
                console.log('Gemini answered free-form question')
                continue
              }
            }

            if (geminiData?.type === 'task' && todoist.isEnabled()) {
              const task = await todoist.createTask({
                content: geminiData.content || text,
                due_string: geminiData.due_string || null,
                priority: geminiData.priority || 1,
              })
              if (task) {
                const dueText = task.due?.string ? ` para el ${task.due.string}` : ''
                await assuredSend(senderPhone, `✅ Tarea agregada en Todoist: "${task.content}"${dueText}`, 'todoist:task_created')
                await react(senderPhone, message.id, '✅')
                await db.saveMessage({
                  waMessageId: message.id,
                  fromNumber: senderPhone,
                  fromName: senderName,
                  userId: user?.id || null,
                  body: text,
                  tipo: 'chat',
                  procesado: true,
                  fechaMensaje: new Date(),
                })
                console.log('Todoist task created for message:', text)
                continue
              }
            }
          } catch (error) {
            console.error('Gemini error:', error)
          }
        }

        // Si Gemini clasificó como tarea pero Todoist falló, no procesar como gasto
        if (geminiData?.type === 'task') {
          await react(senderPhone, message.id, '❌')
          await assuredSend(senderPhone, '❌ No pude crear la tarea en Todoist. Intenta de nuevo.', 'todoist:error')
          continue
        }

        // Si Gemini no lo clasificó como gasto y tampoco hay número en el texto,
        // es un mensaje que no entendemos — responder y no procesar como gasto
        const hasNumber = /\d/.test(text)
        if (!hasNumber && geminiData?.type !== 'expense') {
          await react(senderPhone, message.id, '❓')
          await assuredSend(senderPhone, '🤖 No entendí ese mensaje. Puedes registrar un gasto (ej: "gasté 150 en uber") o hacerme una pregunta sobre tus finanzas.', 'fallback:no_recognize')
          await db.saveMessage({
            waMessageId: message.id,
            fromNumber: senderPhone,
            fromName: senderName,
            userId: user?.id || null,
            body: text,
            tipo: 'error',
            procesado: false,
            error: 'mensaje no reconocido',
            fechaMensaje: new Date(),
          })
          continue
        }

        try {
          await react(senderPhone, message.id, '⏳')

          // geminiData mejora el parseo si Gemini detectó un registro
          const parsed = parseMessage(text, senderName || 'Rene', senderPhone, message.id, geminiData?.type === 'expense' ? geminiData : null)

          const categoria = await db.findCategoria(parsed.categoria)
          const metodoPago = await db.findMetodoPago(parsed.formaPago)
          const quincena = await db.findQuincenaByCodigo(parsed.quincena)

          if (!categoria || !quincena) {
            console.error(`No se encontro categoria (${parsed.categoria}) o quincena (${parsed.quincena})`)
            await react(senderPhone, message.id, '❌')
            await assuredSend(senderPhone, '❌ Error: categoria o quincena no encontrada.', 'error:categoria_quincena')
            await db.saveMessage({
              waMessageId: message.id,
              fromNumber: senderPhone,
              fromName: senderName,
              userId: user?.id || null,
              body: text,
              tipo: 'error',
              procesado: false,
              error: `Categoria: ${parsed.categoria}, Quincena: ${parsed.quincena}`,
              fechaMensaje: new Date(),
            })
            continue
          }

          const tx = await db.saveTransaccion({
            fecha: parsed.fecha,
            quincenaId: quincena.id,
            userId: user?.id || null,
            descripcion: parsed.descripcion,
            categoriaId: categoria.id,
            clasificacion: parsed.clasificacion,
            tipo: parsed.tipo,
            direccion: parsed.direccion,
            monto: parsed.monto,
            metodoPagoId: metodoPago?.id || null,
            estatus: parsed.estatus,
            notas: null,
            source: 'whatsapp',
          })

          await db.saveMessage({
            waMessageId: message.id,
            fromNumber: senderPhone,
            fromName: senderName,
            userId: user?.id || null,
            body: text,
            tipo: parsed.tipo.toLowerCase(),
            procesado: true,
            transaccionId: tx.id,
            fechaMensaje: new Date(),
          })

          if (SHEETS_ENABLED) {
            try {
              const row = [
                parsed.timestamp.toLocaleString('es-MX'),
                parsed.usuario,
                parsed.monto,
                parsed.descripcion,
                parsed.categoria,
                parsed.formaPago,
                parsed.tipo,
                parsed.clasificacion,
                parsed.quincena,
                parsed.estatus,
                parsed.fecha.toISOString().slice(0, 10),
                parsed.phone || '',
                parsed.messageId || '',
              ]
              await appendRow(row)
            } catch (sheetsError) {
              console.error('Sheets backup error:', sheetsError)
            }
          }

          const confirmation = formatConfirmation(parsed)
          await assuredSend(senderPhone, confirmation, 'tx:success')
          await react(senderPhone, message.id, '✅')
          console.log('Transaccion guardada en DB:', tx.id)
        } catch (error) {
          console.error('Error processing message:', error)
          await react(senderPhone, message.id, '❌')
          await assuredSend(senderPhone, '❌ Error al procesar tu mensaje. Intenta de nuevo.', 'error:tx_process')
          await db.saveMessage({
            waMessageId: message.id,
            fromNumber: senderPhone,
            fromName: senderName,
            userId: null,
            body: text,
            tipo: 'error',
            procesado: false,
            error: error.message,
            fechaMensaje: new Date(),
          })
        }
      } finally {
        processingMessages.delete(message.id)
      }
    }
  } catch (error) {
    console.error('Webhook error:', error)
  }
})

// "el gasto de suerox mandalo a diversion": encuentra el movimiento real y
// PROPONE el cambio con un boton. Nunca escribe: la escritura vive en el
// callback, detras de un toque humano.
//
// Devuelve true si atendio el mensaje, false si no era una reasignacion y el
// flujo normal debe seguir.
async function handleReassign(message, { referencia, destino }) {
  const quincena = await db.findQuincenaByCodigo(getCurrentQuincena())
  if (!quincena) return false

  const candidatos = await findTransactionsByReference({ referencia, quincenaId: quincena.id })
  console.log(`TELEGRAM_REASSIGN: ref=${JSON.stringify(referencia)} destino=${JSON.stringify(destino)} encontrados=${candidatos.length}`)

  if (candidatos.length === 0) {
    await telegram.sendTelegramMessage(
      message.chatId,
      `No encontré ningún gasto de esta quincena que diga “${telegram.escapeMarkdown(referencia)}”.`,
      message.messageId,
    )
    return true
  }

  // Con varios candidatos no se adivina: primero se elige cual.
  if (candidatos.length > 1) {
    const buttons = candidatos.map(tx => [{
      text: `$${Number(tx.monto).toFixed(2)} — ${tx.descripcion}`,
      callback_data: `ps:${tx.id}`,
    }])
    await telegram.sendTelegramMessage(
      message.chatId,
      `Encontré ${candidatos.length} gastos que dicen “${telegram.escapeMarkdown(referencia)}”. ¿Cuál quieres mover?`,
      message.messageId,
      { buttons },
    )
    return true
  }

  const tx = candidatos[0]
  const lookup = { quincenaId: quincena.id, categoriaId: tx.categoriaId, descripcion: destino, tipo: tx.tipo }
  // Por NOMBRE y en toda la quincena: aqui el usuario escribio el destino, no
  // lo estamos adivinando, y el resultado se confirma con un boton antes de
  // escribir nada. Ver resolveBudgetLineByName en src/budgetTracker.js.
  const linea = await resolveBudgetLineByName({ quincenaId: quincena.id, destino, tipo: tx.tipo })

  const resumen = `💡 *$${Number(tx.monto).toFixed(2)} — ${telegram.escapeMarkdown(tx.descripcion)}*`

  if (linea) {
    // El boton usa el MISMO callback_data del flujo de botones: la validacion y
    // la escritura son exactamente las mismas, ya probadas.
    await telegram.sendTelegramMessage(
      message.chatId,
      `${resumen}\n\n¿Lo mando a *${telegram.escapeMarkdown(linea.descripcion)}*?`,
      message.messageId,
      { buttons: [[{ text: `Sí, mandarlo a ${linea.descripcion}`, callback_data: `pl:${tx.id}:${linea.id}` }]] },
    )
    return true
  }

  // No se pudo resolver el destino con seguridad: se cae en los mismos botones
  // de linea del flujo normal en vez de adivinar.
  const candidatasLinea = await getBudgetCandidates(lookup)
  if (candidatasLinea.length === 0) {
    await telegram.sendTelegramMessage(
      message.chatId,
      `${resumen}\n\nNo encontré ninguna línea de esta quincena que se parezca a “${telegram.escapeMarkdown(destino)}”.`,
      message.messageId,
    )
    return true
  }

  await telegram.sendTelegramMessage(
    message.chatId,
    `${resumen}\n\nNo identifiqué “${telegram.escapeMarkdown(destino)}” con seguridad. ¿A cuál línea lo mando?`,
    message.messageId,
    { buttons: budgetButtons(tx.id, candidatasLinea) },
  )
  return true
}

// Lo que necesitan los botones que solo NAVEGAN (paginar, agrupar por
// categoria, elegir movimiento): la transaccion y sus candidatas.
//
// Se recalcula en cada toque en vez de guardarse: el bot no tiene estado
// conversacional y no queremos inventarselo. El costo es una consulta por
// toque; el beneficio es que no hay nada que expirar ni que sincronizar.
async function budgetPickerContext(txId) {
  const tx = await prisma.transaccion.findUnique({ where: { id: Number(txId) } })
  if (!tx) return null

  const candidatas = await getBudgetCandidates({
    quincenaId: tx.quincenaId,
    categoriaId: tx.categoriaId,
    descripcion: tx.descripcion,
    // El tipo sale de la transaccion, no hardcodeado: un ingreso o un ahorro
    // tambien se cuelgan de una linea.
    tipo: tx.tipo,
  })
  return { tx, candidatas }
}

// Resuelve el toque de un boton de presupuesto.
//
// `callback.data` es entrada NO CONFIABLE: viajo por el cliente del usuario y un
// cliente modificado puede mandar cualquier par de ids. Por eso aqui solo se
// parsea la forma, y quien valida contra la base es budgetActions.
async function handleBudgetCallback(callback) {
  // Acusar recibo primero: Telegram deja el boton en "cargando" ~10s si no se
  // contesta, aunque la accion ya haya corrido.
  await telegram.answerCallbackQuery(callback.callbackId)

  // Split posicional: cada rama lee las posiciones que le tocan. El tercer
  // campo significa cosas distintas segun el prefijo (linea, pagina o
  // categoria), de ahi el nombre generico.
  const [accion, txId, arg] = callback.data.split(':')
  console.log(`TELEGRAM_CALLBACK: accion=${accion} tx=${txId} arg=${arg ?? '-'} chat=${callback.chatId}`)

  try {
    if (accion === 'pn') {
      const result = await unlinkTransaction({ transaccionId: txId })
      if (!result.ok) {
        await telegram.editMessageText(callback.chatId, callback.messageId, describeRechazo(result.reason))
        return
      }
      await telegram.editMessageText(
        callback.chatId,
        callback.messageId,
        '✅ Gasto registrado, sin línea de presupuesto.\n\nPuedes asignarlo después desde el dashboard.',
        { buttons: dashboardButton('Abrir el dashboard') },
      )
      return
    }

    // 'ps' = elegir cual movimiento, 'pp' = paginar, 'pc' = categorias. Las
    // tres solo cambian que botones se ven; ninguna escribe nada.
    if (accion === 'ps' || accion === 'pp' || accion === 'pc') {
      const contexto = await budgetPickerContext(txId)
      if (!contexto) {
        await telegram.editMessageText(callback.chatId, callback.messageId, describeRechazo('TX_NO_EXISTE'))
        return
      }
      const { tx, candidatas } = contexto
      const resumen = `💡 *$${Number(tx.monto).toFixed(2)} — ${telegram.escapeMarkdown(tx.descripcion)}*`

      if (candidatas.length === 0) {
        await telegram.editMessageText(callback.chatId, callback.messageId, `${resumen}\n\nNo hay líneas de presupuesto en esta quincena.`)
        return
      }

      if (accion === 'pc' && Number(arg) > 0) {
        const nombre = candidatas.find(c => c.categoriaId === Number(arg))?.categoriaNombre || 'esa categoría'
        await telegram.editMessageText(
          callback.chatId,
          callback.messageId,
          `${resumen}\n\nLíneas de *${telegram.escapeMarkdown(nombre)}*:`,
          { buttons: categoryLinesButtons(tx.id, candidatas, Number(arg)) },
        )
        return
      }

      if (accion === 'pc') {
        await telegram.editMessageText(
          callback.chatId,
          callback.messageId,
          `${resumen}\n\n¿De qué categoría es la línea?`,
          { buttons: categoryMenuButtons(tx.id, candidatas) },
        )
        return
      }

      await telegram.editMessageText(
        callback.chatId,
        callback.messageId,
        `${resumen}\n\n¿A cuál línea lo mando?`,
        { buttons: budgetButtons(tx.id, candidatas, { pagina: accion === 'pp' ? arg : 0 }) },
      )
      return
    }

    // 'pk' = confirmar que la categoria se mueve a la de la linea. Es la SEGUNDA
    // escritura del flujo, separada del enlace a proposito.
    if (accion === 'pk') {
      const result = await alignTransactionCategory({ transaccionId: txId, presupuestoId: arg })
      if (!result.ok) {
        await telegram.editMessageText(callback.chatId, callback.messageId, `⚠️ ${describeRechazo(result.reason)}`)
        return
      }
      const status = await getBudgetLineStatus(Number(arg))
      const bloque = budgetStatusBlock(status)
      const encabezado = `✅ Movido a *${telegram.escapeMarkdown(result.categoriaNueva?.nombre || 'la categoría de la línea')}*`
      await telegram.editMessageText(
        callback.chatId,
        callback.messageId,
        bloque.texto ? `${encabezado}\n\n${bloque.texto}` : encabezado,
        { buttons: bloque.buttons },
      )
      console.log(`TELEGRAM_CATEGORIA_ALINEADA: tx=${txId}; linea=${arg}; de=${result.categoriaAnterior?.nombre}; a=${result.categoriaNueva?.nombre}`)
      return
    }

    // 'pm' = mantener mi categoria. No escribe: solo cierra el mensaje dejando
    // por escrito que el cruce fue una decision, no un descuido.
    if (accion === 'pm') {
      const tx = await prisma.transaccion.findUnique({ where: { id: Number(txId) } })
      if (!tx) {
        await telegram.editMessageText(callback.chatId, callback.messageId, describeRechazo('TX_NO_EXISTE'))
        return
      }
      const status = await getBudgetLineStatus(Number(arg))
      const bloque = budgetStatusBlock(status)
      const encabezado = `✅ Asignado a *${telegram.escapeMarkdown(status?.descripcion || 'la línea')}*, y lo dejé en su categoría.`
      await telegram.editMessageText(
        callback.chatId,
        callback.messageId,
        bloque.texto ? `${encabezado}\n\n${bloque.texto}` : encabezado,
        { buttons: bloque.buttons },
      )
      console.log(`TELEGRAM_CRUCE_MANTENIDO: tx=${txId}; linea=${arg}`)
      return
    }

    if (accion !== 'pl') return

    const result = await linkTransactionToBudget({ transaccionId: txId, presupuestoId: arg })
    if (!result.ok) {
      // Se edita el mensaje (y con eso se quitan los botones) para que no quede
      // invitando a repetir algo que no va a funcionar.
      await telegram.editMessageText(callback.chatId, callback.messageId, `⚠️ ${describeRechazo(result.reason)}`)
      return
    }

    const bloque = budgetStatusBlock(result.status)
    const encabezado = result.yaEstaba
      ? `✅ Ya estaba asignado a *${telegram.escapeMarkdown(result.linea.descripcion)}*`
      : `✅ Asignado a *${telegram.escapeMarkdown(result.linea.descripcion)}*`

    // La pregunta de categoria va DESPUES del enlace, no antes: preguntar
    // primero obligaria a arrastrar un enlace pendiente por un round-trip, y el
    // unico lugar donde cabria ese estado es el propio callback_data. Enlazar
    // ya ocurrio; lo que falta es una decision distinta.
    if (result.cruzado) {
      const catLinea = result.linea.categoria?.nombre || 'otra categoría'
      const catTx = result.tx.categoria?.nombre || 'su categoría'
      const aviso = `Esta línea es de *${telegram.escapeMarkdown(catLinea)}*, y el movimiento está en *${telegram.escapeMarkdown(catTx)}*. ¿Muevo también la categoría?`
      await telegram.editMessageText(
        callback.chatId,
        callback.messageId,
        bloque.texto ? `${encabezado}\n\n${bloque.texto}\n\n${aviso}` : `${encabezado}\n\n${aviso}`,
        { buttons: [...crossCategoryButtons(result.tx.id, result.linea.id, catLinea, catTx), ...(bloque.buttons || [])] },
      )
      console.log(`TELEGRAM_BUDGET_LINKED: tx=${txId}; linea=${arg}; cruzado=true; excedido=${result.status?.excedido || 0}`)
      return
    }

    await telegram.editMessageText(
      callback.chatId,
      callback.messageId,
      bloque.texto ? `${encabezado}\n\n${bloque.texto}` : encabezado,
      { buttons: bloque.buttons },
    )
    // `cruzado` mide en produccion algo que no se puede saber de otro modo: con
    // que frecuencia la linea que la gente elige es de otra categoria que la
    // que el parser adivino. Si sale alto, el parser es el que esta mal.
    console.log(`TELEGRAM_BUDGET_LINKED: tx=${txId}; linea=${arg}; cruzado=false; excedido=${result.status?.excedido || 0}`)
  } catch (error) {
    console.error('TELEGRAM_CALLBACK_ERROR:', error)
    try {
      await telegram.editMessageText(callback.chatId, callback.messageId, '❌ Ocurrió un error al asignar el gasto.')
    } catch {}
  }
}

app.post('/telegram/webhook', async (req, res) => {
  // Traza de entrada ANTES de cualquier puerta. Sin esto, un update rechazado
  // por el secreto o por la lista blanca no deja ni una linea en los logs: el
  // bot se ve "arriba y sano" mientras descarta todos los mensajes.
  const inboundChat = req.body?.message?.chat || req.body?.edited_message?.chat
  console.log(
    `TELEGRAM_UPDATE_IN: update=${req.body?.update_id ?? 'n/a'} chat=${inboundChat?.id ?? 'n/a'} ` +
      `type=${inboundChat?.type ?? 'n/a'} keys=${Object.keys(req.body || {}).join(',') || 'none'}`,
  )

  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (expectedSecret && req.get('X-Telegram-Bot-Api-Secret-Token') !== expectedSecret) {
    // Telegram manda el secreto que se le dio en setWebhook. Si no coincide,
    // el registro del webhook quedo desfasado del env (tipico: se cambio
    // TELEGRAM_WEBHOOK_SECRET y el setWebhook del arranque fallo). Todos los
    // mensajes mueren aqui, asi que tiene que ser ruidoso.
    console.error(
      `TELEGRAM_SECRET_MISMATCH: update rechazado con 403. Telegram ${req.get('X-Telegram-Bot-Api-Secret-Token') ? 'mando otro secreto' : 'no mando secreto'} ` +
        'y el app espera TELEGRAM_WEBHOOK_SECRET. Vuelve a correr setWebhook (reinicia el servicio o corre scripts/diagnose-telegram.js --fix-webhook).',
    )
    return res.sendStatus(403)
  }

  res.sendStatus(200)

  // Tocar un boton NO puede ser una puerta trasera a la lista blanca: el
  // callback pasa por las mismas puertas que un mensaje (el secreto del webhook
  // ya se valido arriba, y aqui se valida el chat).
  const callback = telegram.extractCallbackQuery(req.body)
  if (callback) {
    if (!telegram.isAllowedChat(callback.chatId)) {
      console.warn(
        `TELEGRAM_UNAUTHORIZED_CHAT: chat=${callback.chatId} type=${callback.chatType} ` +
          `title=${JSON.stringify(callback.chatTitle)} rejected (callback) (allowedChatIds=${telegram.getAllowedChatIds().size})`,
      )
      return
    }
    await handleBudgetCallback(callback)
    return
  }

  const migration = telegram.extractChatMigration(req.body)
  if (migration) {
    console.error(
      `TELEGRAM_CHAT_MIGRATED: el grupo ${migration.fromChatId} ahora es supergrupo ${migration.toChatId}. ` +
        `Actualiza TELEGRAM_ALLOWED_CHAT_IDS con ${migration.toChatId} o el bot dejara de responder en ese chat.`,
    )
  }

  const message = telegram.extractTelegramMessage(req.body)
  if (!message?.text) return

  // Lista blanca de chats autorizados: sin TELEGRAM_ALLOWED_CHAT_IDS configurada
  // (o si el chat no esta en ella), el mensaje se ignora en silencio. No se le
  // confirma a un desconocido que el bot existe o funciona.
  if (!telegram.isAllowedChat(message.chatId)) {
    // El id va en el log porque es el dato exacto que hay que pegar en
    // TELEGRAM_ALLOWED_CHAT_IDS; los grupos lo cambian al volverse supergrupo.
    console.warn(
      `TELEGRAM_UNAUTHORIZED_CHAT: chat=${message.chatId} type=${message.chatType} ` +
        `title=${JSON.stringify(message.chatTitle)} rejected (allowedChatIds=${telegram.getAllowedChatIds().size})`,
    )
    return
  }

  if (processingUpdates.has(message.updateId)) return
  processingUpdates.add(message.updateId)

  try {
    const simpleReply = getSimpleConversationReply(message.text)
    if (simpleReply) {
      await telegram.sendTelegramMessage(message.chatId, simpleReply, message.messageId)
      console.log(`Telegram simple reply sent; chat=${message.chatId}; text=${message.text}`)
      return
    }

    await ensureFreshQuincenas()
    const user = await resolveMiloUser(message)
    const senderName = user?.nombre || message.senderName
    const expandedText = expandFinanceShorthand(message.text)

    // Antes de intentar leer el mensaje como un gasto NUEVO: puede estar
    // hablando de uno que ya existe. Sin esto, "el gasto de suerox mandalo a
    // diversion" no tiene monto y termina en el fallback de "no pude
    // identificar una operacion".
    const reasignacion = detectReassign(message.text)
    if (reasignacion && await handleReassign(message, reasignacion)) return

    // Primero resolvemos localmente las preguntas conocidas. Esto cubre lenguaje
    // cotidiano como "x asignar" sin depender de ningún proveedor externo.
    if (looksLikeFinanceQuestion(expandedText)) {
      const localAnswer = await telegramBrain.answerQuestion(expandedText, user)
      if (localAnswer) {
        await telegram.sendTelegramMessage(message.chatId, localAnswer, message.messageId)
        console.log(`Telegram finance brain answered; chat=${message.chatId}`)
        return
      }
    }

    // Para lenguaje ambiguo: DeepSeek es principal y Gemini queda como fallback.
    let aiData = null
    let systemContext = null
    if (aiRouter.isEnabled()) {
      try {
        systemContext = await aiRouter.getSystemContext(prisma)
        aiData = await aiRouter.classify(message.text, systemContext)

        if (aiData?.type === 'question') {
          // Antes del viejo mapa de intents, damos la pregunta al agente de
          // herramientas. El agente puede navegar presupuesto, movimientos,
          // liquidez, cuentas, deudas, créditos y ahorros de forma segura.
          const agentResult = await financeAgent.answer(message.text, { senderName })
          if (agentResult?.reply) {
            await telegram.sendTelegramMessage(message.chatId, agentResult.reply, message.messageId)
            console.log(`Telegram finance agent answered; chat=${message.chatId}; tools=${JSON.stringify(agentResult.trace || [])}`)
            return
          }

          // Fallback conservador: mantenemos los intents anteriores si el agente
          // no pudo responder por disponibilidad del proveedor o error temporal.
          if (aiData.intent && aiData.intent !== 'generic_finance') {
            const canonicalPrompts = {
              expenses_today: '¿cuánto gasté hoy?',
              unassigned_expenses: '¿qué gastos tenemos sin asignar?',
              budget_remaining: aiData.subject ? `¿cuánto queda del presupuesto de ${aiData.subject}?` : '¿cuánto queda del presupuesto?',
              liquidity: '¿cuánto dinero tenemos realmente?',
              quincena_summary: '¿cómo vamos esta quincena?',
              recent_transactions: 'últimos movimientos',
            }
            const canonical = canonicalPrompts[aiData.intent]
            if (canonical) {
              const answer = await telegramBrain.answerQuestion(canonical, user)
              if (answer) {
                await telegram.sendTelegramMessage(message.chatId, answer, message.messageId)
                console.log(`Telegram ${aiData._provider} intent answered deterministically; chat=${message.chatId}`)
                return
              }
            }
          }

          const data = await getData()
          const result = await aiRouter.answer(message.text, data, senderName, systemContext)
          if (result?.reply) {
            await telegram.sendTelegramMessage(message.chatId, result.reply, message.messageId)
            console.log(`Telegram ${result.provider} question answered; chat=${message.chatId}`)
            return
          }
        }

        // Respaldo del detector local de src/reassignIntent.js, para frases que
        // la regex no cubre. Igual que el local: solo PROPONE con un boton.
        if (aiData?.type === 'reassign' && aiData.referencia && aiData.destino) {
          if (await handleReassign(message, { referencia: aiData.referencia, destino: aiData.destino })) return
        }

        if (aiData?.type === 'chat') {
          const result = await aiRouter.chat(message.text, senderName, systemContext)
          if (result?.reply) {
            await telegram.sendTelegramMessage(message.chatId, result.reply, message.messageId)
            console.log(`Telegram ${result.provider} chat replied; chat=${message.chatId}`)
            return
          }
        }

        if (aiData?.type === 'task') {
          await telegram.sendTelegramMessage(
            message.chatId,
            'Entendí que quieres crear una tarea. Por ahora en Telegram estoy enfocado en gastos y consultas financieras.',
            message.messageId,
          )
          return
        }
      } catch (error) {
        console.error('Telegram AI routing error:', error)
      }
    }

    const expenseData = aiData?.type === 'expense' ? aiData : null
    const parsed = parseMessage(
      message.text,
      senderName,
      null,
      `tg:${message.chatId}:${message.messageId}`,
      expenseData,
    )

    if (!parsed.monto || parsed.monto <= 0) {
      const fallback = aiRouter.isEnabled()
        ? 'No pude identificar una operación o pregunta financiera clara. Puedes escribirme algo como “gasté 350 en gasolina” o “¿cuánto gasté hoy?”.'
        : 'No encontré un monto válido. Ejemplo: “gasté 350 en gasolina”.'
      await telegram.sendTelegramMessage(message.chatId, fallback, message.messageId)
      return
    }

    const categoria = await db.findCategoria(parsed.categoria)
    const metodoPago = await db.findMetodoPago(parsed.formaPago)
    const quincena = await db.findQuincenaByCodigo(parsed.quincena)

    if (!categoria || !quincena) {
      await telegram.sendTelegramMessage(message.chatId, 'No pude identificar la categoría o el periodo presupuestal.', message.messageId)
      return
    }

    const budgetLookup = {
      quincenaId: quincena.id,
      categoriaId: categoria.id,
      descripcion: parsed.descripcion,
      tipo: parsed.tipo,
    }

    const presupuesto = await resolveBudgetLine(budgetLookup)
    const tx = await saveTelegramTransaction(parsed, user, categoria, metodoPago, quincena, presupuesto)

    let confirmation = formatTelegramConfirmation(parsed)
    let buttons = null

    if (presupuesto) {
      const status = await getBudgetLineStatus(presupuesto.id)
      const bloque = budgetStatusBlock(status)
      if (bloque.texto) confirmation += `\n\n${bloque.texto}`
      buttons = bloque.buttons
    } else if (TIPOS_CON_LINEA.has(parsed.tipo)) {
      // Antes esto era `parsed.tipo === 'Gasto'`: los ingresos y los ahorros
      // nunca veian un boton de linea aunque su categoria tuviera partidas.
      const candidates = await getBudgetCandidates(budgetLookup)
      confirmation += '\n\n⚠️ El movimiento quedó registrado, pero no lo vinculé a una línea porque hay ambigüedad.'

      if (candidates.length > 0) {
        // Antes esto era una lista de texto y un "la proxima vez especifica el
        // concepto": el gasto se quedaba huerfano hasta que alguien abriera el
        // dashboard. Ahora se resuelve con un toque.
        confirmation += '\n\n¿A cuál línea lo mando?'
        buttons = budgetButtons(tx.id, candidates)
      }
    }

    await telegram.sendTelegramMessage(message.chatId, confirmation, message.messageId, { buttons })
    console.log(`Telegram transaction saved: ${tx.id}; chat=${message.chatId}; budget=${presupuesto?.id || 'none'}`)
  } catch (error) {
    console.error('Telegram webhook error:', error)
    try {
      await telegram.sendTelegramMessage(message.chatId, '❌ Ocurrió un error al procesar el mensaje.', message.messageId)
    } catch {}
  } finally {
    processingUpdates.delete(message.updateId)
  }
})

app.get('/', (req, res) => {
  const ai = aiRouter.status()
  res.json({
    status: 'ok',
    service: 'gastos-bot',
    version: '2.0',
    telegramEnabled: telegram.isEnabled(),
    aiEnabled: aiRouter.isEnabled(),
    ...ai,
    financeBrainEnabled: telegramBrain.isEnabled(),
    // El agente corre con cualquiera de los dos proveedores, no solo DeepSeek.
    financeAgentEnabled: ai.deepseekEnabled || ai.geminiEnabled,
    telegramWebhookUrl: telegram.getWebhookUrl(),
    timestamp: new Date().toISOString(),
  })
})

app.get('/health', (req, res) => {
  const ai = aiRouter.status()
  res.json({
    status: 'ok',
    telegramEnabled: telegram.isEnabled(),
    aiEnabled: aiRouter.isEnabled(),
    ...ai,
    // El agente corre con cualquiera de los dos proveedores, no solo DeepSeek.
    financeAgentEnabled: ai.deepseekEnabled || ai.geminiEnabled,
    timestamp: new Date().toISOString(),
  })
})

app.get('/telegram/status', async (req, res) => {
  const info = await telegram.getWebhookInfo()
  if (!info.ok) return res.status(500).json(info)

  const result = info.data?.result || {}
  const ai = aiRouter.status()
  const expectedUrl = telegram.getWebhookUrl()
  return res.json({
    ok: true,
    url: result.url || null,
    expectedUrl,
    // Con urlMatchesExpected=false Telegram esta entregando a otro lado.
    urlMatchesExpected: !!result.url && result.url === expectedUrl,
    pendingUpdateCount: result.pending_update_count || 0,
    lastErrorDate: result.last_error_date ? new Date(result.last_error_date * 1000).toISOString() : null,
    lastErrorMessage: result.last_error_message || null,
    // Las dos puertas que descartan mensajes en silencio. Solo banderas y
    // cuentas: los ids de chat autorizados no se exponen por HTTP.
    ...telegram.describeAccess(),
    // El agente corre con cualquiera de los dos proveedores, no solo DeepSeek.
    financeAgentEnabled: ai.deepseekEnabled || ai.geminiEnabled,
    ...ai,
  })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, async () => {
  console.log('GEMINI_ENABLED:', gemini.isEnabled(), 'GEMINI_MODEL:', process.env.GEMINI_MODEL || 'gemini-2.0-flash')
  console.log(`Bot de Gastos running on port ${PORT}`)
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`)

  const ai = aiRouter.status()
  console.log(`Telegram AI providers: primary=${ai.primary || 'none'}; deepseek=${ai.deepseekEnabled}; gemini=${ai.geminiEnabled}`)

  if (telegram.isEnabled()) {
    // Deja claro en el arranque cual de los dos servicios (gastos-bot /
    // milo-telegram-bot) es el dueno del webhook. Sin esta linea, dos
    // instancias con el mismo token se lo roban en cada reinicio y el sintoma
    // es "el bot funciona a veces".
    console.log(`Telegram role: ${telegram.shouldRegisterWebhook() ? 'DUENO del webhook (lo reapunta a esta instancia)' : 'solo responde (TELEGRAM_REGISTER_WEBHOOK=false)'}`)
    console.log(`Telegram webhook URL: ${telegram.getWebhookUrl()}`)
    if (telegram.getAllowedChatIds().size === 0) {
      console.warn('TELEGRAM_ALLOWED_CHAT_IDS is empty — all incoming Telegram messages will be rejected until this is set.')
    }
    const result = await telegram.registerWebhook()
    if (!result.ok && !result.skipped) {
      console.error('Telegram webhook registration failed during startup')
    }

    // Se revisa al final: si el modo privacidad esta prendido, los mensajes
    // sueltos del grupo no llegan nunca y el bot se ve mudo aunque todo lo
    // demas (token, webhook, lista blanca) este bien.
    await telegram.checkGroupPrivacyMode()
  }
})
