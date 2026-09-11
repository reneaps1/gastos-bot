process.env.TZ = 'America/Mexico_City'
require('dotenv').config()

const express = require('express')
const { execSync } = require('child_process')

// Mismo bootstrap de Prisma que el bot de WhatsApp en Render.
if (process.env.SKIP_PRISMA_BOOTSTRAP !== '1') {
  const realDbUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = realDbUrl || 'postgresql://x:x@localhost:0/x'
  try {
    execSync('node_modules/.bin/prisma generate', { stdio: 'inherit' })
  } catch (error) {
    console.error('prisma generate failed:', error.message)
    process.exit(1)
  }
  process.env.DATABASE_URL = realDbUrl
  if (realDbUrl) {
    try {
      execSync('node_modules/.bin/prisma migrate deploy', { stdio: 'inherit' })
    } catch (error) {
      console.error('prisma migrate deploy failed:', error.message)
    }
  }
}

const prisma = require('./lib/prisma')
const db = require('./database')
const gemini = require('./gemini')
const telegramBrain = require('./telegramBrain')
const { getData } = require('./analytics')
const { resolverTipoYDireccion } = require('./tipoAhorro')
const { parseMessage } = require('./parser')
const { ensureFreshQuincenas } = require('./quincenas')
const {
  sendTelegramMessage,
  extractTelegramMessage,
  isEnabled,
  getWebhookUrl,
  registerWebhook,
  getWebhookInfo,
} = require('./telegram')
const {
  resolveBudgetLine,
  getBudgetCandidates,
  getBudgetLineStatus,
  formatBudgetStatus,
} = require('./budgetTracker')

const app = express()
app.use(express.json())

const processingUpdates = new Set()

function normalizeSimpleText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¡!¿?.,]+/g, '')
    .replace(/\s+/g, ' ')
}

function getSimpleConversationReply(text) {
  const normalized = normalizeSimpleText(text)

  // Conversación básica instantánea: no consume una llamada a Gemini.
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

function formatTelegramDate(date) {
  return date.toLocaleDateString('es-MX', { timeZone: 'UTC' })
}

function formatTelegramConfirmation(parsed) {
  return [
    `✅ *${parsed.tipo} registrado*`,
    '',
    `📅 ${formatTelegramDate(parsed.fecha)}`,
    `👤 ${parsed.usuario}`,
    `$${parsed.monto}`,
    `📝 ${parsed.descripcion}`,
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

async function saveTransaction(parsed, user, categoria, metodoPago, quincena, presupuesto) {
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

app.post('/telegram/webhook', async (req, res) => {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (expectedSecret && req.get('X-Telegram-Bot-Api-Secret-Token') !== expectedSecret) {
    return res.sendStatus(403)
  }

  res.sendStatus(200)

  const message = extractTelegramMessage(req.body)
  if (!message?.text || processingUpdates.has(message.updateId)) return
  processingUpdates.add(message.updateId)

  try {
    const simpleReply = getSimpleConversationReply(message.text)
    if (simpleReply) {
      await sendTelegramMessage(message.chatId, simpleReply, message.messageId)
      console.log(`Telegram simple reply sent; chat=${message.chatId}; text=${message.text}`)
      return
    }

    await ensureFreshQuincenas()
    const user = await resolveMiloUser(message)
    const senderName = user?.nombre || message.senderName

    // Gemini interpreta el lenguaje; los cálculos sensibles del primer set de
    // preguntas se resuelven con consultas deterministas a PostgreSQL.
    let geminiData = null
    let systemContext = null
    if (gemini.isEnabled()) {
      try {
        systemContext = await gemini.getSystemContext(prisma)
        geminiData = await gemini.classify(message.text, systemContext)

        if (geminiData?.type === 'question') {
          let answer = await telegramBrain.answerQuestion(message.text, user)

          // Para preguntas todavía no cubiertas por las funciones deterministas,
          // dejamos que Gemini redacte usando datos reales del sistema.
          if (!answer) {
            const data = await getData()
            answer = await gemini.answer(message.text, data, senderName, systemContext)
          }

          if (answer) {
            await sendTelegramMessage(message.chatId, answer, message.messageId)
            console.log(`Telegram Gemini question answered; chat=${message.chatId}`)
            return
          }
        }

        if (geminiData?.type === 'chat') {
          const reply = await gemini.chat(message.text, senderName, systemContext)
          if (reply) {
            await sendTelegramMessage(message.chatId, reply, message.messageId)
            console.log(`Telegram Gemini chat replied; chat=${message.chatId}`)
            return
          }
        }

        if (geminiData?.type === 'task') {
          await sendTelegramMessage(
            message.chatId,
            'Entendí que quieres crear una tarea. Por ahora en Telegram estoy enfocado en gastos y consultas financieras.',
            message.messageId,
          )
          return
        }
      } catch (error) {
        console.error('Telegram Gemini routing error:', error)
      }
    }

    // Si Gemini identificó un registro, aprovechamos monto/categoría/descripción
    // extraídos por el modelo. Si no, el parser determinista sigue funcionando.
    const expenseData = geminiData?.type === 'expense' ? geminiData : null
    const parsed = parseMessage(
      message.text,
      senderName,
      null,
      `tg:${message.chatId}:${message.messageId}`,
      expenseData,
    )

    if (!parsed.monto || parsed.monto <= 0) {
      const fallback = gemini.isEnabled()
        ? 'No pude identificar una operación o pregunta financiera clara. Puedes escribirme algo como “gasté 350 en gasolina” o “¿cuánto gasté hoy?”.'
        : 'No encontré un monto válido. Ejemplo: “gasté 350 en gasolina”.'
      await sendTelegramMessage(message.chatId, fallback, message.messageId)
      return
    }

    const categoria = await db.findCategoria(parsed.categoria)
    const metodoPago = await db.findMetodoPago(parsed.formaPago)
    const quincena = await db.findQuincenaByCodigo(parsed.quincena)

    if (!categoria || !quincena) {
      await sendTelegramMessage(message.chatId, 'No pude identificar la categoría o el periodo presupuestal.', message.messageId)
      return
    }

    const budgetLookup = {
      quincenaId: quincena.id,
      categoriaId: categoria.id,
      descripcion: parsed.descripcion,
      tipo: parsed.tipo,
    }

    const presupuesto = await resolveBudgetLine(budgetLookup)
    const tx = await saveTransaction(parsed, user, categoria, metodoPago, quincena, presupuesto)

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
          confirmation += `\n• ${candidate.descripcion} — $${candidate.presupuesto.toFixed(2)}`
        }
        confirmation += '\n\nLa próxima vez especifica el concepto, por ejemplo: “100 gasolina Corolla”.'
      }
    }

    await sendTelegramMessage(message.chatId, confirmation, message.messageId)
    console.log(`Telegram transaction saved: ${tx.id}; chat=${message.chatId}; budget=${presupuesto?.id || 'none'}`)
  } catch (error) {
    console.error('Telegram webhook error:', error)
    try {
      await sendTelegramMessage(message.chatId, '❌ Ocurrió un error al procesar el mensaje.', message.messageId)
    } catch {}
  } finally {
    processingUpdates.delete(message.updateId)
  }
})

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'milo-telegram-bot',
    telegramEnabled: isEnabled(),
    geminiEnabled: gemini.isEnabled(),
    financeBrainEnabled: telegramBrain.isEnabled(),
    webhookUrl: getWebhookUrl(),
    timestamp: new Date().toISOString(),
  })
})

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    telegramEnabled: isEnabled(),
    geminiEnabled: gemini.isEnabled(),
    timestamp: new Date().toISOString(),
  })
})

app.get('/telegram/status', async (_req, res) => {
  const info = await getWebhookInfo()
  if (!info.ok) return res.status(500).json(info)

  const result = info.data?.result || {}
  return res.json({
    ok: true,
    url: result.url || null,
    pendingUpdateCount: result.pending_update_count || 0,
    lastErrorDate: result.last_error_date || null,
    lastErrorMessage: result.last_error_message || null,
    geminiEnabled: gemini.isEnabled(),
  })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, async () => {
  console.log(`Milo Telegram bot running on port ${PORT}`)
  console.log(`Gemini enabled: ${gemini.isEnabled()}`)
  const result = await registerWebhook()
  if (!result.ok && !result.skipped) {
    console.error('Telegram webhook registration failed during startup')
  }
})
