const axios = require('axios')

function isEnabled() {
  return !!process.env.TELEGRAM_BOT_TOKEN
}

// Escapa los caracteres que rompen el modo `Markdown` (legacy) de Telegram.
// Sin esto, cualquier "_", "*", "`" o "[" en texto libre (descripciones,
// nombres de linea de presupuesto, nombres de usuario) hace que Telegram
// rechace el mensaje con 400 "can't parse entities".
function escapeMarkdown(text) {
  return String(text ?? '').replace(/([_*`[])/g, '\\$1')
}

// Lista blanca de chats autorizados a usar el bot. Sin TELEGRAM_ALLOWED_CHAT_IDS
// configurada, el set queda vacio y isAllowedChat rechaza todo (fail-closed):
// antes de esto, cualquiera que le escribiera al bot podia crear gastos reales
// o leer liquidez/presupuesto/deudas/creditos/ahorro.
function getAllowedChatIds() {
  return new Set(
    String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean),
  )
}

function isAllowedChat(chatId) {
  const allowed = getAllowedChatIds()
  if (allowed.size === 0) return false
  return allowed.has(String(chatId))
}

function getWebhookUrl() {
  if (process.env.TELEGRAM_WEBHOOK_URL) return process.env.TELEGRAM_WEBHOOK_URL
  if (process.env.RENDER_EXTERNAL_URL) {
    return `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/telegram/webhook`
  }
  return null
}

async function registerWebhook() {
  if (!isEnabled()) {
    console.warn('Telegram webhook not registered: TELEGRAM_BOT_TOKEN not configured')
    return { ok: false, skipped: true }
  }

  const url = getWebhookUrl()
  if (!url) {
    console.warn('Telegram webhook not registered: TELEGRAM_WEBHOOK_URL/RENDER_EXTERNAL_URL unavailable')
    return { ok: false, skipped: true }
  }

  try {
    const payload = { url }
    if (process.env.TELEGRAM_WEBHOOK_SECRET) {
      payload.secret_token = process.env.TELEGRAM_WEBHOOK_SECRET
    }

    const response = await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`,
      payload,
      { headers: { 'Content-Type': 'application/json' } },
    )

    console.log(`Telegram webhook registered: ${url}`)
    return { ok: true, data: response.data, url }
  } catch (error) {
    const details = error.response?.data || error.message
    console.error('Telegram setWebhook error:', JSON.stringify(details))
    return { ok: false, error: details, url }
  }
}

async function getWebhookInfo() {
  if (!isEnabled()) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' }

  try {
    const response = await axios.get(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`,
    )
    return { ok: true, data: response.data }
  } catch (error) {
    const details = error.response?.data || error.message
    console.error('Telegram getWebhookInfo error:', JSON.stringify(details))
    return { ok: false, error: details }
  }
}

async function postSendMessage(payload) {
  return axios.post(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    payload,
    { headers: { 'Content-Type': 'application/json' } },
  )
}

function isMarkdownParseError(error) {
  return error.response?.status === 400 && /can't parse entities/i.test(error.response?.data?.description || '')
}

async function sendTelegramMessage(chatId, message, replyToMessageId = null) {
  if (!isEnabled()) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' }
  }

  const payload = {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown',
  }

  if (replyToMessageId) payload.reply_parameters = { message_id: replyToMessageId }

  try {
    const response = await postSendMessage(payload)
    return { ok: true, data: response.data }
  } catch (error) {
    if (isMarkdownParseError(error)) {
      // Texto libre (descripcion de gasto, nombre de linea, o una respuesta
      // generada por IA) traia un caracter que Telegram interpreta como
      // markdown sin cerrar. En vez de dejar al usuario sin respuesta,
      // reintentamos una vez en texto plano.
      console.warn(`Telegram Markdown parse error, retrying as plain text: chat=${chatId}`)
      try {
        const { parse_mode, ...plainPayload } = payload
        const response = await postSendMessage(plainPayload)
        return { ok: true, data: response.data, markdownFallback: true }
      } catch (retryError) {
        const details = retryError.response?.data || retryError.message
        console.error('Telegram API error (plain text retry):', JSON.stringify(details))
        return { ok: false, error: details }
      }
    }

    const details = error.response?.data || error.message
    console.error('Telegram API error:', JSON.stringify(details))
    return { ok: false, error: details }
  }
}

function extractTelegramMessage(update) {
  const message = update?.message || update?.edited_message
  if (!message?.text) return null

  return {
    updateId: update.update_id,
    messageId: message.message_id,
    chatId: String(message.chat.id),
    chatType: message.chat.type,
    chatTitle: message.chat.title || null,
    text: message.text.trim(),
    telegramUserId: String(message.from?.id || ''),
    username: message.from?.username || null,
    senderName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ').trim() || message.from?.username || 'Telegram user',
  }
}

module.exports = {
  isEnabled,
  getWebhookUrl,
  registerWebhook,
  getWebhookInfo,
  sendTelegramMessage,
  extractTelegramMessage,
  escapeMarkdown,
  getAllowedChatIds,
  isAllowedChat,
}
