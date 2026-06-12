require('dotenv').config();

const express = require('express');
const { appendRow } = require('./sheets');
const { parseMessage, formatConfirmation } = require('./parser');
const { sendWhatsAppMessage, extractPhoneNumber } = require('./whatsapp');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.log('Webhook verification failed');
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') return;

    const entry = body.entry?.[0];
    if (!entry) return;

    const changes = entry.changes?.[0];
    if (!changes) return;

    const messages = changes.value?.messages;
    if (!messages || messages.length === 0) return;

    for (const message of messages) {
      if (message.type !== 'text') continue;

      const text = message.text?.body?.trim();
      if (!text) continue;

      const senderPhone = extractPhoneNumber(message.from);
      const senderName = changes.value.contacts?.[0]?.profile?.name || 'Rene';

      console.log(`Message from ${senderName} (${senderPhone}): ${text}`);

      if (text.toLowerCase() === 'resumen' || text.toLowerCase() === 'help' || text.toLowerCase() === 'ayuda') {
        await sendWhatsAppMessage(senderPhone, [
          '📝 *Bot de Gastos*',
          '',
          'Escribe tu gasto o ingreso en texto libre:',
          '',
          '*Ejemplos:*',
          '• gaste 149 en McDonald\'s',
          '• compre 36 estacionamiento',
          '• gasto 348 helado',
          '• ingreso 3500 pago',
          '• pague 36 estacionamiento',
          '',
          '*Comandos:*',
          '• resumen - Ver esta ayuda',
          '• ultimos - Ver ultimos registros',
        ].join('\n'));
        continue;
      }

      try {
        const row = parseMessage(text, senderName || 'Rene');
        await appendRow(row);

        const confirmation = formatConfirmation(row);
        await sendWhatsAppMessage(senderPhone, confirmation);
        console.log('Row added:', row);
      } catch (error) {
        console.error('Error processing message:', error);
        await sendWhatsAppMessage(senderPhone, '❌ Error al procesar tu mensaje. Intenta de nuevo.');
      }
    }
  } catch (error) {
    console.error('Webhook error:', error);
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bot de Gastos running on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
});
