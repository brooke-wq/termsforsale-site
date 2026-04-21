// Netlify function: notify-buyers
// Matches new deals to buyer criteria and triggers GHL alerts
// Runs on schedule (every 30 min) OR manually via /api/notify-test?deal_id=XXX
//
// ENV VARS REQUIRED:
//   NOTION_TOKEN, NOTION_DB_ID — Notion access
//   GHL_API_KEY — GoHighLevel API key
//   GHL_LOCATION_ID — GoHighLevel location/sub-account ID
//   DEAL_ALERTS_LIVE — set to "true" to actually send alerts (default: test mode)

const https = require('https');
const { buildDealUrl, buildTrackedDealUrl } = require('./_deal-url');
const { setDealWebsiteLink } = require('./_notion-url');

// ─── FILE-BASED DEDUP (Droplet only) ────────────────────────
var sentLog;
try { sentLog = require('../../../jobs/sent-log'); } catch(e) { sentLog = null; }

// ─── AUTO BLOG POST ─────────────────────────────────────────
var autoBlog;
try { autoBlog = require('./auto-blog'); } catch(e) { autoBlog = null; }

// ─── AI fit check (optional, gated by AI_MATCH_LIVE=true) ─
var aiMatch;
try { aiMatch = require('./_ai-match'); } catch(e) { aiMatch = null; }

// ─── HTTP HELPERS ────────────────────────────────────────────

function httpRequest(url, options, body) {
  return new Promise(function(resolve, reject) {
    var parsed = new URL(url);
    var opts = Object.assign({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, {});
    var req = https.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ─── NOTION: Get recently published deals ────────────────────

async function getRecentDeals(token, dbId, sinceMinutes) {
  // Use "Started Marketing" date field — only alerts on newly listed deals,
  // not on any random edit. Dedup tags prevent double sends per buyer per deal.
  // Look back 7 days instead of just today so deals whose Started Marketing
  // date was set on a day the cron didn't run (or before the cron fired)
  // still get picked up. The per-buyer dedup tag (alerted-XXXXXXXX) prevents
  // any buyer from receiving duplicate alerts for the same deal.
  var lookback = new Date();
  lookback.setDate(lookback.getDate() - 7);
  var since = lookback.toISOString().split('T')[0]; // YYYY-MM-DD, 7 days ago
  var body = {
    filter: {
      and: [
        { property: 'Deal Status', status: { equals: 'Actively Marketing' } },
        { property: 'Started Marketing ', date: { on_or_after: since } }
      ]
    },
    page_size: 20
  };
  var result = await httpRequest('https://api.notion.com/v1/databases/' + dbId + '/query', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    }
  }, body);

  if (result.status !== 200) {
    // Try with select instead of status
    body.filter.and[0] = { property: 'Deal Status', select: { equals: 'Actively Marketing' } };
    result = await httpRequest('https://api.notion.com/v1/databases/' + dbId + '/query', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    }, body);
  }

  if (result.status !== 200) return [];
  return (result.body.results || []).map(parseDeal);
}

// Get a single deal by ID (for test endpoint)
async function getDealById(token, dbId, pageId) {
  var result = await httpRequest('https://api.notion.com/v1/pages/' + pageId, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Notion-Version': '2022-06-28'
    }
  });
  if (result.status !== 200) return null;
  return parseDeal(result.body);
}

// Resolve a short deal code (e.g. "PHX-001") to a full Notion page by querying
// the database for a matching "Deal ID" property. Returns the parsed deal or
// null. Used when the user passes a short code to ?deal_id= instead of a UUID.
async function getDealByCode(token, dbId, dealCode) {
  var body = {
    filter: {
      property: 'Deal ID',
      rich_text: { equals: String(dealCode).toUpperCase() }
    },
    page_size: 1
  };
  var result = await httpRequest('https://api.notion.com/v1/databases/' + dbId + '/query', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    }
  }, body);
  if (result.status !== 200) return null;
  var pages = (result.body && result.body.results) || [];
  if (!pages.length) return null;
  return parseDeal(pages[0]);
}

// Notion page UUIDs are 32 hex chars (typically with dashes). Anything
// shorter/different is almost certainly a short code like "PHX-001".
function looksLikeNotionUuid(s) {
  var clean = String(s || '').replace(/-/g, '');
  return clean.length === 32 && /^[0-9a-f]+$/i.test(clean);
}

function prop(page, name) {
  var p = page.properties[name];
  if (!p) return '';
  switch (p.type) {
    case 'title': return (p.title || []).map(function(t) { return t.plain_text; }).join('');
    case 'rich_text': return (p.rich_text || []).map(function(t) { return t.plain_text; }).join('');
    case 'number': return p.number !== null && p.number !== undefined ? p.number : '';
    case 'select': return p.select ? p.select.name : '';
    case 'multi_select': return (p.multi_select || []).map(function(s) { return s.name; }).join(', ');
    case 'status': return p.status ? p.status.name : '';
    case 'url': return p.url || '';
    case 'date': return p.date ? p.date.start : '';
    case 'formula':
      if (p.formula.type === 'string') return p.formula.string || '';
      if (p.formula.type === 'number') return p.formula.number !== null ? p.formula.number : '';
      return '';
    default: return '';
  }
}

// Slugify an address the same way scripts/migrate-sent-tags.js and
// termsforsale/netlify/functions/tag-blast-sent.js do it.
// "123 Main St Mesa AZ" → "123-main-st-mesa-az"
// IMPORTANT: all three slugifiers MUST stay in lockstep or the admin buyer
// dashboard won't find the tags that notify-buyers writes.
function slugifyAddress(street, city, state) {
  var parts = [street, city, state].filter(Boolean).join(' ');
  return String(parts)
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function parseDeal(page) {
  var deal = {
    id: page.id,
    dealCode: prop(page, 'Deal ID'),
    dealType: prop(page, 'Deal Type'),
    streetAddress: prop(page, 'Street Address'),
    city: prop(page, 'City'),
    state: prop(page, 'State'),
    zip: prop(page, 'ZIP'),
    nearestMetro: prop(page, 'Nearest Metro') || prop(page, 'Nearest Metro Area'),
    propertyType: prop(page, 'Property Type'),
    askingPrice: +prop(page, 'Asking Price') || 0,
    entryFee: +prop(page, 'Entry Fee') || 0,
    arv: +prop(page, 'ARV') || 0,
    rentFinal: +prop(page, 'LTR Market Rent') || 0,
    beds: prop(page, 'Beds'),
    baths: prop(page, 'Baths'),
    sqft: prop(page, 'Living Area') || prop(page, 'Sqft'),
    yearBuilt: prop(page, 'Year Built') || prop(page, 'Year Build'),
    // HOA raw string from Notion — used by the HOA hard filter. Was
    // silently missing before, so parseHoaDeal() always returned false
    // and the HOA filter never ran. See buyerRejectsHoa() for how the
    // buyer side is evaluated.
    hoa: prop(page, 'HOA'),
    highlight1: prop(page, 'Highlight 1'),
    highlight2: prop(page, 'Highlight 2'),
    highlight3: prop(page, 'Highlight 3'),
    lastEdited: page.last_edited_time
  };
  deal.dealUrl = buildDealUrl(deal);
  return deal;
}

// ─── GHL: Search contacts by tags/criteria ───────────────────

// ─── GHL Custom Field IDs for Buy Box matching ──────────────
// Hardcoded field IDs (from legacy buy-box integration)
var CF = {
  TARGET_STATES:    'aewzY7iEvZh12JhMVi7E',  // Multi-select: ['AZ','TX']
  TARGET_CITIES:    'DbY7dHIXk8YowpaWrxYj',  // Multi-select: ['Phoenix, AZ','Dallas, TX']
  DEAL_STRUCTURES:  '0L0ycmmsEjy6OPDL0rgq',  // Multi-select: ['Cash','Subject To']
  PROPERTY_TYPE:    'HGC6xWLpSqoAQPZr0uwY',  // Multi-select: ['Single Family']
  MAX_PRICE:        'BcxuopmSK4wA3Z3NyanD',  // Monetary
  MAX_ENTRY:        'SZmNHA3BQva2AZg00ZNP',  // Monetary
  MIN_ARV:          'KKGEfgdaqu98yrZYkmoO',  // Monetary
  MIN_BEDS:         'RRuCraVtRUlEMvdFXngv',  // Number
  EXIT_STRATEGIES:  '98i8EKc3OWYSqS4Qb1nP',  // Multi-select
  TARGET_MARKETS:   'XjXqGv6Y82iTP659pO4t',  // Large text
  BUYER_TYPE:       '95PgdlIYfXYcMymnjsIv',  // Single select
  CONTACT_ROLE:     'agG4HMPB5wzsZXiRxfmR',  // Multi-select: ['Buyer']
};

// Fields looked up dynamically by fieldKey at runtime (populated once per invocation
// via getFieldIds()). Lets us reference new fields by their stable fieldKey without
// hardcoding mutable GHL IDs.
var DYNAMIC_FIELD_KEYS = [
  'contact.buyer_status',              // dropdown — exclude "not buying now"
  'contact.hoa',                       // checkbox — no = excluded on HOA deals
  'contact.hoa_tolerance',             // text/dropdown — "no" = excluded on HOA deals
  'contact.property_type_preference',  // multi-select — buyer's preferred prop types
  'contact.deal_structure',            // multi-select — buyer's accepted structures
  'contact.buy_box',                   // large text — free-form buy box description
  'contact.parsed_prefs'               // Large text JSON — AI-parsed buy box (Option D)
];
var dynamicFieldIds = {}; // populated at runtime: fieldKey -> fieldId

// Required match thresholds
var MIN_BUYERS_TARGET = 50;

// Map deal types to structure values in GHL custom fields
var DEAL_STRUCTURE_MAP = {
  'Cash': ['Cash'],
  'SubTo': ['Subject To','Sub-To','SubTo'],
  'Seller Finance': ['Seller Finance','Seller Financing','Owner Finance'],
  'Hybrid': ['Hybrid','Subject To','Seller Finance'],
  'Wrap': ['Wrap','Wrap Around'],
  'Morby Method': ['Morby Method','Subject To'],
  'Lease Option': ['Lease Option'],
  'Novation': ['Novation']
};

function getCF(contact, fieldId) {
  var cfs = contact.customFields || [];
  var field = cfs.find(function(f) { return f.id === fieldId; });
  if (!field) return null;
  return field.value;
}

// Fetch by fieldKey — uses the dynamicFieldIds lookup table
function getCFByKey(contact, fieldKey) {
  var id = dynamicFieldIds[fieldKey];
  if (!id) return null;
  return getCF(contact, id);
}

// One-time load of dynamic field IDs from GHL for the given location
async function loadDynamicFieldIds(apiKey, locationId) {
  if (Object.keys(dynamicFieldIds).length > 0) return; // already loaded
  try {
    var res = await httpRequest(
      'https://services.leadconnectorhq.com/locations/' + locationId + '/customFields',
      {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Version': '2021-07-28'
        }
      }
    );
    if (res.status !== 200 || !res.body || !res.body.customFields) {
      console.warn('[notify-buyers] Could not load custom fields map, status=' + res.status);
      return;
    }
    res.body.customFields.forEach(function (f) {
      if (f.fieldKey && f.id && DYNAMIC_FIELD_KEYS.indexOf(f.fieldKey) > -1) {
        dynamicFieldIds[f.fieldKey] = f.id;
      }
    });
    console.log('[notify-buyers] Loaded dynamic field IDs:', Object.keys(dynamicFieldIds).join(', '));
  } catch (e) {
    console.warn('[notify-buyers] loadDynamicFieldIds failed:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// BUYER → DEAL MATCHING
// ═══════════════════════════════════════════════════════════════
//
// Hard filters (all tiers require these to pass):
//   1. Contact role = Buyer                (enforced in fetchAllBuyers)
//   2. Vetted / buyer_status ≠ "not buying now"
//   3. Deal structure contains deal type   (if buyer has prefs)
//   4. Property type contains deal type    (if buyer has prefs)
//   5. HOA rule: if deal has HOA, buyer hoa ≠ "no" AND hoa_tolerance doesn't
//      contain "no"
//
// Market match (required, determines tier):
//   - CITY MATCH: deal city or metro appears in target_markets, buy_box,
//     or target_cities → tier 1 or 2 (based on extras)
//   - STATE FALLBACK: buyer has no city-level preferences filled (only state)
//     and buyer's state matches deal state → tier 3
//   - If buyer HAS city preferences but none matched, fall back to state
//     match → tier 3 (the user's explicit "fallback to state" rule)
//
// Tier scoring (among buyers who passed hard + market):
//   - TIER 1: City match + all optional extras satisfied (price, beds, ARV
//     where populated — each populated field must pass)
//   - TIER 2: City match but not all extras satisfied (or no extras set)
//   - TIER 3: State-only fallback
//
// Buyers who fail a populated "Max Price" / "Min Beds" / "Max Entry" / "Min
// ARV" are STILL eligible — they just drop to Tier 2 or 3 instead of Tier 1.
// The user's original rule was "if additional like price, bed/bath included,
// those can be a higher tier" — so the scoring bumps the tier, doesn't reject.

function parseHoaDeal(dealHoa) {
  // Notion HOA field — "Yes"/"No"/"$129/mo"/"" etc. Return true if deal has HOA.
  if (dealHoa == null) return false;
  var s = String(dealHoa).trim().toLowerCase();
  if (!s) return false;
  if (s === 'no' || s === 'none' || s === 'n/a' || s === '0' || s === 'false') return false;
  return true;
}

// Returns { reject: bool, source: string } — source explains where the
// rejection came from so it can be written to the buyer's GHL note.
// Checks in priority order:
//   1. contact.hoa structured checkbox ("no"/"false"/"0")
//   2. contact.hoa_tolerance structured text ("no" as a word)
//   3. contact.buy_box large-text free form ("no HOAs please")
//   4. notes (optional — caller passes in pre-fetched notes)
// Wide text patterns live in _ai-match.textRejectsHoa() so both the
// deterministic layer and the AI layer agree on phrasing.
function buyerRejectsHoa(contact, extraText) {
  var hoaFlag = getCFByKey(contact, 'contact.hoa');
  var hoaTol = getCFByKey(contact, 'contact.hoa_tolerance');
  var buyBox = getCFByKey(contact, 'contact.buy_box');
  var flagStr = String(hoaFlag == null ? '' : hoaFlag).toLowerCase().trim();
  var tolStr = String(hoaTol == null ? '' : hoaTol).toLowerCase().trim();

  // 1. Checkbox: explicit "no"
  if (flagStr === 'no' || flagStr === 'false' || flagStr === '0') {
    return { reject: true, source: 'HOA flag = no' };
  }
  // 2. Tolerance field: "no", "No HOA", etc.
  if (tolStr && (tolStr === 'no' || /\bno\b/.test(tolStr))) {
    return { reject: true, source: 'HOA tolerance: "' + tolStr.slice(0, 40) + '"' };
  }
  // 3. Buy box free text — wider regex catches "no HOAs", "avoid HOA",
  //    "won't do HOA", "hoa = no", etc.
  if (buyBox && aiMatch && aiMatch.textRejectsHoa(buyBox)) {
    return { reject: true, source: 'Buy box mentions no-HOA' };
  }
  // 4. Extra text (typically contact notes) — same regex bank
  if (extraText && aiMatch && aiMatch.textRejectsHoa(extraText)) {
    return { reject: true, source: 'Note mentions no-HOA' };
  }
  return { reject: false };
}

// ─── Option D: parsed_prefs helpers ───────────────────────────
//
// contact.parsed_prefs is a JSON blob written by _parse-preferences.js and
// the backfill script. It contains structured extracts of the buyer's free-
// text preferences (cities_only, deal_killers, requires_pool, etc.) so
// matching can evaluate them as exact filters instead of re-parsing prose on
// every blast.

function getParsedPrefs(contact) {
  var raw = getCFByKey(contact, 'contact.parsed_prefs');
  if (!raw) return null;
  try {
    var p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (p && typeof p === 'object') return p;
  } catch (e) {}
  return null;
}

// Returns { reject: bool, reason: string } if parsed prefs explicitly
// disqualify this deal. Does NOT return reject=false — caller should treat
// "null" / no rejection as "keep going with legacy checks".
function parsedPrefsReject(prefs, deal) {
  if (!prefs) return null;

  // cities_only — hard filter. If set, deal city MUST be in list.
  if (prefs.cities_only && prefs.cities_only.length) {
    var dealCityState = (deal.city || '').toLowerCase().trim() + ', ' + (deal.state || '').toUpperCase().trim();
    var dealCity = (deal.city || '').toLowerCase().trim();
    var hit = prefs.cities_only.some(function (c) {
      var low = String(c).toLowerCase().trim();
      return low === dealCityState || low === dealCity || low.indexOf(dealCity) > -1;
    });
    if (!hit) return { reject: true, reason: 'parsed_prefs cities_only: deal city not in buyer list' };
  }

  // cities_avoid — hard filter. If deal city in list, reject.
  if (prefs.cities_avoid && prefs.cities_avoid.length) {
    var cavLow = (deal.city || '').toLowerCase().trim();
    var blocked = prefs.cities_avoid.some(function (c) {
      return String(c).toLowerCase().indexOf(cavLow) > -1;
    });
    if (blocked) return { reject: true, reason: 'parsed_prefs cities_avoid: deal city blocked' };
  }

  // states_only — hard filter. If set, deal state MUST be in list.
  if (prefs.states_only && prefs.states_only.length) {
    var ds = (deal.state || '').toUpperCase().trim();
    if (prefs.states_only.indexOf(ds) === -1) {
      return { reject: true, reason: 'parsed_prefs states_only: deal state not in buyer list' };
    }
  }

  // hoa_acceptable = false → reject HOA deals
  if (prefs.hoa_acceptable === false && parseHoaDeal(deal.hoa)) {
    return { reject: true, reason: 'parsed_prefs hoa_acceptable=false and deal has HOA' };
  }

  // requires_pool = true → deal must indicate pool somehow. We don't have a
  // structured "has pool" field on deals yet, so we scan highlights + details.
  if (prefs.requires_pool === true) {
    var dealText = [deal.highlight1, deal.highlight2, deal.highlight3, deal.highlights, deal.details]
      .filter(Boolean).join(' ').toLowerCase();
    if (!/\bpool\b/.test(dealText)) {
      return { reject: true, reason: 'parsed_prefs requires_pool=true but deal has no pool mention' };
    }
  }

  // min_year_built — reject if deal built earlier
  if (prefs.min_year_built && +deal.yearBuilt > 0 && +deal.yearBuilt < +prefs.min_year_built) {
    return { reject: true, reason: 'parsed_prefs min_year_built=' + prefs.min_year_built + ' but deal built ' + deal.yearBuilt };
  }

  // min_sqft — reject if deal smaller
  if (prefs.min_sqft && +deal.sqft > 0 && +deal.sqft < +prefs.min_sqft) {
    return { reject: true, reason: 'parsed_prefs min_sqft=' + prefs.min_sqft + ' but deal is ' + deal.sqft };
  }

  // min_baths — reject if deal has fewer
  if (prefs.min_baths && +deal.baths > 0 && +deal.baths < +prefs.min_baths) {
    return { reject: true, reason: 'parsed_prefs min_baths=' + prefs.min_baths + ' but deal has ' + deal.baths };
  }

  // deal_killers — scan against deal features for explicit rejection phrases.
  // This is the catch-all for buyer-stated "won't touch X" preferences.
  if (prefs.deal_killers && prefs.deal_killers.length) {
    var dealFeatures = [deal.highlight1, deal.highlight2, deal.highlight3,
      deal.highlights, deal.details, deal.propertyType, deal.dealType,
      deal.hoa, deal.yearBuilt, deal.city].filter(Boolean).join(' ').toLowerCase();
    for (var i = 0; i < prefs.deal_killers.length; i++) {
      var killer = String(prefs.deal_killers[i]).toLowerCase().trim();
      if (!killer) continue;
      // Skip pre-YYYY / no-hoa / no-pool — already handled above specifically.
      if (/^(pre-\d+|no.hoa|no.pool|no hoa|no pool)$/.test(killer)) continue;
      if (dealFeatures.indexOf(killer) > -1) {
        return { reject: true, reason: 'parsed_prefs deal_killer hit: "' + killer + '"' };
      }
    }
  }

  return null; // no rejection
}

// Returns an integer bump (+1, 0, -1) to the tier based on soft signals in
// parsed_prefs. Used AFTER base tier is assigned.
function parsedPrefsTierBump(prefs, deal) {
  if (!prefs) return 0;
  var bump = 0;

  // deal_delights matching → bump up
  if (prefs.deal_delights && prefs.deal_delights.length) {
    var dealText = [deal.highlight1, deal.highlight2, deal.highlight3,
      deal.highlights, deal.details, deal.propertyType, deal.dealType]
      .filter(Boolean).join(' ').toLowerCase();
    var delightHits = prefs.deal_delights.filter(function (d) {
      return dealText.indexOf(String(d).toLowerCase().trim()) > -1;
    }).length;
    if (delightHits >= 2) bump -= 1; // bump tier UP (lower number)
  }

  // structure_pref exact match → bump up (the buyer wants THIS type)
  if (prefs.structure_pref && prefs.structure_pref.length) {
    var hit = prefs.structure_pref.some(function (s) {
      var a = String(s).toLowerCase(), b = String(deal.dealType || '').toLowerCase();
      return a.indexOf(b) > -1 || b.indexOf(a) > -1;
    });
    if (hit) bump -= 1;
  }

  return bump;
}

function matchesBuyBox(contact, deal) {
  var reasons = [];
  var fails = [];

  // Day-2 "pref-market-only" tag — buyer explicitly wants their target
  // market only. If set, disable the state fallback for this buyer.
  var marketOnly = (contact.tags || []).indexOf('pref-market-only') > -1;

  // Option D: AI-parsed preferences (authoritative when present)
  var parsedPrefs = getParsedPrefs(contact);

  // ═ HARD FILTER 0: parsed_prefs explicit rejections ═
  // Runs BEFORE legacy filters — if AI extracted "Phoenix only" or "no pool",
  // the deal is rejected even if structured fields say otherwise.
  if (parsedPrefs) {
    var prefReject = parsedPrefsReject(parsedPrefs, deal);
    if (prefReject) {
      return { match: false, fails: [prefReject.reason] };
    }
    reasons.push('Parsed prefs OK (conf=' + (parsedPrefs.confidence != null ? parsedPrefs.confidence : '?') + ')');
  }

  // ═ HARD FILTER 1: buyer status ═
  var buyerStatus = getCFByKey(contact, 'contact.buyer_status');
  if (buyerStatus != null) {
    var statusStr = String(Array.isArray(buyerStatus) ? buyerStatus.join(' ') : buyerStatus).toLowerCase().trim();
    if (statusStr.indexOf('not buying now') > -1) {
      return { match: false, fails: ['Status: not buying now'] };
    }
  }

  // ═ HARD FILTER 2: deal structure ═
  // Buyer may have structures under hardcoded CF.DEAL_STRUCTURES or dynamic contact.deal_structure
  var dealStructures = getCF(contact, CF.DEAL_STRUCTURES);
  if (!dealStructures) dealStructures = getCFByKey(contact, 'contact.deal_structure');
  var structureNames = DEAL_STRUCTURE_MAP[deal.dealType] || [deal.dealType];
  if (dealStructures && (Array.isArray(dealStructures) ? dealStructures.length : String(dealStructures).trim())) {
    var dsArr = Array.isArray(dealStructures) ? dealStructures : String(dealStructures).split(/,\s*/);
    var structMatch = structureNames.some(function (s) {
      return dsArr.some(function (ds) {
        var a = String(ds).toLowerCase(), b = String(s).toLowerCase();
        return a.indexOf(b) > -1 || b.indexOf(a) > -1;
      });
    });
    if (!structMatch) {
      return { match: false, fails: ['Structure mismatch: wants ' + dsArr.join(',') + ', deal is ' + deal.dealType] };
    }
    reasons.push('Structure: ' + deal.dealType);
  }

  // ═ HARD FILTER 3: property type ═
  var propTypes = getCFByKey(contact, 'contact.property_type_preference')
    || getCF(contact, CF.PROPERTY_TYPE);
  var dealPropType = (deal.propertyType || '').trim();
  if (propTypes && dealPropType) {
    var ptArr = Array.isArray(propTypes) ? propTypes : String(propTypes).split(/,\s*/);
    if (ptArr.length > 0) {
      var propMatch = ptArr.some(function (pt) {
        var a = String(pt).toLowerCase(), b = dealPropType.toLowerCase();
        return a.indexOf(b) > -1 || b.indexOf(a) > -1;
      });
      if (!propMatch) {
        return { match: false, fails: ['Property type mismatch: wants ' + ptArr.join(',') + ', deal is ' + dealPropType] };
      }
      reasons.push('Prop type: ' + dealPropType);
    }
  }

  // ═ HARD FILTER 4: HOA rule ═
  // Deal.hoa is now populated from Notion (was silently missing before).
  // buyerRejectsHoa() checks structured hoa/hoa_tolerance + free-text buy_box
  // and returns a source string so we can log why the buyer was dropped.
  if (parseHoaDeal(deal.hoa)) {
    var hoaCheck = buyerRejectsHoa(contact);
    if (hoaCheck.reject) {
      return { match: false, fails: ['HOA: ' + hoaCheck.source] };
    }
    reasons.push('HOA OK');
  }

  // ═ MARKET MATCH: city first, state fallback ═
  var dealCity = (deal.city || '').toLowerCase().trim();
  var dealMetro = (deal.nearestMetro || '').toLowerCase().trim();
  var dealState = (deal.state || '').trim().toUpperCase();

  // Collect all the text fields where city/market might be mentioned
  var cityFields = [];
  var targetMarketsRaw = getCF(contact, CF.TARGET_MARKETS);
  if (typeof targetMarketsRaw === 'string' && targetMarketsRaw.trim()) cityFields.push(targetMarketsRaw.toLowerCase());
  else if (Array.isArray(targetMarketsRaw)) cityFields.push(targetMarketsRaw.join(' ').toLowerCase());

  var buyBoxTextRaw = getCFByKey(contact, 'contact.buy_box');
  if (typeof buyBoxTextRaw === 'string' && buyBoxTextRaw.trim()) cityFields.push(buyBoxTextRaw.toLowerCase());

  var targetCities = getCF(contact, CF.TARGET_CITIES);
  if (Array.isArray(targetCities) && targetCities.length > 0) {
    cityFields.push(targetCities.join(' ').toLowerCase());
  } else if (typeof targetCities === 'string' && targetCities.trim()) {
    cityFields.push(targetCities.toLowerCase());
  }

  var hasAnyCityPreference = cityFields.length > 0;

  // State preferences
  var targetStates = getCF(contact, CF.TARGET_STATES);
  var stateMatch = false;
  if (Array.isArray(targetStates) && targetStates.length > 0) {
    stateMatch = targetStates.some(function (s) { return String(s).trim().toUpperCase() === dealState; });
  } else if (typeof targetStates === 'string' && targetStates.trim()) {
    stateMatch = String(targetStates).trim().toUpperCase() === dealState;
  }
  // Fall back to contact.state
  if (!stateMatch) {
    var contactState = (contact.state || '').trim().toUpperCase();
    if (contactState && contactState === dealState) stateMatch = true;
  }

  // City match — does the deal city or metro appear in any of the city fields?
  var cityMatch = false;
  if (hasAnyCityPreference && dealCity) {
    cityMatch = cityFields.some(function (txt) {
      if (txt.indexOf(dealCity) > -1) return true;
      if (dealMetro && txt.indexOf(dealMetro) > -1) return true;
      return false;
    });
  }

  if (!cityMatch && !stateMatch) {
    return { match: false, fails: ['No market match (no city/state/market overlap)'] };
  }

  // pref-market-only: buyer asked for their target market only — never fall
  // back to state. Hard-reject if they didn't get a city match.
  if (marketOnly && !cityMatch) {
    return {
      match: false,
      fails: ['Market-only pref set but deal city ' + (deal.city || '?') + ' not in buyer target market']
    };
  }

  if (cityMatch) reasons.push('Market: ' + deal.city);
  else reasons.push('State fallback: ' + dealState);

  // ═ OPTIONAL EXTRAS (determine T1 vs T2) ═
  var extrasPass = true;    // did every populated optional field pass?
  var extrasCount = 0;      // how many populated extras there are

  var maxPrice = getCF(contact, CF.MAX_PRICE);
  if (maxPrice && +maxPrice > 0 && deal.askingPrice > 0) {
    extrasCount++;
    if (deal.askingPrice <= +maxPrice) reasons.push('Price in range');
    else { extrasPass = false; fails.push('Over budget'); }
  }

  var maxEntry = getCF(contact, CF.MAX_ENTRY);
  if (maxEntry && +maxEntry > 0 && deal.entryFee > 0) {
    extrasCount++;
    if (deal.entryFee <= +maxEntry) reasons.push('Entry in range');
    else { extrasPass = false; fails.push('Entry too high'); }
  }

  var minArv = getCF(contact, CF.MIN_ARV);
  var dealArv = +deal.compsArv || +deal.arv || 0;
  if (minArv && +minArv > 0 && dealArv > 0) {
    extrasCount++;
    if (dealArv >= +minArv) reasons.push('ARV >= min');
    else { extrasPass = false; fails.push('ARV too low'); }
  }

  var minBeds = getCF(contact, CF.MIN_BEDS);
  if (minBeds && +minBeds > 0 && +deal.beds > 0) {
    extrasCount++;
    if (+deal.beds >= +minBeds) reasons.push('Beds >= min');
    else { extrasPass = false; fails.push('Not enough beds'); }
  }

  // ═ TIER ASSIGNMENT ═
  var tier;
  if (cityMatch) {
    // City match → T1 if all extras passed, T2 otherwise
    tier = (extrasPass && extrasCount > 0) ? 1 : 2;
    // Note: if no extras are set (extrasCount == 0), treat as T2 — a city match
    // with no additional restrictions is good but not "best fit"
  } else {
    // State fallback → T3
    tier = 3;
  }

  // Option D: parsed_prefs soft signals can bump the tier up or down
  if (parsedPrefs) {
    var bump = parsedPrefsTierBump(parsedPrefs, deal);
    if (bump !== 0) {
      var newTier = Math.max(1, Math.min(3, tier + bump));
      if (newTier !== tier) {
        reasons.push('Tier bumped ' + tier + '→' + newTier + ' by parsed_prefs');
        tier = newTier;
      }
    }
  }

  return { match: true, tier: tier, reasons: reasons, fails: fails };
}

async function fetchAllBuyers(apiKey, locationId) {
  var allBuyers = [];
  var hasMore = true;
  var startAfter = '';
  var startAfterId = '';
  var checked = 0;

  while (hasMore) {
    var searchUrl = 'https://services.leadconnectorhq.com/contacts/?locationId=' + locationId
      + '&limit=100'
      + (startAfter ? '&startAfter=' + startAfter + '&startAfterId=' + startAfterId : '');

    var result = await httpRequest(searchUrl, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
      }
    });

    if (result.status !== 200 || !result.body.contacts || !result.body.contacts.length) break;

    var contacts = result.body.contacts;
    checked += contacts.length;

    contacts.forEach(function(contact) {
      var contactRole = getCF(contact, CF.CONTACT_ROLE);
      var isBuyer = false;
      if (contactRole) {
        if (Array.isArray(contactRole)) {
          isBuyer = contactRole.some(function(r) { return r.toLowerCase() === 'buyer'; });
        } else {
          isBuyer = String(contactRole).toLowerCase() === 'buyer';
        }
      }
      if (!isBuyer) return;
      // Skip buyers who asked to pause alerts (reply "C" on Day 2 follow-up SMS).
      // Tag is set by buyer-response-tag.js and must be manually removed to re-enable.
      var tags = contact.tags || [];
      if (tags.indexOf('alerts-paused') > -1) return;
      // REQUIRED: every buyer must have the "opt in" tag (case-insensitive)
      // before we send any campaign SMS/email. Set when they actively opt in
      // via signup/buy-box/VIP. Without it, we don't message them — full stop.
      var hasOptIn = tags.some(function (t) {
        return String(t || '').trim().toLowerCase() === 'opt in';
      });
      if (!hasOptIn) return;
      allBuyers.push(contact);
    });

    if (result.body.meta && result.body.meta.nextPageUrl) {
      var lastContact = contacts[contacts.length - 1];
      startAfter = lastContact.startAfter ? lastContact.startAfter[0] : '';
      startAfterId = lastContact.startAfter ? lastContact.startAfter[1] : lastContact.id;
      if (!startAfter) hasMore = false;
    } else { hasMore = false; }

    // Raised from 2000 on 2026-04-20. Real opted-in buyer count is ~8,964
    // (tfs buyer + opt in + Contact Role = Buyer) and was growing past the
    // old 2000 cap, silently cutting off ~77% of eligible buyers from
    // every deal blast. 12000 gives headroom over current total contact
    // count 17,377 while staying well under GHL search rate limits.
    // Pagination is 100/page so at most ~120 HTTP calls per cron run
    // (every 30 min) — negligible cost.
    if (checked >= 12000) hasMore = false;
  }

  console.log('Fetched ' + checked + ' contacts, ' + allBuyers.length + ' are buyers');
  return allBuyers;
}

// Build the compact buyer profile shape the AI matcher expects. We read
// every relevant custom field once and pass plain strings so the AI helper
// doesn't need to know about GHL custom field IDs.
function buildBuyerProfile(contact) {
  var targetStates = getCF(contact, CF.TARGET_STATES);
  var targetCities = getCF(contact, CF.TARGET_CITIES);
  var targetMarkets = getCF(contact, CF.TARGET_MARKETS);
  var dealStructures = getCF(contact, CF.DEAL_STRUCTURES) || getCFByKey(contact, 'contact.deal_structure');
  var propTypes = getCFByKey(contact, 'contact.property_type_preference') || getCF(contact, CF.PROPERTY_TYPE);
  return {
    name: ((contact.firstName || '') + ' ' + (contact.lastName || '')).trim(),
    buyerStatus: String(getCFByKey(contact, 'contact.buyer_status') || ''),
    targetStates: Array.isArray(targetStates) ? targetStates.join(', ') : (targetStates || ''),
    targetCities: Array.isArray(targetCities) ? targetCities.join(', ') : (targetCities || ''),
    targetMarkets: String(targetMarkets || ''),
    dealStructures: Array.isArray(dealStructures) ? dealStructures.join(', ') : (dealStructures || ''),
    propertyTypes: Array.isArray(propTypes) ? propTypes.join(', ') : (propTypes || ''),
    maxPrice: getCF(contact, CF.MAX_PRICE) || '',
    maxEntry: getCF(contact, CF.MAX_ENTRY) || '',
    minArv: getCF(contact, CF.MIN_ARV) || '',
    minBeds: getCF(contact, CF.MIN_BEDS) || '',
    hoaFlag: String(getCFByKey(contact, 'contact.hoa') || ''),
    hoaTolerance: String(getCFByKey(contact, 'contact.hoa_tolerance') || ''),
    buyBoxText: String(getCFByKey(contact, 'contact.buy_box') || ''),
    tags: (contact.tags || []).join(', ')
  };
}

// Run the AI fit check on a shortlist of deterministic matches, in batches
// of CONCURRENCY so we don't slam the Netlify function timeout.
//
// Rules for tier adjustment (only applied when fit !== 'unknown'):
//   fit=reject  → drop the buyer entirely (added to dropped[] for logging)
//   fit=strong  → upgrade tier by 1 (min 1)
//   fit=weak    → downgrade tier by 1 (max 3)
//   fit=fair    → no change
async function runAiFitPass(claudeKey, ghlKey, deal, buyersByContact) {
  // Netlify function timeout is ~10-26s. At ~1.5s per Claude call (even
  // batched 5-concurrent) a 100-buyer cap would overrun. Cap harder when
  // we detect we're running on Netlify. Droplet cron has no timeout,
  // so it keeps the 100 default. Explicit AI_MATCH_MAX_PER_DEAL env var
  // always wins if set.
  var isNetlify = !!process.env.NETLIFY;
  var defaultLimit = isNetlify ? 20 : 100;
  var LIMIT_PER_DEAL = +(process.env.AI_MATCH_MAX_PER_DEAL || defaultLimit);
  var CONCURRENCY = 5;
  var shortlist = Object.keys(buyersByContact).slice(0, LIMIT_PER_DEAL);
  var dropped = [];
  var totalCost = 0;

  async function processOne(contactId) {
    var pair = buyersByContact[contactId];
    if (!pair) return;
    var contact = pair.contact;
    var entry = pair.entry;
    var profile = buildBuyerProfile(contact);
    var res = await aiMatch.checkFit({
      claudeKey: claudeKey,
      ghlKey: ghlKey,
      deal: deal,
      contact: contact,
      buyerProfile: profile
    });
    if (res.usage && res.usage.cost) totalCost += res.usage.cost;
    entry.ai = res;
    if (res.fit === 'reject') {
      entry._drop = true;
      dropped.push({ name: entry.name, reasons: res.redFlags || res.reasons || [] });
      return;
    }
    if (res.fit === 'strong' && entry.tier > 1) entry.tier -= 1;
    else if (res.fit === 'weak' && entry.tier < 3) entry.tier += 1;
    // Merge AI reasons into the match reason string
    var aiReasons = (res.reasons || []).slice(0, 3);
    if (aiReasons.length) {
      entry.matchReasons = (entry.matchReasons || []).concat(aiReasons.map(function (r) { return 'AI: ' + r; }));
      entry.matchReason = entry.matchReasons.join(' | ');
    }
  }

  for (var i = 0; i < shortlist.length; i += CONCURRENCY) {
    var batch = shortlist.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processOne));
  }

  console.log('[notify-buyers] AI fit pass: env=' + (isNetlify ? 'netlify' : 'droplet') +
    ' cap=' + LIMIT_PER_DEAL +
    ' shortlist=' + shortlist.length +
    ' dropped=' + dropped.length +
    ' cost=$' + totalCost.toFixed(4));
  return { dropped: dropped, cost: totalCost };
}

async function findMatchingBuyers(apiKey, locationId, deal) {
  // Load dynamic field IDs once per cron run (uses module-level cache)
  await loadDynamicFieldIds(apiKey, locationId);

  var buyers = await fetchAllBuyers(apiKey, locationId);
  var tier1 = [], tier2 = [], tier3 = [];
  var buyersByContact = {}; // contactId → { contact, entry }

  // Single pass — matchesBuyBox already assigns the tier based on
  // market match + extras. Hard filters are the gate.
  buyers.forEach(function (contact) {
    var r = matchesBuyBox(contact, deal);
    if (!r.match) return;
    var entry = {
      id: contact.id,
      name: ((contact.firstName || '') + ' ' + (contact.lastName || '')).trim(),
      email: contact.email || '',
      phone: contact.phone || '',
      score: (r.reasons || []).length,
      tier: r.tier,
      matchReasons: r.reasons,
      matchReason: r.reasons.join(' | ')
    };
    buyersByContact[contact.id] = { contact: contact, entry: entry };
    if (r.tier === 1) tier1.push(entry);
    else if (r.tier === 2) tier2.push(entry);
    else tier3.push(entry);
  });

  console.log('[notify-buyers] Matched T1=' + tier1.length + ' T2=' + tier2.length + ' T3=' + tier3.length);

  // ─── AI holistic fit pass (opt-in via AI_MATCH_LIVE=true) ───
  // Runs on the deterministic shortlist. Can upgrade/downgrade tier by 1
  // and will drop buyers the model flags as outright rejects (e.g. "no HOAs"
  // buried in buy_box or notes that the deterministic layer missed).
  var aiEnabled = process.env.AI_MATCH_LIVE === 'true';
  var claudeKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (aiEnabled && aiMatch && claudeKey) {
    await runAiFitPass(claudeKey, apiKey, deal, buyersByContact);
    // Rebuild tier arrays from the possibly-mutated entries
    tier1 = []; tier2 = []; tier3 = [];
    Object.keys(buyersByContact).forEach(function (cid) {
      var e = buyersByContact[cid].entry;
      if (e._drop) return;
      if (e.tier === 1) tier1.push(e);
      else if (e.tier === 2) tier2.push(e);
      else tier3.push(e);
    });
    console.log('[notify-buyers] Post-AI T1=' + tier1.length + ' T2=' + tier2.length + ' T3=' + tier3.length);
  } else if (aiEnabled && !claudeKey) {
    console.warn('[notify-buyers] AI_MATCH_LIVE=true but ANTHROPIC_API_KEY not set — skipping AI pass');
  }

  // Combine: tier 1 first, then tier 2, then tier 3 (up to target)
  var combined = tier1.concat(tier2).concat(tier3);
  combined.sort(function(a, b) {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return b.score - a.score;
  });

  console.log('Matching results — Tier 1: ' + tier1.length + ', Tier 2: ' + tier2.length + ', Tier 3: ' + tier3.length + ', Total: ' + combined.length);
  return combined;
}

// ─── GHL: Trigger alert for a buyer (with dedup) ────────────

async function triggerBuyerAlert(apiKey, locationId, contact, deal) {
  // ═ COMPLIANCE GATE (TCPA / CAN-SPAM / carrier rules) ═════════════
  // Skip the ENTIRE alert — no SMS, no tags, no workflow trigger — for
  // any contact that has opted out. Checked in priority order:
  //   1. GHL native `dnd` flag (top-level contact field; covers all channels)
  //   2. Any tag starting with `opt-out` (covers `opt-out:sms`, `opt-out:email`,
  //      `opt-out:all`) or `unsubscribe`
  // This gate MUST come before any tag application or /conversations/messages
  // call, because applying `new-deal-alert` could trigger a downstream GHL
  // workflow that sends SMS on its own.
  if (contact.dnd === true) {
    console.log('notify-buyers: SKIP ' + (contact.name || contact.id) + ' — GHL dnd=true (contact-level opt-out)');
    return 'skipped-dnd';
  }
  var optOutTag = (contact.tags || []).find(function (t) {
    var tl = String(t).toLowerCase();
    return tl.indexOf('opt-out') === 0 || tl.indexOf('unsubscribe') === 0;
  });
  if (optOutTag) {
    console.log('notify-buyers: SKIP ' + (contact.name || contact.id) + ' — tag "' + optOutTag + '" indicates opt-out');
    return 'skipped-optout-tag';
  }

  // DEDUP CHECK 1: File-based dedup (Droplet — most reliable, zero API dependency)
  if (sentLog && sentLog.isDroplet()) {
    var dealIdShort = (deal.id || '').slice(0, 8);
    if (sentLog.wasSent(contact.id, dealIdShort, 'alert')) {
      console.log('notify-buyers: SKIP ' + contact.name + ' — file dedup for deal ' + deal.id);
      return 'skipped-file-dedup';
    }
  }

  // DEDUP CHECK 2: Tag-based dedup (GHL — works on Netlify too)
  var dealTag = 'alerted-' + (deal.id || '').slice(0, 8);
  var addressSlug = slugifyAddress(deal.streetAddress, deal.city, deal.state);
  var sentTag = addressSlug ? 'sent:' + addressSlug : null;
  // Per-blast tier tag: tier1:[slug] / tier2:[slug] / tier3:[slug]
  //   tier 1 = strict buy-box match (≥ 2 criteria)
  //   tier 2 = relaxed match (≥ 1 criterion) — only if tier 1 < 50 buyers
  //   tier 3 = state-only fallback — only if tier 1 + 2 < 50 buyers
  // Used by /admin/deal-buyers.html to distinguish real matches from padding.
  var tierNum = contact.tier || contact._tier;  // set on the buyer object by findMatchingBuyers
  var tierTag = (addressSlug && tierNum) ? 'tier' + tierNum + ':' + addressSlug : null;
  var existingTags = contact.tags || [];
  if (existingTags.indexOf(dealTag) > -1) {
    console.log('notify-buyers: SKIP ' + contact.name + ' — already alerted for deal ' + deal.id);
    return 'skipped-duplicate';
  }

  // Add dedup tag + new-deal-alert tag + sent:[slug] audit tag + tierN:[slug] match-quality tag
  // (sent:[slug] is the one the admin Deal Buyer List dashboard queries —
  //  without it, new deal blasts are invisible to /admin/deal-buyers.html)
  var tagsToAdd = ['new-deal-alert', dealTag];
  if (sentTag) tagsToAdd.push(sentTag);
  if (tierTag) tagsToAdd.push(tierTag);

  // Hybrid tier router applies these tags AFTER a tier-specific Wait (see
  // bottom of function). We still fall back to direct apply if the router
  // is unreachable.
  var tagUrl = 'https://services.leadconnectorhq.com/contacts/' + contact.id + '/tags';
  var result = { status: 200 };

  // Post a buyer match note on the contact so Brooke can see why this
  // buyer got this alert without leaving the GHL contact view.
  // Always runs — even without the AI pass — so match reasons are auditable.
  try {
    var noteLines = [
      '📨 Deal alert sent: ' + (deal.dealCode || '(no code)') + ' — ' +
        [deal.streetAddress, deal.city, deal.state].filter(Boolean).join(', '),
      'Type: ' + (deal.dealType || '?') +
        (deal.askingPrice ? ' · ' + '$' + deal.askingPrice.toLocaleString() : '') +
        (deal.entryFee ? ' entry $' + deal.entryFee.toLocaleString() : '') +
        (contact.tier ? ' · Tier ' + contact.tier : ''),
      ''
    ];
    if (contact.matchReasons && contact.matchReasons.length) {
      noteLines.push('Match reasons:');
      contact.matchReasons.forEach(function (r) { noteLines.push('  • ' + r); });
      noteLines.push('');
    }
    if (contact.ai && contact.ai.fit && contact.ai.fit !== 'unknown') {
      noteLines.push('AI fit: ' + contact.ai.fit + ' (score ' + contact.ai.score + '/10)');
      if (contact.ai.reasons && contact.ai.reasons.length) {
        noteLines.push('AI reasons:');
        contact.ai.reasons.forEach(function (r) { noteLines.push('  • ' + r); });
      }
      if (contact.ai.redFlags && contact.ai.redFlags.length) {
        noteLines.push('Red flags:');
        contact.ai.redFlags.forEach(function (r) { noteLines.push('  ⚠ ' + r); });
      }
      if (contact.ai.notesUsed) {
        noteLines.push('(scanned ' + contact.ai.notesUsed + ' recent contact note' + (contact.ai.notesUsed === 1 ? '' : 's') + ')');
      }
    }
    noteLines.push('');
    noteLines.push('View: ' + (deal.dealUrl || ''));
    await httpRequest('https://services.leadconnectorhq.com/contacts/' + contact.id + '/notes', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
      }
    }, { body: noteLines.join('\n') });
  } catch (noteErr) {
    console.warn('notify-buyers: match note failed for ' + contact.name + ': ' + noteErr.message);
  }

  // Update GHL custom fields with deal info
  var price = deal.askingPrice ? '$' + deal.askingPrice.toLocaleString() : '';
  var entry = deal.entryFee ? '$' + deal.entryFee.toLocaleString() + ' + CC/TC' : '';
  var highlights = [deal.highlight1, deal.highlight2, deal.highlight3].filter(Boolean).join('\n');
  var updateUrl = 'https://services.leadconnectorhq.com/contacts/' + contact.id;
  await httpRequest(updateUrl, {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    }
  }, {
    customFields: [
      { id: 'TerjqctukTW67rB21ugC', value: deal.city + ', ' + deal.state },
      { id: 'KuaUFXhbQB6kKvBSKfoI', value: deal.city },
      { id: 'ltmVcWUpbwZ0S3dBid3U', value: deal.state },
      { id: 'UqJl4Dq6T8wfNb70EMrL', value: deal.zip || '' },
      { id: '0thrOdoETTLlFA45oN8U', value: deal.dealType },
      { id: '5eEVPcp8nERlR6GpjZUn', value: deal.dealUrl },
      { id: 'YjoPoDPv7Joo1izePpDx', value: deal.dealType + ' | ' + deal.city + ', ' + deal.state + ' | ' + price + (entry ? ' | ' + entry : '') },
      { id: 'iur6TZsfKotwO3gZb8yk', value: price },
      { id: 'DH4Ekmyw2dvzrE74JSzs', value: entry },
      { id: 'DJFMav5mPvWBzsPdhAqy', value: deal.propertyType || '' },
      { id: '2iVO7pRpi0f0ABb6nYka', value: deal.beds ? deal.beds + ' beds' : '' },
      { id: 'rkzCcjHJMFJP3GcwnNx6', value: deal.baths ? deal.baths + ' baths' : '' },
      { id: 'nNMHvkPbjGYRbOB1v7vQ', value: deal.yearBuilt ? 'Built in ' + deal.yearBuilt : '' },
      { id: 'MgNeVZgMdTcdatcTTHue', value: deal.sqft ? deal.sqft.toLocaleString() + ' sqft' : '' },
      { id: 'eke6ZGnex77y5aUCNgly', value: highlights },
      { id: 'FXp9oPT4T4xqA1HIJuSC', value: (function(){ var m = (deal.coverPhoto||'').match(/\/d\/([a-zA-Z0-9_-]{20,})/); return m ? 'https://termsforsale.com/api/drive-image?id=' + m[1] + '&sz=800' : ''; })() }
    ]
  });

  // HYBRID TIER ROUTER: hand off tag application + SMS send to the n8n
  // "Hybrid Tier Router" workflow. It Waits per tier (A immediate, B +1h,
  // C +4h), then applies tagsToAdd + sends SMS. This implements the
  // A/B/C staggered-release design from the Team SOP + deck.
  //
  // Tier mapping: Netlify matcher assigns tier 1/2/3 from buy-box fit.
  //   Tier 1 (city + all extras pass) → A  (immediate, VIP)
  //   Tier 2 (city match, not all extras) → B  (+1 hour)
  //   Tier 3 (state fallback only) → C  (+4 hours)
  //
  // FALLBACK: if the router POST fails (network, n8n down), we fall back to
  // the pre-hybrid direct path so a buyer still gets their alert — just
  // without the tier stagger.
  var tierLetter = ({ 1: 'A', 2: 'B', 3: 'C' })[contact.tier || contact._tier] || 'C';
  var smsMsg = 'New ' + deal.dealType + ' deal in ' + deal.city + ', ' + deal.state;
  if (price) smsMsg += ' — ' + price;
  if (entry) smsMsg += ' entry ' + entry;
  smsMsg += '. View: ' + buildTrackedDealUrl(deal, contact.id);
  if (smsMsg.length > 160) smsMsg = smsMsg.slice(0, 157) + '...';

  var hybridRouted = false;
  if (contact.phone && locationId) {
    try {
      var routerRes = await httpRequest('https://n8n.termsforsale.com/webhook/hybrid-tier-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        contact_id: contact.id,
        tier: tierLetter,
        sms_text: smsMsg,
        sms_from: '+14806373117',
        tags_to_add: tagsToAdd
      });
      if (routerRes.status >= 200 && routerRes.status < 300) {
        hybridRouted = true;
        console.log('notify-buyers: posted to hybrid router — tier=' + tierLetter + ' contact=' + contact.name);
      } else {
        console.warn('notify-buyers: hybrid router returned ' + routerRes.status + ' for ' + contact.name + ' — falling back to direct send');
      }
    } catch (routerErr) {
      console.warn('notify-buyers: hybrid router unreachable for ' + contact.name + ': ' + routerErr.message + ' — falling back to direct send');
    }
  }

  // FALLBACK: if hybrid router didn't accept the job, apply tags and send
  // SMS directly (pre-hybrid behavior). Covers network failures + the
  // no-phone case (router needs a phone; contacts without phones still get
  // tags applied so the email workflow + dashboard tracking still work).
  if (!hybridRouted) {
    try {
      await httpRequest(tagUrl, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Version': '2021-07-28', 'Content-Type': 'application/json' }
      }, { tags: tagsToAdd });
    } catch (tagErr) {
      console.warn('notify-buyers: direct tag apply failed for ' + contact.name + ': ' + tagErr.message);
    }
    if (contact.phone && locationId) {
      try {
        await httpRequest('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + apiKey, 'Version': '2021-07-28', 'Content-Type': 'application/json' }
        }, { type: 'SMS', contactId: contact.id, message: smsMsg, fromNumber: '+14806373117' });
        console.log('notify-buyers: SMS sent directly (fallback) to ' + contact.name);
      } catch (smsErr) {
        console.warn('notify-buyers: SMS failed for ' + contact.name + ': ' + smsErr.message);
      }
    }
  }

  // Send deal alert email to the buyer
  if (contact.email || contact.id) {
    var coverImg = '';
    var photoMatch = (deal.coverPhoto || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/);
    if (photoMatch) coverImg = 'https://termsforsale.com/api/drive-image?id=' + photoMatch[1] + '&sz=800';

    var specs = [
      deal.beds ? deal.beds + ' Beds' : '',
      deal.baths ? deal.baths + ' Baths' : '',
      deal.sqft ? deal.sqft.toLocaleString() + ' Sqft' : '',
      deal.yearBuilt ? 'Built ' + deal.yearBuilt : ''
    ].filter(Boolean).join(' · ');

    var trackUrl = buildTrackedDealUrl(deal, contact.id);
    var arvStr = deal.arv ? '$' + deal.arv.toLocaleString() : '';
    var rentStr = deal.rentFinal ? '$' + deal.rentFinal.toLocaleString() + '/mo' : '';
    var highlights = [deal.highlight1, deal.highlight2, deal.highlight3].filter(Boolean);

    var emailHtml = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff">'
      // Header
      + '<div style="background:#0D1F3C;padding:20px 32px;border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:space-between">'
      + '<img src="https://assets.cdn.filesafe.space/7IyUgu1zpi38MDYpSDTs/media/697a3aee1fd827ffd863448d.svg" alt="Terms For Sale" style="height:32px">'
      + '<span style="color:rgba(255,255,255,.5);font-size:11px;font-weight:600">NEW DEAL ALERT</span>'
      + '</div>'
      // Photo
      + (coverImg ? '<a href="' + trackUrl + '" style="display:block;width:100%;max-height:300px;overflow:hidden"><img src="' + coverImg + '" alt="Property" style="width:100%;display:block"></a>' : '')
      // Body
      + '<div style="padding:28px 32px">'
      + '<div style="display:inline-block;padding:4px 12px;border-radius:20px;background:#EBF8FF;color:#1a8bbf;font-size:12px;font-weight:700;margin-bottom:12px">' + (deal.dealType || 'Deal') + '</div>'
      + '<h2 style="color:#0D1F3C;font-size:22px;margin:0 0 4px">' + deal.city + ', ' + deal.state + '</h2>'
      + '<p style="color:#718096;font-size:13px;margin:0 0 20px">' + (specs || '') + '</p>'
      // Numbers grid
      + '<table style="width:100%;border-collapse:collapse;margin:0 0 20px">'
      + (price ? '<tr><td style="padding:10px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-size:13px;font-weight:600">Asking Price</td><td style="padding:10px 0;border-bottom:1px solid #EDF2F7;color:#0D1F3C;font-size:16px;font-weight:800;text-align:right">' + price + '</td></tr>' : '')
      + (entry ? '<tr><td style="padding:10px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-size:13px;font-weight:600">Entry Fee</td><td style="padding:10px 0;border-bottom:1px solid #EDF2F7;color:#0D1F3C;font-size:16px;font-weight:800;text-align:right">' + entry + '</td></tr>' : '')
      + (arvStr ? '<tr><td style="padding:10px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-size:13px;font-weight:600">ARV</td><td style="padding:10px 0;border-bottom:1px solid #EDF2F7;color:#0D1F3C;font-size:16px;font-weight:800;text-align:right">' + arvStr + '</td></tr>' : '')
      + (rentStr ? '<tr><td style="padding:10px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-size:13px;font-weight:600">Est. Rent</td><td style="padding:10px 0;border-bottom:1px solid #EDF2F7;color:#10B981;font-size:16px;font-weight:800;text-align:right">' + rentStr + '</td></tr>' : '')
      + '</table>'
      // Highlights
      + (highlights.length ? '<div style="background:#F7FAFC;border-radius:8px;padding:14px 16px;margin-bottom:20px">' + highlights.map(function(h) { return '<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px"><span style="color:#10B981;font-size:14px;line-height:1">&#10003;</span><span style="color:#4A5568;font-size:13px;line-height:1.4">' + h + '</span></div>'; }).join('') + '</div>' : '')
      // CTA
      + '<a href="' + trackUrl + '" style="display:block;text-align:center;padding:16px 32px;background:#29ABE2;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px">View Full Deal Details &rarr;</a>'
      + '<div style="background:#F7FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 16px;margin-top:16px;text-align:center">'
      + '<span style="font-size:12px;color:#718096">Need landlord insurance? </span>'
      + '<a href="https://dealpros.steadilypartner.com/" target="_blank" style="color:#29ABE2;font-size:12px;font-weight:700">Get an instant quote &rarr;</a>'
      + '</div>'
      + '<p style="color:#718096;font-size:12px;margin-top:20px;text-align:center">This deal matched your buying criteria. <a href="https://termsforsale.com/buying-criteria.html" style="color:#29ABE2">Update your buy box</a> anytime.</p>'
      + '</div>'
      // Footer
      + '<div style="background:#F4F6F9;padding:16px 32px;border-radius:0 0 12px 12px;text-align:center">'
      + '<p style="color:#718096;font-size:11px;margin:0">Terms For Sale &middot; Deal Pros LLC &middot; <a href="https://termsforsale.com" style="color:#29ABE2">termsforsale.com</a></p>'
      + '</div></div>';

    try {
      await httpRequest('https://services.leadconnectorhq.com/conversations/messages', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Version': '2021-07-28',
          'Content-Type': 'application/json'
        }
      }, {
        type: 'Email',
        contactId: contact.id,
        subject: 'New ' + (deal.dealType || 'Deal') + ' in ' + deal.city + ', ' + deal.state + (price ? ' — ' + price : ''),
        html: emailHtml,
        emailFrom: 'Terms For Sale <info@termsforsale.com>'
      });
      console.log('notify-buyers: Email sent to ' + contact.name);
    } catch (emailErr) {
      console.warn('notify-buyers: Email failed for ' + contact.name + ': ' + emailErr.message);
    }
  }

  // Mark as sent in file-based dedup log
  if (sentLog && sentLog.isDroplet()) {
    sentLog.markSent(contact.id, (deal.id || '').slice(0, 8), 'alert');
  }

  return result.status;
}

// ─── MAIN HANDLER ────────────────────────────────────────────

exports.handler = async function(event) {
  var headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: headers, body: '' };

  var token = process.env.NOTION_TOKEN;
  var dbId = process.env.NOTION_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';
  var apiKey = process.env.GHL_API_KEY;
  var locationId = process.env.GHL_LOCATION_ID;
  if (!token || !apiKey || !locationId) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({
      error: 'Missing env vars',
      hasNotion: !!token,
      hasGHL: !!apiKey,
      hasLocation: !!locationId
    })};
  }

  var params = event.queryStringParameters || {};
  var isTest = params.test === 'true' || params.deal_id;
  var isLive = process.env.DEAL_ALERTS_LIVE === 'true' && !isTest;
  var deals = [];

  try {
    if (params.deal_id) {
      // Manual test: check a specific deal. Accept either a full Notion UUID
      // or a short dealCode like "PHX-001" (resolved via the Notion DB).
      var deal = null;
      if (looksLikeNotionUuid(params.deal_id)) {
        deal = await getDealById(token, dbId, params.deal_id);
      } else {
        deal = await getDealByCode(token, dbId, params.deal_id);
        // Fallback: if code lookup fails, try treating the input as a UUID
        // anyway (handles edge cases where the DB filter errors out)
        if (!deal) deal = await getDealById(token, dbId, params.deal_id);
      }
      if (deal) deals = [deal];
      else return { statusCode: 404, headers: headers, body: JSON.stringify({
        error: 'Deal not found',
        hint: 'Pass either the Notion page UUID or a dealCode like "PHX-001"',
        tried: params.deal_id
      }) };
    } else {
      // Scheduled run: check deals edited in last 35 minutes
      deals = await getRecentDeals(token, dbId, 35);
    }

    if (!deals.length) {
      return { statusCode: 200, headers: headers, body: JSON.stringify({
        message: 'No new deals to process',
        mode: isLive ? 'LIVE' : 'TEST',
        checkedAt: new Date().toISOString()
      })};
    }

    var results = [];

    for (var i = 0; i < deals.length; i++) {
      var deal = deals[i];

      // Best-effort: sync the Notion "Website Link" URL column with the
      // short /d/{city}-{zip}-{code} URL so Notion views show a clickable
      // live link. Never blocks alerts if the PATCH fails.
      try {
        var linkResult = await setDealWebsiteLink(token, deal);
        if (!linkResult.ok) {
          console.warn('notify-buyers: Website Link patch failed for ' + deal.id + ' status=' + linkResult.status);
        } else {
          console.log('notify-buyers: Website Link synced for ' + deal.id + ' → ' + deal.dealUrl);
        }
      } catch (linkErr) {
        console.warn('notify-buyers: Website Link patch threw for ' + deal.id + ': ' + linkErr.message);
      }

      var buyers = await findMatchingBuyers(apiKey, locationId, deal);

      var dealResult = {
        deal: {
          id: deal.id,
          type: deal.dealType,
          address: deal.streetAddress + ', ' + deal.city + ', ' + deal.state,
          price: deal.askingPrice,
          entry: deal.entryFee,
          url: deal.dealUrl
        },
        matchedBuyers: buyers.length,
        tiers: {
          tier1_strict: buyers.filter(function(b){return b.tier===1;}).length,
          tier2_relaxed: buyers.filter(function(b){return b.tier===2;}).length,
          tier3_state: buyers.filter(function(b){return b.tier===3;}).length
        },
        buyers: buyers.map(function(b) {
          return {
            name: b.name,
            email: b.email,
            phone: b.phone ? b.phone.replace(/\d{4}$/, '****') : '',
            tier: b.tier,
            score: b.score,
            matchReason: b.matchReason
          };
        }),
        alerts: []
      };

      // TEST_ONLY_PHONE: if set, only send to this phone number (for safe testing)
      var testOnlyPhone = process.env.TEST_ONLY_PHONE || '';

      if (isLive) {
        // LIVE MODE: Actually trigger GHL alerts + send SMS
        for (var j = 0; j < buyers.length; j++) {
          if (testOnlyPhone && buyers[j].phone !== testOnlyPhone) {
            dealResult.alerts.push({
              buyer: buyers[j].name,
              status: 'SKIPPED — test mode, not target phone',
              sent: false
            });
            continue;
          }
          var status = await triggerBuyerAlert(apiKey, locationId, buyers[j], deal);
          dealResult.alerts.push({
            buyer: buyers[j].name,
            status: status,
            sent: true
          });
        }
        console.log('LIVE: Sent alerts for deal ' + deal.streetAddress + (testOnlyPhone ? ' (TEST_ONLY_PHONE=' + testOnlyPhone + ')' : ''));
      } else {
        // TEST MODE: Log what would happen
        dealResult.alerts = buyers.map(function(b) {
          return { buyer: b.name, status: 'TEST — would send', sent: false };
        });
        console.log('TEST: Would send ' + buyers.length + ' alerts for deal ' + deal.streetAddress);
      }

      results.push(dealResult);

      // Auto-generate blog post for new deals (fire and forget)
      if (autoBlog && isLive) {
        try { await autoBlog.createDealPost(deal); } catch(e) { console.warn('[notify-buyers] auto-blog failed:', e.message); }
      }
    }

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        mode: isLive && !isTest ? 'LIVE' : 'TEST',
        dealsProcessed: deals.length,
        totalAlerts: results.reduce(function(sum, r) { return sum + r.matchedBuyers; }, 0),
        results: results,
        timestamp: new Date().toISOString()
      }, null, 2)
    };

  } catch (err) {
    console.error('notify-buyers error:', err.message);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
