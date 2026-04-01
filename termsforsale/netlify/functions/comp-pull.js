// Netlify function: comp-pull
// POST /api/comp-pull
// AI-assisted market estimate for a property. NOT real comps (no MLS access).
// Uses HUD FMR data + Claude to estimate ARV range and rent.
//
// ENV VARS: ANTHROPIC_API_KEY

const { complete } = require('./_claude');

const MARKET_SYSTEM = `You are a real estate market analyst for Deal Pros LLC, a wholesale and creative finance company based in Phoenix, AZ.

You are generating an AI-assisted market estimate — NOT actual comparable sales. You do not have MLS access. Your estimates are based on general market knowledge, the property details provided, and any HUD Fair Market Rent data supplied.

PHOENIX/SCOTTSDALE MARKET BASELINES (use as anchors for AZ properties):
  Phoenix SFR: $150–$200/sqft mid | rent $1.00–$1.15/sqft
  Mesa SFR: $160–$210/sqft mid | rent $1.05–$1.20/sqft
  Scottsdale SFR: $280–$380/sqft mid | rent $1.40–$1.80/sqft
  Pool premium: $10,000–$18,000
  Target days on market: 7–21 days

For properties OUTSIDE Phoenix metro, use your general US real estate knowledge and clearly note lower confidence.

IMPORTANT GUIDELINES:
- arv_low = conservative estimate (distressed / quick sale)
- arv_mid = most likely market value (retail, average condition)
- arv_high = optimistic estimate (fully renovated, strong market)
- rent_estimate = estimated monthly rent based on HUD FMR data and property size
- market_notes = 2-3 sentences about the local market conditions, demand, and any factors affecting value
- confidence = "high" (Phoenix metro with good data), "medium" (known market, limited data), or "low" (unfamiliar market or missing key details)

Respond with valid JSON only.`;

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'POST only' });

  var anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return respond(500, { error: 'Missing ANTHROPIC_API_KEY' });
  }

  var body;
  try { body = JSON.parse(event.body); } catch(e) {
    return respond(400, { error: 'Invalid JSON' });
  }

  var address = body.address || '';
  var city    = body.city || '';
  var state   = body.state || '';
  var zip     = body.zip || '';
  var beds    = body.beds || null;
  var baths   = body.baths || null;
  var sqft    = body.sqft || null;

  if (!address) {
    return respond(400, { error: 'address is required' });
  }

  try {
    // Step 1: Fetch HUD FMR data if we have enough location info
    var fmrData = null;
    if (zip || (city && state)) {
      try {
        fmrData = await fetchFMR(zip, city, state);
        console.log('[comp-pull] FMR data retrieved: ' + (fmrData ? 'yes' : 'no'));
      } catch (fmrErr) {
        console.warn('[comp-pull] FMR fetch failed (non-fatal):', fmrErr.message);
      }
    }

    // Step 2: Build prompt for Claude
    var propertyDetails = [
      'Address: ' + [address, city, state, zip].filter(Boolean).join(', '),
      beds ? 'Bedrooms: ' + beds : null,
      baths ? 'Bathrooms: ' + baths : null,
      sqft ? 'Square Feet: ' + sqft : null,
      body.year_built ? 'Year Built: ' + body.year_built : null,
      body.condition ? 'Condition: ' + body.condition : null,
      body.property_type ? 'Property Type: ' + body.property_type : null,
      body.lot_size ? 'Lot Size: ' + body.lot_size : null,
      body.pool ? 'Pool: Yes' : null
    ].filter(Boolean).join('\n');

    var fmrSection = '';
    if (fmrData) {
      fmrSection = '\n\nHUD FAIR MARKET RENT DATA:\n' +
        '  Area: ' + (fmrData.area_name || fmrData.county_name || 'Unknown') + '\n' +
        '  1BR FMR: $' + (fmrData.fmr_1br || fmrData.Rent_br1 || '?') + '\n' +
        '  2BR FMR: $' + (fmrData.fmr_2br || fmrData.Rent_br2 || '?') + '\n' +
        '  3BR FMR: $' + (fmrData.fmr_3br || fmrData.Rent_br3 || '?') + '\n' +
        '  4BR FMR: $' + (fmrData.fmr_4br || fmrData.Rent_br4 || '?');
    }

    var userPrompt = 'Generate a market estimate for this property:\n\n' +
      propertyDetails + fmrSection + '\n\n' +
      'Return JSON: { "arv_low": number, "arv_mid": number, "arv_high": number, ' +
      '"rent_estimate": number, "price_per_sqft": number, "confidence": "high|medium|low", ' +
      '"market_notes": "string" }';

    console.log('[comp-pull] estimating: ' + address + ', ' + city + ' ' + state);

    var claudeRes = await complete(anthropicKey, {
      system: MARKET_SYSTEM,
      user: userPrompt,
      maxTokens: 600,
      json: true
    });

    var result = claudeRes.text;

    console.log('[comp-pull] ARV mid=$' + (result.arv_mid || 0) +
      ' confidence=' + (result.confidence || '?') +
      ' cost=$' + claudeRes.usage.cost.toFixed(6));

    return respond(200, {
      comps_estimated: true,
      address: [address, city, state, zip].filter(Boolean).join(', '),
      arv_low: result.arv_low || 0,
      arv_mid: result.arv_mid || 0,
      arv_high: result.arv_high || 0,
      rent_estimate: result.rent_estimate || 0,
      price_per_sqft: result.price_per_sqft || null,
      confidence: result.confidence || 'low',
      market_notes: result.market_notes || '',
      fmr_data: fmrData || null,
      usage: claudeRes.usage,
      disclaimer: 'DISCLAIMER: These are AI-generated market estimates based on general market data and HUD Fair Market Rents. They are NOT actual comparable sales from MLS. Do not use these figures as the sole basis for investment decisions. Always obtain a professional appraisal or BPO and verify with actual closed comps before making offers.'
    });

  } catch (err) {
    console.error('[comp-pull] error:', err.message);
    return respond(500, { error: err.message });
  }
};

/**
 * Fetch HUD Fair Market Rent data via the internal hud-fmr function.
 * Calls the HUD FMR API directly (same logic as hud-fmr.js).
 */
async function fetchFMR(zip, city, state) {
  // HUD FMR API — free, no key needed
  var baseUrl = 'https://www.huduser.gov/hudapi/public/fmr/data/';

  // Try by ZIP first (most reliable)
  if (zip) {
    var url = baseUrl + encodeURIComponent(zip) + '?year=2024';
    var res = await fetch(url, {
      headers: { 'User-Agent': 'DealPros-CompPull/1.0' }
    });
    if (res.ok) {
      var data = await res.json();
      if (data && data.data && data.data.basicdata) {
        return data.data.basicdata;
      }
      if (data && data.data) {
        return data.data;
      }
    }
  }

  // Fallback: try state+county query if zip fails
  if (state) {
    var stateUrl = 'https://www.huduser.gov/hudapi/public/fmr/statedata/' +
      encodeURIComponent(state) + '?year=2024';
    var stateRes = await fetch(stateUrl, {
      headers: { 'User-Agent': 'DealPros-CompPull/1.0' }
    });
    if (stateRes.ok) {
      var stateData = await stateRes.json();
      if (stateData && stateData.data) {
        return stateData.data;
      }
    }
  }

  return null;
}

function respond(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(body)
  };
}
