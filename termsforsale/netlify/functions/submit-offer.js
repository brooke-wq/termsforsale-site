/**
 * Submit Offer — POST /.netlify/functions/submit-offer
 * Records an offer as a GHL note on the contact + adds tags.
 */

const { getContact, postNote, addTags } = require('./_ghl');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'POST only' });
  }

  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) return respond(500, { error: 'Server config error' });

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return respond(400, { error: 'Invalid JSON' }); }

  const { contactId, dealId, address, amount, coe, notes } = body;

  if (!contactId || !dealId) {
    return respond(400, { error: 'Missing contactId or dealId' });
  }

  // Verify contact
  const contact = await getContact(apiKey, contactId);
  if (contact.status >= 400) return respond(401, { error: 'Invalid contact' });

  // Build note body
  const noteLines = [
    '📋 OFFER SUBMITTED',
    '─────────────────',
    'Deal: ' + (address || dealId),
    amount ? 'Offer Amount: $' + Number(amount).toLocaleString() : '',
    coe ? 'Target Close: ' + coe : '',
    notes ? 'Notes: ' + notes : '',
    '─────────────────',
    'Submitted: ' + new Date().toISOString().split('T')[0],
    'Source: Terms For Sale Website'
  ].filter(Boolean).join('\n');

  // Post note + add tags in parallel
  await Promise.all([
    postNote(apiKey, contactId, noteLines),
    addTags(apiKey, contactId, ['Offer Submitted', 'Active Buyer'])
  ]);

  console.log('[submit-offer] contact=' + contactId + ' deal=' + dealId + ' amount=' + amount);

  return respond(200, { ok: true });
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function respond(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}
