/**
 * google.js - Google Sheets API authentication
 */
const { google } = require('googleapis');
const logger    = require('../utils/logger');

function parsePrivateKey(raw) {
  if (!raw) throw new Error('GOOGLE_PRIVATE_KEY is not set');
  return raw.replace(/\\n/g, '\n');
}

function getSheetsClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key   = parsePrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  if (!email) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL not set');
  const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  logger.debug('Sheets client init', { email });
  return google.sheets({ version: 'v4', auth });
}

module.exports = { getSheetsClient };
