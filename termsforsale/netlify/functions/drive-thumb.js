// Netlify function: drive-thumb
// Proxies a single Google Drive file thumbnail through the server using API key
// Client calls: /api/drive-thumb?id=FILE_ID&sz=800
// Falls back through: thumbnailLink → webContentLink → direct download

const https = require('https');

function fetchUrl(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { headers: { 'User-Agent': 'TermsForSale/1.0' } }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        resolve({
          statusCode: res.statusCode,
          contentType: res.headers['content-type'] || 'image/jpeg',
          body: Buffer.concat(chunks)
        });
      });
    }).on('error', reject);
  });
}

exports.handler = async function(event) {
  var headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=86400'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  var params = event.queryStringParameters || {};
  var fileId = params.id;
  var sz     = parseInt(params.sz) || 800;

  if (!fileId) return { statusCode: 400, headers: {'Content-Type':'application/json'}, body: JSON.stringify({error:'Missing id'}) };

  var apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: {'Content-Type':'application/json'}, body: JSON.stringify({error:'No API key'}) };

  try {
    // Get thumbnail and content URLs from Drive API
    var metaUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId
      + '?fields=thumbnailLink,webContentLink,mimeType,name'
      + '&supportsAllDrives=true'
      + '&key=' + apiKey;

    var metaResult = await fetchUrl(metaUrl);
    var meta = JSON.parse(metaResult.body.toString());

    // Build fallback chain: thumbnail → webContentLink → direct download
    var imageUrl = null;
    if (meta.thumbnailLink) {
      imageUrl = meta.thumbnailLink.replace(/=s\d+/, '=s' + sz);
    } else if (meta.webContentLink) {
      imageUrl = meta.webContentLink;
    } else {
      imageUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId
        + '?alt=media&supportsAllDrives=true&key=' + apiKey;
    }

    // Fetch the actual image bytes and return them
    var imgResult = await fetchUrl(imageUrl);

    if (imgResult.statusCode !== 200 || !imgResult.body.length) {
      return { statusCode: 404, headers: {'Content-Type':'application/json'}, body: JSON.stringify({error:'Image not found', name: meta.name}) };
    }

    return {
      statusCode: 200,
      headers: Object.assign({}, headers, {
        'Content-Type': imgResult.contentType
      }),
      body: imgResult.body.toString('base64'),
      isBase64Encoded: true
    };
  } catch(e) {
    return { statusCode: 500, headers: {'Content-Type':'application/json'}, body: JSON.stringify({error: e.message}) };
  }
};
