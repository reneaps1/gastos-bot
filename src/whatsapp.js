const axios = require('axios');
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

async function sendWhatsAppMessage(to, message) {
  const url = `https://graph.facebook.com/v18.0/${META_PHONE_NUMBER_ID}/messages`;

  try {
    await axios.post(url, {
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: message },
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    return true;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.response?.data || error.message);
    return false;
  }
}

function extractPhoneNumber(value) {
  if (!value) return null;
  return value.replace(/\D/g, '');
}

module.exports = { sendWhatsAppMessage, extractPhoneNumber };
