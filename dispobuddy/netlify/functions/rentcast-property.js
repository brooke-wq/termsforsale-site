/**
 * Dispo Buddy — RentCast Property Lookup
 * POST /api/rentcast/property
 * Requires X-Admin-Password header.
 *
 * Request body:  { "address": "5500 Grand Lake Dr, San Antonio, TX 78244" }
 * Response:      { arv, rentEstimate, beds, baths, squareFootage, yearBuilt, propertyType, raw }
 *
 * Env vars:
 *   ADMIN_PASSWORD     — gate
 *   RENTCAST_API_KEY   — required (paid API)
 *
 * Notes:
 *   - Single endpoint combines the RentCast /properties + /avm/value + /avm/rent/long-term
 *     calls so the UI only has to hit one endpoint to autofill the form.
 *   - If any one of the three RentCast calls fails, we still return whatever data we
 *     did get. Client handles missing fields gracefully.
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

async function rc(path, key) {
  try {
    var res = await fetch('https://api.rentcast.io/v1' + path, {
      method: 'GET',
      headers: { 'X-Api-Key': key, 'Accept': 'application/json' }
    });
    if (!res.ok) return { error: 'status ' + res.status };
    return await res.json();
  } catch (e) {
    return { error: e.message };
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

  var q = encodeURIComponent(address);

  // Fire all three RentCast calls in parallel. Any failure is captured but doesn't break the response.
  var results = await Promise.all([
    rc('/properties?address=' + q, key),
    rc('/avm/value?address=' + q, key),
    rc('/avm/rent/long-term?address=' + q, key)
  ]);
  var prop = results[0];
  var value = results[1];
  var rent = results[2];

  // Properties endpoint returns an array; pick the first match.
  var p = Array.isArray(prop) ? prop[0] : (prop && prop.properties ? prop.properties[0] : null);

  var out = {
    arv: (value && value.price) || (p && p.lastSalePrice) || null,
    rentEstimate: (rent && rent.rent) || null,
    beds: p ? p.bedrooms : null,
    baths: p ? p.bathrooms : null,
    squareFootage: p ? p.squareFootage : null,
    yearBuilt: p ? p.yearBuilt : null,
    propertyType: p ? p.propertyType : null,
    county: p ? p.county : null,
    city: p ? p.city : null,
    state: p ? p.state : null,
    zip: p ? p.zipCode : null,
    // Confidence ranges from the AVM endpoints, if returned
    valueRangeLow: value ? value.priceRangeLow : null,
    valueRangeHigh: value ? value.priceRangeHigh : null,
    rentRangeLow: rent ? rent.rentRangeLow : null,
    rentRangeHigh: rent ? rent.rentRangeHigh : null,
    // Pass through any errors from individual calls for debugging
    errors: {
      property: prop && prop.error ? prop.error : null,
      value: value && value.error ? value.error : null,
      rent: rent && rent.error ? rent.error : null
    }
  };

  return { statusCode: 200, headers: headers, body: JSON.stringify(out) };
};
