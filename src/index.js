/**
 * index.js  (src/index.js)
 * Application entry point.
 * Two modes:
 *   node src/index.js          → starts the cron scheduler
 *   node src/index.js --once   → runs sync once and exits
 */
require('dotenv').config();
const cron          = require('node-cron');
const { runSync }   = require('./services/syncService');
const logger        = require('./utils/logger');

const SYNC_INTERVAL = parseInt(process.env.SYNC_INTERVAL_MINUTES || '5', 10);
const RUN_ONCE      = process.argv.includes('--once');

logger.info('Google Sheets Auto-Sync Engine starting');
logger.info('Mode: ' + (RUN_ONCE ? 'Single run' : 'Scheduler every ' + SYNC_INTERVAL + ' min'));

const REQUIRED = ['SOURCE_SHEET_ID','DESTINATION_SHEET_ID','GOOGLE_SERVICE_ACCOUNT_EMAIL','GOOGLE_PRIVATE_KEY'];
const missing = REQUIRED.filter(v => !process.env[v]);
if (missing.length > 0) { logger.error('Missing env vars:', missing); process.exit(1); }

if (RUN_ONCE) {
  runSync().then(s => { logger.info('Done', s); process.exit(0); }).catch(e => { logger.error(e.message); process.exit(1); });
} else {
  const interval = Math.min(Math.max(SYNC_INTERVAL, 1), 59);
  const cronExpr = '*/' + interval + ' * * * *';
  logger.info('Cron: ' + cronExpr);
  runSync().catch(e => logger.error(e.message));
  cron.schedule(cronExpr, async () => { try { await runSync(); } catch(e) { logger.error(e.message); } });
  process.on('SIGINT',  () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}
