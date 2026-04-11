/**
 * Deal Buyer List — GET /.netlify/functions/deal-buyer-list?deal=123-main-st-mesa-az&code=PHX-001
 *
 * Returns all GHL contacts who were sent a specific deal (have tag
 * sent:[deal-slug]), enriched with their acq:* / mkt:* tags and a
 * per-deal response status derived from the real tags actually written
 * by the rest of the system. Sorted hot → interested → no-response → passed.
 *
 * Query params:
 *   deal=<deal-slug>  (required)  The slugified deal address
 *   code=<deal-code>  (optional)  The Notion Deal ID (e.g. PHX-001). When
 *                                 provided, per-deal `alert-[code]` and
 *                                 `viewed-[code]` tags are read to
 *                                 populate Hot / Interested status.
 *                                 Without it, only global response tags
 *                                 are considered (loose, not per-deal).
 *
 * Tag → status mapping (strongest signal wins):
 *   alert-[code]          → deal:hot          (per-deal explicit INTERESTED reply)
 *   viewed-[code]         → deal:interested   (per-deal click-through engagement)
 *   global buyer-interested → deal:interested (global — loose fallback)
 *   global buyer-maybe      → deal:interested (global — loose fallback)
 *   global buyer-pass       → deal:passed     (global — loose fallback)
 *   (legacy deal:hot/deal:interested/deal:passed/deal:no-response tags
 *    are also honored for forward compatibility)
 *
 * ENV VARS: GHL_API_KEY, GHL_LOCATION_ID_TERMS (or GHL_LOCATION_ID)
 */

const https = require('https');
const crypto = require('crypto');

const GHL_HOST = 'services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// Output status key → sort priority (lower = earlier). These are the
// normalized values the frontend (admin/deals.html drawer + admin/deal-buyers.html)
// switches on — the UI already maps them to Hot / Interested / etc.
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

/**
 * Compute the per-deal response status for a contact by inspecting
 * their actual tags. Returns one of the STATUS_PRIORITY keys or null
 * (null means "no response signal at all" — the UI shows "Not responded").
 *
 * Strongest signal wins. Per-deal signals (alert-[code], viewed-[code])
 * always outrank global ones (buyer-interested, buyer-pass, …) so a
 * buyer who said PASS on some other deal last week but clicked on this
 * specific deal is still shown as Interested.
 *
 * @param {string[]} tags        All tags on the contact (any case).
 * @param {string}   dealCodeRaw Notion Deal Code for THIS deal, e.g. "PHX-001".
 *                               Pass "" when the caller doesn't know the
 *                               code (we'll fall back to global signals only).
 */
function computeDealStatus(tags, dealCodeRaw) {
  if (!Array.isArray(tags) || tags.length === 0) return null;

  // Normalize once — GHL lowercases tags on save, so we compare lowercase.
  var lowered = tags.map(function (t) { return String(t || '').toLowerCase(); });
  var set = Object.create(null);
  for (var i = 0; i < lowered.length; i++) set[lowered[i]] = true;

  var code = String(dealCodeRaw || '').toLowerCase().trim();

  // ── 1. Legacy explicit deal:* tags (if anything still writes them) ──
  // Listed first so a hand-applied deal:hot tag always wins.
  if (set['deal:hot'])         return 'deal:hot';
  if (set['deal:interested'])  return 'deal:interested';
  if (set['deal:passed'])      return 'deal:passed';

  // ── 2. Per-deal signals (only when we know the deal code) ──
  if (code) {
    // alert-[code] is written by buyer-alert.js when the buyer replies
    // INTERESTED to a blast. Strongest "hot" signal we have per-deal.
    if (set['alert-' + code]) return 'deal:hot';
    // viewed-[code] is written by deal-view-tracker.js when a logged-in
    // buyer loads the deal page (from SMS/email click or the dashboard).
    // Solid "interested" signal — they clicked through.
    if (set['viewed-' + code]) return 'deal:interested';
  }

  // ── 3. Global response tags (loose fallback — NOT per-deal) ──
  // These come from buyer-response-tag.js which writes one of these any
  // time a buyer replies 1/2/3/IN/MAYBE/PASS/etc to ANY deal blast SMS.
  // They get overwritten on every new reply, so they represent the
  // buyer's most recent reply overall — which for a recent deal blast
  // is usually (but not guaranteed to be) this deal.
  if (set['buyer-interested']) return 'deal:interested';
  if (set['buyer-maybe'])      return 'deal:interested';
  if (set['buyer-pass'])       return 'deal:passed';

  // ── 4. Legacy explicit no-response tag ──
  if (set['deal:no-response']) return 'deal:no-response';

  // No signal at all — UI will show "Not responded"
  return null;
}

/** Filter tags with a given prefix, e.g. "acq:" or "mkt:". */
function tagsWithPrefix(tags, prefix) {
  return tags.filter(function(t) { return String(t || '').indexOf(prefix) === 0; });
}

/**
 * Extract match tier (1|2|3|null) from a contact's tags for a specific deal slug.
 * Tier tags are written by notify-buyers.js at blast time as `tier1:[slug]`,
 * `tier2:[slug]`, `tier3:[slug]`. Historical blasts (before tier tagging was
 * added) won't have any tier tag → returns null.
 *
 *   tier 1 = strict buy-box match (≥ 2 criteria)
 *   tier 2 = relaxed match (≥ 1 criterion) — only if tier 1 < 50 buyers
 *   tier 3 = state-only fallback — only if tier 1 + 2 < 50 buyers
 */
function findTierForDeal(tags, dealSlug) {
  for (var i = 0; i < tags.length; i++) {
    var t = String(tags[i] || '').toLowerCase();
    if (t === 'tier1:' + dealSlug) return 1;
    if (t === 'tier2:' + dealSlug) return 2;
    if (t === 'tier3:' + dealSlug) return 3;
  }
  return null;
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
  var dealCode = params.code || '';
  if (!dealSlug) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'deal query param is required' }) };
  }

  var searchTag = 'sent:' + dealSlug;

  try {
    console.log('[deal-buyer-list] searching for contacts tagged "' + searchTag + '"' + (dealCode ? ' (code=' + dealCode + ')' : ''));
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
        dealStatus: computeDealStatus(tags, dealCode),  // may be null if no signal
        tier: findTierForDeal(tags, dealSlug)  // 1|2|3|null — null for historical blasts
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
        dealCode: dealCode || null,
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
