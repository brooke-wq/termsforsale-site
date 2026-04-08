/**
 * Admin Auth — POST /.netlify/functions/admin-auth
 *
 * Simple password check for admin dashboard access.
 * Uses constant-time comparison to avoid timing attacks.
 *
 * Request body:
 *   { "password": "your-admin-password" }
 *
 * Response:
 *   200 { ok: true } — correct
 *   401 { error: "Invalid password" } — wrong
 *
 * ENV VARS:
 *   ADMIN_PASSWORD — the admin password
 *                    (must be set in Netlify env vars)
 */

const crypto = require('crypto');

/**
 * Constant-time string comparison. Returns true if equal.
 * Prevents timing attacks that could leak the password character by character.
 */
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  var bufA = Buffer.from(a);
  var bufB = Buffer.from(b);
  return crypto.timingSafeEqual(bufA, bufB);
}

exports.handler = async function(event) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  var expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'Admin auth not configured' }) };
  }

  var body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  var password = body.password || '';
  if (!password) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Password required' }) };
  }

  if (!constantTimeEqual(password, expected)) {
    return { statusCode: 401, headers: headers, body: JSON.stringify({ error: 'Invalid password' }) };
  }

  return { statusCode: 200, headers: headers, body: JSON.stringify({ ok: true }) };
};

// Exported for use by other functions (e.g. deal-buyer-list) to verify auth
module.exports.verifyPassword = function(providedPassword) {
  var expected = process.env.ADMIN_PASSWORD;
  if (!expected || !providedPassword) return false;
  return constantTimeEqual(String(providedPassword), expected);
};
