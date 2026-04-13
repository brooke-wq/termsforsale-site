/**
 * property-lookup.js — Rentcast property data proxy
 *
 * GET /api/property-lookup?address=123+Main+St&city=Phoenix&state=AZ&zip=85001
 *
 * Returns property details (beds, baths, sqft, year built, lot size, property type)
 * from the Rentcast API. Proxied through a Netlify function so the API key
 * stays server-side.
 *
 * Env: RENTCAST_API_KEY (required)
 */

const RENTCAST_BASE = 'https://api.rentcast.io/v1';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'RENTCAST_API_KEY not configured' }) };
  }

  const qs = event.queryStringParameters || {};
  const address = qs.address;
  const city = qs.city;
  const state = qs.state;
  const zip = qs.zip;

  if (!address) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'address is required' }) };
  }

  try {
    // Build the Rentcast query — use full address for best match
    const params = new URLSearchParams();
    params.set('address', address);
    if (city) params.set('city', city);
    if (state) params.set('state', state);
    if (zip) params.set('zipCode', zip);

    const url = `${RENTCAST_BASE}/properties?${params.toString()}`;
    console.log('[property-lookup] Fetching:', url.replace(apiKey, '***'));

    const res = await fetch(url, {
      headers: { 'X-Api-Key': apiKey, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error('[property-lookup] Rentcast error:', res.status, errBody);
      return {
        statusCode: res.status === 404 ? 404 : 502,
        headers,
        body: JSON.stringify({ error: 'Property not found', status: res.status })
      };
    }

    const data = await res.json();

    // Rentcast returns an array — take the first match
    const prop = Array.isArray(data) ? data[0] : data;
    if (!prop) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No property found at that address' }) };
    }

    // Map Rentcast property types to our form options
    const typeMap = {
      'Single Family': 'Single Family',
      'Condo': 'Condo / Townhome',
      'Townhouse': 'Condo / Townhome',
      'Townhome': 'Condo / Townhome',
      'Multi-Family': 'Multi-Family (5+)',
      'Multifamily': 'Multi-Family (5+)',
      'Duplex': 'Duplex',
      'Triplex': 'Triplex',
      'Quadruplex': 'Quadplex',
      'Manufactured': 'Manufactured / Mobile',
      'Mobile': 'Manufactured / Mobile',
      'Land': 'Land',
      'Commercial': 'Commercial',
    };

    const rawType = prop.propertyType || '';
    const mappedType = typeMap[rawType] || '';

    // Normalize lot size to readable format
    let lotSize = '';
    if (prop.lotSize) {
      lotSize = prop.lotSize >= 43560
        ? (prop.lotSize / 43560).toFixed(2) + ' acres'
        : prop.lotSize.toLocaleString() + ' sqft';
    }

    const result = {
      bedrooms: prop.bedrooms || null,
      bathrooms: prop.bathrooms || null,
      squareFootage: prop.squareFootage || null,
      yearBuilt: prop.yearBuilt || null,
      lotSize: lotSize || null,
      propertyType: mappedType || null,
      rawPropertyType: rawType,
      // Bonus fields the form doesn't use yet but could be useful
      addressFull: prop.addressLine1 || null,
      county: prop.county || null,
      lastSalePrice: prop.lastSalePrice || null,
      lastSaleDate: prop.lastSaleDate || null,
    };

    return { statusCode: 200, headers, body: JSON.stringify(result) };

  } catch (err) {
    console.error('[property-lookup] Error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
