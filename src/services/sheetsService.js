/**
 * sheetsService.js - Low-level Google Sheets API wrapper
 */

const { getSheetsClient } = require('../config/google');
const logger = require('../utils/logger');

let sheetsClient = null;

function getClient() {
  if (!sheetsClient) sheetsClient = getSheetsClient();
  return sheetsClient;
}

async function listAllTabs(spreadsheetId) {
  const res = await getClient().spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title'
  });

  return res.data.sheets.map(s => s.properties.title);
}

async function readTabRows(spreadsheetId, tabName) {
  let res;

  try {
    res = await getClient().spreadsheets.values.get({
      spreadsheetId,
      range: tabName,
      valueRenderOption: 'FORMATTED_VALUE'
    });
  } catch (err) {
    logger.warn('Cannot read tab ' + tabName + ': ' + err.message);
    return [];
  }

  const rawRows = res.data.values || [];

  if (!rawRows.length) return [];

  let headerRowIndex = -1;
  let headers = [];

  for (let i = 0; i < rawRows.length; i++) {
    if (
      rawRows[i] &&
      rawRows[i].some(c => c && c.toString().trim())
    ) {
      headerRowIndex = i;
      headers = rawRows[i].map(h =>
        (h || '').toString().trim()
      );
      break;
    }
  }

  if (headerRowIndex === -1) return [];

  const result = [];

  for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
    const row = rawRows[i] || {};
    const obj = {};

    headers.forEach((h, idx) => {
      if (h) {
        obj[h] = row[idx] !== undefined ? row[idx] : '';
      }
    });

    if (
      Object.values(obj).some(
        v => v && v.toString().trim()
      )
    ) {
      result.push({
        rowIndex: i + 1,
        headers,
        data: obj
      });
    }
  }

  return result;
}

async function readDestinationRows(spreadsheetId, tabName) {
  let res;

  try {
    res = await getClient().spreadsheets.values.get({
      spreadsheetId,
      range: tabName,
      valueRenderOption: 'FORMATTED_VALUE'
    });
  } catch (err) {
    return { headers: [], rows: [] };
  }

  const rawRows = res.data.values || [];

  if (!rawRows.length) {
    return { headers: [], rows: [] };
  }

  const headers = rawRows[0].map(h =>
    (h || '').toString().trim()
  );

  const syncIdx = headers.indexOf('_sync_id');

  const rows = rawRows.slice(1).map((row, i) => ({
    rowIndex: i + 2,
    syncId: syncIdx >= 0 ? (row[syncIdx] || '') : '',
    data: row || []
  }));

  return { headers, rows };
}

async function ensureDestinationTab(spreadsheetId, tabName) {
  const existing = await listAllTabs(spreadsheetId);

  if (existing.includes(tabName)) return;

  logger.info('Creating tab: ' + tabName);

  await getClient().spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: tabName
            }
          }
        }
      ]
    }
  });
}

async function writeDestinationHeaders(
  spreadsheetId,
  tabName,
  headers
) {
  await getClient().spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [headers]
    }
  });
}

async function appendRow(
  spreadsheetId,
  tabName,
  rowValues
) {
  await getClient().spreadsheets.values.append({
    spreadsheetId,
    range: tabName,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [rowValues]
    }
  });
}

async function updateRow(
  spreadsheetId,
  tabName,
  rowIndex,
  rowValues
) {
  await getClient().spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!A${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [rowValues]
    }
  });
}

module.exports = {
  listAllTabs,
  readTabRows,
  readDestinationRows,
  ensureDestinationTab,
  writeDestinationHeaders,
  appendRow,
  updateRow
};
