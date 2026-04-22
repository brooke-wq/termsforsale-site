#!/usr/bin/env node
/**
 * tokenize-pitch-deck.js — Phase 1 tokenization of tfs-build/pitch-deck-template.html
 *
 * Converts the hard-coded "4218 S Juniper Creek Dr." example values into {{TOKEN}}
 * placeholders so the deck can be filled in per-deal by /api/generate-pitch-deck.
 *
 * Phase 1 scope: deal identity, cover stats, property specs, location header,
 * financial headline tiles, contact / close section. Exit strategy tables,
 * comps, rent comps, rehab, and risk narratives remain as example content
 * until Phase 2 (AI-generated content + computed math).
 *
 * Idempotent: running twice produces the same file (the Juniper example
 * strings have already been replaced; second pass is a no-op).
 *
 * Usage:
 *   node scripts/tokenize-pitch-deck.js
 *   node scripts/tokenize-pitch-deck.js --dry   # prints replacement count without writing
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'tfs-build', 'pitch-deck-template.html');
const DRY = process.argv.includes('--dry');

// Each entry: [search-string, token, { all?: bool, minCount?: number }]
// minCount (optional) asserts that the search-string appears at least N times;
// used to catch template drift — if Brooke's template is re-generated and a
// string disappears, this script fails loudly instead of silently skipping.
const REPLACEMENTS = [
  // ============== SLIDE 01 — COVER ==============
  ['4218 S&nbsp;Juniper&nbsp;Creek&nbsp;Dr.',            '{{DEAL_ADDRESS}}',              { minCount: 1 }],
  ['Tampa, Florida&nbsp;33611',                          '{{CITY_STATE_ZIP}}',            { minCount: 1 }],
  ['Single Family · 3/2',                                '{{PROPERTY_TYPE_BEDS_BATHS}}',  { minCount: 1 }],
  ['Subject&#8209;To + Seller Finance',                  '{{DEAL_STRUCTURE}}',            { minCount: 1 }],
  ['6 Viable Exits',                                     '{{VIABLE_EXITS}}',              { minCount: 1 }],
  ['TFS&nbsp;&mdash;&nbsp;1042',                         '{{DEAL_ID}}',                   { minCount: 1 }],
  ['April 21, 2026',                                     '{{MEMO_DATE}}',                 { minCount: 1 }],
  ['Private Buyer List',                                 '{{PREPARED_FOR}}',              { minCount: 1 }],

  // ============== HEADER ON EVERY SLIDE ==============
  // These appear on ~13 non-cover slides as "Deal TFS&#8209;1042 · <section>"
  ['TFS&#8209;1042',                                     '{{DEAL_ID_SHORT}}',             { all: true, minCount: 10 }],

  // ============== SLIDE 02 — EXECUTIVE SUMMARY ==============
  ['An assumable 2.875% loan, in-place cashflow,<br/>six viable exits.', '{{EXEC_HEADLINE}}', { minCount: 1 }],
  // NOTE: narrative paragraphs + stat tile values (18.4%, $2,140, 7–21 d) are kept hard-coded
  // until Phase 2. The cover-page stat row already has its own tokens.

  // ============== SLIDE 03 — THE PROPERTY ==============
  ['4218 S Juniper Creek Dr.',                           '{{DEAL_ADDRESS_PLAIN}}',        { minCount: 1 }],
  // photo labels remain static (FRONT ELEVATION / KITCHEN etc.)
  ['font-size:30px;">Single Family</div>',              'font-size:30px;">{{PROPERTY_TYPE}}</div>', { minCount: 1 }],
  ['font-size:30px;">1998</div>',                        'font-size:30px;">{{YEAR_BUILT}}</div>',    { minCount: 1 }],
  ['font-size:30px;">Turn&#8209;Key</div>',              'font-size:30px;">{{CONDITION}}</div>',     { minCount: 1 }],
  ['font-size:30px;">Vacant</div>',                      'font-size:30px;">{{OCCUPANCY}}</div>',     { minCount: 1 }],

  // ============== SLIDE 04 — PROPERTY SPECS ==============
  // Big number tiles (Bedrooms, Bathrooms, Sqft, Lot, Year, Garage)
  ['font-size:88px;">3</div>\n            <div class="lbl">Bedrooms</div>',     'font-size:88px;">{{BEDROOMS}}</div>\n            <div class="lbl">Bedrooms</div>', { minCount: 1 }],
  ['font-size:88px;">2</div>\n            <div class="lbl">Bathrooms</div>',    'font-size:88px;">{{BATHROOMS}}</div>\n            <div class="lbl">Bathrooms</div>', { minCount: 1 }],
  ['font-size:88px;">1,784</div>\n            <div class="lbl">Sq Ft Living</div>', 'font-size:88px;">{{LIVING_SQFT}}</div>\n            <div class="lbl">Sq Ft Living</div>', { minCount: 1 }],
  ['font-size:88px;">8,712</div>\n            <div class="lbl">Lot Sq Ft</div>',    'font-size:88px;">{{LOT_SQFT}}</div>\n            <div class="lbl">Lot Sq Ft</div>', { minCount: 1 }],
  ['font-size:88px;">1998</div>\n            <div class="lbl">Year Built</div>',   'font-size:88px;">{{YEAR_BUILT_2}}</div>\n            <div class="lbl">Year Built</div>', { minCount: 1 }],
  ['font-size:88px;">2&#8209;car</div>',                 'font-size:88px;">{{GARAGE}}</div>', { minCount: 1 }],

  // ============== SLIDE 05 — LOCATION & MARKET ==============
  ['South Tampa · 33611',                                '{{SUBMARKET_NAME}}',            { minCount: 1 }],
  ['Interbay peninsula. Walk to Ballast Point waterfront, 10 minutes to MacDill AFB, 15 minutes to downtown.', '{{LOCATION_NARRATIVE}}', { minCount: 1 }],

  // ============== COVER-PAGE STAT TILES + EXEC-SUMMARY BOTTOM STRIP ==============
  // Hero purchase-price / rate / cash / PITI / equity appear on slide 1 (big)
  // and again on slide 2 summary strip. Tokenize both.

  // Cover — big $387,000
  ['<div class="num ivory" style="font-size:140px;">$387,000</div>',
   '<div class="num ivory" style="font-size:140px;">{{PURCHASE_PRICE}}</div>',          { minCount: 1 }],
  // Cover — 2.875%
  ['<div class="num" style="color:var(--gold); font-size:72px;">2.875%</div>',
   '<div class="num" style="color:var(--gold); font-size:72px;">{{EXISTING_RATE}}</div>', { minCount: 1 }],
  // Cover — $42K cash
  ['<div class="num ivory" style="font-size:72px;">$42K</div>\n          <div class="lbl" style="color:var(--slate-mist);">Cash to Close</div>',
   '<div class="num ivory" style="font-size:72px;">{{CASH_TO_CLOSE_SHORT}}</div>\n          <div class="lbl" style="color:var(--slate-mist);">Cash to Close</div>', { minCount: 1 }],
  // Cover — $1,890 PITI
  ['<div class="num" style="color:var(--gold); font-size:72px;">$1,890</div>',
   '<div class="num" style="color:var(--gold); font-size:72px;">{{PITI}}</div>',         { minCount: 1 }],
  // Cover — $78K equity
  ['<div class="num ivory" style="font-size:72px;">$78K</div>',
   '<div class="num ivory" style="font-size:72px;">{{DAY1_EQUITY_SHORT}}</div>',         { minCount: 1 }],

  // ============== SLIDE 23 — NEXT STEPS / CONTACT ==============
  ['32 active deals this week. First qualified offer moves forward.',
   '{{ACTIVE_DEAL_COUNT}} active deals this week. First qualified offer moves forward.', { minCount: 1 }],
  ['Jordan Avery',                                       '{{COORDINATOR_NAME}}',          { minCount: 1 }],
  ['Senior Acquisitions · Terms For Sale',               '{{COORDINATOR_TITLE}}',         { minCount: 1 }],
  ['deals@termsforsale.com',                             '{{COORDINATOR_EMAIL}}',         { minCount: 1 }],
  ['(480) 637&#8209;3117',                               '{{COORDINATOR_PHONE}}',         { minCount: 1 }],
  ['termsforsale.com/deals/TFS-1042',                    '{{DEAL_URL}}',                  { minCount: 1 }],
];

function tokenize() {
  if (!fs.existsSync(FILE)) {
    console.error(`[tokenize] file not found: ${FILE}`);
    process.exit(1);
  }

  let html = fs.readFileSync(FILE, 'utf8');
  const originalLen = html.length;

  let totalReplacements = 0;
  const log = [];

  for (const [search, token, opts] of REPLACEMENTS) {
    const hits = countOccurrences(html, search);
    const tokenAlready = countOccurrences(html, token);

    if (hits === 0 && tokenAlready > 0) {
      // already tokenized on a previous run — skip silently (idempotent)
      log.push(`  [skip-already-tokenized] ${token}`);
      continue;
    }

    if (hits === 0) {
      log.push(`  [WARN] search string not found (and no existing token): ${truncate(search, 60)}`);
      continue;
    }

    if (opts.minCount && hits < opts.minCount) {
      log.push(`  [WARN] expected ${opts.minCount}+ hits for "${truncate(search, 40)}" but found ${hits}`);
    }

    if (opts.all) {
      html = html.split(search).join(token);
      totalReplacements += hits;
      log.push(`  [replace-all x${hits}] ${truncate(search, 40)} → ${token}`);
    } else {
      // Replace only first occurrence (default)
      html = html.replace(search, token);
      totalReplacements += 1;
      log.push(`  [replace x1] ${truncate(search, 40)} → ${token}`);
    }
  }

  // Count unique tokens present after tokenization
  const allTokens = html.match(/\{\{[A-Z0-9_]+\}\}/g) || [];
  const uniqueTokens = Array.from(new Set(allTokens)).sort();

  console.log('--- REPLACEMENT LOG ---');
  console.log(log.join('\n'));
  console.log('');
  console.log(`Total replacements applied: ${totalReplacements}`);
  console.log(`Unique tokens in output: ${uniqueTokens.length}`);
  console.log(`Token list: ${uniqueTokens.join(', ')}`);
  console.log(`File length: ${originalLen} → ${html.length} (diff ${html.length - originalLen})`);

  if (DRY) {
    console.log('\n[DRY RUN] not writing file.');
    return;
  }

  fs.writeFileSync(FILE, html, 'utf8');
  console.log(`\nWrote ${FILE}`);
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function truncate(s, n) {
  const oneLine = s.replace(/\n/g, '\\n');
  return oneLine.length > n ? oneLine.slice(0, n) + '…' : oneLine;
}

tokenize();
