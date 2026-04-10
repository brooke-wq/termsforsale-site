#!/usr/bin/env node
/**
 * Retrigger Unsent Deals
 *
 * Scans all "Actively Marketing" deals in the Notion Deal Pipeline,
 * checks GHL for any contacts tagged with `sent:[slug]` for each deal,
 * and retriggers `notify-buyers` for any deal that has 0 sent buyers.
 *
 * WHY: `notify-buyers.js` cron only picks up deals where "Started Marketing"
 * date >= today. If a deal was set to Actively Marketing and the cron didn't
 * run that day (or the date was set retroactively), the deal is permanently
 * skipped. This script catches those missed deals.
 *
 * USAGE (run on Droplet or anywhere with NOTION_TOKEN + GHL_API_KEY):
 *   cd /root/termsforsale-site
 *   DRY_RUN=1 node scripts/retrigger-unsent-deals.js   # preview only
 *   node scripts/retrigger-unsent-deals.js              # actually trigger
 *
 * Optional env:
 *   MAX_DEALS  — cap the number of deals retriggered (default: unlimited)
 *   DEAL_IDS   — comma-separated Deal IDs to target (e.g. "PHI-02,PHI-03")
 *                If set, only those deals are checked/triggered.
 *
 * ENV VARS required:
 *   NOTION_TOKEN
 *   GHL_API_KEY
 *   GHL_LOCATION_ID
 *   DEAL_ALERTS_LIVE  — must be "true" to actually send SMS/email
 */

const https = require('https');
const path = require('path');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const MAX_DEALS = parseInt(process.env.MAX_DEALS || '0', 10);
const DEAL_IDS = (process.env.DEAL_IDS || '')
  .split(',')
  .map(function(s) { return s.trim().toUpperCase(); })
  .filter(Boolean);

const NOTION_TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const NOTION_DB_ID = process.env.NOTION_DB_ID || process.env.NOTION_DEALS_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

if (!NOTION_TOKEN) { console.error('Missing NOTION_TOKEN'); process.exit(1); }
if (!GHL_API_KEY) { console.error('Missing GHL_API_KEY'); process.exit(1); }
if (!GHL_LOCATION_ID) { console.error('Missing GHL_LOCATION_ID'); process.exit(1); }

// ─── HTTP helpers ───────────────────────────────────────────────

function httpRequest(url, options, body) {
  return new Promise(function(resolve, reject) {
    var parsed = new URL(url);
    var opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };
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

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// ─── Notion: fetch all Actively Marketing deals ─────────────────

function prop(page, name) {
  var p = page.properties[name];
  if (!p) return '';
  switch (p.type) {
    case 'title': return (p.title || []).map(function(t) { return t.plain_text; }).join('');
    case 'rich_text': return (p.rich_text || []).map(function(t) { return t.plain_text; }).join('');
    case 'number': return p.number !== null && p.number !== undefined ? p.number : '';
    case 'select': return p.select ? p.select.name : '';
    case 'status': return p.status ? p.status.name : '';
    case 'url': return p.url || '';
    case 'date': return p.date ? p.date.start : '';
    default: return '';
  }
}

async function fetchActiveDeals() {
  var allPages = [];
  var hasMore = true;
  var cursor = undefined;

  while (hasMore) {
    var queryBody = {
      filter: { property: 'Deal Status', status: { equals: 'Actively Marketing' } },
      page_size: 100,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }]
    };
    if (cursor) queryBody.start_cursor = cursor;

    var result = await httpRequest('https://api.notion.com/v1/databases/' + NOTION_DB_ID + '/query', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + NOTION_TOKEN,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    }, queryBody);

    if (result.status !== 200) {
      // Try select filter instead of status
      queryBody.filter = { property: 'Deal Status', select: { equals: 'Actively Marketing' } };
      result = await httpRequest('https://api.notion.com/v1/databases/' + NOTION_DB_ID + '/query', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + NOTION_TOKEN,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        }
      }, queryBody);
    }

    if (result.status !== 200) {
      console.error('Notion API error:', result.status, JSON.stringify(result.body));
      break;
    }

    allPages = allPages.concat(result.body.results || []);
    hasMore = result.body.has_more === true;
    cursor = result.body.next_cursor || undefined;
  }

  return allPages.map(function(page) {
    return {
      id: page.id,
      dealCode: prop(page, 'Deal ID'),
      streetAddress: prop(page, 'Street Address'),
      city: prop(page, 'City'),
      state: prop(page, 'State'),
      zip: prop(page, 'ZIP'),
      dealType: prop(page, 'Deal Type'),
      askingPrice: +prop(page, 'Asking Price') || 0,
      startedMarketing: prop(page, 'Started Marketing ')
    };
  });
}

// ─── Slug generation (must match notify-buyers.js) ──────────────

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

// ─── GHL: check if any buyers have the sent:[slug] tag ──────────

async function countSentBuyers(slug) {
  var tag = 'sent:' + slug;
  var result = await httpRequest('https://services.leadconnectorhq.com/contacts/search', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + GHL_API_KEY,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    }
  }, {
    locationId: GHL_LOCATION_ID,
    page: 1,
    pageLimit: 1,
    filters: [{
      group: 'AND',
      filters: [{
        field: 'tags',
        operator: 'contains',
        value: [tag]
      }]
    }]
  });

  if (result.status < 200 || result.status >= 300) {
    console.warn('  GHL search error for tag "' + tag + '": status ' + result.status);
    return -1; // error sentinel
  }

  var contacts = (result.body && (result.body.contacts || result.body.data)) || [];
  return contacts.length;
}

// ─── Trigger notify-buyers for a deal ───────────────────────────

async function triggerNotifyBuyers(deal) {
  // Use the notify-buyers function directly via require (same as run-job.js)
  var fnPath = path.join(__dirname, '..', 'termsforsale', 'netlify', 'functions', 'notify-buyers');
  var fn;
  try {
    fn = require(fnPath);
  } catch(e) {
    console.error('  Failed to load notify-buyers:', e.message);
    return null;
  }

  // Build a fake Netlify event with the deal_id param
  var dealRef = deal.dealCode || deal.id;
  var event = {
    httpMethod: 'GET',
    queryStringParameters: { deal_id: dealRef, test: 'false' },
    headers: {},
    body: null
  };

  try {
    var result = await fn.handler(event, {});
    var body = {};
    try { body = JSON.parse(result.body); } catch(e) {}
    return { status: result.statusCode, body: body };
  } catch(e) {
    console.error('  notify-buyers threw:', e.message);
    return null;
  }
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('=== Retrigger Unsent Deals ===');
  console.log('Mode: ' + (DRY_RUN ? 'DRY RUN (no alerts sent)' : 'LIVE'));
  console.log('DEAL_ALERTS_LIVE: ' + (process.env.DEAL_ALERTS_LIVE || 'not set'));
  if (DEAL_IDS.length) console.log('Targeting specific deals: ' + DEAL_IDS.join(', '));
  if (MAX_DEALS) console.log('Max deals to trigger: ' + MAX_DEALS);
  console.log('');

  // Step 1: Fetch all actively marketing deals from Notion
  console.log('Fetching Actively Marketing deals from Notion...');
  var deals = await fetchActiveDeals();
  console.log('Found ' + deals.length + ' actively marketing deals.\n');

  // Filter to specific deal IDs if provided
  if (DEAL_IDS.length) {
    deals = deals.filter(function(d) {
      return DEAL_IDS.indexOf((d.dealCode || '').toUpperCase()) > -1;
    });
    console.log('Filtered to ' + deals.length + ' matching deals.\n');
  }

  // Step 2: Check each deal for sent buyers
  var unsent = [];
  for (var i = 0; i < deals.length; i++) {
    var deal = deals[i];
    var slug = slugifyAddress(deal.streetAddress, deal.city, deal.state);
    var label = (deal.dealCode || deal.id.slice(0, 8)) + ' — ' + deal.streetAddress + ', ' + deal.city + ', ' + deal.state;

    if (!slug) {
      console.log('SKIP  ' + label + ' (no address → empty slug)');
      continue;
    }

    var count = await countSentBuyers(slug);
    if (count < 0) {
      console.log('ERROR ' + label + ' (GHL search failed)');
    } else if (count === 0) {
      console.log('UNSENT ' + label + '  [slug: ' + slug + ']');
      unsent.push(deal);
    } else {
      console.log('OK     ' + label + '  [' + count + '+ buyers tagged]');
    }

    // Rate limit: 1 GHL search per 200ms
    await sleep(200);
  }

  console.log('\n' + unsent.length + ' deals have 0 sent buyers.\n');

  if (!unsent.length) {
    console.log('Nothing to retrigger. Done.');
    return;
  }

  // Step 3: Retrigger notify-buyers for unsent deals
  var triggered = 0;
  for (var j = 0; j < unsent.length; j++) {
    if (MAX_DEALS && triggered >= MAX_DEALS) {
      console.log('Reached MAX_DEALS=' + MAX_DEALS + ', stopping.');
      break;
    }

    var d = unsent[j];
    var dlabel = (d.dealCode || d.id.slice(0, 8)) + ' — ' + d.streetAddress;

    if (DRY_RUN) {
      console.log('DRY RUN: would trigger notify-buyers for ' + dlabel + ' (deal_id=' + (d.dealCode || d.id) + ')');
      triggered++;
      continue;
    }

    console.log('TRIGGERING notify-buyers for ' + dlabel + '...');
    var result = await triggerNotifyBuyers(d);
    if (result) {
      var matched = (result.body && result.body.results && result.body.results[0])
        ? result.body.results[0].matchedBuyers
        : '?';
      console.log('  → status=' + result.status + ', matched=' + matched + ' buyers');
    } else {
      console.log('  → FAILED (see error above)');
    }
    triggered++;

    // Rate limit between triggers (notify-buyers does many GHL calls)
    await sleep(2000);
  }

  console.log('\nDone. Triggered ' + triggered + ' deals.');
}

main().catch(function(err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
