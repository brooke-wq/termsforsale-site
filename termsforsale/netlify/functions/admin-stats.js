/**
 * Admin Stats — GET /.netlify/functions/admin-stats
 *
 * Returns summary counters for the admin dashboard:
 *   - activeDeals       (count of deals in Notion with status "Actively Marketing")
 *   - totalDeals        (count of all deals in Notion)
 *   - closedDeals       (count of deals with status "Closed")
 *   - totalBuyers       (estimate — uses /contacts/search with buyer tag filter, first page only)
 *   - vipBuyers         (subset tagged VIP)
 *   - dealsByType       (breakdown of active deals by deal type)
 *   - dealsByState      (breakdown of active deals by state)
 *
 * Headers:
 *   X-Admin-Password: <ADMIN_PASSWORD>
 */

const https = require('https');
const crypto = require('crypto');

const GHL_HOST = 'services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

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

function httpsRequest(opts, body) {
  return new Promise(function (resolve, reject) {
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
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function notionQuery(dbId, token, filter) {
  var body = { page_size: 100 };
  if (filter) body.filter = filter;
  return httpsRequest({
    hostname: 'api.notion.com',
    path: '/v1/databases/' + dbId + '/query',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    }
  }, body);
}

async function notionPaginate(dbId, token, filter) {
  var all = [];
  var cursor = undefined;
  var pages = 0;
  while (pages < 20) {
    var body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;
    var res = await httpsRequest({
      hostname: 'api.notion.com',
      path: '/v1/databases/' + dbId + '/query',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    }, body);
    if (res.status !== 200) return { error: res.body, pages: all };
    all = all.concat(res.body.results || []);
    if (!res.body.has_more) break;
    cursor = res.body.next_cursor;
    pages++;
  }
  return { pages: all };
}

function prop(page, name) {
  var p = page.properties && page.properties[name];
  if (!p) return '';
  switch (p.type) {
    case 'title':      return (p.title || []).map(function (t) { return t.plain_text; }).join('');
    case 'rich_text':  return (p.rich_text || []).map(function (t) { return t.plain_text; }).join('');
    case 'select':     return p.select ? p.select.name : '';
    case 'status':     return p.status ? p.status.name : '';
    case 'number':     return p.number;
    default:           return '';
  }
}

async function ghlCount(apiKey, locationId, tag) {
  // Query first page only to get a quick count hint. GHL /contacts/search returns
  // only page data, not totals, so we just read the first page to sanity-check.
  var res = await httpsRequest({
    hostname: GHL_HOST,
    path: '/contacts/search',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Version': GHL_VERSION,
      'Content-Type': 'application/json'
    }
  }, {
    locationId: locationId,
    page: 1,
    pageLimit: 100,
    filters: [{
      group: 'AND',
      filters: [{ field: 'tags', operator: 'contains', value: [tag] }]
    }]
  });
  if (res.status < 200 || res.status >= 300) return { count: 0, error: res.body };
  var list = (res.body && (res.body.contacts || res.body.data)) || [];
  // Return meta.total if provided, else first-page length as a floor.
  var total = (res.body && res.body.meta && res.body.meta.total)
    || (res.body && res.body.total)
    || list.length;
  return { count: total, firstPage: list.length };
}

exports.handler = async function (event) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: headers, body: '' };

  var auth = verifyAdmin(event);
  if (!auth.ok) return { statusCode: 401, headers: headers, body: JSON.stringify({ error: auth.reason }) };

  var notionToken = process.env.NOTION_TOKEN;
  var dbId = process.env.NOTION_DB_ID || process.env.NOTION_DATABASE_ID || 'a3c0a38fd9294d758dedabab2548ff29';
  var ghlKey = process.env.GHL_API_KEY;
  var locationId = process.env.GHL_LOCATION_ID_TERMS || process.env.GHL_LOCATION_ID;

  var out = {
    activeDeals: 0,
    totalDeals: 0,
    closedDeals: 0,
    dealsByType: {},
    dealsByState: {},
    totalBuyers: 0,
    vipBuyers: 0,
    newBuyersThisWeek: 0,
    recentDeals: [],
    errors: []
  };

  // ─ Notion deals ─
  if (notionToken) {
    try {
      var active = await notionPaginate(dbId, notionToken, {
        property: 'Deal Status',
        status: { equals: 'Actively Marketing' }
      });
      if (active.error) {
        // Retry with select filter (older Notion DBs)
        active = await notionPaginate(dbId, notionToken, {
          property: 'Deal Status',
          select: { equals: 'Actively Marketing' }
        });
      }
      var activePages = active.pages || [];
      out.activeDeals = activePages.length;

      // Breakdown by type + state
      activePages.forEach(function (p) {
        var type = prop(p, 'Deal Type') || 'Unknown';
        var state = prop(p, 'State') || 'Unknown';
        out.dealsByType[type] = (out.dealsByType[type] || 0) + 1;
        out.dealsByState[state] = (out.dealsByState[state] || 0) + 1;
      });

      // Recent deals (first 5 of the active list — already sorted newest on the Notion side)
      out.recentDeals = activePages.slice(0, 5).map(function (p) {
        return {
          id: p.id,
          dealCode: prop(p, 'Deal ID'),
          city: prop(p, 'City'),
          state: prop(p, 'State'),
          dealType: prop(p, 'Deal Type'),
          price: prop(p, 'Asking Price'),
          lastEdited: p.last_edited_time
        };
      });

      // Closed deals
      var closed = await notionPaginate(dbId, notionToken, {
        property: 'Deal Status',
        status: { equals: 'Closed' }
      });
      if (!closed.error) out.closedDeals = (closed.pages || []).length;
    } catch (e) {
      out.errors.push('notion: ' + e.message);
    }
  } else {
    out.errors.push('notion: NOTION_TOKEN not set');
  }

  // ─ GHL buyer counts (cheap — first page only) ─
  if (ghlKey && locationId) {
    try {
      var allBuyers = await ghlCount(ghlKey, locationId, 'tfs buyer');
      out.totalBuyers = allBuyers.count || 0;
      var vip = await ghlCount(ghlKey, locationId, 'VIP Buyer List');
      out.vipBuyers = vip.count || 0;
    } catch (e) {
      out.errors.push('ghl: ' + e.message);
    }
  } else {
    out.errors.push('ghl: credentials missing');
  }

  return { statusCode: 200, headers: headers, body: JSON.stringify(out) };
};
