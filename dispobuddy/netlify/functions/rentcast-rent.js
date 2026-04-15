/**
 * Dispo Buddy — RentCast Rent Estimate
 * POST /api/rentcast/rent
 * Requires X-Admin-Password header.
 *
 * Request body:  { "address": "5500 Grand Lake Dr, San Antonio, TX 78244" }
 * Response:      { rent, rentRangeLow, rentRangeHigh, comparables }
 *
 * Thin wrapper — the property endpoint already fetches rent, but this is
 * kept as a separate route for callers that only need rent.
 */

const crypto = require('crypto');

function verifyAdmin(event) {
  var expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { ok: false, reason: 'ADMIN_PASSWORD not configured' };
  var provided = (event.headers && (event.headers['x-admin-password'] || event.headers['X-Admin-Password'])) || '';
  if (!provided) return { ok: false, reason: 'Password required' };
  if (typeof provided !== 'string' || provided.length !== expected.length) {
    return { ok: false, reason: 'Invalid password' };
  }
  try {
    var eq = crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    return eq ? { ok: true } : { ok: false, reason: 'Invalid password' };
  } catch (e) {
    return { ok: false, reason: 'Invalid password' };
  }
}

exports.handler = async function (event) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: headers, body: JSON.stringify({ error: 'POST only' }) };

  var auth = verifyAdmin(event);
  if (!auth.ok) return { statusCode: 401, headers: headers, body: JSON.stringify({ error: auth.reason }) };

  var key = process.env.RENTCAST_API_KEY;
  if (!key) return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'RENTCAST_API_KEY not configured' }) };

  var body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
  var address = String(body.address || '').trim();
  if (!address) return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'address required' }) };

  try {
    var res = await fetch('https://api.rentcast.io/v1/avm/rent/long-term?address=' + encodeURIComponent(address), {
      headers: { 'X-Api-Key': key, 'Accept': 'application/json' }
    });
    if (!res.ok) {
      return { statusCode: res.status, headers: headers, body: JSON.stringify({ error: 'RentCast ' + res.status }) };
    }
    var data = await res.json();
    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        rent: data.rent || null,
        rentRangeLow: data.rentRangeLow || null,
        rentRangeHigh: data.rentRangeHigh || null,
        comparables: data.comparables || []
      })
    };
  } catch (e) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: e.message }) };
  }
};
