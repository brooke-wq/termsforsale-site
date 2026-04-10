#!/usr/bin/env node
/**
 * Notion Description Backfill
 *
 * Scans deals in the Notion "Deal Pipeline" DB that are missing a
 * Description, auto-generates one via Claude Haiku (~$0.001/call),
 * and PATCHes it back to the Notion page.
 *
 * Only writes to deals that have NO existing Description. Never
 * overwrites a human-written description.
 *
 * USAGE (run on Droplet or anywhere with NOTION_TOKEN + CLAUDE_API_KEY):
 *   cd /root/termsforsale-site
 *   DRY_RUN=1 node scripts/backfill-descriptions.js    # preview
 *   node scripts/backfill-descriptions.js              # apply
 *
 * Optional env:
 *   STATUSES   — comma-separated (default: "Actively Marketing")
 *   MAX_DEALS  — cap (default: unlimited)
 *
 * ENV VARS required:
 *   NOTION_TOKEN, CLAUDE_API_KEY (or ANTHROPIC_API_KEY)
 */

const https = require('https');
const { generateDescription } = require('../termsforsale/netlify/functions/_deal-description');
const { patchDescription } = require('../termsforsale/netlify/functions/_notion-url');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const MAX_DEALS = parseInt(process.env.MAX_DEALS || '0', 10);
const STATUSES = (process.env.STATUSES || 'Actively Marketing')
  .split(',').map(function(s) { return s.trim(); }).filter(Boolean);

const NOTION_TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const NOTION_DB_ID = process.env.NOTION_DB_ID || process.env.NOTION_DEALS_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';
const CLAUDE_KEY = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;

if (!NOTION_TOKEN) { console.error('Missing NOTION_TOKEN'); process.exit(1); }
if (!CLAUDE_KEY)   { console.error('Missing CLAUDE_API_KEY'); process.exit(1); }

function notionRequest(path, method, body) {
  return new Promise(function(resolve, reject) {
    var data = body ? JSON.stringify(body) : null;
    var opts = {
      hostname: 'api.notion.com', path: path, method: method,
      headers: {
        'Authorization': 'Bearer ' + NOTION_TOKEN,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    var req = https.request(opts, function(res) {
      var chunks = '';
      res.on('data', function(c) { chunks += c; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch (e) { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function readText(page, key) {
  var p = page.properties[key];
  if (!p) return '';
  switch (p.type) {
    case 'title': return (p.title || []).map(function(t) { return t.plain_text; }).join('');
    case 'rich_text': return (p.rich_text || []).map(function(t) { return t.plain_text; }).join('');
    case 'select': return p.select ? p.select.name : '';
    case 'status': return p.status ? p.status.name : '';
    case 'number': return p.number == null ? '' : String(p.number);
    case 'url': return p.url || '';
    default: return '';
  }
}

function parseDeal(page) {
  return {
    id: page.id,
    dealCode: readText(page, 'Deal ID'),
    dealType: readText(page, 'Deal Type'),
    streetAddress: readText(page, 'Street Address'),
    city: readText(page, 'City'),
    state: readText(page, 'State'),
    zip: readText(page, 'ZIP'),
    propertyType: readText(page, 'Property Type'),
    askingPrice: +readText(page, 'Asking Price') || 0,
    entryFee: +readText(page, 'Entry Fee') || 0,
    arv: +readText(page, 'ARV') || 0,
    rentFinal: +readText(page, 'LTR Market Rent') || 0,
    beds: readText(page, 'Beds'),
    baths: readText(page, 'Baths'),
    sqft: readText(page, 'Living Area') || readText(page, 'Sqft'),
    yearBuilt: readText(page, 'Year Built'),
    highlight1: readText(page, 'Highlight 1'),
    highlight2: readText(page, 'Highlight 2'),
    highlight3: readText(page, 'Highlight 3'),
    description: readText(page, 'Description') || readText(page, 'Details ') || readText(page, 'Details'),
    subtoLoanBalance: +readText(page, 'SubTo Loan Balance') || 0,
    subtoRate: +readText(page, 'SubTo Rate (%)') || 0,
    piti: +readText(page, 'PITI ') || +readText(page, 'PITI') || 0,
    sfLoanAmount: +readText(page, 'SF Loan Amount') || 0,
    sfRate: readText(page, 'SF Rate'),
    sfTerm: readText(page, 'SF Term'),
    sfPayment: +readText(page, 'SF Payment') || 0,
    occupancy: readText(page, 'Occupancy'),
    hoa: readText(page, 'HOA')
  };
}

async function queryAllPages() {
  var all = [], cursor;
  do {
    var body = { page_size: 100, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] };
    if (cursor) body.start_cursor = cursor;
    if (STATUSES.length === 1) {
      body.filter = { property: 'Deal Status', status: { equals: STATUSES[0] } };
    } else if (STATUSES.length > 1) {
      body.filter = { or: STATUSES.map(function(s) { return { property: 'Deal Status', status: { equals: s } }; }) };
    }
    var r = await notionRequest('/v1/databases/' + NOTION_DB_ID + '/query', 'POST', body);
    if (r.status !== 200) { console.error('Notion query failed:', r.status); break; }
    all = all.concat(r.body.results || []);
    cursor = r.body.has_more ? r.body.next_cursor : null;
    if (MAX_DEALS && all.length >= MAX_DEALS) break;
  } while (cursor);
  return MAX_DEALS ? all.slice(0, MAX_DEALS) : all;
}

(async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Notion Description Backfill (Claude Haiku)                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('  Mode:       ' + (DRY_RUN ? 'DRY RUN' : 'LIVE'));
  console.log('  Statuses:   ' + STATUSES.join(', '));
  if (MAX_DEALS) console.log('  Max deals:  ' + MAX_DEALS);
  console.log('');

  var pages = await queryAllPages();
  console.log('Found ' + pages.length + ' matching deals\n');

  var generated = 0, skipped = 0, failed = 0;

  for (var i = 0; i < pages.length; i++) {
    var deal = parseDeal(pages[i]);
    var label = (deal.dealCode || deal.id.slice(0, 8)) + '  ' + (deal.city || '—') + ', ' + (deal.state || '');

    if (deal.description) {
      console.log('HAS   ' + label + '  ✓ already has description (' + deal.description.length + ' chars)');
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log('WOULD ' + label + '  (no description — would generate)');
      generated++;
      continue;
    }

    try {
      var desc = await generateDescription(CLAUDE_KEY, deal);
      var res = await patchDescription(NOTION_TOKEN, deal.id, desc);
      if (res.ok) {
        console.log('WROTE ' + label);
        console.log('       ' + desc.slice(0, 120) + (desc.length > 120 ? '…' : ''));
        generated++;
      } else {
        console.log('FAIL  ' + label + '  Notion PATCH status=' + res.status);
        failed++;
      }
    } catch (err) {
      console.log('FAIL  ' + label + '  ' + err.message);
      failed++;
    }

    // Small delay between Claude calls to stay well within rate limits
    if (i < pages.length - 1) await new Promise(function(r) { setTimeout(r, 500); });
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  BACKFILL COMPLETE                                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('  ' + (DRY_RUN ? 'Would generate: ' : 'Generated:      ') + generated);
  console.log('  Already had:    ' + skipped);
  console.log('  Failed:         ' + failed);
  if (generated > 0 && !DRY_RUN) {
    var estCost = generated * 0.001;
    console.log('  Est. cost:      ~$' + estCost.toFixed(3) + ' (Haiku)');
  }

  if (failed > 0) process.exit(1);
})().catch(function(err) { console.error('Fatal:', err); process.exit(1); });
