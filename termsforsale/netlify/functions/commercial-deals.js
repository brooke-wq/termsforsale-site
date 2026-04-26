// Netlify function: commercial-deals
// Returns BLIND teaser data for the /commercial page.
// Merges TWO sources:
//   1) The dedicated commercial Notion DB (NOTION_COMMERCIAL_DB_ID) — purpose-built blind teasers.
//   2) The main residential/creative-finance pipeline (NOTION_DB_ID), filtered to property types
//      that fall under the "commercial realm" (multifamily, commercial, industrial, storage facilities,
//      hotels/motels, RV parks, mobile home parks). These deals continue to appear on /deals as well.
// Never returns addresses or data-room URLs.

const https = require('https');

function notionRequest(path, token, body) {
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: 'api.notion.com',
      path: path,
      method: body ? 'POST' : 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function prop(page, name) {
  var p = page.properties[name];
  if (!p) return '';
  switch (p.type) {
    case 'title': return (p.title || []).map(function(t) { return t.plain_text; }).join('');
    case 'rich_text': return (p.rich_text || []).map(function(t) { return t.plain_text; }).join('');
    case 'select': return p.select ? p.select.name : '';
    case 'multi_select': return (p.multi_select || []).map(function(s) { return s.name; }).join(', ');
    case 'status': return p.status ? p.status.name : '';
    case 'url': return p.url || '';
    case 'number': return p.number !== null && p.number !== undefined ? p.number : '';
    case 'formula':
      if (p.formula.type === 'string') return p.formula.string || '';
      if (p.formula.type === 'number') return p.formula.number !== null ? p.formula.number : '';
      return '';
    default: return '';
  }
}

// Maps a free-text property type to one of the commercial-realm categories
// that the /commercial page surfaces. Returns null if the deal is not commercial.
function commercialCategory(propType) {
  if (!propType) return null;
  var s = String(propType).toLowerCase();
  if (/mobile.?home|manufactured.?home|\bmhp\b/.test(s)) return 'Mobile Home Parks';
  if (/\brv\b|recreational.?vehicle/.test(s)) return 'RV Parks';
  if (/hotel|motel|hospitality|\binn\b|resort/.test(s)) return 'Hotels/Motels';
  if (/self.?storage|storage.?facility|storage.?unit|\bstorage\b/.test(s)) return 'Storage Facilities';
  if (/industrial|warehouse|\bflex\b|distribution/.test(s)) return 'Industrial';
  if (/multi.?family|multifamily|apartment|\bmf\b/.test(s)) return 'Multifamily';
  if (/mixed.?use|retail|office|commercial|\bcre\b/.test(s)) return 'Commercial';
  return null;
}

// Bucket a numeric asking price into the same bands the commercial filter uses.
function priceBucket(n) {
  var v = Number(n) || 0;
  if (v <= 0) return '';
  if (v < 5000000) return 'Under $5M';
  if (v < 10000000) return '$5M - $10M';
  if (v < 20000000) return '$10M - $20M';
  return '$20M+';
}

// Try to extract a numeric price from a priceRange string ("$5M - $10M", "~$3.2M", etc.).
function parsePriceFromRange(s) {
  if (!s) return 0;
  var m = String(s).match(/\$?\s*([0-9]+(?:\.[0-9]+)?)\s*([mMkK]?)/);
  if (!m) return 0;
  var n = parseFloat(m[1]);
  var unit = (m[2] || '').toLowerCase();
  if (unit === 'm') n *= 1000000;
  else if (unit === 'k') n *= 1000;
  return n;
}

function formatMoneyShort(n) {
  var v = Number(n) || 0;
  if (v <= 0) return '';
  if (v >= 1000000) return '$' + (Math.round(v / 100000) / 10) + 'M';
  if (v >= 1000) return '$' + Math.round(v / 1000) + 'K';
  return '$' + v;
}

// Build a teaser-shaped object from a commercial-DB Notion page.
function mapCommercialPage(page) {
  var priceRange = prop(page, 'Price Range');
  return {
    id: page.id,
    source: 'commercial-db',
    dealCode: prop(page, 'Deal Code'),
    status: prop(page, 'Status'),
    metro: prop(page, 'Metro'),
    submarket: prop(page, 'Submarket'),
    propertyType: prop(page, 'Property Type'),
    commercialCategory: commercialCategory(prop(page, 'Property Type')),
    unitsOrSqft: prop(page, 'Units or Sqft'),
    vintageClass: prop(page, 'Vintage / Class'),
    noiRange: prop(page, 'NOI Range'),
    priceRange: priceRange,
    priceNum: parsePriceFromRange(priceRange),
    dealStory: [
      prop(page, 'Deal Story 1'),
      prop(page, 'Deal Story 2'),
      prop(page, 'Deal Story 3')
    ].filter(Boolean),
    structureSummary: prop(page, 'Structure Summary')
    // EXPLICITLY OMITTED: Address, Data Room URL, CIM URL
  };
}

// Build a teaser-shaped object from a main-pipeline Notion page that classifies as commercial.
function mapPipelinePage(page) {
  var rawType = prop(page, 'Property Type');
  var category = commercialCategory(rawType);
  if (!category) return null;

  var dealStatus = prop(page, 'Deal Status');
  // Only surface deals that are still in-market on /commercial.
  if (dealStatus !== 'Actively Marketing' && dealStatus !== 'Assignment Sent') return null;

  var dealCode = prop(page, 'Deal ID');
  var city = prop(page, 'City');
  var state = prop(page, 'State');
  var nearestMetro = prop(page, 'Nearest Metro') || prop(page, 'Nearest Metro Area');
  var metro = nearestMetro || [city, state].filter(Boolean).join(', ');

  var sqft = prop(page, 'Living Area') || prop(page, 'Sqft');
  var beds = prop(page, 'Beds');
  var unitsOrSqft = '';
  if (category === 'Multifamily' || category === 'Mobile Home Parks' || category === 'RV Parks') {
    if (beds) unitsOrSqft = beds + (String(beds).match(/unit|pad|site/i) ? '' : ' units');
    else if (sqft) unitsOrSqft = sqft + ' sqft';
  } else {
    if (sqft) unitsOrSqft = sqft + ' sqft';
    else if (beds) unitsOrSqft = beds + ' units';
  }

  var yearBuilt = prop(page, 'Year Built') || prop(page, 'Year Build');
  var noi = +prop(page, 'Annual NOI') || 0;
  var asking = +prop(page, 'Asking Price') || 0;

  var stories = [
    prop(page, 'Highlight 1'),
    prop(page, 'Highlight 2'),
    prop(page, 'Highlight 3')
  ].filter(Boolean);

  var loanType = prop(page, 'Loan Type');
  var subtoBalance = +prop(page, 'SubTo Loan Balance') || 0;
  var subtoRate = prop(page, 'SubTo Rate (%)') || prop(page, 'SubTo Rate');
  var sfAmount = +prop(page, 'SF Loan Amount') || 0;
  var sfRate = prop(page, 'SF Rate');

  var structureBits = [];
  if (loanType) structureBits.push(loanType);
  if (subtoBalance > 0) structureBits.push('SubTo ' + formatMoneyShort(subtoBalance) + (subtoRate ? ' @ ' + subtoRate + '%' : ''));
  if (sfAmount > 0) structureBits.push('SF ' + formatMoneyShort(sfAmount) + (sfRate ? ' @ ' + sfRate + '%' : ''));
  var structureSummary = structureBits.join(' · ') || (loanType || 'Cash / Negotiable');

  return {
    id: page.id,
    source: 'pipeline',
    dealCode: dealCode,
    status: dealStatus,
    metro: metro,
    submarket: city,
    propertyType: category,
    commercialCategory: category,
    unitsOrSqft: unitsOrSqft,
    vintageClass: yearBuilt ? String(yearBuilt) : '',
    noiRange: noi > 0 ? formatMoneyShort(noi) + ' NOI' : '',
    priceRange: asking > 0 ? priceBucket(asking) : '',
    priceNum: asking,
    dealStory: stories,
    structureSummary: structureSummary
  };
}

async function fetchAllPages(dbId, token, filter) {
  var allPages = [];
  var hasMore = true;
  var cursor = undefined;
  while (hasMore) {
    var queryBody = { page_size: 100 };
    if (filter) queryBody.filter = filter;
    if (cursor) queryBody.start_cursor = cursor;
    var result = await notionRequest('/v1/databases/' + dbId + '/query', token, queryBody);
    if (result.status !== 200) {
      var detail = result.body && result.body.message ? result.body.message : '';
      throw new Error('Notion ' + result.status + ': ' + detail);
    }
    allPages = allPages.concat(result.body.results || []);
    hasMore = result.body.has_more === true;
    cursor = result.body.next_cursor || undefined;
  }
  return allPages;
}

// The main pipeline DB has hundreds of rows; we must filter server-side or the
// /commercial page sits on a spinner. Deal Status is sometimes a `status` prop
// and sometimes a `select` prop depending on the workspace, so try both before
// falling back to an unfiltered fetch.
async function fetchPipelineCommercial(dbId, token) {
  var marketingStatuses = ['Actively Marketing', 'Assignment Sent'];
  var attempts = [
    { or: marketingStatuses.map(function(s){ return { property: 'Deal Status', status: { equals: s } }; }) },
    { or: marketingStatuses.map(function(s){ return { property: 'Deal Status', select: { equals: s } }; }) }
  ];
  for (var i = 0; i < attempts.length; i++) {
    try {
      return await fetchAllPages(dbId, token, attempts[i]);
    } catch (e) {
      // Try the next filter shape; only swallow validation_error type failures.
      if (i === attempts.length - 1) {
        // Final fallback: no filter (mapPipelinePage will drop non-commercial / non-active rows).
        return await fetchAllPages(dbId, token, null);
      }
    }
  }
  return [];
}

exports.handler = async function(event) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    // Short max-age + long stale-while-revalidate so a cold Lambda re-fetch
    // doesn't make the next pageview wait on Notion (~1-3s round trip).
    'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }

  var token = process.env.NOTION_TOKEN;
  var commercialDbId = process.env.NOTION_COMMERCIAL_DB_ID;
  var pipelineDbId = process.env.NOTION_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';

  if (!token) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'NOTION_TOKEN not configured' }) };
  }

  var errors = [];

  // Fetch both sources in parallel — they're independent Notion queries.
  var commercialPromise = commercialDbId
    ? fetchAllPages(commercialDbId, token, { property: 'Status', select: { equals: 'Active' } })
        .catch(function(e) {
          console.error('commercial-deals: dedicated DB error:', e.message);
          errors.push({ source: 'commercial-db', error: e.message });
          return [];
        })
    : Promise.resolve([]);

  var pipelinePromise = fetchPipelineCommercial(pipelineDbId, token)
    .catch(function(e) {
      console.error('commercial-deals: pipeline DB error:', e.message);
      errors.push({ source: 'pipeline', error: e.message });
      return [];
    });

  var results = await Promise.all([commercialPromise, pipelinePromise]);
  var commercialDeals = results[0].map(mapCommercialPage);
  var pipelineDeals = results[1].map(mapPipelinePage).filter(Boolean);

  // De-dupe by dealCode (commercial DB takes precedence if a code exists in both).
  var seen = {};
  var deals = [];
  commercialDeals.forEach(function(d) {
    if (!d.dealCode) { deals.push(d); return; }
    if (!seen[d.dealCode]) { seen[d.dealCode] = true; deals.push(d); }
  });
  pipelineDeals.forEach(function(d) {
    if (!d.dealCode) { deals.push(d); return; }
    if (!seen[d.dealCode]) { seen[d.dealCode] = true; deals.push(d); }
  });

  console.log('commercial-deals: ' + deals.length + ' total (' + commercialDeals.length + ' commercial-db, ' + pipelineDeals.length + ' pipeline)');

  return {
    statusCode: 200,
    headers: headers,
    body: JSON.stringify({
      deals: deals,
      count: deals.length,
      sources: { commercialDb: commercialDeals.length, pipeline: pipelineDeals.length },
      errors: errors.length ? errors : undefined
    })
  };
};
