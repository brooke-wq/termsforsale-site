// ═══════════════════════════════════════════════════════════════
// _parse-preferences.js — One-time Claude Haiku parse of buyer prefs
// ═══════════════════════════════════════════════════════════════
//
// Prefix _ means Netlify will NOT deploy this as a function; it's a shared
// private module.
//
// The buyer's preferences live in three places:
//   1. Structured custom fields (Max Price, Min Beds, Deal Structures, etc.)
//   2. Free-text buy_box field ("Phoenix only, no HOA, need pool")
//   3. Contact notes ("spoke with buyer 4/2 — wants Phoenix only now")
//
// Matching re-parses #2 and #3 on every deal blast — wasteful, slow, and
// inconsistent. This helper parses ONCE (on buy-box-save, on new note, or via
// nightly backfill cron) into a single structured JSON object stored on
// contact.parsed_prefs. Matching then reads that JSON directly — fast, cheap,
// auditable.
//
// Returns shape (see PARSED_PREFS_SCHEMA below):
//   { cities_only, cities_avoid, states_only, min_beds, min_baths,
//     min_sqft, min_year_built, max_price, max_entry_fee, min_arv,
//     max_monthly_piti, min_cashflow, max_interest_rate, max_repair_budget,
//     property_types, structure_pref, structure_open_to, hoa_acceptable,
//     requires_pool, occupancy_pref, remodel_tolerance, deal_killers,
//     deal_delights, persona_notes, confidence, last_parsed,
//     source_checksum, model_used }
//
// On failure (network, parse, timeout, missing API key) returns null so the
// caller can write nothing and matching can fall back to raw fields.

const crypto = require('crypto');
const { complete } = require('./_claude');

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const PARSED_PREFS_VERSION = 1;

// ─── Source checksum — so we can detect stale parses ──────────
//
// If buy_box text, notes, or tags change, the checksum changes. The backfill
// script can skip contacts whose parsed_prefs.source_checksum matches the
// current inputs (idempotent re-runs cost nothing).

function computeChecksum(buyBox, notes, tags) {
  var h = crypto.createHash('sha256');
  h.update(String(buyBox || ''));
  h.update('|');
  h.update((notes || []).map(function (n) { return String(n.body || ''); }).join('||'));
  h.update('|');
  h.update((tags || []).slice().sort().join(','));
  return h.digest('hex').slice(0, 16);
}

// ─── System prompt ─────────────────────────────────────────────

var SYSTEM_PROMPT =
  'You extract structured real estate investor buyer preferences from ' +
  'free-form text (buy box + CRM notes + tags). You never invent facts. ' +
  'If a field is not clearly stated, leave it null / empty array. Notes are ' +
  'more authoritative than buy box text when they contradict (e.g. a recent ' +
  'note saying "only Phoenix now, not Mesa" overrides an older buy box ' +
  'listing both).\n\n' +
  'Rules:\n' +
  '1. cities_only = cities the buyer will ONLY accept (hard filter). ' +
  'cities_avoid = cities they refuse. Don\'t list the same city in both.\n' +
  '2. Structure preferences: structure_pref is what they WANT. ' +
  'structure_open_to is what they\'d also consider. Values: Cash, Subject ' +
  'To, Seller Finance, Hybrid, Morby Method, Wrap, Lease Option, Novation.\n' +
  '3. deal_killers = phrases like "no HOA", "pre-1980", "no pool". ' +
  'deal_delights = things that make a deal extra attractive (e.g. "pool", ' +
  '"ADU potential", "near X school").\n' +
  '4. hoa_acceptable: true/false/null. Default null (unstated). Only set ' +
  'false if the buyer clearly rejects HOA. Only set true if they clearly ' +
  'accept it.\n' +
  '5. requires_pool: true only if they state they NEED a pool. false only ' +
  'if they explicitly reject pools. null otherwise.\n' +
  '6. persona_notes = 1-sentence summary of buyer type (fix-and-flip, ' +
  'buy-and-hold, PadSplit operator, commercial syndicator, etc.).\n' +
  '7. confidence = 0-1 float — how much of the buy box was usable and ' +
  'consistent. Low confidence if text was vague or contradictory.\n' +
  '8. Output valid JSON only, no prose, no markdown fences.';

// ─── Build the prompt ─────────────────────────────────────────

function buildUserPrompt(buyBox, notes, tags, structuredFields) {
  var lines = ['BUY BOX TEXT', '------------'];
  lines.push(buyBox && buyBox.trim() ? buyBox.trim() : '(empty)');

  if (notes && notes.length) {
    lines.push('', 'RECENT NOTES (newest first)', '---------------------------');
    notes.slice(0, 5).forEach(function (n, i) {
      var d = n.date ? new Date(n.date).toISOString().slice(0, 10) : '????-??-??';
      var body = String(n.body || '').replace(/\s+/g, ' ').trim().slice(0, 400);
      lines.push((i + 1) + '. [' + d + '] ' + body);
    });
  } else {
    lines.push('', 'NOTES', '-----', '(none)');
  }

  if (tags && tags.length) {
    lines.push('', 'TAGS', '----');
    lines.push(tags.slice().sort().join(', '));
  }

  if (structuredFields && Object.keys(structuredFields).length) {
    lines.push('', 'STRUCTURED FIELDS ALREADY SET', '-----------------------------');
    Object.keys(structuredFields).forEach(function (k) {
      var v = structuredFields[k];
      if (v != null && v !== '' && !(Array.isArray(v) && v.length === 0)) {
        lines.push(k + ': ' + (Array.isArray(v) ? v.join(', ') : String(v)));
      }
    });
  }

  lines.push('', 'Return JSON with EXACTLY these keys (use null or empty array when unknown):');
  lines.push(JSON.stringify({
    cities_only: [], cities_avoid: [], states_only: [],
    min_beds: null, min_baths: null, min_sqft: null, min_year_built: null,
    max_price: null, max_entry_fee: null, min_arv: null,
    max_monthly_piti: null, min_cashflow: null, max_interest_rate: null,
    max_repair_budget: null,
    property_types: [], structure_pref: [], structure_open_to: [],
    hoa_acceptable: null, requires_pool: null,
    occupancy_pref: null, remodel_tolerance: null,
    deal_killers: [], deal_delights: [],
    persona_notes: '', confidence: 0.0
  }, null, 2));

  return lines.join('\n');
}

// ─── Normalize the AI output ─────────────────────────────────
//
// AI can drift — ensure shape is always correct so matching code doesn't
// blow up on a missing key.

function normalize(raw) {
  var num = function (v) {
    if (v == null || v === '') return null;
    var n = Number(String(v).replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? null : n;
  };
  var arr = function (v) {
    if (Array.isArray(v)) return v.filter(Boolean).map(String);
    if (typeof v === 'string' && v.trim()) return [v.trim()];
    return [];
  };
  var bool = function (v) {
    if (v === true || v === false) return v;
    if (v == null) return null;
    var s = String(v).toLowerCase().trim();
    if (['true', 'yes', 'y', '1'].indexOf(s) > -1) return true;
    if (['false', 'no', 'n', '0'].indexOf(s) > -1) return false;
    return null;
  };
  var str = function (v) {
    if (v == null) return '';
    return String(v).trim();
  };

  return {
    cities_only:       arr(raw.cities_only),
    cities_avoid:      arr(raw.cities_avoid),
    states_only:       arr(raw.states_only).map(function (s) { return s.toUpperCase().slice(0, 2); }),
    min_beds:          num(raw.min_beds),
    min_baths:         num(raw.min_baths),
    min_sqft:          num(raw.min_sqft),
    min_year_built:    num(raw.min_year_built),
    max_price:         num(raw.max_price),
    max_entry_fee:     num(raw.max_entry_fee),
    min_arv:           num(raw.min_arv),
    max_monthly_piti:  num(raw.max_monthly_piti),
    min_cashflow:      num(raw.min_cashflow),
    max_interest_rate: num(raw.max_interest_rate),
    max_repair_budget: num(raw.max_repair_budget),
    property_types:    arr(raw.property_types),
    structure_pref:    arr(raw.structure_pref),
    structure_open_to: arr(raw.structure_open_to),
    hoa_acceptable:    bool(raw.hoa_acceptable),
    requires_pool:     bool(raw.requires_pool),
    occupancy_pref:    str(raw.occupancy_pref) || null,
    remodel_tolerance: str(raw.remodel_tolerance) || null,
    deal_killers:      arr(raw.deal_killers),
    deal_delights:     arr(raw.deal_delights),
    persona_notes:     str(raw.persona_notes),
    confidence:        typeof raw.confidence === 'number'
                         ? Math.max(0, Math.min(1, raw.confidence))
                         : 0.5
  };
}

// ─── Main entry point ─────────────────────────────────────────
//
// @param {string} claudeKey  ANTHROPIC_API_KEY
// @param {object} inputs
//   buyBox           {string}   free-text buy_box field
//   notes            {array}    [{date, body}, ...] — most recent first
//   tags             {array}    contact.tags
//   structuredFields {object}   already-known structured fields (to feed AI
//                               context — so it doesn't try to re-extract)
// @returns {object|null}  parsed_prefs JSON, or null on failure

async function parsePreferences(claudeKey, { buyBox, notes, tags, structuredFields }) {
  if (!claudeKey) {
    console.warn('[_parse-preferences] no ANTHROPIC_API_KEY — skipping');
    return null;
  }

  var checksum = computeChecksum(buyBox, notes, tags);

  // If there's literally nothing to parse, don't pay for an API call.
  var hasAnyInput = (buyBox && buyBox.trim()) ||
                    (notes && notes.length > 0) ||
                    (tags && tags.length > 0);
  if (!hasAnyInput) {
    return {
      version: PARSED_PREFS_VERSION,
      cities_only: [], cities_avoid: [], states_only: [],
      min_beds: null, min_baths: null, min_sqft: null, min_year_built: null,
      max_price: null, max_entry_fee: null, min_arv: null,
      max_monthly_piti: null, min_cashflow: null, max_interest_rate: null,
      max_repair_budget: null,
      property_types: [], structure_pref: [], structure_open_to: [],
      hoa_acceptable: null, requires_pool: null,
      occupancy_pref: null, remodel_tolerance: null,
      deal_killers: [], deal_delights: [],
      persona_notes: '', confidence: 0.0,
      source_checksum: checksum,
      last_parsed: new Date().toISOString(),
      model_used: '(none — empty input)'
    };
  }

  var userPrompt = buildUserPrompt(buyBox, notes, tags, structuredFields);

  try {
    var res = await complete(claudeKey, {
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 800,
      json: true,
      model: HAIKU_MODEL
    });
    var normalized = normalize(res.text || {});
    normalized.version = PARSED_PREFS_VERSION;
    normalized.source_checksum = checksum;
    normalized.last_parsed = new Date().toISOString();
    normalized.model_used = HAIKU_MODEL;
    return normalized;
  } catch (err) {
    console.warn('[_parse-preferences] parse failed:', err.message);
    return null;
  }
}

module.exports = {
  parsePreferences: parsePreferences,
  computeChecksum: computeChecksum,
  HAIKU_MODEL: HAIKU_MODEL,
  PARSED_PREFS_VERSION: PARSED_PREFS_VERSION
};
