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
const crypto = require('crypto');

// Steadily's /v1/quote/estimate requires a caller-supplied `property_id` on
// every property (learned empirically from staging 422 responses — the Redoc
// page was unreachable from the build environment). We auto-generate a stable
// ID from the address so repeat calls for the same property get the same ID.
function deriveStablePropertyId(street, city, state, zip) {
  const fingerprint = [street, city, state, zip].join('|').toLowerCase();
  const hash = crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 16);
  return 'tfs_' + hash;
}

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

  const propertyId = body.property_id || deriveStablePropertyId(street, city, state, zip);

  let payload;
  try {
    payload = buildPropertyPayload({
      address: address,
      propertyId: propertyId,
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

  console.log('[insurance-quote] Steadily 200 body=' + JSON.stringify(result.body).substring(0, 500));

  // Response shape based on observed staging responses: `estimates[]` with an
  // `estimate` object that contains TWO rates — `lowest` (bare-bones coverage)
  // and `highest` (full coverage). We always project the HIGHEST rate so the
  // deal page never shows a stripped-down number the buyer can't actually buy.
  // If only `lowest` is present (older API versions / edge cases), we fall
  // back to it rather than showing nothing.
  const estimates = (result.body && result.body.estimates) || [];
  if (!estimates.length) {
    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({ available: false, message: 'No estimate available for this property' })
    };
  }

  const est = estimates[0] || {};
  const estObj = est.estimate || {};
  const highest = typeof estObj.highest === 'number' ? estObj.highest : 0;
  const lowest  = typeof estObj.lowest  === 'number' ? estObj.lowest  : 0;
  const annual  = highest > 0 ? highest : lowest;
  const monthly = annual > 0 ? Math.round(annual / 12) : 0;
  const startUrl = est.start_url || '';
  const rateTier = highest > 0 ? 'highest' : (lowest > 0 ? 'lowest(fallback)' : 'none');

  console.log('[insurance-quote] ' + city + ', ' + state + ' — $' + monthly + '/mo tier=' + rateTier + ' (high=$' + highest + ' low=$' + lowest + ') url=' + (startUrl ? 'yes' : 'no'));

  return {
    statusCode: 200,
    headers: headers,
    body: JSON.stringify({
      available: monthly > 0,
      annual: annual,
      monthly: monthly,
      annualHighest: highest,
      annualLowest: lowest,
      rateTier: rateTier,
      startUrl: startUrl,
      propertyId: est.property_id || ''
    })
  };
};
