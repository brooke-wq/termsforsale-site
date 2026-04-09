/**
 * Admin Buyers — GET /.netlify/functions/admin-buyers
 *
 * Paginated, server-side search of GHL contacts that are tagged as buyers.
 * Designed to handle 10,000+ buyer databases without shipping the whole
 * list to the browser.
 *
 * Query params:
 *   page       (default 1)   1-based page number
 *   pageLimit  (default 100) max 100 per page
 *   q          substring match against firstName / lastName / email / phone
 *   filter     "all" | "vip" | "buybox" | "nobuybox"
 *   stats      "1" to include aggregate stats block (total / vip / buy box)
 *              Default: stats are only returned on page=1 with no filter/q
 *
 * Response:
 *   {
 *     ok: true,
 *     page: 1,
 *     pageLimit: 100,
 *     count: 100,           // contacts in this page
 *     total: 12543,         // total matching contacts across all pages
 *     hasMore: true,        // more pages available
 *     contacts: [...],      // just this page, same shape as before
 *     stats: {              // OPTIONAL — only when stats=1 or page=1 && !filter && !q
 *       total, vip, hasBuyBox
 *     }
 *   }
 *
 * Headers: X-Admin-Password: <ADMIN_PASSWORD>
 */

const https = require('https');
const crypto = require('crypto');

const GHL_HOST = 'services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const MAX_PAGE_LIMIT = 100;

// Tags any buyer may have. Contacts matching ANY of these are treated as buyers.
const BUYER_TAGS = [
  'tfs buyer', 'tfs-buyer',
  'buyer-signup', 'buyer signup',
  'VIP Buyer List',
  'buy box complete',
  'use:buyer'
];

function verifyAdmin(event) {
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

function ghlRequest(method, path, apiKey, body) {
  return new Promise(function (resolve, reject) {
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
    var req = https.request(opts, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
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

// Build the GHL filters array for a buyer search.
// Contacts must have at least one buyer tag AND optionally match
// the additional tag filter (vip / buybox) AND optionally match the search.
function buildFilters(opts) {
  var filters = [];

  // Base: must have ANY buyer tag
  filters.push({
    group: 'OR',
    filters: BUYER_TAGS.map(function (t) {
      return { field: 'tags', operator: 'contains', value: [t] };
    })
  });

  // Extra tag filter (VIP / Buy Box)
  if (opts.filter === 'vip') {
    filters.push({
      group: 'OR',
      filters: [
        { field: 'tags', operator: 'contains', value: ['VIP Buyer List'] },
        { field: 'tags', operator: 'contains', value: ['vip-buyer'] }
      ]
    });
  } else if (opts.filter === 'buybox') {
    filters.push({
      group: 'AND',
      filters: [{ field: 'tags', operator: 'contains', value: ['buy box complete'] }]
    });
  }
  // nobuybox filter can't be expressed server-side (GHL doesn't support NOT contains).
  // For that case we fall back to client-side filtering of the returned page.

  // Search query — matches name or email contains
  if (opts.q) {
    filters.push({
      group: 'OR',
      filters: [
        { field: 'firstNameLowerCase', operator: 'contains', value: opts.q.toLowerCase() },
        { field: 'lastNameLowerCase', operator: 'contains', value: opts.q.toLowerCase() },
        { field: 'email', operator: 'contains', value: opts.q.toLowerCase() },
        { field: 'phone', operator: 'contains', value: opts.q }
      ]
    });
  }

  return filters;
}

function ghlSearch(apiKey, locationId, page, pageLimit, filterOpts) {
  return ghlRequest('POST', '/contacts/search', apiKey, {
    locationId: locationId,
    page: page,
    pageLimit: pageLimit,
    filters: buildFilters(filterOpts)
  });
}

// Cheap "count only" query — page 1 limit 1 just to read meta.total
function ghlCount(apiKey, locationId, filterOpts) {
  return ghlRequest('POST', '/contacts/search', apiKey, {
    locationId: locationId,
    page: 1,
    pageLimit: 1,
    filters: buildFilters(filterOpts)
  }).then(function (res) {
    if (res.status < 200 || res.status >= 300) return 0;
    var meta = res.body && res.body.meta;
    var total = (meta && meta.total) || res.body.total || 0;
    return total;
  }).catch(function () { return 0; });
}

function tagsWithPrefix(tags, prefix) {
  return tags.filter(function (t) {
    return String(t || '').toLowerCase().indexOf(prefix.toLowerCase()) === 0;
  });
}

function mapContact(c) {
  var tags = (c.tags || []).map(function (t) { return String(t); });
  var lowerTags = tags.map(function (t) { return t.toLowerCase(); });
  return {
    id: c.id,
    name: ((c.firstName || '') + ' ' + (c.lastName || '')).trim() || c.contactName || '',
    firstName: c.firstName || '',
    lastName: c.lastName || '',
    email: c.email || '',
    phone: c.phone || '',
    dateAdded: c.dateAdded || c.createdAt || '',
    lastActivity: c.lastActivity || c.updatedAt || '',
    tags: tags,
    isVip: lowerTags.indexOf('vip buyer list') > -1 || lowerTags.indexOf('vip-buyer') > -1,
    hasBuyBox: lowerTags.indexOf('buy box complete') > -1 || tagsWithPrefix(tags, 'acq:').length > 0,
    isLegacy: lowerTags.indexOf('legacy-user') > -1,
    markets: tagsWithPrefix(tags, 'mkt:').map(function (t) { return t.replace(/^mkt:/i, ''); }),
    strategies: tagsWithPrefix(tags, 'acq:').map(function (t) { return t.replace(/^acq:/i, ''); })
  };
}

exports.handler = async function (event) {
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

  var auth = verifyAdmin(event);
  if (!auth.ok) {
    return { statusCode: 401, headers: headers, body: JSON.stringify({ error: auth.reason || 'Unauthorized' }) };
  }

  var apiKey = process.env.GHL_API_KEY;
  var locationId = process.env.GHL_LOCATION_ID_TERMS || process.env.GHL_LOCATION_ID;
  if (!apiKey) return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'GHL_API_KEY not configured' }) };
  if (!locationId) return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'GHL_LOCATION_ID not configured' }) };

  var params = event.queryStringParameters || {};
  var page = Math.max(1, parseInt(params.page, 10) || 1);
  var pageLimit = Math.min(MAX_PAGE_LIMIT, Math.max(1, parseInt(params.pageLimit, 10) || 100));
  var q = String(params.q || '').trim();
  var filter = String(params.filter || 'all').toLowerCase();
  var includeStats = params.stats === '1' || (page === 1 && !q && (filter === 'all' || filter === 'nobuybox'));

  try {
    // ─ Main page fetch ─
    var res = await ghlSearch(apiKey, locationId, page, pageLimit, { filter: filter, q: q });
    if (res.status < 200 || res.status >= 300) {
      return {
        statusCode: 500,
        headers: headers,
        body: JSON.stringify({ error: 'GHL search failed', status: res.status, detail: res.body })
      };
    }

    var rawContacts = (res.body && (res.body.contacts || res.body.data)) || [];
    var mapped = rawContacts.map(mapContact);

    // Client-side nobuybox filter (GHL doesn't support NOT contains)
    if (filter === 'nobuybox') {
      mapped = mapped.filter(function (b) { return !b.hasBuyBox; });
    }

    var meta = res.body && res.body.meta;
    var total = (meta && meta.total) || res.body.total || mapped.length;
    var hasMore = rawContacts.length === pageLimit;

    var out = {
      ok: true,
      page: page,
      pageLimit: pageLimit,
      count: mapped.length,
      total: total,
      hasMore: hasMore,
      contacts: mapped
    };

    // ─ Aggregate stats (cheap first-page count queries in parallel) ─
    if (includeStats) {
      var statPromises = [
        ghlCount(apiKey, locationId, { filter: 'all' }),
        ghlCount(apiKey, locationId, { filter: 'vip' }),
        ghlCount(apiKey, locationId, { filter: 'buybox' })
      ];
      var statResults = await Promise.all(statPromises);
      out.stats = {
        total: statResults[0],
        vip: statResults[1],
        hasBuyBox: statResults[2],
        newThisWeek: 0  // computed below if we can
      };

      // New this week: scan the current page (usually sorted newest first)
      // and count anyone added in the last 7 days. This is a rough approximation.
      var weekAgo = Date.now() - 7 * 86400000;
      var nw = 0;
      mapped.forEach(function (b) {
        var t = b.dateAdded ? Date.parse(b.dateAdded) : 0;
        if (t && t > weekAgo) nw++;
      });
      out.stats.newThisWeek = nw;
    }

    return { statusCode: 200, headers: headers, body: JSON.stringify(out) };
  } catch (err) {
    console.error('[admin-buyers] error:', err.message);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
