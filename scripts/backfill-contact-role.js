#!/usr/bin/env node
/**
 * Retroactive Contact Role Backfill
 *
 * Scans every GHL contact tagged as a buyer (`buyer-signup`, `TFS Buyer`,
 * `use:buyer`, `tfs buyer`, `Website Signup`) and sets Contact Role = ['Buyer']
 * on any contact missing it.
 *
 * WHY: Between April 3 (auth-signup launch) and April 9 (this fix),
 * `auth-signup.js` created website-signup buyers without setting the Contact
 * Role custom field. `notify-buyers.js` filters by Contact Role === 'Buyer'
 * and silently skips any contact without it — so those signups never
 * received deal alerts even though they had buy box data.
 *
 * HOW IT WORKS:
 *   1. Search GHL for contacts tagged with buyer indicators (paginated)
 *   2. For each contact, read the existing Contact Role custom field
 *      (id: agG4HMPB5wzsZXiRxfmR, multi-select)
 *   3. If it already contains "Buyer", skip
 *   4. Otherwise, PUT the custom field with ['Buyer'] appended
 *
 * USAGE (run on Droplet where env vars already exist):
 *   cd /root/termsforsale-site
 *   DRY_RUN=1 node scripts/backfill-contact-role.js    # preview
 *   node scripts/backfill-contact-role.js              # actually apply
 *
 * ENV VARS required:
 *   GHL_API_KEY, GHL_LOCATION_ID (or GHL_LOCATION_ID_TERMS)
 */

const https = require('https');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const MAX_CONTACTS = parseInt(process.env.MAX_CONTACTS || '0', 10);

const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID_TERMS || process.env.GHL_LOCATION_ID;
const CONTACT_ROLE_FIELD_ID = 'agG4HMPB5wzsZXiRxfmR';

if (!GHL_API_KEY || !GHL_LOCATION_ID) {
  console.error('Missing required env vars: GHL_API_KEY, GHL_LOCATION_ID(_TERMS)');
  process.exit(1);
}

// Tags that indicate this contact is a buyer in some form.
// We scan each one and union the results. A contact tagged with ANY of these
// should have Contact Role = Buyer.
const BUYER_TAGS = [
  'buyer-signup',
  'tfs buyer',
  'TFS Buyer',
  'use:buyer',
  'Website Signup',
  'VIP Buyer List',
  'buy box complete'
];

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
// Uses the same reliable-end-signal pattern as migrate-sent-tags.js:
//   stop when a batch returns < PAGE_SIZE (NEVER trust meta.total).
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

// Find the current Contact Role value on a contact (may be string or array).
function findContactRole(contact) {
  var cfs = contact.customFields || contact.customField || [];
  for (var i = 0; i < cfs.length; i++) {
    var f = cfs[i];
    if (f.id === CONTACT_ROLE_FIELD_ID) {
      return f.value !== undefined ? f.value : f.field_value;
    }
  }
  return null;
}

function isAlreadyBuyer(currentValue) {
  if (currentValue == null) return false;
  if (Array.isArray(currentValue)) {
    return currentValue.some(function(v) { return String(v || '').toLowerCase() === 'buyer'; });
  }
  return String(currentValue).toLowerCase() === 'buyer';
}

// Build the new value for the Contact Role field — union of existing + 'Buyer'.
function buildNewRoleValue(currentValue) {
  if (currentValue == null || currentValue === '') return ['Buyer'];
  if (Array.isArray(currentValue)) {
    if (currentValue.some(function(v) { return String(v || '').toLowerCase() === 'buyer'; })) {
      return currentValue;
    }
    return currentValue.concat(['Buyer']);
  }
  // Single string value — convert to array and add Buyer
  var s = String(currentValue);
  if (s.toLowerCase() === 'buyer') return [s];
  return [s, 'Buyer'];
}

// ─── Main ──────────────────────────────────────────────────────

(async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Contact Role Backfill — set Contact Role = [\'Buyer\']      ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('DRY_RUN:       ' + (DRY_RUN ? 'YES (no changes will be made)' : 'NO (changes will be written)'));
  console.log('MAX_CONTACTS:  ' + (MAX_CONTACTS || 'unlimited'));
  console.log('GHL LOCATION:  ' + GHL_LOCATION_ID);

  var startTime = Date.now();

  // Step 1: fetch contacts across all buyer-indicator tags, dedup by id
  console.log('\n[1/2] Fetching buyer contacts from GHL by tag...');
  var seen = {};
  var all = [];

  for (var i = 0; i < BUYER_TAGS.length; i++) {
    var tag = BUYER_TAGS[i];
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

  // Step 2: backfill Contact Role on each
  console.log('\n[2/2] Backfilling Contact Role on ' + all.length + ' unique contacts...\n');

  var stats = { updated: 0, skipped: 0, failed: 0, wouldUpdate: 0 };

  for (var i = 0; i < all.length; i++) {
    var c = all[i];
    var name = ((c.firstName || '') + ' ' + (c.lastName || '')).trim() || c.email || c.id;
    var currentRole = findContactRole(c);

    if (isAlreadyBuyer(currentRole)) {
      stats.skipped++;
      continue;
    }

    var newRoleValue = buildNewRoleValue(currentRole);

    if (DRY_RUN) {
      console.log('  [DRY] ' + name + ' — would set Contact Role to ' + JSON.stringify(newRoleValue) + ' (was ' + JSON.stringify(currentRole) + ')');
      stats.wouldUpdate++;
      continue;
    }

    try {
      var res = await ghl('PUT', '/contacts/' + c.id, {
        customFields: [
          { id: CONTACT_ROLE_FIELD_ID, value: newRoleValue }
        ]
      });
      if (res.status >= 200 && res.status < 300) {
        stats.updated++;
        console.log('  ✓ ' + name + ' — set Contact Role = Buyer');
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
  console.log('Already buyers:          ' + stats.skipped);
  console.log('Elapsed:                 ' + elapsed + 's');

  if (DRY_RUN) {
    console.log('\n→ Re-run without DRY_RUN=1 to actually apply these changes.');
  }
})().catch(function(err) {
  console.error('\n✗ FATAL ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
