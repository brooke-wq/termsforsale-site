/**
 * Auto-Tag Buyer Responses — POST /.netlify/functions/buyer-response-tag
 *
 * GHL workflow webhook: when a buyer replies to a deal blast SMS/email,
 * parse their response and auto-tag them.
 *
 * Response mapping:
 *   "1" or "IN"    → interested (tag: buyer-interested)
 *   "2" or "MAYBE" → maybe (tag: buyer-maybe)
 *   "3" or "PASS"  → pass (tag: buyer-pass)
 *
 * GHL webhook payload: { contact_id, message, ... }
 */

const { getContact, addTags, removeTags, postNote } = require('./_ghl');

// Response patterns (case-insensitive)
const PATTERNS = [
  { match: /^1$|^in$|^interested$|^i'm in$|^im in$|^yes$|^send it$|^send info$/i, tag: 'buyer-interested', label: 'INTERESTED', emoji: '🟢' },
  { match: /^2$|^maybe$|^possibly$|^tell me more$|^more info$/i, tag: 'buyer-maybe', label: 'MAYBE', emoji: '🟡' },
  { match: /^3$|^pass$|^no$|^not interested$|^no thanks$|^nah$|^skip$/i, tag: 'buyer-pass', label: 'PASS', emoji: '🔴' },
];

// Tags to remove when re-categorizing (so a buyer doesn't have conflicting tags)
const ALL_RESPONSE_TAGS = PATTERNS.map(function(p) { return p.tag; });

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

  const contactId = body.contact_id || body.contactId || (body.contact && body.contact.id);
  const message = (body.message || body.body || body.text || '').trim();

  if (!contactId || !message) {
    return respond(200, { ok: true, skipped: 'no contactId or message' });
  }

  // Match the response
  let matched = null;
  for (let i = 0; i < PATTERNS.length; i++) {
    if (PATTERNS[i].match.test(message)) {
      matched = PATTERNS[i];
      break;
    }
  }

  if (!matched) {
    console.log('[buyer-response-tag] unmatched reply from ' + contactId + ': "' + message + '"');
    return respond(200, { ok: true, matched: false, message: message });
  }

  try {
    // Remove any existing response tags, then add the new one
    await removeTags(apiKey, contactId, ALL_RESPONSE_TAGS);
    await addTags(apiKey, contactId, [matched.tag, 'buyer-responded']);

    // Post note
    await postNote(apiKey, contactId,
      matched.emoji + ' BUYER RESPONSE: ' + matched.label + '\n' +
      'Message: "' + message + '"\n' +
      'Tagged: ' + matched.tag + '\n' +
      'Date: ' + new Date().toISOString().split('T')[0]
    );

    console.log('[buyer-response-tag] ' + contactId + ' → ' + matched.tag + ' ("' + message + '")');

    return respond(200, {
      ok: true,
      matched: true,
      tag: matched.tag,
      label: matched.label
    });

  } catch (err) {
    console.error('[buyer-response-tag] error:', err.message);
    return respond(500, { error: err.message });
  }
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
