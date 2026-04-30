#!/usr/bin/env node
/**
 * Backfill sent:[slug] Tags From sent-log.json
 *
 * Why this exists: between 2026-04-22 (when notify-buyers.js was disabled
 * and replaced by buyer-deal-alerts.js) and the canonical-sender tag fix,
 * the new sender did NOT write the per-deal audit tags
 * (sent:[slug], tier{N}:[slug], alerted-{shortId}, new-deal-alert)
 * that the admin Deal Buyer List dashboard + admin-analytics.js query.
 *
 * Existing migrate-sent-tags.js can't help here — it keys off the
 * alerted-XXXXXXXX tag on GHL contacts, which buyer-deal-alerts.js
 * also wasn't writing. The droplet's jobs/sent-log.json IS the
 * authoritative record of what was actually sent during that window.
 *
 * HOW IT WORKS:
 *   1. Load jobs/sent-log.json — keys are "{contactId}-{dealIdShort}-alert"
 *   2. Group entries by dealIdShort
 *   3. Page through Notion deals DB once, build dealIdShort → deal map
 *      (street, city, state). dealIdShort = first 8 chars of the page UUID.
 *   4. For each (contactId, dealIdShort) entry:
 *        - Compute slug = slugifyAddress(street, city, state)
 *        - POST tags [sent:{slug}, alerted-{shortId}, new-deal-alert] to
 *          /contacts/{id}/tags. GHL appends so existing tags are preserved.
 *
 * Notes:
 *   - We can NOT recover the tier{N}:[slug] tag from sent-log alone (it
 *     never recorded match tier). That's acceptable — tier was a polish
 *     signal, not the primary audit tag.
 *   - GHL tag adds are idempotent at the storage layer (duplicates
 *     collapse), but we still skip contacts whose existing tag list
 *     already includes the target sent:[slug] to avoid wasted API calls.
 *
 * USAGE (must run on the Droplet — that's where sent-log.json lives):
 *   cd /root/termsforsale-site
 *   DRY_RUN=1 node scripts/backfill-sent-tags-from-log.js   # preview
 *   node scripts/backfill-sent-tags-from-log.js             # apply
 *
 *   MAX_ENTRIES=50 node scripts/...    # cap for testing
 *   SINCE=2026-04-22 node scripts/...  # only entries with ts >= date
 *
 * ENV VARS:
 *   GHL_API_KEY, GHL_LOCATION_ID (or GHL_LOCATION_ID_TERMS),
 *   NOTION_TOKEN, NOTION_DB_ID (defaults to residential deals DB)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DRY_RUN     = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const MAX_ENTRIES = parseInt(process.env.MAX_ENTRIES || '0', 10);  // 0 = unlimited
const SINCE       = process.env.SINCE || '';                       // ISO date string

const GHL_API_KEY     = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID_TERMS || process.env.GHL_LOCATION_ID;
const NOTION_TOKEN    = process.env.NOTION_TOKEN;
const NOTION_DB_ID    = process.env.NOTION_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';

const SENT_LOG_PATH = path.join(__dirname, '..', 'jobs', 'sent-log.json');

if (!GHL_API_KEY || !GHL_LOCATION_ID || !NOTION_TOKEN) {
  console.error('Missing required env vars: GHL_API_KEY, GHL_LOCATION_ID(_TERMS), NOTION_TOKEN');
  process.exit(1);
}

if (!fs.existsSync(SENT_LOG_PATH)) {
  console.error('sent-log.json not found at ' + SENT_LOG_PATH);
  console.error('This script must be run on the Droplet (paperclip).');
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────

// MUST stay byte-identical to slugifyAddress in:
//   termsforsale/netlify/functions/_legacy-sender-helpers.js
//   termsforsale/netlify/functions/buyer-deal-alerts.js (via legacy)
//   termsforsale/netlify/functions/admin-analytics.js
//   scripts/migrate-sent-tags.js
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

function request(method, hostname, urlPath, headers, body) {
  return new Promise(function (resolve, reject) {
    var req = https.request({ hostname, path: urlPath, method, headers }, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        var parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function ghl(method, urlPath, body) {
  return request(method, 'services.leadconnectorhq.com', urlPath, {
    Authorization: 'Bearer ' + GHL_API_KEY,
    Version:       '2021-07-28',
    'Content-Type':'application/json',
    Accept:        'application/json',
  }, body);
}

function notionProp(page, name) {
  var p = page && page.properties && page.properties[name];
  if (!p) return '';
  switch (p.type) {
    case 'title':       return (p.title       || []).map(function(t){return t.plain_text;}).join('');
    case 'rich_text':   return (p.rich_text   || []).map(function(t){return t.plain_text;}).join('');
    case 'select':      return p.select ? p.select.name : '';
    default:            return '';
  }
}

async function loadAllNotionDeals() {
  var deals = [];
  var hasMore = true;
  var startCursor;
  while (hasMore) {
    var body = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;
    var res = await request('POST', 'api.notion.com', '/v1/databases/' + NOTION_DB_ID + '/query', {
      Authorization:    'Bearer ' + NOTION_TOKEN,
      'Notion-Version': '2022-06-28',
      'Content-Type':   'application/json',
    }, body);
    if (res.status !== 200) {
      console.error('Notion query failed: HTTP ' + res.status, res.body);
      break;
    }
    var batch = (res.body && res.body.results) || [];
    batch.forEach(function (page) {
      var fullId = String(page.id || '').replace(/-/g, '');
      var shortId = fullId.slice(0, 8);
      deals.push({
        id: page.id,
        shortId: shortId,
        dealCode:      notionProp(page, 'Deal ID'),
        streetAddress: notionProp(page, 'Street Address'),
        city:          notionProp(page, 'City'),
        state:         notionProp(page, 'State'),
      });
    });
    hasMore = res.body && res.body.has_more;
    startCursor = res.body && res.body.next_cursor;
  }
  return deals;
}

async function getContactTags(contactId) {
  var res = await ghl('GET', '/contacts/' + contactId);
  if (res.status !== 200) return null;
  var c = (res.body && (res.body.contact || res.body)) || {};
  return Array.isArray(c.tags) ? c.tags.map(function (t) { return String(t).toLowerCase(); }) : [];
}

async function addTags(contactId, tags) {
  return ghl('POST', '/contacts/' + contactId + '/tags', { tags: tags });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ─── Main ──────────────────────────────────────────────────────────

(async function main() {
  console.log('Loading sent-log.json …');
  var raw = JSON.parse(fs.readFileSync(SENT_LOG_PATH, 'utf8'));

  // Parse keys: "{contactId}-{dealIdShort}-alert"
  var entries = [];
  Object.keys(raw).forEach(function (key) {
    var m = key.match(/^([A-Za-z0-9]+)-([0-9a-f]{8})-alert$/);
    if (!m) return;
    var ts = (raw[key] && raw[key].ts) || '';
    if (SINCE && ts && ts < SINCE) return;
    entries.push({ contactId: m[1], shortId: m[2], ts: ts });
  });
  console.log('Parsed ' + entries.length + ' alert entries from sent-log');

  if (MAX_ENTRIES > 0) {
    entries = entries.slice(0, MAX_ENTRIES);
    console.log('Capped to first ' + entries.length + ' (MAX_ENTRIES)');
  }

  console.log('Loading deals from Notion …');
  var deals = await loadAllNotionDeals();
  console.log('Loaded ' + deals.length + ' deals from Notion');

  var dealByShortId = {};
  deals.forEach(function (d) { dealByShortId[d.shortId] = d; });

  // Group entries by shortId so we can report and skip-checks per-deal.
  var unmatchedShortIds = new Set();
  var stats = { processed: 0, tagged: 0, alreadyHadTag: 0, contactNotFound: 0, dealNotFound: 0, errors: 0 };

  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    stats.processed++;

    var deal = dealByShortId[e.shortId];
    if (!deal) {
      unmatchedShortIds.add(e.shortId);
      stats.dealNotFound++;
      continue;
    }
    var slug = slugifyAddress(deal.streetAddress, deal.city, deal.state);
    if (!slug) {
      stats.dealNotFound++;
      continue;
    }
    var sentTag = 'sent:' + slug;
    var alertedTag = 'alerted-' + e.shortId;

    // Check existing tags so we don't waste API calls.
    var existing = await getContactTags(e.contactId);
    if (existing === null) {
      stats.contactNotFound++;
      console.log('[' + (i+1) + '/' + entries.length + '] CONTACT_404 ' + e.contactId);
      continue;
    }
    var hasSent     = existing.indexOf(sentTag) > -1;
    var hasAlerted  = existing.indexOf(alertedTag) > -1;
    var hasNewAlert = existing.indexOf('new-deal-alert') > -1;
    if (hasSent && hasAlerted && hasNewAlert) {
      stats.alreadyHadTag++;
      continue;
    }

    var toAdd = [];
    if (!hasSent)     toAdd.push(sentTag);
    if (!hasAlerted)  toAdd.push(alertedTag);
    if (!hasNewAlert) toAdd.push('new-deal-alert');

    if (DRY_RUN) {
      console.log('[' + (i+1) + '/' + entries.length + '] DRY ' + e.contactId
        + ' deal=' + (deal.dealCode || e.shortId)
        + ' add=[' + toAdd.join(', ') + ']');
      stats.tagged++;
      continue;
    }

    var r = await addTags(e.contactId, toAdd);
    if (r.status >= 200 && r.status < 300) {
      stats.tagged++;
      console.log('[' + (i+1) + '/' + entries.length + '] OK  ' + e.contactId
        + ' deal=' + (deal.dealCode || e.shortId)
        + ' added=[' + toAdd.join(', ') + ']');
    } else {
      stats.errors++;
      console.warn('[' + (i+1) + '/' + entries.length + '] ERR ' + e.contactId
        + ' status=' + r.status + ' body=' + JSON.stringify(r.body).slice(0, 200));
    }

    // Light throttle so we don't bury GHL.
    await sleep(150);
  }

  console.log('\n─── Summary ────────────────────────');
  console.log('Mode:                 ' + (DRY_RUN ? 'DRY_RUN' : 'LIVE'));
  console.log('Entries processed:    ' + stats.processed);
  console.log('Tagged:               ' + stats.tagged);
  console.log('Already had tags:     ' + stats.alreadyHadTag);
  console.log('Contact not found:    ' + stats.contactNotFound);
  console.log('Deal not found in DB: ' + stats.dealNotFound);
  console.log('Errors:               ' + stats.errors);
  if (unmatchedShortIds.size) {
    console.log('Unique dealIdShorts not in current Notion DB: ' + unmatchedShortIds.size);
    console.log('  (likely closed/archived deals — sent: tag for those will not be backfilled)');
  }
})().catch(function (e) {
  console.error('Fatal:', e.message);
  console.error(e.stack);
  process.exit(1);
});
