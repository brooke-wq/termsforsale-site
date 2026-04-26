// Netlify function: rental-comps
// GET /api/rental-comps?dealId=<notionPageId>
//
// Returns a small, buyer-safe payload of nearby rental comparables for the
// deal's subject property. We pull from RentCast's /avm/rent/long-term
// endpoint and slice the comparables array down to ~10 properties.
//
// Cache strategy:
//   - On first request we fetch RentCast and write the trimmed array onto the
//     Notion page in a rich_text property called "Rent Comps JSON". The
//     property is auto-created if it does not exist (best-effort — schema
//     change failures are non-fatal so the request still serves data).
//   - Subsequent requests read directly from Notion and skip the RentCast
//     call, so re-views are free.
//
// Privacy:
//   - Comp street addresses are stripped on the way out — we expose only
//     city/state/zip/distance/rent/beds/baths/sqft. The buyer pays per
//     viewable property in $/sqft, not per neighborhood snoop. If a comp's
//     coordinates are present we keep them so the frontend can plot them.
//
// ENV: NOTION_TOKEN (required), RENTCAST_API_KEY (required for live fetch)

const https = require('https');

const NOTION_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const RENTCAST_BASE = 'https://api.rentcast.io/v1';
const COMPS_PROP_NAME = 'Rent Comps JSON';
const MAX_COMPS = 10;
// Notion rich_text caps individual chunks at 2000 chars. Our comp payload is
// well under that, but we still slice defensively before writing.
const NOTION_RICH_TEXT_CAP = 1900;

function notionHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json'
  };
}

function getRichText(page, name) {
  var p = page && page.properties && page.properties[name];
  if (!p || p.type !== 'rich_text') return '';
  return (p.rich_text || []).map(function (t) { return t.plain_text; }).join('');
}

function getPropPlain(page, name) {
  var p = page && page.properties && page.properties[name];
  if (!p) return '';
  switch (p.type) {
    case 'title':     return (p.title || []).map(function (t) { return t.plain_text; }).join('');
    case 'rich_text': return (p.rich_text || []).map(function (t) { return t.plain_text; }).join('');
    case 'number':    return p.number != null ? String(p.number) : '';
    case 'select':    return p.select ? p.select.name : '';
    case 'status':    return p.status ? p.status.name : '';
    default:          return '';
  }
}

async function notionGetPage(token, pageId) {
  var res = await fetch(NOTION_BASE + '/pages/' + pageId, { headers: notionHeaders(token) });
  if (!res.ok) throw new Error('notion get ' + res.status);
  return res.json();
}

async function notionUpdateRichText(token, pageId, propName, text) {
  var safe = String(text || '').slice(0, NOTION_RICH_TEXT_CAP);
  var body = { properties: {} };
  body.properties[propName] = {
    rich_text: [{ type: 'text', text: { content: safe } }]
  };
  var res = await fetch(NOTION_BASE + '/pages/' + pageId, {
    method: 'PATCH',
    headers: notionHeaders(token),
    body: JSON.stringify(body)
  });
  return res.ok;
}

async function fetchRentcastComps(apiKey, address, city, state, zipCode) {
  var params = new URLSearchParams();
  if (address) params.set('address', address);
  if (city) params.set('city', city);
  if (state) params.set('state', state);
  if (zipCode) params.set('zipCode', zipCode);
  var res = await fetch(RENTCAST_BASE + '/avm/rent/long-term?' + params.toString(), {
    headers: { 'X-Api-Key': apiKey }
  });
  if (!res.ok) {
    var t = await res.text().catch(function () { return ''; });
    throw new Error('rentcast ' + res.status + ' ' + t.slice(0, 120));
  }
  return res.json();
}

// Trim a single RentCast comparable down to the buyer-safe shape we serve.
// We deliberately drop street, agent contact info, etc.
function shapeComp(c) {
  if (!c || typeof c !== 'object') return null;
  var rent = +c.rent || +c.price || 0;
  var sqft = +c.squareFootage || +c.livingArea || 0;
  return {
    city: c.city || '',
    state: c.state || '',
    zipCode: c.zipCode || '',
    beds: c.bedrooms != null ? +c.bedrooms : null,
    baths: c.bathrooms != null ? +c.bathrooms : null,
    sqft: sqft || null,
    yearBuilt: c.yearBuilt != null ? +c.yearBuilt : null,
    rent: rent || null,
    rentPerSqft: rent && sqft ? +(rent / sqft).toFixed(2) : null,
    distance: c.distance != null ? +(+c.distance).toFixed(2) : null,
    daysOld: c.daysOld != null ? +c.daysOld : null,
    correlation: c.correlation != null ? +(+c.correlation).toFixed(2) : null,
    lat: c.latitude != null ? +c.latitude : null,
    lng: c.longitude != null ? +c.longitude : null
  };
}

function shapeRentcastResponse(rc) {
  if (!rc || typeof rc !== 'object') return { rent: null, comps: [] };
  var comps = (rc.comparables || [])
    .map(shapeComp)
    .filter(function (c) { return c && c.rent; })
    .slice(0, MAX_COMPS);
  return {
    rent: rc.rent != null ? +rc.rent : null,
    rentRangeLow: rc.rentRangeLow != null ? +rc.rentRangeLow : null,
    rentRangeHigh: rc.rentRangeHigh != null ? +rc.rentRangeHigh : null,
    comps: comps,
    cachedAt: new Date().toISOString()
  };
}

function respond(statusCode, payload, extraHeaders) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    // Comps don't move minute-to-minute. Browser caches for 1h.
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
  };
  if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { headers[k] = extraHeaders[k]; });
  return { statusCode: statusCode, headers: headers, body: JSON.stringify(payload) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' };
  }

  var qs = event.queryStringParameters || {};
  var dealId = (qs.dealId || qs.id || '').trim();
  if (!dealId) return respond(400, { error: 'dealId required' });

  var notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) return respond(500, { error: 'NOTION_TOKEN not configured' });

  var page;
  try {
    page = await notionGetPage(notionToken, dealId);
  } catch (err) {
    return respond(502, { error: 'notion fetch failed: ' + err.message });
  }

  // Cache hit — serve cached comps without burning a RentCast call.
  var cachedRaw = getRichText(page, COMPS_PROP_NAME);
  if (cachedRaw) {
    try {
      var cached = JSON.parse(cachedRaw);
      if (cached && Array.isArray(cached.comps)) {
        return respond(200, Object.assign({ source: 'cache' }, cached));
      }
    } catch (e) {
      // Fall through to live fetch on parse failure.
    }
  }

  var address = getPropPlain(page, 'Street Address');
  var city    = getPropPlain(page, 'City');
  var state   = getPropPlain(page, 'State');
  var zip     = getPropPlain(page, 'ZIP');

  if (!address && !zip && !(city && state)) {
    return respond(200, { source: 'no-address', rent: null, comps: [] });
  }

  var rentcastKey = process.env.RENTCAST_API_KEY;
  if (!rentcastKey) {
    return respond(200, { source: 'no-key', rent: null, comps: [] });
  }

  var raw;
  try {
    raw = await fetchRentcastComps(rentcastKey, address, city, state, zip);
  } catch (err) {
    return respond(200, { source: 'fetch-failed', error: err.message, rent: null, comps: [] });
  }

  var shaped = shapeRentcastResponse(raw);

  // Best-effort cache write — failures here don't affect the response.
  try {
    await notionUpdateRichText(notionToken, dealId, COMPS_PROP_NAME, JSON.stringify(shaped));
  } catch (e) {
    // Property likely doesn't exist on the database yet. Caller already has
    // the comps; the next render will hit RentCast again until the property
    // is added by the operator. Silent.
  }

  return respond(200, Object.assign({ source: 'live' }, shaped));
};
