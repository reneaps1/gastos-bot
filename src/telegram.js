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

// getMe es la unica forma de distinguir "token revocado/invalido" de "el
// servicio esta caido": con un token muerto el bot arranca normal, acepta
// updates y falla en silencio al responder.
async function getMe() {
  if (!isEnabled()) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' }

  try {
    const response = await axios.get(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`)
    return { ok: true, data: response.data }
  } catch (error) {
    const details = error.response?.data || error.message
    console.error('Telegram getMe error:', JSON.stringify(details))
    return { ok: false, error: details }
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Un token de Telegram admite UNA sola URL de webhook. Con dos servicios
// corriendo el mismo src/index.js (gastos-bot para WhatsApp, milo-telegram-bot
// para Telegram), los dos llamarian setWebhook al arrancar y cada reinicio le
// robaria los mensajes al otro: Milo se caeria solo, de forma aleatoria, segun
// quien haya reiniciado al ultimo. TELEGRAM_REGISTER_WEBHOOK=false marca a la
// instancia que NO debe reclamar el webhook (sigue pudiendo responder, solo no
// lo reapunta a si misma).
function shouldRegisterWebhook() {
  return String(process.env.TELEGRAM_REGISTER_WEBHOOK ?? 'true').trim().toLowerCase() !== 'false'
}

async function registerWebhook({ attempts = 3 } = {}) {
  if (!isEnabled()) {
    console.warn('Telegram webhook not registered: TELEGRAM_BOT_TOKEN not configured')
    return { ok: false, skipped: true }
  }

  if (!shouldRegisterWebhook()) {
    console.log('Telegram webhook not registered: TELEGRAM_REGISTER_WEBHOOK=false (esta instancia no reclama el webhook)')
    return { ok: false, skipped: true, optedOut: true }
  }

  const url = getWebhookUrl()
  if (!url) {
    console.warn('Telegram webhook not registered: TELEGRAM_WEBHOOK_URL/RENDER_EXTERNAL_URL unavailable')
    return { ok: false, skipped: true }
  }

  const payload = { url }
  if (process.env.TELEGRAM_WEBHOOK_SECRET) {
    payload.secret_token = process.env.TELEGRAM_WEBHOOK_SECRET
  }

  // setWebhook es el unico momento en que el secreto del app llega a Telegram.
  // Si esta llamada falla y no se reintenta, Telegram sigue entregando updates
  // con el secreto viejo (o sin secreto) mientras el handler ya exige el nuevo:
  // el bot responde 403 a todo, en silencio y para siempre. De ahi los
  // reintentos y la verificacion de lectura de abajo.
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await axios.post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`,
        payload,
        { headers: { 'Content-Type': 'application/json' } },
      )

      console.log(`Telegram webhook registered: ${url} (secret=${payload.secret_token ? 'yes' : 'no'})`)
      await verifyWebhook(url)
      return { ok: true, data: response.data, url }
    } catch (error) {
      lastError = error.response?.data || error.message
      console.error(`Telegram setWebhook error (attempt ${attempt}/${attempts}):`, JSON.stringify(lastError))
      if (attempt < attempts) await sleep(2000 * attempt)
    }
  }

  console.error(
    'TELEGRAM_WEBHOOK_REGISTRATION_FAILED: Telegram seguira entregando updates con la configuracion anterior. ' +
      'Si TELEGRAM_WEBHOOK_SECRET cambio, el handler respondera 403 a todos los mensajes hasta que setWebhook funcione.',
  )
  return { ok: false, error: lastError, url }
}

// Lee de vuelta lo que Telegram tiene registrado. Un setWebhook con 200 no
// garantiza que el webhook activo sea el nuestro (otro deploy o un setWebhook
// manual lo pudo mover), y last_error_message es la razon exacta por la que
// Telegram no pudo entregar los ultimos updates.
async function verifyWebhook(expectedUrl) {
  const info = await getWebhookInfo()
  if (!info.ok) return info

  const result = info.data?.result || {}
  if (expectedUrl && result.url !== expectedUrl) {
    console.error(`TELEGRAM_WEBHOOK_URL_MISMATCH: registrado=${result.url || 'ninguno'} esperado=${expectedUrl}`)
  }
  if (result.last_error_message) {
    const when = result.last_error_date ? new Date(result.last_error_date * 1000).toISOString() : 'desconocido'
    console.warn(`TELEGRAM_WEBHOOK_LAST_ERROR: ${result.last_error_message} (${when})`)
  }
  if (result.pending_update_count) {
    console.warn(`TELEGRAM_WEBHOOK_PENDING_UPDATES: ${result.pending_update_count}`)
  }
  return info
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

async function sendTelegramMessage(chatId, message, replyToMessageId = null, { buttons = null } = {}) {
  if (!isEnabled()) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' }
  }

  const payload = {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown',
  }

  // El reintento en texto plano de abajo hace `const { parse_mode, ...resto }`,
  // asi que reply_markup sobrevive al fallback sin tratamiento especial.
  if (buttons?.length) payload.reply_markup = { inline_keyboard: buttons }

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

// Telegram deja el boton con un relojito hasta que se acusa recibo del
// callback. Sin esto el usuario ve el boton "cargando" ~10 segundos aunque la
// accion ya se haya ejecutado.
async function answerCallbackQuery(callbackQueryId, text = null) {
  if (!isEnabled()) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' }

  try {
    const response = await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
      { callback_query_id: callbackQueryId, ...(text ? { text } : {}) },
      { headers: { 'Content-Type': 'application/json' } },
    )
    return { ok: true, data: response.data }
  } catch (error) {
    const details = error.response?.data || error.message
    console.error('Telegram answerCallbackQuery error:', JSON.stringify(details))
    return { ok: false, error: details }
  }
}

// Reescribe el mensaje original en vez de mandar uno nuevo: el historial del
// chat queda con una sola confirmacion, ya resuelta. Quitar los botones
// (buttons vacio) es lo que impide que alguien vuelva a tocarlos.
async function editMessageText(chatId, messageId, text, { buttons = null } = {}) {
  if (!isEnabled()) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' }

  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons || [] },
  }

  try {
    const response = await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/editMessageText`,
      payload,
      { headers: { 'Content-Type': 'application/json' } },
    )
    return { ok: true, data: response.data }
  } catch (error) {
    if (isMarkdownParseError(error)) {
      try {
        const { parse_mode, ...plainPayload } = payload
        const response = await axios.post(
          `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/editMessageText`,
          plainPayload,
          { headers: { 'Content-Type': 'application/json' } },
        )
        return { ok: true, data: response.data, markdownFallback: true }
      } catch (retryError) {
        const details = retryError.response?.data || retryError.message
        console.error('Telegram editMessageText error (plain text retry):', JSON.stringify(details))
        return { ok: false, error: details }
      }
    }
    const details = error.response?.data || error.message
    console.error('Telegram editMessageText error:', JSON.stringify(details))
    return { ok: false, error: details }
  }
}

// Lo que Telegram manda al tocar un boton. Ojo: `data` viajo por el cliente del
// usuario, asi que es entrada NO CONFIABLE -- quien lo consuma tiene que validar
// contra la base, no creerle a los ids.
function extractCallbackQuery(update) {
  const query = update?.callback_query
  if (!query?.data) return null

  const chat = query.message?.chat
  if (!chat) return null

  return {
    updateId: update.update_id,
    callbackId: query.id,
    data: String(query.data),
    chatId: String(chat.id),
    chatType: chat.type,
    chatTitle: chat.title || null,
    messageId: query.message.message_id,
    telegramUserId: String(query.from?.id || ''),
    username: query.from?.username || null,
    senderName: [query.from?.first_name, query.from?.last_name].filter(Boolean).join(' ').trim() || query.from?.username || 'Telegram user',
  }
}

// Cuando un grupo normal se convierte en supergrupo, Telegram CAMBIA el id del
// chat (-123456789 pasa a -100123456789) y manda este aviso una sola vez. El id
// viejo en TELEGRAM_ALLOWED_CHAT_IDS deja de coincidir y, como la lista blanca
// es fail-closed, el bot se queda mudo sin ningun error visible.
function extractChatMigration(update) {
  const message = update?.message || update?.edited_message
  const to = message?.migrate_to_chat_id
  if (!to) return null
  return { fromChatId: String(message.chat?.id ?? ''), toChatId: String(to) }
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

// En grupos, el "modo privacidad" de Telegram (prendido por default) hace que
// el bot SOLO reciba comandos, menciones y respuestas a sus propios mensajes.
// Un "30, suerox" suelto en el grupo nunca llega al webhook: no hay error, no
// hay log, no hay nada. Se apaga en @BotFather con /setprivacy → Disable.
// Esto se chequea al arrancar porque es invisible desde el lado del servidor:
// el update simplemente no existe.
async function checkGroupPrivacyMode() {
  const groupIds = [...getAllowedChatIds()].filter(id => id.startsWith('-'))
  if (groupIds.length === 0) return { ok: true, skipped: true }

  const me = await getMe()
  if (!me.ok) return { ok: false, error: me.error }

  const canReadAll = me.data?.result?.can_read_all_group_messages
  if (canReadAll === false) {
    console.warn(
      `TELEGRAM_PRIVACY_MODE_ON: @${me.data?.result?.username} tiene el modo privacidad activo y hay ${groupIds.length} grupo(s) autorizado(s) ` +
        `(${groupIds.join(', ')}). En esos grupos solo va a recibir comandos, menciones y respuestas a sus propios mensajes: ` +
        'un mensaje suelto como "30, suerox" nunca llega al webhook. Apagalo en @BotFather con /setprivacy -> Disable.',
    )
  }
  return { ok: true, canReadAllGroupMessages: canReadAll, groupIds, username: me.data?.result?.username }
}

// Resumen sin secretos de las dos puertas que pueden dejar al bot mudo.
// Seguro para exponer en /telegram/status: solo cuentas y banderas.
function describeAccess() {
  return {
    tokenConfigured: isEnabled(),
    secretConfigured: !!process.env.TELEGRAM_WEBHOOK_SECRET,
    allowedChatIdCount: getAllowedChatIds().size,
    registersWebhook: shouldRegisterWebhook(),
  }
}

module.exports = {
  isEnabled,
  getWebhookUrl,
  registerWebhook,
  shouldRegisterWebhook,
  verifyWebhook,
  getWebhookInfo,
  getMe,
  checkGroupPrivacyMode,
  extractChatMigration,
  extractCallbackQuery,
  answerCallbackQuery,
  editMessageText,
  describeAccess,
  sendTelegramMessage,
  extractTelegramMessage,
  escapeMarkdown,
  getAllowedChatIds,
  isAllowedChat,
}
