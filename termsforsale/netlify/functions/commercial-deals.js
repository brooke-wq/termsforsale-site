// Netlify function: commercial-deals
// Fetches active commercial/multifamily deals from Notion
// Returns BLIND teaser data only — no addresses, no data room URLs

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
    case 'number': return p.number !== null ? p.number : '';
    default: return '';
  }
}

exports.handler = async function(event) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=60'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }

  var token = process.env.NOTION_TOKEN;
  var dbId = process.env.NOTION_COMMERCIAL_DB_ID;

  if (!token || !dbId) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'Notion not configured' }) };
  }

  try {
    // Fetch all active commercial deals (paginated)
    var allPages = [];
    var hasMore = true;
    var cursor = undefined;

    while (hasMore) {
      var queryBody = {
        filter: { property: 'Status', select: { equals: 'Active' } },
        page_size: 100
      };
      if (cursor) queryBody.start_cursor = cursor;

      var result = await notionRequest('/v1/databases/' + dbId + '/query', token, queryBody);
      if (result.status !== 200) {
        console.error('Notion error:', result.status, JSON.stringify(result.body).substring(0, 200));
        return { statusCode: result.status, headers: headers, body: JSON.stringify({ error: 'Notion error', detail: result.body.message || '' }) };
      }
      allPages = allPages.concat(result.body.results || []);
      hasMore = result.body.has_more === true;
      cursor = result.body.next_cursor || undefined;
    }

    // Map to BLIND teaser objects — explicitly exclude private fields
    var deals = allPages.map(function(page) {
      return {
        id: page.id,
        dealCode: prop(page, 'Deal Code'),
        status: prop(page, 'Status'),
        metro: prop(page, 'Metro'),
        submarket: prop(page, 'Submarket'),
        propertyType: prop(page, 'Property Type'),
        unitsOrSqft: prop(page, 'Units or Sqft'),
        vintageClass: prop(page, 'Vintage / Class'),
        noiRange: prop(page, 'NOI Range'),
        priceRange: prop(page, 'Price Range'),
        dealStory: [
          prop(page, 'Deal Story 1'),
          prop(page, 'Deal Story 2'),
          prop(page, 'Deal Story 3')
        ].filter(Boolean),
        structureSummary: prop(page, 'Structure Summary')
        // EXPLICITLY OMITTED: Address, Data Room URL, CIM URL
      };
    });

    console.log('Commercial deals fetched: ' + deals.length);

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({ deals: deals, count: deals.length })
    };

  } catch (err) {
    console.error('commercial-deals error:', err.message);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
