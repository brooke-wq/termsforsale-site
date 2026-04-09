/**
 * Deal Buyer List — GET /.netlify/functions/deal-buyer-list?deal=123-main-st-mesa-az
 *
 * Returns all GHL contacts who were sent a specific deal (have tag
 * sent:[deal-slug]), enriched with their acq:*, mkt:*, and deal:* tags
 * and sorted by response status: hot → interested → no-response → passed.
 *
 * Query params:
 *   deal=<deal-slug>  (required)  The slugified deal address
 *
 * ENV VARS: GHL_API_KEY, GHL_LOCATION_ID_TERMS (or GHL_LOCATION_ID)
 */

const https = require('https');
const crypto = require('crypto');

const GHL_HOST = 'services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// Response-status tag → sort priority (lower = earlier)
const STATUS_PRIORITY = {
  'deal:hot': 0,
  'deal:interested': 1,
  'deal:no-response': 2,
  'deal:passed': 3
};

/**
 * Constant-time password comparison to avoid timing attacks.
 * Accepts password from X-Admin-Password header or ?password= query param.
 */
function verifyAdminPassword(event) {
  var expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { ok: false, reason: 'ADMIN_PASSWORD not configured' };

  var provided = (event.headers && (event.headers['x-admin-password'] || event.headers['X-Admin-Password']))
    || (event.queryStringParameters && event.queryStringParameters.password)
    || '';

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

// ─── Helpers ───────────────────────────────────────────────────

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
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Search GHL contacts that have a specific tag.
 * Uses POST /contacts/search with a tag filter. Paginates up to 2000.
 */
async function searchContactsByTag(apiKey, locationId, tag) {
  var all = [];
  var page = 1;
  var hasMore = true;
  var PAGE_SIZE = 100;
  var SAFETY_LIMIT = 2000;  // hard cap to prevent runaway

  while (hasMore && all.length < SAFETY_LIMIT) {
    var res = await ghlRequest('POST', '/contacts/search', apiKey, {
      locationId: locationId,
      page: page,
      pageLimit: PAGE_SIZE,
      filters: [{
        group: 'AND',
        filters: [{
          field: 'tags',
          operator: 'contains',
          value: [tag]
        }]
      }]
    });

    console.log('[deal-buyer-list] search page=' + page + ' status=' + res.status);

    if (res.status < 200 || res.status >= 300) {
      // Bail gracefully — return what we have + the error for the caller
      return { contacts: all, error: { status: res.status, detail: res.body } };
    }

    var batch = (res.body && (res.body.contacts || res.body.data)) || [];
    all = all.concat(batch);

    // Don't trust meta.total — GHL returns page size, not total count.
    // Only stop when a batch returns less than PAGE_SIZE (reliable end signal).
    if (batch.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return { contacts: all };
}

/** Extract current deal:* status tag from a contact's tag list (first match wins). */
function findStatusTag(tags) {
  for (var i = 0; i < tags.length; i++) {
    if (STATUS_PRIORITY.hasOwnProperty(tags[i])) return tags[i];
  }
  return null;
}

/** Filter tags with a given prefix, e.g. "acq:" or "mkt:". */
function tagsWithPrefix(tags, prefix) {
  return tags.filter(function(t) { return String(t || '').indexOf(prefix) === 0; });
}

// ─── Handler ───────────────────────────────────────────────────

exports.handler = async function(event) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: headers, body: JSON.stringify({ error: 'GET only' }) };
  }

  // Require admin password — this endpoint exposes contact PII
  var auth = verifyAdminPassword(event);
  if (!auth.ok) {
    return { statusCode: 401, headers: headers, body: JSON.stringify({ error: auth.reason || 'Unauthorized' }) };
  }

  var apiKey = process.env.GHL_API_KEY;
  var locationId = process.env.GHL_LOCATION_ID_TERMS || process.env.GHL_LOCATION_ID;

  if (!apiKey) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'GHL_API_KEY not configured' }) };
  }
  if (!locationId) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'GHL_LOCATION_ID_TERMS not configured' }) };
  }

  var params = event.queryStringParameters || {};
  var dealSlug = params.deal || '';
  if (!dealSlug) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'deal query param is required' }) };
  }

  var searchTag = 'sent:' + dealSlug;

  try {
    console.log('[deal-buyer-list] searching for contacts tagged "' + searchTag + '"');
    var result = await searchContactsByTag(apiKey, locationId, searchTag);
    var contacts = result.contacts || [];

    // Map each contact to the shape requested, pulling relevant tag subsets
    var mapped = contacts.map(function(c) {
      var tags = c.tags || [];
      return {
        id: c.id,
        name: ((c.firstName || '') + ' ' + (c.lastName || '')).trim() || c.contactName || '',
        phone: c.phone || '',
        email: c.email || '',
        acqTags: tagsWithPrefix(tags, 'acq:'),
        mktTags: tagsWithPrefix(tags, 'mkt:'),
        dealStatus: findStatusTag(tags)   // may be null if they haven't responded yet
      };
    });

    // Sort by status priority: hot (0) → interested (1) → no-response (2) → passed (3).
    // Contacts with no status tag land at priority 99 (below all known statuses).
    mapped.sort(function(a, b) {
      var pa = a.dealStatus ? STATUS_PRIORITY[a.dealStatus] : 99;
      var pb = b.dealStatus ? STATUS_PRIORITY[b.dealStatus] : 99;
      return pa - pb;
    });

    console.log('[deal-buyer-list] returning ' + mapped.length + ' contacts for ' + searchTag);

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        ok: true,
        dealSlug: dealSlug,
        tag: searchTag,
        count: mapped.length,
        contacts: mapped,
        searchError: result.error || undefined
      })
    };

  } catch (err) {
    console.error('[deal-buyer-list] error:', err.message);
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
