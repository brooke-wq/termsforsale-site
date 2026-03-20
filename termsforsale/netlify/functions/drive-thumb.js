// Netlify function: drive-thumb
// Proxies a single Google Drive file thumbnail through the server using API key
// Client calls: /api/drive-thumb?id=FILE_ID&sz=800
// This solves the browser-side auth issue with drive.google.com/thumbnail

const https = require('https');

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

  // Use Drive API to get thumbnail link for the file
  var metaUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId
    + '?fields=thumbnailLink,webContentLink,mimeType,name'
    + '&supportsAllDrives=true'
    + '&key=' + apiKey;

  return new Promise(function(resolve) {
    https.get(metaUrl, { headers: { 'User-Agent': 'TermsForSale/1.0' } }, function(res) {
      var data = '';
      res.on('data', function(c){ data += c; });
      res.on('end', function() {
        try {
          var meta = JSON.parse(data);
          // Use thumbnailLink from Drive API (already authenticated via API key)
          var thumbUrl = meta.thumbnailLink
            ? meta.thumbnailLink.replace(/=s\d+/, '=s' + sz)
            : null;

          if (thumbUrl) {
            // Redirect to the thumbnail URL — browser follows it
            resolve({
              statusCode: 302,
              headers: Object.assign({}, headers, { 'Location': thumbUrl }),
              body: ''
            });
          } else {
            // Fallback: return file metadata so client knows it exists
            resolve({
              statusCode: 200,
              headers: Object.assign({}, headers, {'Content-Type':'application/json'}),
              body: JSON.stringify({ error: 'no thumbnail', name: meta.name })
            });
          }
        } catch(e) {
          resolve({ statusCode: 500, headers: {'Content-Type':'application/json'}, body: JSON.stringify({error: e.message}) });
        }
      });
    }).on('error', function(err) {
      resolve({ statusCode: 500, headers: {'Content-Type':'application/json'}, body: JSON.stringify({error: err.message}) });
    });
  });
};
