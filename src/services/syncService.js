/**
 * syncService.js - Core sync engine: filter + upsert + archive + color
 */
require('dotenv').config();
const { getSheetsClient }                        = require('../config/google');
const sheetsService                              = require('./sheetsService');
const { loadColorMap, getColor, hexToSheetsRgb } = require('./colorService');
const { generateIdFromRow, normalise }           = require('../utils/hashUtils');
const logger                                     = require('../utils/logger');

const SOURCE_SHEET_ID      = process.env.SOURCE_SHEET_ID;
const DESTINATION_SHEET_ID = process.env.DESTINATION_SHEET_ID;
const DESTINATION_TAB_NAME = process.env.DESTINATION_TAB_NAME || 'Synced Data';
const TARGET_SELLER_NAME   = (process.env.TARGET_SELLER_NAME || 'Nirob').toLowerCase();
const TARGET_STATUS        = (process.env.TARGET_STATUS || 'Quoted,Converted')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function findColumn(headers, aliases) {
  const lw = aliases.map(a => a.toLowerCase());
  return headers.find(h => lw.includes(h.toLowerCase())) || null;
}

function rowMatchesFilter(rowData, sellerCol, statusCol) {
  if (!sellerCol || !statusCol) return false;
  const seller = normalise(rowData[sellerCol]);
  const status = normalise(rowData[statusCol]);
  return seller === TARGET_SELLER_NAME && TARGET_STATUS.some(t => status.includes(t));
}

function buildDestHeaders(srcHeaders) {
  const clean = srcHeaders.filter(h =>
    !['_source_tab', '_sync_id', '_last_synced'].includes(h.toLowerCase())
  );
  return [...clean, '_source_tab', '_sync_id', '_last_synced'];
}

function rowToArray(rowData, destHeaders, tabName, syncId) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  return destHeaders.map(h => {
    if (h === '_source_tab')  return tabName;
    if (h === '_sync_id')     return syncId;
    if (h === '_last_synced') return ts;
    return rowData[h] !== undefined ? String(rowData[h]) : '';
  });
}

// Apply color to a single row immediately (used for newly inserted rows)
async function applyRowColor(sheetsClient, sheetId, rowIndex, profileName, colorMap) {
  if (!sheetId || !profileName) return;
  const hex = getColor(profileName, colorMap);
  const rgb = hexToSheetsRgb(hex);
  await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId: DESTINATION_SHEET_ID,
    requestBody: {
      requests: [{
        repeatCell: {
          range: {
            sheetId,
            startRowIndex:    rowIndex - 1, // Sheets API is 0-indexed
            endRowIndex:      rowIndex,
            startColumnIndex: 0,
            endColumnIndex:   20,
          },
          cell:   { userEnteredFormat: { backgroundColor: rgb } },
          fields: 'userEnteredFormat.backgroundColor',
        },
      }],
    },
  });
}

// Batch-apply colors to multiple rows in one API call (used for updated rows)
async function applyAllRowColors(sheetsClient, sheetId, rowColorPairs, colorMap) {
  if (!sheetId || !rowColorPairs.length) return;
  const requests = rowColorPairs.map(({ rowIndex, profileName }) => {
    const hex = getColor(profileName, colorMap);
    const rgb = hexToSheetsRgb(hex);
    return {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex:    rowIndex - 1, // Sheets API is 0-indexed
          endRowIndex:      rowIndex,
          startColumnIndex: 0,
          endColumnIndex:   20,
        },
        cell:   { userEnteredFormat: { backgroundColor: rgb } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    };
  });
  await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId: DESTINATION_SHEET_ID,
    requestBody: { requests },
  });
}

async function runSync() {
  const t0    = Date.now();
  const stats = { appended: 0, updated: 0, skipped: 0, errors: 0 };

  // Tracks how many rows were inserted at the top this cycle.
  // Each insert shifts ALL existing rows down by 1, so we add this
  // offset when updating a previously synced row.
  let insertedCount = 0;

  logger.info('-----------------------------------------------');
  logger.info('Starting sync cycle');
  if (!SOURCE_SHEET_ID || !DESTINATION_SHEET_ID) throw new Error('Missing sheet IDs');

  // Get numeric sheetId and color map for formatting
  const sheetsClient = getSheetsClient();
  const meta         = await sheetsClient.spreadsheets.get({ spreadsheetId: DESTINATION_SHEET_ID });
  const sheetMeta    = meta.data.sheets.find(s => s.properties.title === DESTINATION_TAB_NAME);
  const sheetId      = sheetMeta ? sheetMeta.properties.sheetId : null;
  const colorMap     = loadColorMap();

  const sourceTabs = await sheetsService.listAllTabs(SOURCE_SHEET_ID);
  logger.info('Tabs: ' + sourceTabs.join(', '));

  await sheetsService.ensureDestinationTab(DESTINATION_SHEET_ID, DESTINATION_TAB_NAME);
  let destState = await sheetsService.readDestinationRows(DESTINATION_SHEET_ID, DESTINATION_TAB_NAME);

  const matches       = [];
  let   mergedHeaders = [];

  for (const tabName of sourceTabs) {
    let rows;
    try { rows = await sheetsService.readTabRows(SOURCE_SHEET_ID, tabName); }
    catch (e) { logger.warn(e.message); stats.errors++; continue; }
    if (!rows.length) continue;

    const tabHeaders = rows[0].headers;
    tabHeaders.forEach(h => { if (h && !mergedHeaders.includes(h)) mergedHeaders.push(h); });

    const sellerCol = findColumn(tabHeaders, ['Seller Name', 'seller name', 'Seller']);
    const statusCol = findColumn(tabHeaders, ['Status', 'status']);
    if (!sellerCol || !statusCol) continue;

    let n = 0;
    for (const { data } of rows) {
      if (rowMatchesFilter(data, sellerCol, statusCol)) {
        matches.push({ syncId: generateIdFromRow(data), tabName, data });
        n++;
      }
    }
    logger.info('Tab ' + tabName + ': ' + n + ' matches of ' + rows.length);
  }

  if (!matches.length) { logger.info('No matches found'); return stats; }

  const destHeaders = buildDestHeaders(mergedHeaders);
  if (!destState.headers.length) {
    await sheetsService.writeDestinationHeaders(DESTINATION_SHEET_ID, DESTINATION_TAB_NAME, destHeaders);
    destState = await sheetsService.readDestinationRows(DESTINATION_SHEET_ID, DESTINATION_TAB_NAME);
  }

  const resolvedHeaders = destState.headers.length ? destState.headers : destHeaders;
  const profileColIdx   = resolvedHeaders.indexOf('Profile Name');

  const freshMap      = new Map();
  const rowColorPairs = []; // collect updated rows for batch color — applied at end

  destState.rows.forEach(r => { if (r.syncId) freshMap.set(r.syncId, r); });

  for (const { syncId, tabName, data } of matches) {
    const values      = rowToArray(data, resolvedHeaders, tabName, syncId);
    const profileName = profileColIdx >= 0 ? (values[profileColIdx] || '') : '';

    try {
      if (freshMap.has(syncId)) {
        // ── UPDATE existing row ────────────────────────────────────────────
        // exr.rowIndex is from BEFORE this cycle's inserts.
        // Each top-insert shifts rows down by 1, so we add insertedCount.
        const exr          = freshMap.get(syncId);
        const adjustedRow  = exr.rowIndex + insertedCount;
        const changed      = values.some((v, i) =>
          resolvedHeaders[i] !== '_last_synced' && v !== (exr.data[i] || '')
        );

        if (changed) {
          await sheetsService.updateRow(
            DESTINATION_SHEET_ID, DESTINATION_TAB_NAME, adjustedRow, values
          );
          // Collect for batch color at end (no more inserts will affect this index)
          rowColorPairs.push({ rowIndex: adjustedRow, profileName });
          stats.updated++;
          logger.info('UPDATE row ' + adjustedRow + ': ' + syncId.substring(0, 8));
        } else {
          stats.skipped++;
        }

      } else {
        // ── INSERT new row at top (row 2, right after header) ─────────────
        // Color must be applied IMMEDIATELY while the row is still at row 2,
        // because the NEXT insert will push it down to row 3, then 4, etc.
        await sheetsService.insertRowAtTop(
          DESTINATION_SHEET_ID, DESTINATION_TAB_NAME, values
        );

        // Color the new row right now — it is at row 2 at this exact moment
        await applyRowColor(sheetsClient, sheetId, 2, profileName, colorMap);

        // Record in map (row 2 for now; future inserts will shift it, but
        // we only need this for detecting duplicates — not for positioning)
        freshMap.set(syncId, { syncId, rowIndex: 2, data: values });
        insertedCount++;
        stats.appended++;
        logger.info('INSERT top (row 2): ' + syncId.substring(0, 8));
      }

    } catch (e) {
      logger.error('Error: ' + e.message);
      stats.errors++;
    }
  }

  // Apply colors for all UPDATED rows in one single API call
  if (rowColorPairs.length) {
    await applyAllRowColors(sheetsClient, sheetId, rowColorPairs, colorMap);
    logger.info('Colors applied to ' + rowColorPairs.length + ' updated rows');
  }

  logger.info(
    'Sync done in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's | ' +
    JSON.stringify(stats)
  );
  return stats;
}

module.exports = { runSync };
