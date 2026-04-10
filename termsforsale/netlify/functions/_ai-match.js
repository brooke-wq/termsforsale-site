// ═══════════════════════════════════════════════════════════════
// _ai-match.js — Holistic buyer↔deal fit check
// ═══════════════════════════════════════════════════════════════
//
// Prefix _ means Netlify will NOT deploy this as a function; it's a shared
// private module used by notify-buyers.js (and any future matcher).
//
// Problem this solves: the deterministic buy-box match in notify-buyers only
// reads a handful of structured custom fields (target states, target cities,
// deal structures, max price, etc.) and a single checkbox for HOA. Real
// buyer preferences also live in:
//   - the buy_box large-text field ("no HOAs, 3bd+, Chandler/Gilbert only")
//   - contact notes ("spoke w/ buyer 4/2 — only wants Subject To in Mesa")
//   - hoa_tolerance free text ("no HOA fees please")
//
// This helper pulls the contact's last N notes, builds a compact profile
// (structured fields + free-text fields + notes), and asks Claude Haiku
// to judge fit and surface red flags that the deterministic layer missed.
//
// Returns shape:
//   { fit: 'strong'|'fair'|'weak'|'reject',
//     score: 1-10,
//     reasons: [string],
//     redFlags: [string],
//     usage: { input_tokens, output_tokens, cost } }
//
// On any failure (network, parse, timeout, missing API key) the helper
// resolves to { fit: 'unknown', error: string } so the caller can still
// ship the deterministic result without the AI layer.

const { complete } = require('./_claude');

// Claude Haiku 4.5 — cheap + fast, per CLAUDE.md cost rules
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Per-call budget / shaping
const MAX_NOTES_PER_CONTACT = 5;
const MAX_NOTE_CHARS = 400;
const MAX_BUY_BOX_CHARS = 800;

// ─── Fetch recent notes for a contact ─────────────────────────

async function fetchContactNotes(apiKey, contactId) {
  if (!contactId) return [];
  try {
    var res = await fetch('https://services.leadconnectorhq.com/contacts/' + contactId + '/notes', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) return [];
    var data = await res.json();
    var notes = (data && data.notes) || [];
    // Sort newest first, trim to N, strip to short snippets
    notes.sort(function (a, b) {
      return new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0);
    });
    return notes.slice(0, MAX_NOTES_PER_CONTACT).map(function (n) {
      var body = String(n.body || '').replace(/\s+/g, ' ').trim();
      if (body.length > MAX_NOTE_CHARS) body = body.slice(0, MAX_NOTE_CHARS) + '…';
      return { date: n.dateAdded || '', body: body };
    }).filter(function (n) { return n.body.length > 0; });
  } catch (err) {
    console.warn('[_ai-match] fetchContactNotes failed:', err.message);
    return [];
  }
}

// ─── Build the compact buyer profile that Claude sees ────────
//
// buyerProfile is the pre-shaped object the caller passes — it's expected to
// contain the plain-English versions of the custom fields the deterministic
// matcher already extracted (so we avoid re-reading GHL structure twice).

function buildPrompt(deal, buyerProfile, notes) {
  var dealLines = [
    'DEAL',
    '----',
    'Type: ' + (deal.dealType || '?'),
    'Location: ' + [deal.streetAddress, deal.city, deal.state, deal.zip].filter(Boolean).join(', '),
    'Property: ' + (deal.propertyType || '?') +
      (deal.beds ? ' · ' + deal.beds + 'bd' : '') +
      (deal.baths ? '/' + deal.baths + 'ba' : '') +
      (deal.sqft ? ' · ' + deal.sqft + ' sqft' : '') +
      (deal.yearBuilt ? ' · built ' + deal.yearBuilt : ''),
    'Asking: $' + (deal.askingPrice || 0).toLocaleString(),
    'Entry fee: $' + (deal.entryFee || 0).toLocaleString(),
    'ARV: $' + ((deal.arv || deal.compsArv || 0)).toLocaleString(),
    'Rent (LTR): $' + (deal.rentFinal || 0).toLocaleString(),
    'HOA: ' + (deal.hoa || 'n/a'),
    'Highlights: ' + [deal.highlight1, deal.highlight2, deal.highlight3].filter(Boolean).join(' | ')
  ].join('\n');

  var buyBox = String(buyerProfile.buyBoxText || '').trim();
  if (buyBox.length > MAX_BUY_BOX_CHARS) buyBox = buyBox.slice(0, MAX_BUY_BOX_CHARS) + '…';

  var buyerLines = [
    'BUYER',
    '-----',
    'Name: ' + (buyerProfile.name || '(unknown)'),
    'Buyer status: ' + (buyerProfile.buyerStatus || 'unset'),
    'Target states: ' + (buyerProfile.targetStates || 'none set'),
    'Target cities: ' + (buyerProfile.targetCities || 'none set'),
    'Target markets (free text): ' + (buyerProfile.targetMarkets || 'none'),
    'Accepted structures: ' + (buyerProfile.dealStructures || 'none set'),
    'Preferred property types: ' + (buyerProfile.propertyTypes || 'none set'),
    'Max asking price: ' + (buyerProfile.maxPrice || 'not set'),
    'Max entry fee: ' + (buyerProfile.maxEntry || 'not set'),
    'Min ARV: ' + (buyerProfile.minArv || 'not set'),
    'Min beds: ' + (buyerProfile.minBeds || 'not set'),
    'HOA flag (structured): ' + (buyerProfile.hoaFlag || 'unset'),
    'HOA tolerance (free text): ' + (buyerProfile.hoaTolerance || 'unset'),
    'Buy box (free text):',
    buyBox || '(empty)',
    'Tags: ' + (buyerProfile.tags || 'none')
  ].join('\n');

  var notesLines = notes.length
    ? 'NOTES (most recent first)\n-------------------------\n' +
      notes.map(function (n, i) {
        var d = n.date ? new Date(n.date).toISOString().slice(0, 10) : '????-??-??';
        return (i + 1) + '. [' + d + '] ' + n.body;
      }).join('\n')
    : 'NOTES\n-----\n(no notes on file)';

  return dealLines + '\n\n' + buyerLines + '\n\n' + notesLines;
}

// ─── System prompt — kept short to minimize input cost ───────

var SYSTEM_PROMPT =
  'You are a senior real estate acquisitions analyst at Deal Pros LLC. You ' +
  'screen incoming wholesale deals against buyer profiles to decide whether ' +
  'a deal alert should go out to this buyer.\n\n' +
  'Rules:\n' +
  '1. If the buyer has ANY clear rejection criterion that this deal violates ' +
  '(e.g. "no HOAs" in their buy box and the deal has an HOA), return ' +
  'fit="reject".\n' +
  '2. HOA rule: check the deal HOA field AND the buyer\'s structured HOA flag ' +
  'AND the hoa_tolerance field AND the buy box free text AND the notes. If ' +
  'the buyer clearly does not want HOA properties and the deal has an HOA ' +
  '(any non-zero dollar amount or "Yes"), reject.\n' +
  '3. A "strong" fit means the deal clearly matches multiple stated ' +
  'preferences (market + structure + price + property type). A "fair" fit ' +
  'is one that matches on market + one or two others. "weak" is a state-only ' +
  'or metro-only match with little else aligned.\n' +
  '4. Notes are authoritative when they contradict structured fields. If a ' +
  'recent note says "only wants Phoenix now, no more Mesa", trust the note.\n' +
  '5. Be concise. No more than 3 reasons and 2 red flags.\n' +
  '6. Output valid JSON only — no markdown fences, no prose.';

// ─── Main entry point ─────────────────────────────────────────

async function checkFit({ claudeKey, ghlKey, deal, contact, buyerProfile }) {
  if (!claudeKey) {
    return { fit: 'unknown', error: 'missing ANTHROPIC_API_KEY' };
  }

  // Pull recent notes (1 GHL API call per buyer — acceptable at the
  // shortlist size notify-buyers passes in)
  var notes = await fetchContactNotes(ghlKey, contact.id);

  var prompt = buildPrompt(deal, buyerProfile, notes) +
    '\n\nReturn JSON with exactly these keys:\n' +
    '{\n' +
    '  "fit": "strong" | "fair" | "weak" | "reject",\n' +
    '  "score": integer 1-10,\n' +
    '  "reasons": [short strings, max 3],\n' +
    '  "redFlags": [short strings, max 2]\n' +
    '}';

  try {
    var res = await complete(claudeKey, {
      system: SYSTEM_PROMPT,
      user: prompt,
      maxTokens: 350,
      json: true,
      model: HAIKU_MODEL
    });
    var out = res.text || {};
    // Normalize
    var fit = String(out.fit || '').toLowerCase();
    if (['strong', 'fair', 'weak', 'reject'].indexOf(fit) === -1) fit = 'fair';
    var score = Number(out.score);
    if (!score || isNaN(score)) score = 5;
    score = Math.max(1, Math.min(10, Math.round(score)));
    return {
      fit: fit,
      score: score,
      reasons: Array.isArray(out.reasons) ? out.reasons.slice(0, 3).map(String) : [],
      redFlags: Array.isArray(out.redFlags) ? out.redFlags.slice(0, 2).map(String) : [],
      notesUsed: notes.length,
      usage: res.usage
    };
  } catch (err) {
    console.warn('[_ai-match] checkFit failed for ' + (contact.id || '?') + ':', err.message);
    return { fit: 'unknown', error: err.message, notesUsed: notes.length };
  }
}

// ─── Simple regex-based HOA rejection detector ────────────────
//
// Used by notify-buyers.js to strengthen the deterministic HOA check
// without paying for a Claude call. Scans free text (buy_box, hoa_tolerance,
// notes) for common "I don't want HOA" phrasings.

var REJECT_HOA_PATTERNS = [
  /\bno\s+hoas?\b/i,                 // "no HOA", "no HOAs"
  /\bno\s+hoa\s+(fees?|props?|properties)\b/i,
  /\bavoid(ing)?\s+hoas?\b/i,
  /\bskip(ping)?\s+hoas?\b/i,
  /\bwithout\s+hoas?\b/i,
  /\bwon['’]?t\s+(do|take|buy)\s+hoas?\b/i,
  /\bhate\s+hoas?\b/i,
  /\bhoas?\s*[:=-]\s*(no|none|n\/a|0|zero)\b/i,
  /\bnot?\s+hoa\b/i
];

function textRejectsHoa(text) {
  if (!text) return false;
  var s = String(text).trim();
  if (!s) return false;
  for (var i = 0; i < REJECT_HOA_PATTERNS.length; i++) {
    if (REJECT_HOA_PATTERNS[i].test(s)) return true;
  }
  return false;
}

module.exports = {
  checkFit: checkFit,
  fetchContactNotes: fetchContactNotes,
  textRejectsHoa: textRejectsHoa,
  HAIKU_MODEL: HAIKU_MODEL
};
