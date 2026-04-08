/**
 * Tag Blast Sent — POST /.netlify/functions/tag-blast-sent
 *
 * When a deal blast fires, tag every buyer who was sent the deal with
 * a permanent audit trail tag: sent:[deal-address-slug]
 *
 * Request body:
 *   {
 *     "dealAddress": "123 Main St Mesa AZ",
 *     "buyerContactIds": ["contactId1", "contactId2", ...]
 *   }
 *
 * ENV VARS:
 *   GHL_API_KEY              — GHL private integration API key
 *   GHL_LOCATION_ID_TERMS    — Terms For Sale sub-account location ID
 *                              (falls back to GHL_LOCATION_ID if not set)
 */

const https = require('https');

const GHL_HOST = 'services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Convert "123 Main St Mesa AZ" → "123-main-st-mesa-az"
 * Lowercase, remove commas, collapse whitespace, hyphenate spaces.
 */
function slugifyAddress(addr) {
  return String(addr || '')
    .toLowerCase()
    .replace(/,/g, '')                  // drop commas
    .replace(/[^a-z0-9\s-]/g, '')        // drop anything else that's not alnum/space/hyphen
    .trim()
    .replace(/\s+/g, '-')                // spaces → hyphens
    .replace(/-+/g, '-');                // collapse runs of hyphens
}

/**
 * Make a raw HTTPS request to GHL. Returns { status, body }.
 * Using native https (no external packages) per project rules.
 */
function ghlRequest(method, path, apiKey, body) {
  return new Promise(function(resolve, reject) {
    var opts = {
      hostname: GHL_HOST,
      path: path,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Version': GHL_VERSION,
        'Content-Type': 'application/json'
      }
    };
    var req = https.request(opts, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        var parsed;
        try { parsed = JSON.parse(data); }
        catch (e) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Add a tag to a GHL contact WITHOUT removing other tags.
 * POST /contacts/{contactId}/tags appends — does not replace.
 */
async function addTagToContact(apiKey, contactId, tag) {
  return ghlRequest('POST', '/contacts/' + contactId + '/tags', apiKey, {
    tags: [tag]
  });
}

// ─── Handler ───────────────────────────────────────────────────

exports.handler = async function(event) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  // Env vars
  var apiKey = process.env.GHL_API_KEY;
  var locationId = process.env.GHL_LOCATION_ID_TERMS || process.env.GHL_LOCATION_ID;

  if (!apiKey) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'GHL_API_KEY not configured' }) };
  }

  // Parse body
  var body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  var dealAddress = body.dealAddress || '';
  var buyerContactIds = body.buyerContactIds || [];

  if (!dealAddress) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'dealAddress is required' }) };
  }
  if (!Array.isArray(buyerContactIds) || buyerContactIds.length === 0) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'buyerContactIds must be a non-empty array' }) };
  }

  // Build the tag once
  var slug = slugifyAddress(dealAddress);
  var tag = 'sent:' + slug;

  console.log('[tag-blast-sent] tagging ' + buyerContactIds.length + ' buyers with "' + tag + '"');

  // Iterate and tag each buyer. Each contact is independent —
  // a single failure should NOT abort the batch. Per-contact try/catch.
  var succeeded = 0;
  var failed = 0;
  var failures = [];

  for (var i = 0; i < buyerContactIds.length; i++) {
    var contactId = buyerContactIds[i];
    if (!contactId) { failed++; continue; }

    try {
      var res = await addTagToContact(apiKey, contactId, tag);
      console.log('[tag-blast-sent] ' + contactId + ' → ' + res.status);

      if (res.status >= 200 && res.status < 300) {
        succeeded++;
      } else {
        failed++;
        failures.push({
          contactId: contactId,
          status: res.status,
          error: (res.body && res.body.message) || String(res.body).substring(0, 200)
        });
      }
    } catch (err) {
      console.error('[tag-blast-sent] error tagging ' + contactId + ':', err.message);
      failed++;
      failures.push({ contactId: contactId, error: err.message });
    }
  }

  console.log('[tag-blast-sent] done — succeeded=' + succeeded + ' failed=' + failed);

  return {
    statusCode: 200,
    headers: headers,
    body: JSON.stringify({
      ok: true,
      dealAddress: dealAddress,
      tag: tag,
      total: buyerContactIds.length,
      succeeded: succeeded,
      failed: failed,
      failures: failures
    })
  };
};
