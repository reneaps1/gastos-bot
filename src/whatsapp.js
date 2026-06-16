const axios = require('axios');
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

async function apiCall(method, url, data) {
  try {
    await axios({ method, url, data, headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } });
    return true;
  } catch (error) {
    console.error('WhatsApp API error:', error.response?.data || error.message);
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
    return { ok: false, error: details }
  }
}

function extractPhoneNumber(value) {
  if (!value) return null;
  return value.replace(/\D/g, '');
}

module.exports = { sendWhatsAppMessage, extractPhoneNumber, markAsRead, react };
