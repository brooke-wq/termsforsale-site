#!/usr/bin/env node
/**
 * Notion Website Link Backfill
 *
 * Scans every deal in the Notion "Deal Pipeline" DB with status
 * `Actively Marketing` and sets the `Website Link` URL property to the
 * short public URL produced by `_deal-url.js`
 * (`https://deals.termsforsale.com/d/{city}-{zip}-{code}`).
 *
 * WHY: `notify-buyers.js` now writes the Website Link for every deal it
 * processes on the scheduled cron, but that only fires for deals that
 * were edited in the last 35 minutes. Legacy deals that are already
 * Actively Marketing won't get the field populated until someone edits
 * them — this script catches them up in one pass.
 *
 * Only overwrites entries that differ from the computed URL. Safe to
 * re-run at any time.
 *
 * USAGE (run on Droplet or anywhere with NOTION_TOKEN):
 *   cd /root/termsforsale-site
 *   DRY_RUN=1 node scripts/backfill-notion-website-links.js   # preview
 *   node scripts/backfill-notion-website-links.js             # apply
 *
 * Optional env:
 *   STATUSES — comma-separated list of Deal Status values to target
 *     (default: "Actively Marketing")
 *   MAX_DEALS — cap the number of pages processed (default: unlimited)
 *
 * ENV VARS required:
 *   NOTION_TOKEN
 *   NOTION_DB_ID   (default: a3c0a38fd9294d758dedabab2548ff29)
 */

const https = require('https');
const {
  buildDealUrl
} = require('../termsforsale/netlify/functions/_deal-url');
const {
  patchWebsiteLink
} = require('../termsforsale/netlify/functions/_notion-url');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const MAX_DEALS = parseInt(process.env.MAX_DEALS || '0', 10);
const STATUSES = (process.env.STATUSES || 'Actively Marketing')
  .split(',')
  .map(function(s) { return s.trim(); })
  .filter(Boolean);

const NOTION_TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const NOTION_DB_ID = process.env.NOTION_DB_ID || process.env.NOTION_DEALS_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';

if (!NOTION_TOKEN) {
  console.error('Missing required env var: NOTION_TOKEN');
  process.exit(1);
}

// ─── Notion helpers ─────────────────────────────────────────────

function notionRequest(path, method, body) {
  return new Promise(function(resolve, reject) {
    var data = body ? JSON.stringify(body) : null;
    var opts = {
      hostname: 'api.notion.com',
      path: path,
      method: method,
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
        try {
          resolve({ status: res.statusCode, body: JSON.parse(chunks) });
        } catch (e) {
          resolve({ status: res.statusCode, body: chunks });
        }
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
    case 'title':
      return (p.title || []).map(function(t) { return t.plain_text; }).join('');
    case 'rich_text':
      return (p.rich_text || []).map(function(t) { return t.plain_text; }).join('');
    case 'select':
      return p.select ? p.select.name : '';
    case 'status':
      return p.status ? p.status.name : '';
    case 'number':
      return p.number === null || p.number === undefined ? '' : String(p.number);
    case 'url':
      return p.url || '';
    default:
      return '';
  }
}

function parseDeal(page) {
  return {
    id: page.id,
    dealCode: readText(page, 'Deal ID'),
    streetAddress: readText(page, 'Street Address'),
    city: readText(page, 'City'),
    state: readText(page, 'State'),
    zip: readText(page, 'ZIP'),
    dealStatus: readText(page, 'Deal Status'),
    websiteLink: readText(page, 'Website Link')
  };
}

async function queryAllPages() {
  var all = [];
  var cursor;
  do {
    var body = {
      page_size: 100,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }]
    };
    if (cursor) body.start_cursor = cursor;
    if (STATUSES.length === 1) {
      body.filter = { property: 'Deal Status', status: { equals: STATUSES[0] } };
    } else if (STATUSES.length > 1) {
      body.filter = {
        or: STATUSES.map(function(s) {
          return { property: 'Deal Status', status: { equals: s } };
        })
      };
    }
    var result = await notionRequest('/v1/databases/' + NOTION_DB_ID + '/query', 'POST', body);
    if (result.status !== 200) {
      console.error('Notion query failed:', result.status, JSON.stringify(result.body).slice(0, 300));
      break;
    }
    all = all.concat(result.body.results || []);
    cursor = result.body.has_more ? result.body.next_cursor : null;
    if (MAX_DEALS && all.length >= MAX_DEALS) break;
  } while (cursor);
  return MAX_DEALS ? all.slice(0, MAX_DEALS) : all;
}

// ─── Main ───────────────────────────────────────────────────────

(async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Notion Website Link Backfill                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('  Mode:       ' + (DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will PATCH Notion)'));
  console.log('  Statuses:   ' + STATUSES.join(', '));
  console.log('  DB ID:      ' + NOTION_DB_ID);
  if (MAX_DEALS) console.log('  Max deals:  ' + MAX_DEALS);
  console.log('');

  var pages = await queryAllPages();
  console.log('Found ' + pages.length + ' matching deals');
  console.log('');

  var updated = 0;
  var unchanged = 0;
  var skipped = 0;
  var failed = 0;

  for (var i = 0; i < pages.length; i++) {
    var deal = parseDeal(pages[i]);
    var label = (deal.dealCode || deal.id.slice(0, 8)) + '  ' + (deal.streetAddress || '—') + ', ' + (deal.city || '—') + ' ' + (deal.state || '');
    var desiredUrl = buildDealUrl(deal);

    if (!deal.city && !deal.zip && !deal.dealCode) {
      console.log('SKIP  ' + label + '  (no city/zip/code — would produce a bare UUID slug)');
      skipped++;
      continue;
    }

    if (deal.websiteLink === desiredUrl) {
      console.log('OK    ' + label + '  ✓ already ' + desiredUrl);
      unchanged++;
      continue;
    }

    if (DRY_RUN) {
      console.log('WOULD ' + label);
      console.log('       from: ' + (deal.websiteLink || '(empty)'));
      console.log('       to:   ' + desiredUrl);
      updated++;
      continue;
    }

    var res = await patchWebsiteLink(NOTION_TOKEN, deal.id, desiredUrl);
    if (res.ok) {
      console.log('WROTE ' + label + '  → ' + desiredUrl);
      updated++;
    } else {
      console.log('FAIL  ' + label + '  status=' + res.status);
      failed++;
    }
  }

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  BACKFILL COMPLETE                                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('  ' + (DRY_RUN ? 'Would update: ' : 'Updated:      ') + updated);
  console.log('  Unchanged:    ' + unchanged);
  console.log('  Skipped:      ' + skipped);
  console.log('  Failed:       ' + failed);

  if (failed > 0) process.exit(1);
})().catch(function(err) {
  console.error('Fatal:', err);
  process.exit(1);
});
