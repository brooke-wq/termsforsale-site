/**
 * File-based dedup for outbound messaging.
 *
 * Prevents duplicate SMS/email sends by tracking what was sent in a JSON file.
 * Key format: {contactId}-{dealId}-{step}
 *   e.g. "abc123-def456-d0", "abc123-def456-alert", "abc123-def456-d1"
 *
 * Only works on the Droplet (persistent filesystem).
 * Netlify functions (serverless) skip dedup gracefully.
 */

const fs = require('fs');
const path = require('path');

var LOG_PATH = process.env.SENT_LOG_PATH || path.join(__dirname, 'sent-log.json');

function readLog() {
  try {
    var data = fs.readFileSync(LOG_PATH, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

function writeLog(log) {
  try {
    fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), 'utf8');
  } catch (e) {
    console.error('[sent-log] Failed to write:', e.message);
  }
}

/**
 * Check if a message was already sent.
 * @param {string} contactId
 * @param {string} dealId - full or partial deal ID
 * @param {string} step - e.g. "alert", "d0", "d1", "d2"
 * @returns {boolean} true if already sent
 */
function wasSent(contactId, dealId, step) {
  var key = contactId + '-' + dealId + '-' + step;
  var log = readLog();
  return !!log[key];
}

/**
 * Record that a message was sent.
 * @param {string} contactId
 * @param {string} dealId
 * @param {string} step
 */
function markSent(contactId, dealId, step) {
  var key = contactId + '-' + dealId + '-' + step;
  var log = readLog();
  log[key] = { ts: new Date().toISOString() };
  writeLog(log);
}

/**
 * Check if running on Droplet (persistent filesystem).
 * On Netlify, /tmp is the only writable path and it's ephemeral.
 */
function isDroplet() {
  return !process.env.LAMBDA_TASK_ROOT && !process.env.AWS_LAMBDA_FUNCTION_NAME;
}

module.exports = { wasSent, markSent, isDroplet, LOG_PATH };
