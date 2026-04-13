/**
 * Auto-Tag Buyer Responses — POST /.netlify/functions/buyer-response-tag
 *
 * GHL workflow webhook: when a buyer replies to a deal blast SMS/email,
 * parse their response and auto-tag them.
 *
 * Response mapping:
 *   "1" or "IN"    → interested (tag: buyer-interested)
 *   "2" or "MAYBE" → maybe       (tag: buyer-maybe)
 *   "3" or "PASS"  → pass        (tag: buyer-pass)
 *
 * Day 2 follow-up (deal-follow-up.js SMS 3) also asks for A/B/C:
 *   "A" or "keep"      → pref-keep-all     (no change to alert flow)
 *   "B" or "tighten"   → pref-market-only  (gate future alerts to buyer's target cities)
 *   "C" or "pause"     → alerts-paused     (stop future alerts entirely)
 *
 * A/B/C tags are mutually exclusive — writing one always clears the other two.
 * The actual gating for pref-market-only / alerts-paused lives in notify-buyers.js.
 *
 * GHL webhook payload: { contact_id, message, ... }
 */

const { getContact, addTags, removeTags, postNote } = require('./_ghl');

// Response patterns (case-insensitive, tested against trimmed message)
// Exact matches first, then "contains" patterns for natural language
const PATTERNS = [
  // ── INTERESTED (green) ──
  { match: /^1$|^in$|^i'm in$|^im in$|^yes$|^yep$|^yeah$|^yea$|^ya$|^yup$/i, tag: 'buyer-interested', label: 'INTERESTED', emoji: '🟢' },
  { match: /^interested$|^i'm interested$|^im interested$|^very interested$/i, tag: 'buyer-interested', label: 'INTERESTED', emoji: '🟢' },
  { match: /^send it$|^send info$|^send me info$|^send details$|^send me details$/i, tag: 'buyer-interested', label: 'INTERESTED', emoji: '🟢' },
  { match: /^let's go$|^lets go$|^lock it$|^i want it$|^i'll take it$|^ill take it$/i, tag: 'buyer-interested', label: 'INTERESTED', emoji: '🟢' },
  { match: /^sign me up$|^count me in$|^down$|^i'm down$|^im down$|^for sure$/i, tag: 'buyer-interested', label: 'INTERESTED', emoji: '🟢' },
  { match: /^let me know$|^keep me posted$|^sounds good$|^sounds great$/i, tag: 'buyer-interested', label: 'INTERESTED', emoji: '🟢' },
  { match: /^what's the address|^whats the address|^where is it|^send me the address/i, tag: 'buyer-interested', label: 'INTERESTED', emoji: '🟢' },
  { match: /^can i see it|^can I get more|^tell me more about this|^what are the terms/i, tag: 'buyer-interested', label: 'INTERESTED', emoji: '🟢' },
  // ── MAYBE (yellow) ──
  { match: /^2$|^maybe$|^possibly$|^perhaps$|^might be$|^could be$/i, tag: 'buyer-maybe', label: 'MAYBE', emoji: '🟡' },
  { match: /^more info$|^need more info$|^send more info$|^tell me more$/i, tag: 'buyer-maybe', label: 'MAYBE', emoji: '🟡' },
  { match: /^what's the price|^whats the price|^how much$|^what's the entry|^whats the entry/i, tag: 'buyer-maybe', label: 'MAYBE', emoji: '🟡' },
  { match: /^depends$|^it depends$|^not sure$|^idk$|^i don't know$|^thinking about it$/i, tag: 'buyer-maybe', label: 'MAYBE', emoji: '🟡' },
  // ── PASS (red) ──
  { match: /^3$|^pass$|^no$|^nope$|^nah$|^no thanks$|^no thank you$/i, tag: 'buyer-pass', label: 'PASS', emoji: '🔴' },
  { match: /^not interested$|^not for me$|^i'll pass$|^ill pass$|^hard pass$/i, tag: 'buyer-pass', label: 'PASS', emoji: '🔴' },
  { match: /^skip$|^remove me$|^unsubscribe$|^stop$|^take me off$|^opt out$/i, tag: 'buyer-pass', label: 'PASS', emoji: '🔴' },
  { match: /^too expensive$|^too rich$|^out of my range$|^over budget$/i, tag: 'buyer-pass', label: 'PASS', emoji: '🔴' },
  { match: /^not in my area$|^wrong market$|^don't buy there$|^too far$/i, tag: 'buyer-pass', label: 'PASS', emoji: '🔴' },
  // ── ALERT PREFERENCE (A/B/C from Day 2 follow-up SMS 3) ──
  // A = keep sending everything (default, just records the preference)
  { match: /^a$|^a\.$|^a\)$/i, tag: 'pref-keep-all', label: 'KEEP ALL', emoji: '🟢', kind: 'pref' },
  { match: /^keep$|^keep sending$|^keep them coming$|^keep it coming$|^keep all$|^keep sending stuff$/i, tag: 'pref-keep-all', label: 'KEEP ALL', emoji: '🟢', kind: 'pref' },
  // B = tighten to their target market only (gates future alerts to target cities)
  { match: /^b$|^b\.$|^b\)$/i, tag: 'pref-market-only', label: 'MARKET ONLY', emoji: '🔵', kind: 'pref' },
  { match: /^tighten$|^tighten up$|^market only$|^my market only$|^city only$|^tighten to market$|^tighten to my market$/i, tag: 'pref-market-only', label: 'MARKET ONLY', emoji: '🔵', kind: 'pref' },
  // C = pause all alerts (notify-buyers will skip this contact entirely)
  { match: /^c$|^c\.$|^c\)$/i, tag: 'alerts-paused', label: 'PAUSED', emoji: '⏸', kind: 'pref' },
  { match: /^pause$|^pause alerts$|^pause for now$|^stop for now$|^pause me$|^pause my alerts$/i, tag: 'alerts-paused', label: 'PAUSED', emoji: '⏸', kind: 'pref' },
];

// Legacy deal-sprint response tags (IN/MAYBE/PASS family) — cleared together when re-categorizing.
const DEAL_RESPONSE_TAGS = PATTERNS
  .filter(function(p) { return p.kind !== 'pref'; })
  .map(function(p) { return p.tag; });

// Alert-preference tags (A/B/C family) — mutually exclusive; writing one clears the other two.
const PREF_TAGS = ['pref-keep-all', 'pref-market-only', 'alerts-paused'];

// Kept for backwards-compat with any callers referencing the full list.
const ALL_RESPONSE_TAGS = DEAL_RESPONSE_TAGS.concat(PREF_TAGS);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return respond(405, { error: 'GET or POST only' });
  }

  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) return respond(500, { error: 'Server config error' });

  // Accept data from POST body or GET query params (GHL webhooks may send either)
  let body;
  if (event.httpMethod === 'POST') {
    try { body = JSON.parse(event.body); }
    catch (e) { return respond(400, { error: 'Invalid JSON' }); }
  } else {
    body = event.queryStringParameters || {};
  }

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
    var isPref = matched.kind === 'pref';
    var tagsToRemove, tagsToAdd, noteHeading;

    if (isPref) {
      // A/B/C alert preference: the three pref tags are mutually exclusive.
      // Always clear the other two prefs, write the new one, and stamp
      // buyer-responded so the Day 2 sprint stops on this deal.
      tagsToRemove = PREF_TAGS.slice();
      tagsToAdd = [matched.tag, 'buyer-responded'];
      noteHeading = 'ALERT PREF';
    } else {
      // Legacy IN/MAYBE/PASS flow: also swap the deal-hot/warm/paused
      // sprint tag so deal-follow-up.js stops on the right branch.
      var SPRINT_TAGS = ['deal-hot', 'deal-warm', 'deal-paused'];
      var sprintTag = matched.tag === 'buyer-interested' ? 'deal-hot'
                    : matched.tag === 'buyer-maybe' ? 'deal-warm'
                    : 'deal-paused';
      tagsToRemove = DEAL_RESPONSE_TAGS.concat(SPRINT_TAGS);
      tagsToAdd = [matched.tag, sprintTag, 'buyer-responded'];
      noteHeading = 'BUYER RESPONSE';
    }

    await removeTags(apiKey, contactId, tagsToRemove);
    await addTags(apiKey, contactId, tagsToAdd);

    // Post note
    await postNote(apiKey, contactId,
      matched.emoji + ' ' + noteHeading + ': ' + matched.label + '\n' +
      'Message: "' + message + '"\n' +
      'Tagged: ' + matched.tag + '\n' +
      'Date: ' + new Date().toISOString().split('T')[0]
    );

    console.log('[buyer-response-tag] ' + contactId + ' → ' + matched.tag + ' ("' + message + '")');

    return respond(200, {
      ok: true,
      matched: true,
      kind: isPref ? 'pref' : 'deal',
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function respond(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}
