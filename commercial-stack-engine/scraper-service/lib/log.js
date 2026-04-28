'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const cur = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || 20;

function emit(level, msg, extra) {
  if ((LEVELS[level] || 20) < cur) return;
  const line = { ts: new Date().toISOString(), level, msg, ...(extra || {}) };
  process.stdout.write(JSON.stringify(line) + '\n');
}

module.exports = {
  debug: (m, x) => emit('debug', m, x),
  info:  (m, x) => emit('info',  m, x),
  warn:  (m, x) => emit('warn',  m, x),
  error: (m, x) => emit('error', m, x)
};
