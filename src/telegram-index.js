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

  // Acepta variantes naturales como hola, holaa, holaaa, hii, heyy, etc.
  // Se exige que todo el mensaje sea un saludo para no tragarnos frases como
  // "hola, gaste 200 en gasolina" que sí deben seguir al parser financiero.
  if (/^(hola+|holi+|hi+|hey+|buenas+|buenos dias+|buenas tardes+|buenas noches+|que onda)$/.test(normalized)) {
    return '¡Hola! Soy Milo 👋\n\nPuedo registrar tus gastos y decirte cuánto queda en tu línea de presupuesto. Prueba con: “gasté 150 en gasolina”.'
  }

  if (/^(gracias+|muchas gracias+|thanks+)$/.test(normalized)) {
    return '¡De nada! 🙌 Aquí estoy para ayudarte con tus gastos y presupuesto.'
  }

  if (/^(ayuda|help|\/help|que puedes hacer)$/.test(normalized)) {
    return [
      'Puedo ayudarte con cosas como:',
      '',
      '• “gasté 350 en gasolina”',
      '• “pagué 800 de internet”',
      '• registrar el movimiento en Milo',
      '• mostrar cuánto queda en la línea de presupuesto cuando puedo identificarla con seguridad',
    ].join('\n')
  }

  if (/^(\/start|start)$/.test(normalized)) {
    return '¡Hola! Soy Milo. Envíame un gasto y lo registraré en tu sistema. Por ejemplo: “gasté 150 en gasolina”.'
  }

  return null
}

function formatTelegramDate(date) {
  // parsed.fecha representa un día financiero como medianoche UTC. Si se
  // formatea en America/Mexico_City, cae al día anterior por el offset. Para
  // mostrar el día lógico guardado usamos UTC explícitamente.
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
    const parsed = parseMessage(message.text, user?.nombre || message.senderName, null, `tg:${message.chatId}:${message.messageId}`)

    if (!parsed.monto || parsed.monto <= 0) {
      await sendTelegramMessage(message.chatId, 'No encontré un monto válido. Ejemplo: “gasté 350 en gasolina”.', message.messageId)
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
      await sendTelegramMessage(message.chatId, '❌ Ocurrió un error al registrar el movimiento.', message.messageId)
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
    webhookUrl: getWebhookUrl(),
    timestamp: new Date().toISOString(),
  })
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
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
  })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, async () => {
  console.log(`Milo Telegram bot running on port ${PORT}`)
  const result = await registerWebhook()
  if (!result.ok && !result.skipped) {
    console.error('Telegram webhook registration failed during startup')
  }
})
