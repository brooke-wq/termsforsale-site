// Lightweight JWT-style token signer for tokenized data room links.
// Uses HMAC-SHA256 — no external dependencies.
//
// Token payload format: { dc: dealCode, ci: contactId, exp: unixSeconds }
// Token format: base64url(payload).base64url(signature)
//
// 7-day default expiry.

const crypto = require('crypto');

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function b64urlDecode(str) {
  str = str.replace(/-/g,'+').replace(/_/g,'/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function sign(payloadObj, secret = process.env.JWT_SECRET) {
  if (!secret) throw new Error('JWT_SECRET env var is missing');
  const payload = b64url(JSON.stringify(payloadObj));
  const sig = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

function verify(token, secret = process.env.JWT_SECRET) {
  if (!secret) throw new Error('JWT_SECRET env var is missing');
  if (!token || typeof token !== 'string') return { valid: false, reason: 'missing' };
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return { valid: false, reason: 'malformed' };
  const expected = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  if (sig !== expected) return { valid: false, reason: 'bad_signature' };
  let data;
  try { data = JSON.parse(b64urlDecode(payload).toString('utf8')); }
  catch { return { valid: false, reason: 'bad_payload' }; }
  if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return { valid: false, reason: 'expired', data };
  return { valid: true, data };
}

function mintDataRoomToken({ dealCode, contactId, ttlSeconds = DEFAULT_TTL_SECONDS }) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { token: sign({ dc: dealCode, ci: contactId, exp }), expiresAt: exp * 1000 };
}

module.exports = { sign, verify, mintDataRoomToken, DEFAULT_TTL_SECONDS };
