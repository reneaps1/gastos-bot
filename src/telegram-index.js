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
const aiRouter = require('./aiRouter')
const financeAgent = require('./financeAgent')
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
    const expandedText = expandFinanceShorthand(message.text)

    // Primero resolvemos localmente las preguntas conocidas. Esto cubre lenguaje
    // cotidiano como "x asignar" sin depender de ningún proveedor externo.
    if (looksLikeFinanceQuestion(expandedText)) {
      const localAnswer = await telegramBrain.answerQuestion(expandedText, user)
      if (localAnswer) {
        await sendTelegramMessage(message.chatId, localAnswer, message.messageId)
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
            await sendTelegramMessage(message.chatId, agentResult.reply, message.messageId)
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
                await sendTelegramMessage(message.chatId, answer, message.messageId)
                console.log(`Telegram ${aiData._provider} intent answered deterministically; chat=${message.chatId}`)
                return
              }
            }
          }

          const data = await getData()
          const result = await aiRouter.answer(message.text, data, senderName, systemContext)
          if (result?.reply) {
            await sendTelegramMessage(message.chatId, result.reply, message.messageId)
            console.log(`Telegram ${result.provider} question answered; chat=${message.chatId}`)
            return
          }
        }

        if (aiData?.type === 'chat') {
          const result = await aiRouter.chat(message.text, senderName, systemContext)
          if (result?.reply) {
            await sendTelegramMessage(message.chatId, result.reply, message.messageId)
            console.log(`Telegram ${result.provider} chat replied; chat=${message.chatId}`)
            return
          }
        }

        if (aiData?.type === 'task') {
          await sendTelegramMessage(
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
  const ai = aiRouter.status()
  res.json({
    status: 'ok',
    service: 'milo-telegram-bot',
    telegramEnabled: isEnabled(),
    aiEnabled: aiRouter.isEnabled(),
    ...ai,
    financeBrainEnabled: telegramBrain.isEnabled(),
    financeAgentEnabled: ai.deepseekEnabled,
    webhookUrl: getWebhookUrl(),
    timestamp: new Date().toISOString(),
  })
})

app.get('/health', (_req, res) => {
  const ai = aiRouter.status()
  res.json({
    status: 'ok',
    telegramEnabled: isEnabled(),
    aiEnabled: aiRouter.isEnabled(),
    ...ai,
    financeAgentEnabled: ai.deepseekEnabled,
    timestamp: new Date().toISOString(),
  })
})

app.get('/telegram/status', async (_req, res) => {
  const info = await getWebhookInfo()
  if (!info.ok) return res.status(500).json(info)

  const result = info.data?.result || {}
  const ai = aiRouter.status()
  return res.json({
    ok: true,
    url: result.url || null,
    pendingUpdateCount: result.pending_update_count || 0,
    lastErrorDate: result.last_error_date || null,
    lastErrorMessage: result.last_error_message || null,
    financeAgentEnabled: ai.deepseekEnabled,
    ...ai,
  })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, async () => {
  const ai = aiRouter.status()
  console.log(`Milo Telegram bot running on port ${PORT}`)
  console.log(`AI providers: primary=${ai.primary || 'none'}; deepseek=${ai.deepseekEnabled}; gemini=${ai.geminiEnabled}`)
  console.log(`Finance agent enabled: ${ai.deepseekEnabled}`)
  const result = await registerWebhook()
  if (!result.ok && !result.skipped) {
    console.error('Telegram webhook registration failed during startup')
  }
})
