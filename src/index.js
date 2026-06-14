process.env.TZ = 'America/Mexico_City'
require('dotenv').config()

// Render no preserva node_modules/.prisma entre build y runtime.
// DATABASE_URL debe existir para que prisma.config.ts cargue, aunque generate no conecta a la DB.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:x@localhost:0/x'
const { execSync } = require('child_process')
try {
  execSync('node_modules/.bin/prisma generate', { stdio: 'inherit' })
} catch (e) {
  console.error('prisma generate failed:', e.message)
  process.exit(1)
}
try {
  execSync('node_modules/.bin/prisma migrate deploy', { stdio: 'inherit' })
} catch (e) {
  console.error('prisma migrate deploy failed:', e.message)
  process.exit(1)
}

const express = require('express')
const { appendRow, messageExists: sheetsMessageExists } = require('./sheets')
const { parseMessage, formatConfirmation } = require('./parser')
const { sendWhatsAppMessage, extractPhoneNumber, markAsRead, react } = require('./whatsapp')
const { handleQuestion, detectIntent, getData } = require('./analytics')
const gemini = require('./gemini')
const db = require('./database')

const app = express()
app.use(express.json())

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN
const SHEETS_ENABLED = process.env.GOOGLE_SHEETS_ENABLED !== 'false'

// Previene race condition cuando Meta envía el mismo webhook dos veces en rápida sucesión
const processingMessages = new Set()

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
      if (message.type !== 'text') continue

      const text = message.text?.body?.trim()
      if (!text) continue

      if (processingMessages.has(message.id)) continue
      processingMessages.add(message.id)

      try {
        const senderPhone = extractPhoneNumber(message.from)
        const senderName = changes.value.contacts?.[0]?.profile?.name || 'Rene'

        console.log(`Message from ${senderName} (${senderPhone}): ${text}`)

        await markAsRead(message.id)

        let user = await db.findUserByPhone(senderPhone)
        if (!user) user = await db.findUserByName(senderName)

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
              await sendWhatsAppMessage(senderPhone, answer)
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

        // 2. Gemini: clasifica el mensaje y mejora el parseo
        let geminiData = null
        if (gemini.isEnabled()) {
          try {
            geminiData = await gemini.classify(text)

            // Si Gemini dice que es una pregunta (no un registro), responde con IA
            if (geminiData && !geminiData.isExpense) {
              const data = await getData()
              const geminiAnswer = await gemini.answer(text, data, senderName)
              if (geminiAnswer) {
                await sendWhatsAppMessage(senderPhone, geminiAnswer)
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
          } catch (error) {
            console.error('Gemini error:', error)
          }
        }

        try {
          await react(senderPhone, message.id, '⏳')

          // geminiData mejora el parseo si Gemini detectó un registro
          const parsed = parseMessage(text, senderName || 'Rene', senderPhone, message.id, geminiData?.isExpense ? geminiData : null)

          const categoria = await db.findCategoria(parsed.categoria)
          const metodoPago = await db.findMetodoPago(parsed.formaPago)
          const quincena = await db.findQuincenaByCodigo(parsed.quincena)

          if (!categoria || !quincena) {
            console.error(`No se encontro categoria (${parsed.categoria}) o quincena (${parsed.quincena})`)
            await react(senderPhone, message.id, '❌')
            await sendWhatsAppMessage(senderPhone, '❌ Error: categoria o quincena no encontrada.')
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
          await sendWhatsAppMessage(senderPhone, confirmation)
          await react(senderPhone, message.id, '✅')
          console.log('Transaccion guardada en DB:', tx.id)
        } catch (error) {
          console.error('Error processing message:', error)
          await react(senderPhone, message.id, '❌')
          await sendWhatsAppMessage(senderPhone, '❌ Error al procesar tu mensaje. Intenta de nuevo.')
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Bot de Gastos running on port ${PORT}`)
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`)
})
