/**
 * Steadily Insurance Quote — POST /.netlify/functions/insurance-quote
 *
 * Proxies a quote request to Steadily's API and returns the estimate.
 * Called from the deal page with the property address.
 *
 * ENV VARS: STEADILY_API_KEY (staging or production)
 * Staging URL: api.staging.steadily.com
 * Production URL: api.steadily.com
 */

const https = require('https');

function steadilyRequest(body, apiKey, isStaging) {
  var hostname = isStaging ? 'api.staging.steadily.com' : 'api.steadily.com';
  return new Promise(function(resolve, reject) {
    var opts = {
      hostname: hostname,
      path: '/v1/quote/estimate',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      }
    };
    var req = https.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

exports.handler = async function(event) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  var apiKey = process.env.STEADILY_API_KEY || '35f32f0a-bcc5-404c-aded-54085ba27050';
  var isStaging = !process.env.STEADILY_LIVE;

  var body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  var street = body.street_address || '';
  var city = body.city || '';
  var state = body.state || '';
  var zip = body.zip || '';

  if (!street || !city || !state) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Missing address fields' }) };
  }

  try {
    var result = await steadilyRequest({
      properties: [{
        address: {
          street_address: street,
          city: city,
          state: state,
          zip_code: zip
        }
      }]
    }, apiKey, isStaging);

    console.log('[insurance-quote] Steadily response: status=' + result.status + ' body=' + JSON.stringify(result.body).substring(0, 300));

    if (result.status !== 200) {
      return { statusCode: 502, headers: headers, body: JSON.stringify({ error: 'Quote unavailable', status: result.status, detail: JSON.stringify(result.body).substring(0, 200) }) };
    }

    var estimates = result.body.estimates || [];
    if (!estimates.length) {
      return { statusCode: 200, headers: headers, body: JSON.stringify({ available: false, message: 'No estimate available for this property' }) };
    }

    var est = estimates[0];
    var annual = est.estimate && est.estimate.lowest ? est.estimate.lowest : 0;
    var monthly = annual > 0 ? Math.round(annual / 12) : 0;
    var startUrl = est.start_url || '';

    console.log('[insurance-quote] ' + city + ', ' + state + ' — $' + monthly + '/mo, url=' + (startUrl ? 'yes' : 'no'));

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        available: true,
        annual: annual,
        monthly: monthly,
        startUrl: startUrl,
        propertyId: est.property_id || ''
      })
    };

  } catch (err) {
    console.error('[insurance-quote] Error:', err.message);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
