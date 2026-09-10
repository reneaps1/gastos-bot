const axios = require('axios')

function isEnabled() {
  return !!process.env.TELEGRAM_BOT_TOKEN
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

async function sendTelegramMessage(chatId, message, replyToMessageId = null) {
  if (!isEnabled()) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' }
  }

  try {
    const payload = {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    }

    if (replyToMessageId) payload.reply_parameters = { message_id: replyToMessageId }

    const response = await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      payload,
      { headers: { 'Content-Type': 'application/json' } },
    )

    return { ok: true, data: response.data }
  } catch (error) {
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

module.exports = { isEnabled, getWebhookUrl, registerWebhook, getWebhookInfo, sendTelegramMessage, extractTelegramMessage }
