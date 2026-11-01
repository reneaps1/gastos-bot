const axios = require('axios');
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

async function apiCall(method, url, data) {
  try {
    await axios({ method, url, data, headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } });
    return true;
  } catch (error) {
    console.error('WhatsApp API error:', error.response?.data || error.message);
    noteSendFailure(error.response?.data);
    return false;
  }
}

async function markAsRead(messageId) {
  return apiCall('post', `https://graph.facebook.com/v18.0/${META_PHONE_NUMBER_ID}/messages`, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  });
}

async function react(to, messageId, emoji) {
  return apiCall('post', `https://graph.facebook.com/v18.0/${META_PHONE_NUMBER_ID}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'reaction',
    reaction: { message_id: messageId, emoji },
  });
}

async function sendWhatsAppMessage(to, message) {
  try {
    const response = await axios({
      method: 'post',
      url: `https://graph.facebook.com/v18.0/${META_PHONE_NUMBER_ID}/messages`,
      data: {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      },
      headers: {
        Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    })
    return { ok: true, data: response.data }
  } catch (error) {
    const details = error.response?.data || error.message
    console.error(`sendWhatsAppMessage FAILED to=${to}:`, JSON.stringify(details))
    noteSendFailure(details)
    return { ok: false, error: details }
  }
}

async function getMediaUrl(mediaId) {
  try {
    const response = await axios({
      method: 'get',
      url: `https://graph.facebook.com/v18.0/${mediaId}`,
      headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
    })
    return response.data
  } catch (error) {
    console.error('getMediaUrl error:', error.response?.data || error.message)
    return null
  }
}

async function downloadMedia(mediaId) {
  const meta = await getMediaUrl(mediaId)
  if (!meta?.url) return null
  try {
    const response = await axios({
      method: 'get',
      url: meta.url,
      headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
      responseType: 'arraybuffer',
    })
    return { buffer: Buffer.from(response.data), mimeType: meta.mime_type || 'application/octet-stream' }
  } catch (error) {
    console.error('downloadMedia error:', error.message)
    return null
  }
}

// Estado del numero en la Cloud API. Sin esto, un numero sin registrar
// (#133010) o un token caducado (190) solo se veian en los logs al primer
// mensaje, y /health seguia diciendo "ok" con el bot mudo.
let lastStatus = { ok: null, checkedAt: null, error: null, hint: null }

function describeWhatsAppError(details) {
  const err = details?.error || {}
  if (err.code === 133010) return 'El numero no esta registrado en la WhatsApp Cloud API: registralo en WhatsApp Manager (POST /{PHONE_NUMBER_ID}/register con tu PIN).'
  if (err.code === 190) return 'META_ACCESS_TOKEN invalido o caducado: usa un token permanente de System User.'
  if (err.code === 100) return 'META_PHONE_NUMBER_ID no existe o el token no tiene acceso a ese numero.'
  return null
}

async function checkWhatsApp() {
  if (!process.env.META_ACCESS_TOKEN || !META_PHONE_NUMBER_ID) {
    lastStatus = { ok: false, checkedAt: new Date().toISOString(), error: 'Faltan META_ACCESS_TOKEN o META_PHONE_NUMBER_ID', hint: null }
    return lastStatus
  }
  try {
    const response = await axios({
      method: 'get',
      url: `https://graph.facebook.com/v18.0/${META_PHONE_NUMBER_ID}`,
      params: { fields: 'display_phone_number,verified_name,status,name_status' },
      headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
    })
    const data = response.data || {}
    // La API devuelve status CONNECTED cuando el numero esta registrado; si
    // no viene el campo (versiones viejas), no se marca como fallo.
    const ok = !data.status || data.status === 'CONNECTED'
    lastStatus = {
      ok,
      checkedAt: new Date().toISOString(),
      error: ok ? null : `status=${data.status}`,
      hint: ok ? null : describeWhatsAppError({ error: { code: 133010 } }),
      phone: data.display_phone_number || null,
    }
  } catch (error) {
    const details = error.response?.data || error.message
    lastStatus = {
      ok: false,
      checkedAt: new Date().toISOString(),
      error: typeof details === 'string' ? details : details?.error?.message || JSON.stringify(details),
      hint: describeWhatsAppError(details),
    }
  }
  return lastStatus
}

function whatsappStatus() {
  return lastStatus
}

// Cada fallo de envio actualiza el estado: asi /health refleja un 133010/190
// aunque haya aparecido despues del chequeo de arranque.
function noteSendFailure(details) {
  const hint = describeWhatsAppError(details)
  if (!hint) return
  lastStatus = { ok: false, checkedAt: new Date().toISOString(), error: details?.error?.message || null, hint }
}

function extractPhoneNumber(value) {
  if (!value) return null;
  return value.replace(/\D/g, '');
}

module.exports = { sendWhatsAppMessage, extractPhoneNumber, markAsRead, react, getMediaUrl, downloadMedia, checkWhatsApp, whatsappStatus, describeWhatsAppError };
