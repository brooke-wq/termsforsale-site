#!/usr/bin/env node
/**
 * Retroactive Buyer "opt in" Tag Backfill
 *
 * Scans every GHL contact tagged as a Terms For Sale buyer signup and applies
 * the case-insensitive `opt in` tag if not already present.
 *
 * WHY: As of April 14 2026, every campaign sender (notify-buyers,
 * deal-follow-up, follow-up-nudge) hard-skips any contact missing the
 * `opt in` tag (case-insensitive). Without this backfill, every existing
 * buyer is silenced — they signed up before the tag existed.
 *
 * Per company policy, ALL Terms For Sale website signups are treated as
 * having opted in (TFS signup IS the consent action). This backfill applies
 * the tag retroactively to existing buyers who came through any of the
 * website signup paths:
 *
 *   - auth-signup    → tags include `buyer-signup`, `TFS Buyer`, `Website Signup`
 *   - vip-buyer-submit → tags include `VIP Buyer List`, `use:buyer`
 *   - buy-box-save   → tags include `tfs buyer`, `buy box complete`
 *
 * It does NOT touch externally-imported buyers (e.g. InvestorLift,
 * InvestorBase) — those need their own consent record before the tag is
 * applied.
 *
 * USAGE (run on Droplet where env vars already exist):
 *   cd /root/termsforsale-site
 *   DRY_RUN=1 node scripts/backfill-buyer-opt-in.js    # preview
 *   node scripts/backfill-buyer-opt-in.js              # actually apply
 *
 * Optional env vars:
 *   MAX_CONTACTS=N     limit how many contacts get processed
 *
 * ENV VARS required:
 *   GHL_API_KEY, GHL_LOCATION_ID (or GHL_LOCATION_ID_TERMS)
 */

const https = require('https');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const MAX_CONTACTS = parseInt(process.env.MAX_CONTACTS || '0', 10);

const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID_TERMS || process.env.GHL_LOCATION_ID;

if (!GHL_API_KEY || !GHL_LOCATION_ID) {
  console.error('Missing required env vars: GHL_API_KEY, GHL_LOCATION_ID(_TERMS)');
  process.exit(1);
}

// Tags applied by the three TFS website signup paths (auth-signup,
// vip-buyer-submit, buy-box-save). Any contact tagged with ANY of these
// signed up via the website and is treated as having opted in.
//
// NOT included: source:investorlift / source:investorbase (external imports
// — those need a separate consent decision per source).
const SIGNUP_TAGS = [
  'buyer-signup',
  'tfs buyer',
  'TFS Buyer',
  'Website Signup',
  'VIP Buyer List',
  'buy box complete',
  'use:buyer'
];

const OPT_IN_TAG = 'opt in';

// ─── Helpers ───────────────────────────────────────────────────

function ghl(method, path, body) {
  return new Promise(function(resolve, reject) {
    var opts = {
      hostname: 'services.leadconnectorhq.com',
      path: path,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + GHL_API_KEY,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
      }
    };
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

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

// Paginate through contacts matching a specific tag.
// Stops when a batch returns < PAGE_SIZE — never trusts meta.total.
async function searchContactsByTag(tag) {
  var all = [];
  var page = 1;
  var hasMore = true;
  var PAGE_SIZE = 100;
  var SAFETY_LIMIT = 10000;

  while (hasMore && all.length < SAFETY_LIMIT) {
    var res = await ghl('POST', '/contacts/search', {
      locationId: GHL_LOCATION_ID,
      page: page,
      pageLimit: PAGE_SIZE,
      filters: [{
        group: 'AND',
        filters: [{ field: 'tags', operator: 'contains', value: [tag] }]
      }]
    });

    if (res.status < 200 || res.status >= 300) {
      console.error('  [search] GHL ' + res.status + ' on page ' + page + ' — ' + JSON.stringify(res.body).substring(0, 200));
      break;
    }

    var batch = (res.body && (res.body.contacts || res.body.data)) || [];
    all = all.concat(batch);

    if (batch.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
      await sleep(150);
    }
  }

  return all;
}

// Case-insensitive, trimmed check for the opt in tag — same logic as
// hasOptInTag() in _ghl.js. A contact already opted in is skipped.
function hasOptInAlready(contact) {
  var tags = contact.tags || [];
  return tags.some(function(t) {
    return String(t || '').trim().toLowerCase() === OPT_IN_TAG;
  });
}

// ─── Main ──────────────────────────────────────────────────────

(async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Buyer "opt in" Tag Backfill                              ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('DRY_RUN:       ' + (DRY_RUN ? 'YES (no changes will be made)' : 'NO (changes will be written)'));
  console.log('MAX_CONTACTS:  ' + (MAX_CONTACTS || 'unlimited'));
  console.log('GHL LOCATION:  ' + GHL_LOCATION_ID);
  console.log('Signup tags scanned: ' + SIGNUP_TAGS.join(', '));

  var startTime = Date.now();

  // Step 1: fetch contacts across all signup tags, dedup by id
  console.log('\n[1/2] Fetching website-signup buyers from GHL by tag...');
  var seen = {};
  var all = [];

  for (var i = 0; i < SIGNUP_TAGS.length; i++) {
    var tag = SIGNUP_TAGS[i];
    console.log('  tag="' + tag + '"...');
    var batch = await searchContactsByTag(tag);
    var added = 0;
    batch.forEach(function(c) {
      if (!seen[c.id]) {
        seen[c.id] = true;
        all.push(c);
        added++;
      }
    });
    console.log('    → ' + batch.length + ' matched (' + added + ' new, ' + all.length + ' cumulative)');
  }

  if (MAX_CONTACTS > 0 && all.length > MAX_CONTACTS) {
    console.log('  (limiting to first ' + MAX_CONTACTS + ' via MAX_CONTACTS env var)');
    all = all.slice(0, MAX_CONTACTS);
  }

  // Step 2: apply opt in tag to each contact missing it
  console.log('\n[2/2] Applying "opt in" tag on ' + all.length + ' unique contacts...\n');

  var stats = { updated: 0, skipped: 0, failed: 0, wouldUpdate: 0 };

  for (var i = 0; i < all.length; i++) {
    var c = all[i];
    var name = ((c.firstName || '') + ' ' + (c.lastName || '')).trim() || c.email || c.id;

    if (hasOptInAlready(c)) {
      stats.skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log('  [DRY] ' + name + ' — would add "opt in" tag');
      stats.wouldUpdate++;
      continue;
    }

    try {
      var res = await ghl('POST', '/contacts/' + c.id + '/tags', {
        tags: [OPT_IN_TAG]
      });
      if (res.status >= 200 && res.status < 300) {
        stats.updated++;
        console.log('  ✓ ' + name + ' — added "opt in" tag');
      } else {
        stats.failed++;
        console.error('  ✗ ' + name + ' — GHL ' + res.status + ': ' + JSON.stringify(res.body).substring(0, 200));
      }
    } catch (err) {
      stats.failed++;
      console.error('  ✗ ' + name + ' — ' + err.message);
    }

    await sleep(100);  // polite rate limit
  }

  var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  BACKFILL COMPLETE                                        ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('Contacts scanned:        ' + all.length);
  if (DRY_RUN) {
    console.log('Would be updated:        ' + stats.wouldUpdate);
  } else {
    console.log('Successfully updated:    ' + stats.updated);
    console.log('Failed:                  ' + stats.failed);
  }
  console.log('Already opted in:        ' + stats.skipped);
  console.log('Elapsed:                 ' + elapsed + 's');

  if (DRY_RUN) {
    console.log('\n→ Re-run without DRY_RUN=1 to actually apply these changes.');
  }
})().catch(function(err) {
  console.error('\n✗ FATAL ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
