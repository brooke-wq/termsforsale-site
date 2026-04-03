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

    // Sort: files named with front/cover/exterior/01/1- come first (front of house),
    // then maintain createdTime order for the rest
    var FRONT_PATTERNS = /^(front|cover|exterior|main|hero|01|1[-_.\s])/i;
    files.sort(function(a, b) {
      var aFront = FRONT_PATTERNS.test(a.name || '');
      var bFront = FRONT_PATTERNS.test(b.name || '');
      if (aFront && !bFront) return -1;
      if (!aFront && bFront) return 1;
      return 0; // preserve createdTime order from API
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
