#!/usr/bin/env node
/**
 * Backfill contact.parsed_prefs for existing TFS buyers
 *
 * One-shot parse of buy_box + recent notes + tags into structured JSON stored
 * on the new `contact.parsed_prefs` custom field. Uses Claude Haiku (~$0.001
 * per buyer). Idempotent via source_checksum — re-runs skip unchanged buyers.
 *
 * WHY: notify-buyers.js re-parses free-text buy_box on every deal blast (every
 * 30 min). With ~8,964 addressable buyers and 1+ deals/day, that's wasteful
 * and inconsistent. Parsing once and storing the result turns matching into
 * fast structured field comparison.
 *
 * USAGE (run on Droplet where env vars already exist):
 *   cd /root/termsforsale-site
 *   DRY_RUN=1 node scripts/backfill-parsed-prefs.js             # preview
 *   MAX_CONTACTS=10 node scripts/backfill-parsed-prefs.js       # test on 10
 *   node scripts/backfill-parsed-prefs.js                        # full run
 *   FORCE_REPARSE=1 node scripts/backfill-parsed-prefs.js       # redo even if checksum matches
 *
 * ENV VARS required:
 *   GHL_API_KEY, GHL_LOCATION_ID (or GHL_LOCATION_ID_TERMS)
 *   ANTHROPIC_API_KEY
 *
 * PREREQUISITE:
 *   The `contact.parsed_prefs` custom field must exist in GHL (Large Text).
 *   Create it in GHL UI → Settings → Custom Fields → Contacts before running.
 */

const https = require('https');
const path = require('path');

const { parsePreferences } = require(
  path.join(__dirname, '..', 'termsforsale', 'netlify', 'functions', '_parse-preferences')
);

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const FORCE_REPARSE = process.env.FORCE_REPARSE === '1';
const MAX_CONTACTS = parseInt(process.env.MAX_CONTACTS || '0', 10);

const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID_TERMS || process.env.GHL_LOCATION_ID;
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

if (!GHL_API_KEY || !GHL_LOCATION_ID) {
  console.error('Missing required env vars: GHL_API_KEY, GHL_LOCATION_ID(_TERMS)');
  process.exit(1);
}
if (!CLAUDE_KEY) {
  console.error('Missing ANTHROPIC_API_KEY — parser needs Claude access');
  process.exit(1);
}

const BUYER_TAGS = ['buyer-signup', 'tfs buyer', 'TFS Buyer', 'use:buyer', 'Website Signup', 'VIP Buyer List', 'buy box complete'];

// ─── Helpers ───────────────────────────────────────────────────

function ghl(method, path, body) {
  return new Promise(function (resolve, reject) {
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
    var req = https.request(opts, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function searchContactsByTag(tag) {
  var all = [];
  var page = 1;
  var hasMore = true;
  var PAGE_SIZE = 100;
  var SAFETY_LIMIT = 12000;

  while (hasMore && all.length < SAFETY_LIMIT) {
    var res = await ghl('POST', '/contacts/search', {
      locationId: GHL_LOCATION_ID,
      page: page,
      pageLimit: PAGE_SIZE,
      filters: [{ group: 'AND', filters: [{ field: 'tags', operator: 'contains', value: [tag] }] }]
    });
    if (res.status < 200 || res.status >= 300) {
      console.error('  [search] GHL ' + res.status + ' on page ' + page);
      break;
    }
    var batch = (res.body && (res.body.contacts || res.body.data)) || [];
    all = all.concat(batch);
    if (batch.length < PAGE_SIZE) hasMore = false;
    else { page++; await sleep(150); }
  }
  return all;
}

async function fetchCustomFieldMap() {
  var res = await ghl('GET', '/locations/' + GHL_LOCATION_ID + '/customFields');
  if (res.status < 200 || res.status >= 300) return {};
  var map = {};
  ((res.body && res.body.customFields) || []).forEach(function (f) {
    if (f.fieldKey && f.id) map[f.fieldKey] = f.id;
  });
  return map;
}

async function fetchContactNotes(contactId) {
  try {
    var res = await ghl('GET', '/contacts/' + contactId + '/notes');
    if (res.status < 200 || res.status >= 300) return [];
    var notes = (res.body && res.body.notes) || [];
    notes.sort(function (a, b) {
      return new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0);
    });
    return notes.slice(0, 5).map(function (n) {
      return { date: n.dateAdded || '', body: String(n.body || '').replace(/\s+/g, ' ').trim().slice(0, 400) };
    }).filter(function (n) { return n.body.length > 0; });
  } catch (e) {
    return [];
  }
}

function getCustomFieldValue(contact, fieldId) {
  var cfs = contact.customFields || contact.customField || [];
  for (var i = 0; i < cfs.length; i++) {
    if (cfs[i].id === fieldId) return cfs[i].value !== undefined ? cfs[i].value : cfs[i].field_value;
  }
  return null;
}

// ─── Main ──────────────────────────────────────────────────────

(async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Backfill contact.parsed_prefs (AI-parsed buyer prefs)     ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('DRY_RUN:       ' + (DRY_RUN ? 'YES' : 'NO'));
  console.log('FORCE_REPARSE: ' + (FORCE_REPARSE ? 'YES (ignore checksum)' : 'NO (skip unchanged)'));
  console.log('MAX_CONTACTS:  ' + (MAX_CONTACTS || 'unlimited'));

  var startTime = Date.now();

  // Step 0: resolve the parsed_prefs field ID
  console.log('\n[0/3] Resolving custom field IDs...');
  var fieldMap = await fetchCustomFieldMap();
  var parsedPrefsFieldId = fieldMap['contact.parsed_prefs'];
  var buyBoxFieldId = fieldMap['contact.buy_box'];
  if (!parsedPrefsFieldId) {
    console.error('  ✗ contact.parsed_prefs field NOT FOUND in GHL.');
    console.error('    Create it first: GHL UI → Settings → Custom Fields → Contacts');
    console.error('    Type: Large Text');
    console.error('    Name: Parsed Preferences (AI)');
    console.error('    Field Key: contact.parsed_prefs');
    process.exit(1);
  }
  console.log('  contact.parsed_prefs id: ' + parsedPrefsFieldId);
  console.log('  contact.buy_box id:      ' + (buyBoxFieldId || '(not found)'));

  // Step 1: gather all buyer contacts
  console.log('\n[1/3] Fetching buyer contacts from GHL by tag...');
  var seen = {};
  var all = [];
  for (var i = 0; i < BUYER_TAGS.length; i++) {
    var tag = BUYER_TAGS[i];
    console.log('  tag="' + tag + '"...');
    var batch = await searchContactsByTag(tag);
    var added = 0;
    batch.forEach(function (c) {
      if (!seen[c.id]) { seen[c.id] = true; all.push(c); added++; }
    });
    console.log('    → ' + batch.length + ' matched (' + added + ' new, ' + all.length + ' total)');
  }
  if (MAX_CONTACTS > 0 && all.length > MAX_CONTACTS) {
    all = all.slice(0, MAX_CONTACTS);
    console.log('  (limited to first ' + MAX_CONTACTS + ')');
  }

  // Step 2 + 3: parse + write
  console.log('\n[2/3] Parsing each buyer (Haiku ~$0.001/buyer)...\n');
  var stats = { parsed: 0, skipped_unchanged: 0, skipped_empty: 0, failed: 0, would_parse: 0 };
  var totalCost = 0;

  for (var j = 0; j < all.length; j++) {
    var c = all[j];
    var name = ((c.firstName || '') + ' ' + (c.lastName || '')).trim() || c.email || c.id;

    var buyBox = buyBoxFieldId ? String(getCustomFieldValue(c, buyBoxFieldId) || '') : '';
    var tags = c.tags || [];

    var existingPrefsRaw = getCustomFieldValue(c, parsedPrefsFieldId);
    var existingPrefs = null;
    try { if (existingPrefsRaw) existingPrefs = JSON.parse(existingPrefsRaw); } catch (e) { existingPrefs = null; }

    // Fetch notes (costs 1 GHL API call per contact — unavoidable)
    var notes = await fetchContactNotes(c.id);

    // Quick idempotency check — skip if source hasn't changed
    if (!FORCE_REPARSE && existingPrefs && existingPrefs.source_checksum) {
      var parsePrefsMod = require(path.join(__dirname, '..', 'termsforsale', 'netlify', 'functions', '_parse-preferences'));
      var currentChecksum = parsePrefsMod.computeChecksum(buyBox, notes, tags);
      if (currentChecksum === existingPrefs.source_checksum) {
        stats.skipped_unchanged++;
        continue;
      }
    }

    if (DRY_RUN) {
      console.log('  [DRY] ' + name + ' — would parse (buy_box=' + buyBox.length + ' chars, ' + notes.length + ' notes, ' + tags.length + ' tags)');
      stats.would_parse++;
      continue;
    }

    try {
      var parsed = await parsePreferences(CLAUDE_KEY, {
        buyBox: buyBox,
        notes: notes,
        tags: tags,
        structuredFields: {}
      });
      if (!parsed) {
        stats.failed++;
        console.error('  ✗ ' + name + ' — parse returned null');
        continue;
      }
      var res = await ghl('PUT', '/contacts/' + c.id, {
        customFields: [{ id: parsedPrefsFieldId, value: JSON.stringify(parsed) }]
      });
      if (res.status >= 200 && res.status < 300) {
        stats.parsed++;
        console.log('  ✓ ' + name + ' — conf=' + parsed.confidence +
          ' cities=' + parsed.cities_only.length +
          ' killers=' + parsed.deal_killers.length);
      } else {
        stats.failed++;
        console.error('  ✗ ' + name + ' — GHL PUT ' + res.status);
      }
    } catch (err) {
      stats.failed++;
      console.error('  ✗ ' + name + ' — ' + err.message);
    }

    await sleep(200);  // polite rate limit for both GHL + Claude
  }

  var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  BACKFILL COMPLETE                                        ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('Contacts scanned:       ' + all.length);
  if (DRY_RUN) {
    console.log('Would be parsed:        ' + stats.would_parse);
  } else {
    console.log('Successfully parsed:    ' + stats.parsed);
    console.log('Failed:                 ' + stats.failed);
  }
  console.log('Skipped (unchanged):    ' + stats.skipped_unchanged);
  console.log('Elapsed:                ' + elapsed + 's');
  if (!DRY_RUN && stats.parsed > 0) {
    console.log('Est. cost:              ~$' + (stats.parsed * 0.001).toFixed(2));
  }
  if (DRY_RUN) {
    console.log('\n→ Re-run without DRY_RUN=1 to actually parse + write.');
  }
})().catch(function (err) {
  console.error('\n✗ FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
