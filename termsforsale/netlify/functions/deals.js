// Netlify function: deals
// Fetches deals directly from Notion database, filters for "Actively Marketing"
// Client calls: /api/deals

const https = require('https');

function notionRequest(path, token, body) {
  return new Promise(function(resolve, reject) {
    const options = {
      hostname: 'api.notion.com',
      path: path,
      method: body ? 'POST' : 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, function(res) {
      let data = '';
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

// Get first image file ID from a Google Drive folder
function getFirstFileFromFolder(folderId, apiKey) {
  var query = "'" + folderId + "' in parents and trashed=false and mimeType contains 'image/'";
  var url = 'https://www.googleapis.com/drive/v3/files'
    + '?q=' + encodeURIComponent(query)
    + '&fields=files(id)'
    + '&orderBy=name'
    + '&pageSize=1'
    + '&supportsAllDrives=true'
    + '&includeItemsFromAllDrives=true'
    + '&key=' + apiKey;
  return new Promise(function(resolve) {
    https.get(url, { headers: { 'User-Agent': 'TermsForSale/1.0' } }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var parsed = JSON.parse(data);
          var files = (parsed.files || []);
          resolve(files.length ? files[0].id : null);
        } catch(e) { resolve(null); }
      });
    }).on('error', function() { resolve(null); });
  });
}

function extractFolderId(url) {
  if (!url) return null;
  var m = url.match(/folders\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : null;
}

// Extract a plain text value from a Notion property
function prop(page, name) {
  var p = page.properties[name];
  if (!p) return '';
  switch (p.type) {
    case 'title':
      return (p.title || []).map(function(t) { return t.plain_text; }).join('');
    case 'rich_text':
      return (p.rich_text || []).map(function(t) { return t.plain_text; }).join('');
    case 'number':
      return p.number !== null && p.number !== undefined ? p.number : '';
    case 'select':
      return p.select ? p.select.name : '';
    case 'multi_select':
      return (p.multi_select || []).map(function(s) { return s.name; }).join(', ');
    case 'status':
      return p.status ? p.status.name : '';
    case 'url':
      return p.url || '';
    case 'email':
      return p.email || '';
    case 'phone_number':
      return p.phone_number || '';
    case 'checkbox':
      return p.checkbox ? 'Yes' : '';
    case 'date':
      return p.date ? p.date.start : '';
    case 'formula':
      if (p.formula.type === 'string') return p.formula.string || '';
      if (p.formula.type === 'number') return p.formula.number !== null ? p.formula.number : '';
      if (p.formula.type === 'boolean') return p.formula.boolean ? 'Yes' : '';
      if (p.formula.type === 'date') return p.formula.date ? p.formula.date.start : '';
      return '';
    case 'rollup':
      if (p.rollup.type === 'number') return p.rollup.number !== null ? p.rollup.number : '';
      if (p.rollup.type === 'array') return (p.rollup.array || []).map(function(a) {
        if (a.type === 'rich_text') return (a.rich_text || []).map(function(t) { return t.plain_text; }).join('');
        if (a.type === 'number') return a.number;
        return '';
      }).join(', ');
      return '';
    case 'files':
      var files = p.files || [];
      if (!files.length) return '';
      // Return first file URL
      var f = files[0];
      return f.file ? f.file.url : (f.external ? f.external.url : '');
    default:
      return '';
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
  var dbId = process.env.NOTION_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';

  if (!token) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'NOTION_TOKEN not configured' }) };
  }

  try {
    // Query Notion database — filter for "Actively Marketing" status
    // Try both "status" and "select" property types since Notion databases vary
    var filterBody = {
      filter: {
        property: 'Deal Status',
        status: { equals: 'Actively Marketing' }
      },
      page_size: 100,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }]
    };

    var result = await notionRequest('/v1/databases/' + dbId + '/query', token, filterBody);

    // If status filter fails, try select filter
    if (result.status !== 200) {
      filterBody.filter = {
        property: 'Deal Status',
        select: { equals: 'Actively Marketing' }
      };
      result = await notionRequest('/v1/databases/' + dbId + '/query', token, filterBody);
    }

    // If that also fails, try without filter and filter client-side
    if (result.status !== 200) {
      filterBody = { page_size: 100, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] };
      result = await notionRequest('/v1/databases/' + dbId + '/query', token, filterBody);
    }

    if (result.status !== 200) {
      console.error('Notion API error:', result.status, JSON.stringify(result.body));
      return {
        statusCode: result.status,
        headers: headers,
        body: JSON.stringify({ error: 'Notion API error', detail: result.body.message || '' })
      };
    }

    var pages = result.body.results || [];

    // If we couldn't filter server-side, filter here
    if (!filterBody.filter) {
      pages = pages.filter(function(p) {
        var status = prop(p, 'Deal Status');
        return status.toLowerCase().trim() === 'actively marketing';
      });
    }

    // Map Notion pages to deal objects matching the existing frontend schema
    // Property names must match Notion exactly (case-sensitive, including trailing spaces)
    var deals = pages.map(function(page) {
      var rent = prop(page, 'LTR Market Rent');
      return {
        id: page.id,
        dealType: prop(page, 'Deal Type'),
        dealStatus: prop(page, 'Deal Status'),
        streetAddress: prop(page, 'Street Address'),
        city: prop(page, 'City'),
        state: prop(page, 'State'),
        zip: prop(page, 'ZIP'),
        nearestMetro: prop(page, 'Nearest Metro') || prop(page, 'Nearest Metro Area'),
        propertyType: prop(page, 'Property Type'),
        askingPrice: +prop(page, 'Asking Price') || 0,
        entryFee: +prop(page, 'Entry Fee') || 0,
        compsArv: +prop(page, 'ARV') || +prop(page, 'Comps ARV') || 0,
        loanType: prop(page, 'Loan Type'),
        subtoLoanBalance: +prop(page, 'SubTo Loan Balance') || '',
        subtoRate: +prop(page, 'SubTo Rate (%)') || '',
        piti: +prop(page, 'PITI ') || +prop(page, 'PITI') || '',
        subtoLoanMaturity: prop(page, 'SubTo Loan Maturity'),
        subToBalloon: prop(page, 'SubTo Balloon'),
        sfLoanAmount: +prop(page, 'SF Loan Amount') || '',
        sfRate: prop(page, 'SF Rate'),
        sfTerm: prop(page, 'SF Term'),
        sfPayment: +prop(page, 'SF Payment') || '',
        sfBalloon: prop(page, 'SF Balloon'),
        rentFinal: +rent || '',
        rentLow: '',
        rentMid: '',
        rentHigh: '',
        occupancy: prop(page, 'Occupancy'),
        hoa: prop(page, 'HOA'),
        solar: prop(page, 'Solar'),
        beds: prop(page, 'Beds'),
        baths: prop(page, 'Baths'),
        sqft: prop(page, 'Living Area') || prop(page, 'Sqft'),
        yearBuilt: prop(page, 'Year Built') || prop(page, 'Year Build'),
        access: prop(page, 'Access'),
        coe: prop(page, 'COE'),
        photos: prop(page, 'Photos'),
        coverPhoto: prop(page, 'Cover photo') || prop(page, 'Cover Photo'),
        highlight1: prop(page, 'Highlight 1'),
        highlight2: prop(page, 'Highlight 2'),
        highlight3: prop(page, 'Highlight 3'),
        details: prop(page, 'Details ') || prop(page, 'Details'),
        entryBreakdown: prop(page, 'Entry Breakdown'),
        parking: prop(page, 'Parking'),
        lastEdited: page.last_edited_time
      };
    });

    // Auto-populate coverPhoto from first image in Photos folder if not set
    var googleApiKey = process.env.GOOGLE_API_KEY;
    if (googleApiKey) {
      var needsCover = deals.filter(function(d) { return !d.coverPhoto && d.photos; });
      if (needsCover.length) {
        var coverPromises = needsCover.map(function(d) {
          var folderId = extractFolderId(d.photos);
          if (!folderId) return Promise.resolve();
          return getFirstFileFromFolder(folderId, googleApiKey).then(function(fileId) {
            if (fileId) d.coverPhoto = 'https://drive.google.com/file/d/' + fileId + '/view';
          });
        });
        await Promise.all(coverPromises);
      }
    }

    console.log('Notion API success: ' + deals.length + ' active deals');

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({ deals: deals, count: deals.length, source: 'notion' })
    };

  } catch (err) {
    console.error('Function error:', err.message);
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
