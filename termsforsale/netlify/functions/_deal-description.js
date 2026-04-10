/**
 * Auto-generate a buyer-facing deal description via Claude Haiku.
 *
 * Called by notify-buyers.js (for new deals) and
 * scripts/backfill-descriptions.js (for legacy deals).
 * Uses claude-haiku-4-5-20251001 (~$0.001/call) per CLAUDE.md cost rules.
 *
 * Returns plain text (2-4 sentences), investor-to-investor tone,
 * numbers-first, no street addresses, no fluff.
 */

var HAIKU_MODEL = 'claude-haiku-4-5-20251001';
var API_URL = 'https://api.anthropic.com/v1/messages';

var SYSTEM = [
  'You write 2-4 sentence property descriptions for a real estate wholesale company called Terms For Sale.',
  'Tone: professional, investor-to-investor, numbers-first. No fluff or hype.',
  'NEVER include the street address — use city/state only.',
  'Lead with the deal type + location, then key financials, then property highlights.',
  'Output plain text only — no markdown, no bullet points, no headings.'
].join(' ');

function fmt(n) { return n ? '$' + Number(n).toLocaleString() : ''; }

function buildPrompt(deal) {
  var facts = [
    'Deal Type: ' + (deal.dealType || 'unknown'),
    'Location: ' + [deal.city, deal.state].filter(Boolean).join(', '),
    deal.propertyType ? 'Property: ' + deal.propertyType : '',
    deal.askingPrice ? 'Asking Price: ' + fmt(deal.askingPrice) : '',
    deal.entryFee ? 'Entry Fee: ' + fmt(deal.entryFee) + ' + CC/TC' : '',
    deal.arv || deal.compsArv ? 'ARV: ' + fmt(deal.arv || deal.compsArv) : '',
    deal.rentFinal ? 'Est. Rent: ' + fmt(deal.rentFinal) + '/mo' : '',
    deal.beds ? 'Beds: ' + deal.beds : '',
    deal.baths ? 'Baths: ' + deal.baths : '',
    deal.sqft ? 'Sqft: ' + deal.sqft : '',
    deal.yearBuilt ? 'Year Built: ' + deal.yearBuilt : '',
    deal.subtoLoanBalance ? 'SubTo Loan Balance: ' + fmt(deal.subtoLoanBalance) : '',
    deal.subtoRate ? 'SubTo Rate: ' + deal.subtoRate + '%' : '',
    deal.piti ? 'PITI: ' + fmt(deal.piti) + '/mo' : '',
    deal.sfLoanAmount ? 'Seller Finance Amount: ' + fmt(deal.sfLoanAmount) : '',
    deal.sfRate ? 'SF Rate: ' + deal.sfRate + '%' : '',
    deal.sfTerm ? 'SF Term: ' + deal.sfTerm : '',
    deal.sfPayment ? 'SF Payment: ' + fmt(deal.sfPayment) + '/mo' : '',
    deal.highlight1 ? 'Highlight: ' + deal.highlight1 : '',
    deal.highlight2 ? 'Highlight: ' + deal.highlight2 : '',
    deal.highlight3 ? 'Highlight: ' + deal.highlight3 : '',
    deal.occupancy ? 'Occupancy: ' + deal.occupancy : '',
    deal.hoa ? 'HOA: ' + deal.hoa : ''
  ].filter(Boolean).join('\n');

  return 'Write a 2-4 sentence investor-facing description for this deal:\n\n' + facts;
}

async function generateDescription(apiKey, deal) {
  if (!apiKey) throw new Error('Missing CLAUDE_API_KEY');
  if (!deal) throw new Error('Missing deal');

  var user = buildPrompt(deal);

  var res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 256,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }]
    })
  });

  var text = await res.text();
  var data;
  try { data = JSON.parse(text); } catch (e) {
    throw new Error('Claude API non-JSON: ' + text.slice(0, 200));
  }

  if (res.status !== 200 || data.error) {
    throw new Error('Claude API error ' + res.status + ': ' + (data.error ? data.error.message : text.slice(0, 200)));
  }

  var content = (data.content || [])[0];
  if (!content || content.type !== 'text') {
    throw new Error('Claude returned unexpected content type');
  }

  var usage = data.usage || {};
  var cost = ((usage.input_tokens || 0) * 0.80 / 1e6) + ((usage.output_tokens || 0) * 4.00 / 1e6);
  console.log('[deal-desc] model=' + HAIKU_MODEL + ' in=' + (usage.input_tokens || 0) + ' out=' + (usage.output_tokens || 0) + ' cost=$' + cost.toFixed(6));

  return content.text.trim();
}

module.exports = { generateDescription: generateDescription };
