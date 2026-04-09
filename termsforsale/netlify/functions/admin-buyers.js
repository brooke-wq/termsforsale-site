/**
 * Admin Buyers List — GET /.netlify/functions/admin-buyers
 *
 * Returns all GHL contacts that are buyers (Contact Role = Buyer OR
 * tagged with tfs-buyer / buyer-signup / vip-buyer-list) for display on
 * the admin buyer list page. Also returns aggregate counts.
 *
 * Query params:
 *   q      (optional)  substring to filter by name/email/phone
 *   filter (optional)  "all" | "vip" | "buybox" | "active" | "stale"
 *   limit  (optional)  max contacts to return (default 500, hard cap 2000)
 *
 * Headers:
 *   X-Admin-Password: <ADMIN_PASSWORD>
 */

const https = require('https');
const crypto = require('crypto');

const GHL_HOST = 'services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const PAGE_SIZE = 100;
const HARD_CAP = 2000;

// Buyer-identifying tags — any contact with at least one of these is a buyer
const BUYER_TAGS = [
  'tfs buyer', 'tfs-buyer', 'TFS Buyer',
  'buyer-signup', 'buyer signup',
  'VIP Buyer List', 'vip buyer list',
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

// Search GHL contacts that contain ANY of the given tags (OR-joined)
async function searchBuyers(apiKey, locationId, hardLimit) {
  var all = [];
  var seen = new Set();
  var page = 1;

  while (all.length < hardLimit) {
    var res = await ghlRequest('POST', '/contacts/search', apiKey, {
      locationId: locationId,
      page: page,
      pageLimit: PAGE_SIZE,
      filters: [{
        group: 'OR',
        filters: BUYER_TAGS.map(function (t) {
          return { field: 'tags', operator: 'contains', value: [t] };
        })
      }]
    });

    if (res.status < 200 || res.status >= 300) {
      return { contacts: all, error: { status: res.status, detail: res.body } };
    }
    var batch = (res.body && (res.body.contacts || res.body.data)) || [];
    if (!batch.length) break;

    // Dedupe by id across pages
    for (var i = 0; i < batch.length; i++) {
      var c = batch[i];
      if (c && c.id && !seen.has(c.id)) {
        seen.add(c.id);
        all.push(c);
      }
    }

    if (batch.length < PAGE_SIZE) break;
    page++;
    if (page > 50) break; // safety
  }

  return { contacts: all };
}

function hasTag(tags, needle) {
  var n = String(needle || '').toLowerCase();
  for (var i = 0; i < tags.length; i++) {
    if (String(tags[i] || '').toLowerCase() === n) return true;
  }
  return false;
}

function tagsWithPrefix(tags, prefix) {
  return tags.filter(function (t) {
    return String(t || '').toLowerCase().indexOf(prefix.toLowerCase()) === 0;
  });
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
  var q = String(params.q || '').trim().toLowerCase();
  var filter = String(params.filter || 'all').toLowerCase();
  var limit = Math.min(parseInt(params.limit, 10) || 500, HARD_CAP);

  try {
    var result = await searchBuyers(apiKey, locationId, limit);
    var contacts = result.contacts || [];

    // Map to display shape
    var mapped = contacts.map(function (c) {
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
    });

    // Apply text filter
    if (q) {
      mapped = mapped.filter(function (b) {
        return (b.name || '').toLowerCase().indexOf(q) > -1
          || (b.email || '').toLowerCase().indexOf(q) > -1
          || (b.phone || '').indexOf(q) > -1;
      });
    }

    // Apply filter tab
    if (filter === 'vip') {
      mapped = mapped.filter(function (b) { return b.isVip; });
    } else if (filter === 'buybox') {
      mapped = mapped.filter(function (b) { return b.hasBuyBox; });
    } else if (filter === 'nobuybox') {
      mapped = mapped.filter(function (b) { return !b.hasBuyBox; });
    } else if (filter === 'stale') {
      var thirty = Date.now() - 30 * 86400000;
      mapped = mapped.filter(function (b) {
        var t = b.lastActivity ? Date.parse(b.lastActivity) : 0;
        return !t || t < thirty;
      });
    }

    // Sort: newest first by dateAdded
    mapped.sort(function (a, b) {
      var ta = a.dateAdded ? Date.parse(a.dateAdded) : 0;
      var tb = b.dateAdded ? Date.parse(b.dateAdded) : 0;
      return tb - ta;
    });

    // Aggregate counts — use the full, unfiltered list for totals
    var total = contacts.length;
    var vipCount = 0, buyBoxCount = 0, newThisWeek = 0;
    var weekAgo = Date.now() - 7 * 86400000;
    contacts.forEach(function (c) {
      var t = (c.tags || []).map(function (x) { return String(x).toLowerCase(); });
      if (t.indexOf('vip buyer list') > -1 || t.indexOf('vip-buyer') > -1) vipCount++;
      if (t.indexOf('buy box complete') > -1 || t.some(function (x) { return x.indexOf('acq:') === 0; })) buyBoxCount++;
      var added = c.dateAdded ? Date.parse(c.dateAdded) : 0;
      if (added && added > weekAgo) newThisWeek++;
    });

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        ok: true,
        count: mapped.length,
        total: total,
        stats: {
          total: total,
          vip: vipCount,
          hasBuyBox: buyBoxCount,
          newThisWeek: newThisWeek
        },
        contacts: mapped,
        searchError: result.error || undefined
      })
    };
  } catch (err) {
    console.error('[admin-buyers] error:', err.message);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
