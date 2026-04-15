/**
 * Dispo Buddy — Admin Stats
 * GET /api/admin-stats
 * Requires X-Admin-Password header.
 *
 * Returns dashboard counters scoped to JV deals (deals submitted via
 * Dispo Buddy that have a JV Partner value set in Notion):
 *   - activeDeals / underContract / fundedDeals / totalDeals
 *   - dealsByType / dealsByStatus / dealsByState
 *   - recentDeals (5 newest)
 *   - totalPartners / activePartnersWithDeals
 *   - errors[]
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

async function notionPaginate(dbId, token, filter) {
  var all = [];
  var cursor = undefined;
  var pages = 0;
  while (pages < 20) {
    var body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;
    var res = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) return { error: await res.text().catch(function () { return ''; }), pages: all };
    var data = await res.json();
    all = all.concat(data.results || []);
    if (!data.has_more) break;
    cursor = data.next_cursor;
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
    case 'date':       return p.date ? p.date.start : '';
    default:           return '';
  }
}

async function ghlTagCount(apiKey, locationId, tag) {
  try {
    var res = await fetch('https://services.leadconnectorhq.com/contacts/search', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        locationId: locationId,
        page: 1,
        pageLimit: 1,
        filters: [{
          group: 'AND',
          filters: [{ field: 'tags', operator: 'contains', value: [tag] }]
        }]
      })
    });
    if (!res.ok) return 0;
    var data = await res.json();
    return (data && data.meta && data.meta.total) || (data && data.total) || 0;
  } catch (e) {
    return 0;
  }
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
  var locationId = process.env.GHL_LOCATION_ID;

  var out = {
    activeDeals: 0,
    underContract: 0,
    fundedDeals: 0,
    totalDeals: 0,
    dealsByType: {},
    dealsByStatus: {},
    dealsByState: {},
    recentDeals: [],
    totalPartners: 0,
    activePartnersWithDeals: 0,
    errors: []
  };

  if (notionToken) {
    try {
      // Scope to Dispo Buddy deals: anything with a JV Partner value set.
      var all = await notionPaginate(dbId, notionToken, {
        property: 'JV Partner',
        rich_text: { is_not_empty: true }
      });
      if (all.error) {
        // Fall back to all deals if filter fails (older schema)
        all = await notionPaginate(dbId, notionToken, null);
      }
      var pages = all.pages || [];
      out.totalDeals = pages.length;

      var partnerNames = {};
      pages.forEach(function (p) {
        var status = prop(p, 'Deal Status') || 'Unknown';
        var type = prop(p, 'Deal Type') || 'Unknown';
        var state = prop(p, 'State') || 'Unknown';
        var jv = prop(p, 'JV Partner') || '';
        out.dealsByStatus[status] = (out.dealsByStatus[status] || 0) + 1;
        out.dealsByType[type] = (out.dealsByType[type] || 0) + 1;
        out.dealsByState[state] = (out.dealsByState[state] || 0) + 1;
        if (status === 'Actively Marketing' || status === 'New Submission' || status === 'Under Review') out.activeDeals++;
        if (status === 'Under Contract' || status === 'Assignment Sent' || status === 'Assigned with EMD') out.underContract++;
        if (status === 'Closed' || status === 'Funded') out.fundedDeals++;
        if (jv) partnerNames[jv.split('|')[0].trim()] = true;
      });
      out.activePartnersWithDeals = Object.keys(partnerNames).length;

      // Recent 5 by last edited
      pages.sort(function (a, b) { return (b.last_edited_time || '').localeCompare(a.last_edited_time || ''); });
      out.recentDeals = pages.slice(0, 5).map(function (p) {
        return {
          id: p.id,
          dealCode: prop(p, 'Deal ID'),
          street: prop(p, 'Street Address'),
          city: prop(p, 'City'),
          state: prop(p, 'State'),
          dealType: prop(p, 'Deal Type'),
          status: prop(p, 'Deal Status'),
          price: prop(p, 'Asking Price'),
          jvPartner: prop(p, 'JV Partner'),
          lastEdited: p.last_edited_time
        };
      });
    } catch (e) {
      out.errors.push('notion: ' + e.message);
    }
  } else {
    out.errors.push('notion: NOTION_TOKEN not set');
  }

  // Partner counts via GHL tag
  if (ghlKey && locationId) {
    try {
      out.totalPartners = await ghlTagCount(ghlKey, locationId, 'dispo-buddy');
    } catch (e) {
      out.errors.push('ghl: ' + e.message);
    }
  } else {
    out.errors.push('ghl: credentials missing');
  }

  return { statusCode: 200, headers: headers, body: JSON.stringify(out) };
};
