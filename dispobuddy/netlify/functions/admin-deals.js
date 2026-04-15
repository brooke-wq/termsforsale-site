/**
 * Dispo Buddy — Admin JV Deals List
 * GET /api/admin-deals
 * Requires X-Admin-Password header.
 *
 * Query params (all optional):
 *   status = Actively Marketing | Under Contract | Closed | ...
 *   q      = search substring (matches street address, city, state, Deal ID, JV Partner)
 *
 * Returns all JV deals from Notion with key fields.
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
    case 'url':        return p.url || '';
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

  var notionToken = process.env.NOTION_TOKEN;
  var dbId = process.env.NOTION_DB_ID || process.env.NOTION_DATABASE_ID || 'a3c0a38fd9294d758dedabab2548ff29';

  if (!notionToken) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'NOTION_TOKEN not set' }) };
  }

  var qs = event.queryStringParameters || {};
  var statusFilter = qs.status || '';
  var searchTerm = (qs.q || '').toLowerCase().trim();

  try {
    var result = await notionPaginate(dbId, notionToken, {
      property: 'JV Partner',
      rich_text: { is_not_empty: true }
    });
    if (result.error) {
      result = await notionPaginate(dbId, notionToken, null);
    }
    var pages = result.pages || [];

    var deals = pages.map(function (p) {
      return {
        id: p.id,
        dealCode: prop(p, 'Deal ID'),
        street: prop(p, 'Street Address'),
        city: prop(p, 'City'),
        state: prop(p, 'State'),
        zip: prop(p, 'ZIP'),
        dealType: prop(p, 'Deal Type'),
        status: prop(p, 'Deal Status'),
        askingPrice: prop(p, 'Asking Price'),
        contractedPrice: prop(p, 'Contracted Price'),
        entryFee: prop(p, 'Entry Fee'),
        arv: prop(p, 'ARV'),
        coe: prop(p, 'COE'),
        jvPartner: prop(p, 'JV Partner'),
        jvPartnerContactId: prop(p, 'JV Partner Contact ID'),
        photos: prop(p, 'Photos'),
        documents: prop(p, 'Documents'),
        propertyType: prop(p, 'Property Type'),
        beds: prop(p, 'Beds'),
        baths: prop(p, 'Baths'),
        sqft: prop(p, 'Living Area'),
        yearBuilt: prop(p, 'Year Built'),
        lotSize: prop(p, 'Lot Size'),
        county: prop(p, 'County'),
        hoa: prop(p, 'HOA'),
        lastEdited: p.last_edited_time,
        created: p.created_time
      };
    });

    if (statusFilter) {
      deals = deals.filter(function (d) { return d.status === statusFilter; });
    }
    if (searchTerm) {
      deals = deals.filter(function (d) {
        return (
          (d.street || '').toLowerCase().indexOf(searchTerm) >= 0 ||
          (d.city || '').toLowerCase().indexOf(searchTerm) >= 0 ||
          (d.state || '').toLowerCase().indexOf(searchTerm) >= 0 ||
          (d.dealCode || '').toLowerCase().indexOf(searchTerm) >= 0 ||
          (d.jvPartner || '').toLowerCase().indexOf(searchTerm) >= 0
        );
      });
    }

    deals.sort(function (a, b) { return (b.lastEdited || '').localeCompare(a.lastEdited || ''); });

    return { statusCode: 200, headers: headers, body: JSON.stringify({ deals: deals, total: deals.length }) };
  } catch (e) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: e.message }) };
  }
};
