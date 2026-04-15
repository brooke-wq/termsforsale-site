/**
 * Dispo Buddy — Admin Partners List
 * GET /api/admin-partners
 * Requires X-Admin-Password header.
 *
 * Returns all GHL contacts tagged `dispo-buddy` with aggregate stats.
 *
 * Query params (optional):
 *   q = search substring (name / email / phone)
 *
 * Stats computed per partner:
 *   - dealsSubmitted (total Notion rows with matching JV Partner)
 *   - dealsActive / dealsClosed
 *   - lastSubmission (newest Notion deal timestamp)
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

async function ghlSearchContacts(apiKey, locationId, tag, page) {
  var res = await fetch('https://services.leadconnectorhq.com/contacts/search', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      locationId: locationId,
      page: page || 1,
      pageLimit: 100,
      filters: [{
        group: 'AND',
        filters: [{ field: 'tags', operator: 'contains', value: [tag] }]
      }]
    })
  });
  if (!res.ok) throw new Error('GHL search failed: ' + res.status);
  return res.json();
}

async function notionPaginate(dbId, token) {
  var all = [];
  var cursor = undefined;
  var pages = 0;
  while (pages < 20) {
    var body = { page_size: 100, filter: { property: 'JV Partner', rich_text: { is_not_empty: true } } };
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
    if (!res.ok) break;
    var data = await res.json();
    all = all.concat(data.results || []);
    if (!data.has_more) break;
    cursor = data.next_cursor;
    pages++;
  }
  return all;
}

function prop(page, name) {
  var p = page.properties && page.properties[name];
  if (!p) return '';
  switch (p.type) {
    case 'title':      return (p.title || []).map(function (t) { return t.plain_text; }).join('');
    case 'rich_text':  return (p.rich_text || []).map(function (t) { return t.plain_text; }).join('');
    case 'status':     return p.status ? p.status.name : '';
    default:           return '';
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

  var apiKey = process.env.GHL_API_KEY;
  var locationId = process.env.GHL_LOCATION_ID;
  var notionToken = process.env.NOTION_TOKEN;
  var dbId = process.env.NOTION_DB_ID || process.env.NOTION_DATABASE_ID || 'a3c0a38fd9294d758dedabab2548ff29';

  if (!apiKey || !locationId) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'GHL credentials missing' }) };
  }

  var qs = event.queryStringParameters || {};
  var searchTerm = (qs.q || '').toLowerCase().trim();

  try {
    // Paginate GHL contacts with dispo-buddy tag
    var partners = [];
    var seen = {};
    var page = 1;
    while (page <= 20) {
      var data = await ghlSearchContacts(apiKey, locationId, 'dispo-buddy', page);
      var list = (data && (data.contacts || data.data)) || [];
      if (!list.length) break;
      list.forEach(function (c) {
        if (!seen[c.id]) {
          seen[c.id] = true;
          partners.push(c);
        }
      });
      if (list.length < 100) break;
      page++;
    }

    // Aggregate deal stats from Notion
    var dealStats = {};
    if (notionToken) {
      var deals = await notionPaginate(dbId, notionToken);
      deals.forEach(function (p) {
        var jv = prop(p, 'JV Partner') || '';
        var status = prop(p, 'Deal Status');
        // Match on the first part of JV Partner (the name before " | phone | email")
        var name = jv.split('|')[0].trim().toLowerCase();
        if (!name) return;
        if (!dealStats[name]) dealStats[name] = { total: 0, active: 0, closed: 0, lastSubmission: '' };
        dealStats[name].total++;
        if (status === 'Actively Marketing' || status === 'Under Contract' || status === 'Under Review') dealStats[name].active++;
        if (status === 'Closed' || status === 'Funded') dealStats[name].closed++;
        if ((p.created_time || '') > dealStats[name].lastSubmission) {
          dealStats[name].lastSubmission = p.created_time;
        }
      });
    }

    var result = partners.map(function (c) {
      var name = ((c.firstName || '') + ' ' + (c.lastName || '')).trim() || c.contactName || c.name || '(no name)';
      var stats = dealStats[name.toLowerCase()] || { total: 0, active: 0, closed: 0, lastSubmission: '' };
      return {
        id: c.id,
        name: name,
        email: c.email || '',
        phone: c.phone || '',
        tags: c.tags || [],
        dateAdded: c.dateAdded || c.createdAt || '',
        dealsSubmitted: stats.total,
        dealsActive: stats.active,
        dealsClosed: stats.closed,
        lastSubmission: stats.lastSubmission
      };
    });

    if (searchTerm) {
      result = result.filter(function (p) {
        return (
          p.name.toLowerCase().indexOf(searchTerm) >= 0 ||
          (p.email || '').toLowerCase().indexOf(searchTerm) >= 0 ||
          (p.phone || '').indexOf(searchTerm) >= 0
        );
      });
    }

    // Sort: most recent submission first, then alphabetical
    result.sort(function (a, b) {
      if (a.lastSubmission && b.lastSubmission) return b.lastSubmission.localeCompare(a.lastSubmission);
      if (a.lastSubmission) return -1;
      if (b.lastSubmission) return 1;
      return a.name.localeCompare(b.name);
    });

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        partners: result,
        total: result.length,
        stats: {
          totalPartners: result.length,
          withActiveDeals: result.filter(function (p) { return p.dealsActive > 0; }).length,
          withClosedDeals: result.filter(function (p) { return p.dealsClosed > 0; }).length
        }
      })
    };
  } catch (e) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: e.message }) };
  }
};
