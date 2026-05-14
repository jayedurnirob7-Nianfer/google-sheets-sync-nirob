const crypto = require('crypto');
function normalise(v) { if (v===null||v===undefined) return ''; return String(v).trim().replace(/\s/,' ').toLowerCase(); }
function generateRowHash({clientName='',inboxUrl='',date=''}) {
  const composite = [normalise(clientName),normalise(inboxUrl),normalise(date)].join('||');
  return crypto.createHash('md5').update(composite).digest('hex');
}
function generateRowId(params) { return 'SYNC-'+generateRowHash(params); }
function generateIdFromRow(obj) {
  return generateRowId({ clientName:obj['Client Name']||obj['client name']||'', inboxUrl:obj['Inbox URL']||obj['inbox url']||'', date:obj['Date']||obj['date']||'' });
}
module.exports = { generateRowHash, generateRowId, generateIdFromRow, normalise };
