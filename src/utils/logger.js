const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs = require('fs');
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const consoleFmt = format.combine(format.colorize(), format.timestamp({format:'YYYY-MM-DD HH:mm:ss'}), format.printf(({timestamp,level,message,...m}) => { const e = Object.keys(m).length ? ' '+JSON.stringify(m) : ''; return '['+timestamp+'] '+level+': '+message+e; }));
const fileFmt = format.combine(format.timestamp(), format.errors({stack:true}), format.json());
const logger = createLogger({
  level: process.env.LOG_LEVEL||'info',
  transports: [
    new transports.Console({format:consoleFmt}),
    new transports.File({filename:path.join(logsDir,'combined.log'),format:fileFmt,maxsize:5*1024*1024,maxFiles:5}),
    new transports.File({filename:path.join(logsDir,'error.log'),format:fileFmt,level:'error',maxsize:5*1024*1024,maxFiles:5})
  ],
  exceptionHandlers: [new transports.File({filename:path.join(logsDir,'exceptions.log'),format:fileFmt})]
});
module.exports = logger;
