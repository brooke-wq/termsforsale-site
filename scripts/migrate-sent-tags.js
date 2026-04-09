#!/usr/bin/env node
/**
 * Retroactive Sent-Tag Migration
 *
 * For every historical deal alert that was ever sent via notify-buyers.js,
 * add the new address-slug-based tags on the buyer contact in GHL:
 *   - sent:[slug]                        (matches the new deal-blast tagging system)
 *   - responded:[slug]                    (if the buyer already responded)
 *   - deal:hot / interested / passed     (migrated from old tags if present)
 *
 * HOW IT WORKS:
 *   1. Fetch all deals from Notion → build a map of 8-char deal ID → address slug
 *   2. Fetch all GHL contacts tagged "new-deal-alert" (paginated)
 *   3. For each contact:
 *        - Find their alerted-XXXXXXXX tags → map back to deal slugs
 *        - Collect the new tags to add (sent:[slug] for each matched deal)
 *        - If they have deal-hot/warm/paused, also migrate to deal:hot/interested/passed
 *        - Add all new tags in one API call (GHL appends, doesn't replace)
 *
 * USAGE (run on Droplet where env vars already exist):
 *   cd /root/termsforsale-site
 *   node scripts/migrate-sent-tags.js
 *
 *   # Dry run — show what would change, don't modify anything:
 *   DRY_RUN=1 node scripts/migrate-sent-tags.js
 *
 *   # Limit to first N contacts for testing:
 *   MAX_CONTACTS=10 node scripts/migrate-sent-tags.js
 *
 * ENV VARS required:
 *   GHL_API_KEY, GHL_LOCATION_ID (or GHL_LOCATION_ID_TERMS), NOTION_TOKEN,
 *   NOTION_DB_ID (defaults to the residential deals DB)
 */

const https = require('https');

// ─── Config ────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const MAX_CONTACTS = parseInt(process.env.MAX_CONTACTS || '0', 10);  // 0 = unlimited

const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID_TERMS || process.env.GHL_LOCATION_ID;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';

if (!GHL_API_KEY || !GHL_LOCATION_ID || !NOTION_TOKEN) {
  console.error('Missing required env vars: GHL_API_KEY, GHL_LOCATION_ID(_TERMS), NOTION_TOKEN');
  process.exit(1);
}

// Map old response tags → new ones (lowercase for matching)
const RESPONSE_TAG_MAP = {
  'deal-hot':      'deal:hot',
  'deal-warm':     'deal:interested',
  'deal-paused':   'deal:passed'
};

// ─── Helpers ───────────────────────────────────────────────────

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

function request(method, hostname, path, headers, body) {
  return new Promise(function(resolve, reject) {
    var opts = { hostname: hostname, path: path, method: method, headers: headers };
    var req = https.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
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

function ghl(method, path, body) {
  return request(method, 'services.leadconnectorhq.com', path, {
    'Authorization': 'Bearer ' + GHL_API_KEY,
    'Version': '2021-07-28',
    'Content-Type': 'application/json'
  }, body);
}

function notion(method, path, body) {
  return request(method, 'api.notion.com', path, {
    'Authorization': 'Bearer ' + NOTION_TOKEN,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  }, body);
}

function prop(page, name) {
  var p = page.properties[name];
  if (!p) return '';
  switch (p.type) {
    case 'title':       return (p.title || []).map(function(t) { return t.plain_text; }).join('');
    case 'rich_text':   return (p.rich_text || []).map(function(t) { return t.plain_text; }).join('');
    case 'select':      return p.select ? p.select.name : '';
    case 'status':      return p.status ? p.status.name : '';
    default:            return '';
  }
}

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

// ─── Step 1: Fetch all deals from Notion, build ID → slug map ──

async function buildDealMap() {
  console.log('\n[1/3] Fetching deals from Notion...');
  var map = {};     // { 8charId → { slug, fullId, address, city, state } }
  var total = 0;
  var hasMore = true;
  var cursor;

  while (hasMore) {
    var body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    var res = await notion('POST', '/v1/databases/' + NOTION_DB_ID + '/query', body);
    if (res.status !== 200) {
      console.error('Notion query failed:', res.status, JSON.stringify(res.body).substring(0, 200));
      process.exit(1);
    }

    var pages = res.body.results || [];
    pages.forEach(function(page) {
      var street = prop(page, 'Street Address');
      var city = prop(page, 'City');
      var state = prop(page, 'State');
      // Skip deals with no location data — can't build a slug
      if (!street && !city) return;

      var slug = slugifyAddress(street, city, state);
      if (!slug) return;

      // Match the 8-char short ID used by notify-buyers.js (page.id.slice(0, 8))
      var shortId = page.id.replace(/-/g, '').substring(0, 8);
      map[shortId] = {
        fullId: page.id,
        slug: slug,
        street: street,
        city: city,
        state: state
      };
      total++;
    });

    hasMore = res.body.has_more === true;
    cursor = res.body.next_cursor;
  }

  console.log('  → ' + total + ' deals indexed');
  return map;
}

// ─── Step 2: Fetch all GHL contacts with new-deal-alert tag ────

async function fetchAlertedContacts() {
  console.log('\n[2/3] Fetching GHL contacts tagged "new-deal-alert"...');
  var all = [];
  var page = 1;
  var hasMore = true;
  var PAGE_SIZE = 100;
  // Some GHL accounts cap search at ~2500 total via pagination. Hard stop
  // at a safe ceiling to avoid runaway if pagination doesn't signal an end.
  var SAFETY_LIMIT = 10000;

  while (hasMore && all.length < SAFETY_LIMIT) {
    var res = await ghl('POST', '/contacts/search', {
      locationId: GHL_LOCATION_ID,
      page: page,
      pageLimit: PAGE_SIZE,
      filters: [{
        group: 'AND',
        filters: [{ field: 'tags', operator: 'contains', value: ['new-deal-alert'] }]
      }]
    });

    if (res.status < 200 || res.status >= 300) {
      console.error('GHL search failed (page ' + page + '):', res.status, JSON.stringify(res.body).substring(0, 200));
      break;
    }

    var batch = (res.body && (res.body.contacts || res.body.data)) || [];
    all = all.concat(batch);

    var meta = (res.body && res.body.meta) || {};
    // meta.total can be unreliable — only log if present, don't rely on it
    var totalReported = meta.total ? '/' + meta.total : '';
    console.log('  page ' + page + ' → ' + batch.length + ' contacts (running total ' + all.length + totalReported + ')');

    // Stop when we get a partial or empty page — that's the only reliable
    // signal that we've reached the end. Do NOT trust meta.total.
    if (batch.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
      await sleep(200);  // polite delay to avoid rate limits
    }
  }

  console.log('  → ' + all.length + ' alerted buyers found');
  if (MAX_CONTACTS > 0 && all.length > MAX_CONTACTS) {
    console.log('  (limiting to first ' + MAX_CONTACTS + ' via MAX_CONTACTS env var)');
    all = all.slice(0, MAX_CONTACTS);
  }
  return all;
}

// ─── Step 3: For each contact, compute + add new tags ──────────

async function migrateContact(contact, dealMap, stats) {
  var existingTags = (contact.tags || []).map(function(t) { return String(t).toLowerCase(); });
  var newTags = [];
  var dealsMatched = [];
  var dealsOrphaned = [];

  // Find all alerted-XXXXXXXX tags and map them to slugs
  existingTags.forEach(function(tag) {
    var m = tag.match(/^alerted-([a-z0-9]{8})$/);
    if (!m) return;
    var shortId = m[1];
    var deal = dealMap[shortId];
    if (deal) {
      var sentTag = 'sent:' + deal.slug;
      if (existingTags.indexOf(sentTag) === -1 && newTags.indexOf(sentTag) === -1) {
        newTags.push(sentTag);
      }
      dealsMatched.push(deal.slug);
    } else {
      dealsOrphaned.push(shortId);
    }
  });

  // Migrate response tags if present (only one — pick the first match)
  var hasNewStatusTag = false;
  Object.keys(RESPONSE_TAG_MAP).forEach(function(oldTag) {
    if (hasNewStatusTag) return;
    if (existingTags.indexOf(oldTag) > -1) {
      var newStatusTag = RESPONSE_TAG_MAP[oldTag];
      if (existingTags.indexOf(newStatusTag) === -1 && newTags.indexOf(newStatusTag) === -1) {
        newTags.push(newStatusTag);
      }
      // Also mark per-deal response for each matched deal
      dealsMatched.forEach(function(slug) {
        var respondedTag = 'responded:' + slug;
        if (existingTags.indexOf(respondedTag) === -1 && newTags.indexOf(respondedTag) === -1) {
          newTags.push(respondedTag);
        }
      });
      hasNewStatusTag = true;
    }
  });

  var name = ((contact.firstName || '') + ' ' + (contact.lastName || '')).trim() || contact.id;

  if (newTags.length === 0) {
    stats.skipped++;
    if (dealsOrphaned.length) {
      console.log('  ⊘ ' + name + ' — no new tags needed (orphan alerted-' + dealsOrphaned.join(',') + ')');
    } else {
      console.log('  ⊘ ' + name + ' — already migrated');
    }
    return;
  }

  stats.dealsMigrated += dealsMatched.length;
  stats.orphaned += dealsOrphaned.length;

  if (DRY_RUN) {
    console.log('  [DRY] ' + name + ' ← ' + newTags.join(', '));
    stats.wouldUpdate++;
    return;
  }

  // Add all new tags in one API call — POST /contacts/{id}/tags appends
  try {
    var res = await ghl('POST', '/contacts/' + contact.id + '/tags', { tags: newTags });
    if (res.status >= 200 && res.status < 300) {
      stats.updated++;
      console.log('  ✓ ' + name + ' ← ' + newTags.length + ' tags: ' + newTags.slice(0, 3).join(', ') + (newTags.length > 3 ? '...' : ''));
    } else {
      stats.failed++;
      console.error('  ✗ ' + name + ' — GHL ' + res.status + ': ' + JSON.stringify(res.body).substring(0, 100));
    }
  } catch (err) {
    stats.failed++;
    console.error('  ✗ ' + name + ' — ' + err.message);
  }

  // Rate limit protection
  await sleep(100);
}

// ─── Main ──────────────────────────────────────────────────────

(async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Retroactive Sent-Tag Migration                           ║');
  console.log('║  Converting alerted-XXXXXXXX → sent:[slug] for history   ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('DRY_RUN:       ' + (DRY_RUN ? 'YES (no changes will be made)' : 'NO (changes will be written)'));
  console.log('MAX_CONTACTS:  ' + (MAX_CONTACTS || 'unlimited'));
  console.log('GHL LOCATION:  ' + GHL_LOCATION_ID);
  console.log('NOTION DB:     ' + NOTION_DB_ID);

  var startTime = Date.now();

  try {
    var dealMap = await buildDealMap();
    var contacts = await fetchAlertedContacts();

    console.log('\n[3/3] Migrating ' + contacts.length + ' contacts...\n');
    var stats = {
      updated: 0,
      skipped: 0,
      failed: 0,
      wouldUpdate: 0,
      dealsMigrated: 0,
      orphaned: 0
    };

    for (var i = 0; i < contacts.length; i++) {
      await migrateContact(contacts[i], dealMap, stats);
    }

    var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║  MIGRATION COMPLETE                                       ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('Contacts scanned:        ' + contacts.length);
    if (DRY_RUN) {
      console.log('Would be updated:        ' + stats.wouldUpdate);
    } else {
      console.log('Successfully updated:    ' + stats.updated);
      console.log('Failed:                  ' + stats.failed);
    }
    console.log('Skipped (no changes):    ' + stats.skipped);
    console.log('Deal slugs migrated:     ' + stats.dealsMigrated);
    console.log('Orphan tags (no deal):   ' + stats.orphaned);
    console.log('Elapsed:                 ' + elapsed + 's');

    if (DRY_RUN) {
      console.log('\n→ Re-run without DRY_RUN=1 to actually apply these changes.');
    }
  } catch (err) {
    console.error('\n✗ FATAL ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
