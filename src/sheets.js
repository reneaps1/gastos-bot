const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'Sheet1';

let sheets = null;

async function getSheetsClient() {
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

  await client.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:K`,
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

  const res = await client.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A2:K`,
  });

  return res.data.values || [];
}

module.exports = { appendRow, getRows };
