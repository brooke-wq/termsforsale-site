/**
 * Steadily Insurance Quote — POST /.netlify/functions/insurance-quote
 *
 * Proxies a quote request to Steadily's API and returns the estimate.
 * Called from the deal page with the property address (and optionally
 * property details + metadata for richer quoting).
 *
 * Request body (JSON):
 *   street_address  (required)
 *   city            (required)
 *   state           (required)
 *   zip             (optional, passed as zip_code)
 *   county          (optional)
 *   property_id       (optional passthrough)
 *   property_details  (optional object: size_sqft, year_built, property_type, ...)
 *   property_metadata (optional object, passthrough)
 *   metadata          (optional top-level metadata object)
 *
 * Response:
 *   { available, annual, monthly, startUrl, propertyId }
 *
 * ENV VARS: STEADILY_API_KEY (required), STEADILY_LIVE (optional)
 */

const { quoteEstimate, buildPropertyPayload } = require('./_steadily');

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const street = body.street_address || '';
  const city   = body.city || '';
  const state  = body.state || '';
  const zip    = body.zip || body.zip_code || '';
  const county = body.county || '';

  if (!street || !city || !state) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Missing address fields' }) };
  }

  const address = {
    street_address: street,
    city: city,
    state: state,
    zip_code: zip
  };
  if (county) address.county = county;

  let payload;
  try {
    payload = buildPropertyPayload({
      address: address,
      propertyId: body.property_id,
      propertyDetails: body.property_details,
      propertyMetadata: body.property_metadata,
      metadata: body.metadata
    });
  } catch (e) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: e.message }) };
  }

  let result;
  try {
    result = await quoteEstimate(payload);
  } catch (err) {
    if (err && typeof err.status === 'number' && err.status > 0) {
      console.error('[insurance-quote] Steadily error ' + err.status, err.body);
      return {
        statusCode: 502,
        headers: headers,
        body: JSON.stringify({
          error: 'Quote unavailable',
          status: err.status,
          detail: JSON.stringify(err.body).substring(0, 200)
        })
      };
    }
    console.error('[insurance-quote] Error:', err.message);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }

  console.log('[insurance-quote] Steadily 200 body=' + JSON.stringify(result.body).substring(0, 300));

  // Response shape based on observed staging responses: `estimates[]` with
  // `estimate.lowest` (annual premium, USD), `start_url`, and `property_id`.
  // Redoc was not reachable from this environment; callers should treat the
  // mapping below as a best-effort projection and fall back gracefully.
  const estimates = (result.body && result.body.estimates) || [];
  if (!estimates.length) {
    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({ available: false, message: 'No estimate available for this property' })
    };
  }

  const est = estimates[0] || {};
  const annual = (est.estimate && typeof est.estimate.lowest === 'number') ? est.estimate.lowest : 0;
  const monthly = annual > 0 ? Math.round(annual / 12) : 0;
  const startUrl = est.start_url || '';

  console.log('[insurance-quote] ' + city + ', ' + state + ' — $' + monthly + '/mo, url=' + (startUrl ? 'yes' : 'no'));

  return {
    statusCode: 200,
    headers: headers,
    body: JSON.stringify({
      available: monthly > 0,
      annual: annual,
      monthly: monthly,
      startUrl: startUrl,
      propertyId: est.property_id || ''
    })
  };
};
