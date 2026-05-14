/**
 * cleanupSheet.js
 * One-time script:
 *   - Keeps only required columns in exact order
 *   - Deletes everything else
 *   - Applies per-profile row colors
 *
 * Run: node src/scripts/cleanupSheet.js
 */
require('dotenv').config();
const { getSheetsClient }                    = require('../config/google');
const { loadColorMap, getColor, hexToSheetsRgb } = require('../services/colorService');
const logger                                 = require('../utils/logger');

const SPREADSHEET_ID = process.env.DESTINATION_SHEET_ID;
const TAB_NAME       = process.env.DESTINATION_TAB_NAME || 'Synced Data';

const DESIRED_COLUMNS = [
  'Profile Name',
  'Date',
  'Client Name',
  'Inbox URL',
  'Status',
  'Service Line',
  'Ammount',
  'Seller Name',
  'Remarks',
  'Followup',
  '_source_tab',
  '_sync_id',
  '_last_synced'
];

function colLetter(index) {
  let letter = '';
  let i = index;
  while (i >= 0) {
    letter = String.fromCharCode((i % 26) + 65) + letter;
    i = Math.floor(i / 26) - 1;
  }
  return letter;
}

async function run() {
  const sheets = getSheetsClient();

  // --- Get sheet metadata ---
  const meta      = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetMeta = meta.data.sheets.find(s => s.properties.title === TAB_NAME);
  if (!sheetMeta) throw new Error(`Tab "${TAB_NAME}" not found`);
  const sheetId = sheetMeta.properties.sheetId;

  // --- Read all data ---
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: TAB_NAME,
    valueRenderOption: 'FORMATTED_VALUE'
  });
  const rawRows = res.data.values || [];
  if (!rawRows.length) { logger.info('Sheet is empty, nothing to do.'); return; }

  const currentHeaders = rawRows[0].map(h => (h || '').toString().trim());
  logger.info('Current columns (' + currentHeaders.length + '): ' + currentHeaders.join(', '));

  // --- Remap rows to desired columns only ---
  const newRows = rawRows.map((row, i) => {
    if (i === 0) return DESIRED_COLUMNS;
    return DESIRED_COLUMNS.map(col => {
      const idx = currentHeaders.indexOf(col);
      return idx >= 0 ? (row[idx] || '') : '';
    });
  });

  // --- Write remapped data back ---
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB_NAME}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: newRows }
  });
  logger.info('Columns rewritten ✓');

  // --- Clear leftover columns beyond desired width ---
  if (currentHeaders.length > DESIRED_COLUMNS.length) {
    const from = colLetter(DESIRED_COLUMNS.length);
    const to   = colLetter(currentHeaders.length - 1);
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${TAB_NAME}'!${from}1:${to}${rawRows.length + 5}`
    });
    logger.info('Extra columns cleared ✓');
  }

  // --- Apply row colors ---
  const colorMap = loadColorMap();
  const profileColIdx = 0; // 'Profile Name' is first column
  const requests = [];

  // Reset all rows to white first
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: newRows.length,
                startColumnIndex: 0, endColumnIndex: DESIRED_COLUMNS.length },
      cell: { userEnteredFormat: { backgroundColor: { red:1, green:1, blue:1 } } },
      fields: 'userEnteredFormat.backgroundColor'
    }
  });

  // Style header row
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1,
                startColumnIndex: 0, endColumnIndex: DESIRED_COLUMNS.length },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.18, green: 0.18, blue: 0.18 },
          textFormat: { bold: true, foregroundColor: { red:1, green:1, blue:1 } }
        }
      },
      fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat'
    }
  });

  // Color each data row by Profile Name
  for (let i = 1; i < newRows.length; i++) {
    const profileName = newRows[i][profileColIdx] || '';
    const hex = getColor(profileName, colorMap);
    const rgb = hexToSheetsRgb(hex);
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: i, endRowIndex: i + 1,
                  startColumnIndex: 0, endColumnIndex: DESIRED_COLUMNS.length },
        cell: { userEnteredFormat: { backgroundColor: rgb } },
        fields: 'userEnteredFormat.backgroundColor'
      }
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests }
  });
  logger.info('Colors applied ✓');
  logger.info('Cleanup complete!');
}

run().catch(e => { logger.error(e.message); process.exit(1); });
