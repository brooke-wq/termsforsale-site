// Shared Steadily insurance API helper — native fetch (Node 18+), no npm packages.
// Prefix _ means Netlify will NOT deploy this as a function (it's a private module).
//
// ENV VARS:
//   STEADILY_API_KEY  — required. Throws if unset (no hardcoded fallback).
//   STEADILY_LIVE     — if truthy, routes to production api.steadily.com.
//                       Otherwise defaults to api.staging.steadily.com.
//
// Exports:
//   quoteEstimate(payload, opts?)
//       POST /v1/quote/estimate — sends payload as-is, returns { status, body }.
//       Throws on non-2xx with { status, body } attached to the Error.
//
//   buildPropertyPayload({ address, propertyId, propertyDetails,
//                          propertyMetadata, metadata })
//       Convenience builder for single-property requests. Only the `address`
//       field is required; everything else is optional passthrough.
//
// NOTE on response shape: the Steadily Redoc docs
// (https://api.steadily.com/estimate-api/redoc#tag/Quote-Estimates/operation/quote_estimate)
// were not reachable from the build environment when this helper was written
// (403 from the network). The helper therefore returns the full parsed JSON
// body as-is so callers can read whichever fields the current API version
// documents — no silent field dropping.
//
// EMPIRICAL SCHEMA NOTES (observed from staging, not Redoc — update as learned):
//   - `properties[].property_id` is REQUIRED. Omitting it returns a 422 with
//     `{"detail":[{"loc":["body","properties",0,"property_id"], "msg":"field required"}]}`.
//     Callers should pass a stable caller-defined string (e.g. hash of the
//     address) so repeat lookups for the same property get the same ID.
//   - `properties[].property_details` / `property_metadata` / top-level
//     `metadata` appear to be optional passthrough bags.
//   - On 2xx, the body contains `estimates[]`. Each estimate has an `estimate`
//     object with TWO annual-premium numbers: `lowest` (bare-bones coverage)
//     and `highest` (full coverage). Also `start_url` and `property_id`.
//     `insurance-quote.js` projects `highest` (falling back to `lowest` if
//     highest is missing) so the deal page never quotes bare-bones.

const STAGING_BASE = 'https://api.staging.steadily.com';
const PROD_BASE    = 'https://api.steadily.com';
const ESTIMATE_PATH = '/v1/quote/estimate';
const DEFAULT_TIMEOUT_MS = 15000;

function getBaseUrl() {
  return process.env.STEADILY_LIVE ? PROD_BASE : STAGING_BASE;
}

function getApiKey() {
  const key = process.env.STEADILY_API_KEY;
  if (!key) {
    throw new Error('STEADILY_API_KEY env var is not set');
  }
  return key;
}

/**
 * POST /v1/quote/estimate
 *
 * @param {object} payload - Full Steadily request body. Must include a
 *   non-empty `properties` array. May also include top-level `metadata`.
 * @param {object} [opts]
 * @param {string} [opts.apiKey]    - override env-provided API key
 * @param {string} [opts.baseUrl]   - override base URL (e.g. for tests)
 * @param {number} [opts.timeoutMs] - request timeout, default 15s
 * @returns {Promise<{ status: number, body: object }>}
 * @throws Error with `.status` and `.body` on non-2xx
 */
async function quoteEstimate(payload, opts) {
  opts = opts || {};

  if (!payload || !Array.isArray(payload.properties) || payload.properties.length === 0) {
    throw new Error('quoteEstimate: payload.properties must be a non-empty array');
  }

  const apiKey = opts.apiKey || getApiKey();
  const baseUrl = opts.baseUrl || getBaseUrl();
  const url = baseUrl + ESTIMATE_PATH;

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, opts.timeoutMs || DEFAULT_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Steadily-ApiKey': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      const e = new Error('Steadily request timed out after ' + (opts.timeoutMs || DEFAULT_TIMEOUT_MS) + 'ms');
      e.status = 0;
      throw e;
    }
    throw err;
  }
  clearTimeout(timer);

  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; }
  catch (e) { body = { raw: text }; }

  if (!res.ok) {
    console.error('[steadily] ' + res.status + ' ' + url + ' ' + text.slice(0, 300));
    const err = new Error('Steadily API error ' + res.status);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return { status: res.status, body: body };
}

/**
 * Build a single-property payload for quoteEstimate().
 *
 * @param {object} args
 * @param {object} args.address            - { street_address, city, state, zip_code, county? }
 * @param {string} [args.propertyId]       - caller-defined id passed through as `property_id`
 * @param {object} [args.propertyDetails]  - size_sqft, year_built, property_type, etc.
 * @param {object} [args.propertyMetadata] - arbitrary passthrough bag for the property
 * @param {object} [args.metadata]         - top-level metadata for the overall request
 * @returns {object} payload suitable for quoteEstimate()
 */
function buildPropertyPayload(args) {
  args = args || {};
  const address = args.address;
  if (!address || !address.street_address || !address.city || !address.state) {
    throw new Error('buildPropertyPayload: address.street_address, address.city, and address.state are required');
  }

  const property = { address: address };
  if (args.propertyId) property.property_id = args.propertyId;
  if (args.propertyDetails && typeof args.propertyDetails === 'object') {
    property.property_details = args.propertyDetails;
  }
  if (args.propertyMetadata && typeof args.propertyMetadata === 'object') {
    property.property_metadata = args.propertyMetadata;
  }

  const payload = { properties: [property] };
  if (args.metadata && typeof args.metadata === 'object') {
    payload.metadata = args.metadata;
  }
  return payload;
}

module.exports = { quoteEstimate, buildPropertyPayload };
