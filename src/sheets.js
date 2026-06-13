const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'Sheet1';
const SHEETS_ENABLED = process.env.GOOGLE_SHEETS_ENABLED !== 'false';

let sheets = null;

async function getSheetsClient() {
  if (!SHEETS_ENABLED) return null;
  if (sheets) return sheets;

  let auth;

  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else {
    const credentialsPath = path.resolve(process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json');
    auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  sheets = google.sheets({ version: 'v4', auth });
  return sheets;
}

async function appendRow(row) {
  const client = await getSheetsClient();
  if (!client) return false;

  await client.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:M`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row],
    },
  });

  return true;
}

async function getRows() {
  const client = await getSheetsClient();
  if (!client) return [];

  const res = await client.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A2:M`,
  });

  return res.data.values || [];
}

/**
 * Verifica si un mensaje ya fue procesado usando el messageId de Meta
 * @param {string} messageId - ID del mensaje de WhatsApp (Meta)
 * @returns {boolean} - true si el mensaje ya existe, false si no
 */
async function messageExists(messageId) {
  if (!messageId) return false;

  try {
    const client = await getSheetsClient();
    if (!client) return false;

    const rows = await getRows();
    
    // La columna M (índice 12) contiene el messageId de Meta
    return rows.some(row => row && row[12] === messageId);
  } catch (error) {
    console.error('Error checking if message exists:', error);
    return false;
  }
}

module.exports = { appendRow, getRows, messageExists, SHEETS_ENABLED };
