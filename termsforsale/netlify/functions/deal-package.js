// Netlify function: deal-package
// POST endpoint — accepts deal data, generates buyer-facing marketing package via Claude.
//
// Returns:
//   sms: [3 versions, each < 160 chars]
//   emailSubjects: [2 options]
//   emailBody: full email body
//   socialHook: social media hook
//
// ENV VARS: ANTHROPIC_API_KEY
//
// NEVER include seller name or internal MAO in output.
// Brand voice: Terms For Sale — professional, investor-to-investor, numbers first.

const { complete } = require('./_claude');

const PACKAGE_SYSTEM = `You are the marketing director for Terms For Sale, a real estate disposition company that connects motivated sellers with real estate investors.

Brand voice: Professional, investor-to-investor. Lead with numbers. No fluff, no hype. Investors respect deals that speak for themselves. Be specific — exact prices, exact cash flow, exact entry. Use "we" sparingly.

STRICT RULES:
- NEVER include the seller's name
- NEVER mention or hint at MAO (Maximum Allowable Offer) — it's internal only
- NEVER say "motivated seller" — say the deal type instead (SubTo, Seller Finance, etc.)
- Lead with location and deal structure
- Always end with the deal URL or a call to action`;

exports.handler = async function(event) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: headers, body: JSON.stringify({ error: 'POST required' }) };
  }

  var anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };
  }

  var deal;
  try {
    deal = JSON.parse(event.body || '{}');
  } catch(e) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!deal.address && !deal.street_address && !deal.streetAddress) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'address required' }) };
  }

  try {
    var address   = deal.address || deal.street_address || deal.streetAddress || '';
    var city      = deal.city || '';
    var state     = deal.state || '';
    var zip       = deal.zip || '';
    var dealType  = deal.deal_type || deal.dealType || '';
    var asking    = deal.asking_price || deal.askingPrice || 0;
    var entry     = deal.entry_fee || deal.entryFee || 0;
    var arv       = deal.arv || deal.compsArv || 0;
    var rent      = deal.rent || deal.rentFinal || 0;
    var beds      = deal.beds || '';
    var baths     = deal.baths || '';
    var sqft      = deal.sqft || deal.living_area || '';
    var yearBuilt = deal.year_built || deal.yearBuilt || '';
    var propType  = deal.property_type || deal.propertyType || '';
    var highlight1 = deal.highlight1 || deal.highlight_1 || '';
    var highlight2 = deal.highlight2 || deal.highlight_2 || '';
    var highlight3 = deal.highlight3 || deal.highlight_3 || '';
    var loanBal   = deal.loan_balance || deal.subtoLoanBalance || '';
    var rate      = deal.rate || deal.subtoRate || '';
    var piti      = deal.piti || '';
    var dealUrl   = deal.deal_url || deal.dealUrl || 'https://deals.termsforsale.com/deal.html?id=' + (deal.id || '');

    var fmt = function(n) { return n ? '$' + (+n).toLocaleString() : ''; };

    var dealFacts = [
      'Location: ' + [address, city, state, zip].filter(Boolean).join(', '),
      'Deal Type: ' + (dealType || 'not specified'),
      'Property: ' + [propType, beds ? beds + 'bd' : '', baths ? baths + 'ba' : '', sqft ? sqft + ' sqft' : '', yearBuilt ? 'built ' + yearBuilt : ''].filter(Boolean).join(' '),
      'Asking Price: ' + (fmt(asking) || 'not provided'),
      'Entry Fee: ' + (fmt(entry) || 'not provided'),
      'ARV: ' + (fmt(arv) || 'not provided'),
      'Market Rent: ' + (fmt(rent) || 'not provided'),
      loanBal ? 'Existing Loan Balance: ' + fmt(loanBal) : '',
      rate     ? 'Rate: ' + rate + '%' : '',
      piti     ? 'PITI: ' + fmt(piti) : '',
      highlight1 ? 'Highlight: ' + highlight1 : '',
      highlight2 ? 'Highlight: ' + highlight2 : '',
      highlight3 ? 'Highlight: ' + highlight3 : '',
      'Deal URL: ' + dealUrl
    ].filter(Boolean).join('\n');

    var userPrompt = `Create a complete marketing package for this deal:

${dealFacts}

Output valid JSON with exactly these keys:
{
  "sms": ["version1 under 160 chars", "version2 under 160 chars", "version3 under 160 chars"],
  "emailSubjects": ["subject option 1", "subject option 2"],
  "emailBody": "full email body — professional investor tone, 150-250 words, lead with numbers, close with deal URL",
  "socialHook": "1-2 sentence social media hook for FB/IG real estate investor groups"
}

SMS rules: Each version must be under 160 characters, include deal type + location + key number + deal URL (shortened to just the path like /deal/ID if needed to fit). Three distinct angles: one price-focused, one cash-flow-focused, one structure-focused.`;

    console.log('deal-package: calling Claude for ' + address + ', ' + city + ', ' + state);
    var claudeRes = await complete(anthropicKey, {
      system: PACKAGE_SYSTEM,
      user: userPrompt,
      maxTokens: 1200,
      json: true
    });
    var result = claudeRes.text;

    // Validate SMS lengths
    if (Array.isArray(result.sms)) {
      result.sms = result.sms.map(function(msg, i) {
        if (msg.length > 160) {
          console.warn('deal-package: SMS[' + i + '] is ' + msg.length + ' chars, truncating');
          return msg.slice(0, 157) + '...';
        }
        return msg;
      });
    }

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        success: true,
        address: [address, city, state].filter(Boolean).join(', '),
        dealType: dealType,
        package: result
      })
    };

  } catch (err) {
    console.error('deal-package error:', err.message);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
