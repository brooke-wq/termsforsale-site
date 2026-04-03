// Netlify serverless function — proxies Google Drive API
// Uses Node.js built-in https module (no fetch dependency)
// Client calls: /api/drive-photos?folderId=FOLDER_ID

const https = require('https');

function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, {
      headers: {
        'Referer': 'https://deals.termsforsale.com',
        'Origin': 'https://deals.termsforsale.com',
        'User-Agent': 'TermsForSale/1.0'
      }
    }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch(e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on('error', function(err) {
      reject(err);
    });
  });
}

exports.handler = async function(event) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  var folderId = event.queryStringParameters && event.queryStringParameters.folderId;
  if (!folderId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing folderId' }) };
  }

  var apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured in Netlify env vars' }) };
  }

  var query = "'" + folderId + "' in parents and trashed=false and mimeType contains 'image/'";
  var url = 'https://www.googleapis.com/drive/v3/files'
    + '?q=' + encodeURIComponent(query)
    + '&fields=files(id,name)'
    + '&orderBy=createdTime'
    + '&pageSize=30'
    + '&supportsAllDrives=true'
    + '&includeItemsFromAllDrives=true'
    + '&key=' + apiKey;

  try {
    var result = await httpsGet(url);

    if (result.status !== 200) {
      console.error('Drive API error:', result.status, JSON.stringify(result.body));
      return {
        statusCode: result.status,
        headers,
        body: JSON.stringify({
          error: 'Drive API returned ' + result.status,
          detail: result.body && result.body.error ? result.body.error.message : ''
        })
      };
    }

    var files = (result.body.files) || [];

    // Sort: prioritize exterior/front-of-house photos
    // Tier 1: explicitly named front/cover/exterior
    var FRONT_EXACT = /^(front|cover|exterior|main|hero|01|1[-_.\s])/i;
    // Tier 2: contains exterior-related words anywhere in name
    var FRONT_CONTAINS = /(front|exterior|curb|street|facade|house|outside|aerial|drone|entrance)/i;
    // Tier 3: known interior words — push to end
    var INTERIOR = /(kitchen|bathroom|bath\b|bedroom|bed\b|laundry|closet|garage|attic|basement|furnace|hvac|utility|water.?heater)/i;

    files.sort(function(a, b) {
      var an = a.name || '', bn = b.name || '';
      var aScore = FRONT_EXACT.test(an) ? 3 : FRONT_CONTAINS.test(an) ? 2 : INTERIOR.test(an) ? 0 : 1;
      var bScore = FRONT_EXACT.test(bn) ? 3 : FRONT_CONTAINS.test(bn) ? 2 : INTERIOR.test(bn) ? 0 : 1;
      return bScore - aScore; // higher score first
    });

    var fileIds = files.map(function(f) { return f.id; });
    console.log('Drive API success: folderId=' + folderId + ' fileCount=' + fileIds.length + (files[0] ? ' first=' + files[0].name : ''));

    return {
      statusCode: 200,
      headers: Object.assign({}, headers, { 'Cache-Control': 'public, max-age=300' }),
      body: JSON.stringify({ fileIds: fileIds })
    };

  } catch (err) {
    console.error('Function error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
