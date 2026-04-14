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

  console.log('[insurance-quote] Steadily 200 body=' + JSON.stringify(result.body).substring(0, 800));

  // Steadily's /v1/quote/estimate returns an `estimates[]` array. Each entry
  // has an `estimate` object containing one or more annual-premium numbers.
  // We want the HIGHEST (full-coverage) rate, never the bare-bones number.
  //
  // Problem: Steadily's field names have shifted across API versions (and
  // their Redoc docs are unreachable from this build env), so hard-coding
  // `estimate.highest` is fragile — if the field is actually `maximum` or
  // `annual_high` or nested inside a `coverages[]` array, we'd silently fall
  // back to `lowest` and the deal page would quote the bare-bones premium
  // (that's exactly the $22/mo bug Brooke reported on 2026-04-14).
  //
  // Robust approach: walk every numeric value reachable under `estimate`
  // AND under the top-level estimate record (so if Steadily returns a
  // `coverages[]` or `tiers[]` array we still find it) and pick the MAX.
  // Values < $50/yr or > $50k/yr are ignored as likely non-premium noise
  // (percentages, deductibles, policy IDs, year_built, etc).
  //
  // Also return the FULL set of numeric fields found so we can audit the
  // shape from API logs / the frontend without another request.
  // Known property-metadata / non-premium field names. Exact match only so
  // we don't accidentally drop legitimate premium paths like `coverages[]`
  // (contains "age") or `property_id` (ends with "id"). Keys compared
  // case-insensitively.
  const META_KEYS = new Set([
    'id', 'property_id', 'policy_id', 'quote_id',
    'year', 'year_built', 'yearbuilt',
    'zip', 'zip_code', 'zipcode', 'postal_code',
    'bedrooms', 'bed', 'beds', 'num_bedrooms',
    'bathrooms', 'bath', 'baths', 'num_bathrooms',
    'stories', 'num_stories',
    'units', 'num_units',
    'sqft', 'size_sqft', 'square_feet', 'squarefeet',
    'age', 'property_age',
    'deductible', 'deductibles',
    'coverage_limit', 'limit',
    'dwelling_coverage', 'other_structures_coverage', 'personal_property_coverage',
    'loss_of_use_coverage', 'personal_liability', 'medical_payments',
    'home_value', 'property_value', 'market_value', 'purchase_price',
    'latitude', 'longitude', 'lat', 'lng', 'lon',
    'month', 'months', 'day', 'days', 'time', 'timestamp', 'created_at', 'updated_at'
  ]);

  function collectPremiumCandidates(root) {
    const out = [];
    (function walk(node, path) {
      if (node === null || node === undefined) return;
      if (typeof node === 'number') {
        if (isFinite(node) && node >= 50 && node <= 50000) {
          out.push({ path: path, value: node });
        }
        return;
      }
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) walk(node[i], path + '[' + i + ']');
        return;
      }
      if (typeof node === 'object') {
        for (const k of Object.keys(node)) {
          if (META_KEYS.has(k.toLowerCase())) continue;
          walk(node[k], path ? path + '.' + k : k);
        }
      }
    })(root, '');
    return out;
  }

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

  // Explicit known-field reads (back-compat / fast path)
  const namedHighest = typeof estObj.highest === 'number' ? estObj.highest : 0;
  const namedLowest  = typeof estObj.lowest  === 'number' ? estObj.lowest  : 0;

  // Fallback: scan every plausible premium-shaped numeric field
  const candidates = collectPremiumCandidates(est);
  candidates.sort((a, b) => b.value - a.value);
  const scannedMax = candidates.length ? candidates[0].value : 0;
  const scannedMin = candidates.length ? candidates[candidates.length - 1].value : 0;

  // Pick the annual rate — prefer the highest value we can find anywhere.
  // If `namedHighest` exists AND is the top candidate, use it (cleanest).
  // Otherwise use the highest scanned value (covers unknown field names).
  // Last resort: named lowest.
  let annual = 0;
  let rateTier = 'none';
  if (scannedMax > 0 && scannedMax >= namedHighest) {
    annual = scannedMax;
    rateTier = (scannedMax === namedHighest) ? 'highest' : 'scanned-max';
  } else if (namedHighest > 0) {
    annual = namedHighest;
    rateTier = 'highest';
  } else if (namedLowest > 0) {
    annual = namedLowest;
    rateTier = 'lowest(fallback)';
  }

  const monthly = annual > 0 ? Math.round(annual / 12) : 0;
  const startUrl = est.start_url || '';

  // Plausibility floor. US landlord insurance for a standard SFR almost
  // never comes in below ~$60/mo ($720/yr) — anything under that is almost
  // certainly a liability-only or bare-bones rate that the buyer can't
  // actually bind. Rather than display a misleading teaser, treat sub-floor
  // quotes as "no usable estimate" so the deal page shows "Get Quote →"
  // CTA (routing to the Steadily partner page) instead of a dollar number.
  // Overridable via INSURANCE_MIN_MONTHLY env var if we want to tune later.
  const minMonthly = parseInt(process.env.INSURANCE_MIN_MONTHLY || '60', 10);
  const belowFloor = monthly > 0 && monthly < minMonthly;
  if (belowFloor) {
    console.log('[insurance-quote] ' + city + ', ' + state +
      ' — $' + monthly + '/mo is below floor $' + minMonthly + '/mo; suppressing estimate');
  }

  console.log(
    '[insurance-quote] ' + city + ', ' + state +
    ' — $' + monthly + '/mo tier=' + rateTier +
    ' (named high=$' + namedHighest + ' low=$' + namedLowest +
    ' scannedMax=$' + scannedMax + ' scannedMin=$' + scannedMin +
    ' candidates=' + candidates.length + ')' +
    ' estimateKeys=[' + Object.keys(estObj).join(',') + ']' +
    ' url=' + (startUrl ? 'yes' : 'no')
  );
  if (candidates.length) {
    console.log('[insurance-quote] candidates: ' +
      candidates.slice(0, 8).map(c => c.path + '=$' + c.value).join(', '));
  }

  return {
    statusCode: 200,
    headers: headers,
    body: JSON.stringify({
      available: monthly > 0 && !belowFloor,
      annual: belowFloor ? 0 : annual,
      monthly: belowFloor ? 0 : monthly,
      annualHighest: Math.max(namedHighest, scannedMax),
      annualLowest:  namedLowest || scannedMin,
      rateTier: belowFloor ? 'below-floor' : rateTier,
      belowFloor: belowFloor,
      rawMonthly: monthly,
      startUrl: startUrl,
      propertyId: est.property_id || '',
      _debug: {
        estimateKeys: Object.keys(estObj),
        candidates: candidates.slice(0, 8),
        minMonthly: minMonthly
      }
    })
  };
};
