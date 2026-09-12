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
const telegram = require('./telegram')
const telegramBrain = require('./telegramBrain')
const aiRouter = require('./aiRouter')
const financeAgent = require('./financeAgent')
const {
  resolveBudgetLine,
  getBudgetCandidates,
  getBudgetLineStatus,
  formatBudgetStatus,
} = require('./budgetTracker')

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
  const CLASIFICACION_POR = {
    Hogar: 'Fijo', Salud: 'Fijo', Familia: 'Variable', Transporte: 'Variable',
    Suscripciones: 'Fijo', Deudas: 'Fijo', Personal: 'Variable', Ingresos: null, Ahorro: null,
  }
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
    clasificacion: CLASIFICACION_POR[categoria] || null,
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
  const { tipo, direccion } = resolverTipoYDireccion(categoria.tipo, parsed.tipo, null)

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
    if (presupuesto) {
      const status = await getBudgetLineStatus(presupuesto.id)
      const budgetText = formatBudgetStatus(status)
      if (budgetText) confirmation += `\n\n${budgetText}`
    } else if (parsed.tipo === 'Gasto') {
      const candidates = await getBudgetCandidates(budgetLookup)
      confirmation += '\n\n⚠️ El gasto quedó registrado, pero no lo vinculé a una línea porque hay ambigüedad.'

      if (candidates.length > 0) {
        confirmation += '\n\nLíneas posibles en esta categoría:'
        for (const candidate of candidates) {
          confirmation += `\n• ${telegram.escapeMarkdown(candidate.descripcion)} — $${candidate.presupuesto.toFixed(2)}`
        }
        confirmation += '\n\nLa próxima vez especifica el concepto, por ejemplo: “100 gasolina Corolla”.'
      }
    }

    await telegram.sendTelegramMessage(message.chatId, confirmation, message.messageId)
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
    financeAgentEnabled: ai.deepseekEnabled,
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
    financeAgentEnabled: ai.deepseekEnabled,
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
    financeAgentEnabled: ai.deepseekEnabled,
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
