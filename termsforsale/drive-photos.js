// Netlify serverless function — proxies Google Drive API
// The API key lives in Netlify environment variables, never in client code
// Client calls: /api/drive-photos?folderId=FOLDER_ID
// This function calls Google on the server, returns file IDs to client

exports.handler = async function(event) {
  var folderId = event.queryStringParameters && event.queryStringParameters.folderId;

  if (!folderId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Missing folderId parameter' })
    };
  }

  var apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'API key not configured' })
    };
  }

  var query = "'" + folderId + "' in parents and trashed=false and mimeType contains 'image/'";
  var url = 'https://www.googleapis.com/drive/v3/files'
    + '?q=' + encodeURIComponent(query)
    + '&fields=files(id,name)'
    + '&orderBy=name'
    + '&pageSize=30'
    + '&key=' + apiKey;

  try {
    var response = await fetch(url);
    var data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: data.error || 'Drive API error' })
      };
    }

    var fileIds = (data.files || []).map(function(f) { return f.id; });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300' // cache 5 min
      },
      body: JSON.stringify({ fileIds: fileIds })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
