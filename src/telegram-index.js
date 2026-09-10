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
const { parseMessage, formatConfirmation } = require('./parser')
const { ensureFreshQuincenas } = require('./quincenas')
const {
  sendTelegramMessage,
  extractTelegramMessage,
  isEnabled,
  getWebhookUrl,
  registerWebhook,
  getWebhookInfo,
} = require('./telegram')
const { resolveBudgetLine, getBudgetLineStatus, formatBudgetStatus } = require('./budgetTracker')

const app = express()
app.use(express.json())

const processingUpdates = new Set()

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

    const presupuesto = await resolveBudgetLine({
      quincenaId: quincena.id,
      categoriaId: categoria.id,
      descripcion: parsed.descripcion,
      tipo: parsed.tipo,
    })

    const tx = await saveTransaction(parsed, user, categoria, metodoPago, quincena, presupuesto)

    let confirmation = formatConfirmation(parsed)
    if (presupuesto) {
      const status = await getBudgetLineStatus(presupuesto.id)
      const budgetText = formatBudgetStatus(status)
      if (budgetText) confirmation += `\n\n${budgetText}`
    } else if (parsed.tipo === 'Gasto') {
      confirmation += '\n\n⚠️ El gasto quedó registrado, pero no vinculé una línea de presupuesto porque no encontré una coincidencia suficientemente clara.'
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
