/**
 * syncService.js - Core sync engine: filter + upsert + archive
 */
const sheetsService = require('./sheetsService');
const { generateIdFromRow, normalise } = require('../utils/hashUtils');
const logger = require('../utils/logger');

const SOURCE_SHEET_ID = process.env.SOURCE_SHEET_ID;
const DESTINATION_SHEET_ID = process.env.DESTINATION_SHEET_ID;
const DESTINATION_TAB_NAME = process.env.DESTINATION_TAB_NAME || 'Synced Data';
const TARGET_SELLER_NAME = (process.env.TARGET_SELLER_NAME || 'Nirob').toLowerCase();
const TARGET_STATUS = (process.env.TARGET_STATUS || 'Quoted,Converted').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

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
  const clean = srcHeaders.filter(h => !['_source_tab','_sync_id','_last_synced'].includes(h.toLowerCase()));
  return [...clean, '_source_tab', '_sync_id', '_last_synced'];
}

function rowToArray(rowData, destHeaders, tabName, syncId) {
  const ts = new Date().toISOString().replace('T',' ').substring(0,19);
  return destHeaders.map(h => {
    if (h === '_source_tab') return tabName;
    if (h === '_sync_id') return syncId;
    if (h === '_last_synced') return ts;
    return rowData[h] !== undefined ? String(rowData[h]) : '';
  });
}

async function runSync() {
  const t0 = Date.now();
  const stats = { appended: 0, updated: 0, skipped: 0, errors: 0 };
  logger.info('-----------------------------------------------');
  logger.info('Starting sync cycle');
  if (!SOURCE_SHEET_ID || !DESTINATION_SHEET_ID) throw new Error('Missing sheet IDs');
  const sourceTabs = await sheetsService.listAllTabs(SOURCE_SHEET_ID);
  logger.info('Tabs: ' + sourceTabs.join(', '));
  await sheetsService.ensureDestinationTab(DESTINATION_SHEET_ID, DESTINATION_TAB_NAME);
  let destState = await sheetsService.readDestinationRows(DESTINATION_SHEET_ID, DESTINATION_TAB_NAME);
  const destMap = new Map();
  destState.rows.forEach(r => { if (r.syncId) destMap.set(r.syncId, r); });
  const matches = [];
  let mergedHeaders = [];
  for (const tabName of sourceTabs) {
    let rows;
    try { rows = await sheetsService.readTabRows(SOURCE_SHEET_ID, tabName); }
    catch (e) { logger.warn(e.message); stats.errors++; continue; }
    if (!rows.length) continue;
    const tabHeaders = rows[0].headers;
    tabHeaders.forEach(h => { if (h && !mergedHeaders.includes(h)) mergedHeaders.push(h); });
    const sellerCol = findColumn(tabHeaders, ['Seller Name','seller name','Seller']);
    const statusCol = findColumn(tabHeaders, ['Status','status']);
    if (!sellerCol || !statusCol) continue;
    let n = 0;
    for (const { data } of rows) {
      if (rowMatchesFilter(data, sellerCol, statusCol)) { matches.push({ syncId: generateIdFromRow(data), tabName, data }); n++; }
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
  const freshMap = new Map();
  destState.rows.forEach(r => { if (r.syncId) freshMap.set(r.syncId, r); });
  for (const { syncId, tabName, data } of matches) {
    const values = rowToArray(data, resolvedHeaders, tabName, syncId);
    try {
      if (freshMap.has(syncId)) {
        const exr = freshMap.get(syncId);
        const changed = values.some((v, i) => resolvedHeaders[i] !== '_last_synced' && v !== (exr.data[i]||''));
        if (changed) { await sheetsService.updateRow(DESTINATION_SHEET_ID, DESTINATION_TAB_NAME, exr.rowIndex, values); stats.updated++; logger.info('UPDATE: ' + syncId.substring(0,8)); }
        else { stats.skipped++; }
      } else {
        await sheetsService.appendRow(DESTINATION_SHEET_ID, DESTINATION_TAB_NAME, values);
        freshMap.set(syncId, { syncId, rowIndex: destState.rows.length+2+stats.appended, data: values });
        stats.appended++; logger.info('APPEND: ' + syncId.substring(0,8));
      }
    } catch(e) { logger.error('Error: ' + e.message); stats.errors++; }
  }
  logger.info('Sync done in ' + ((Date.now()-t0)/1000).toFixed(1) + 's | ' + JSON.stringify(stats));
  return stats;
}

module.exports = { runSync };
