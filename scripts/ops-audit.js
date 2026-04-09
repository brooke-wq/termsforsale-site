#!/usr/bin/env node
/**
 * Ops Audit — regular maintenance health check
 *
 * Runs a battery of checks on the Netlify Functions, GHL state, and
 * Notion deals to catch regressions like the April 7 _ghl.js breakage
 * and the Contact Role gap BEFORE they cascade into data loss.
 *
 * Checks performed:
 *   1. All *.js files under termsforsale/netlify/functions/ load cleanly
 *      (catches module-level import errors like missing _ghl.js exports)
 *   2. Every function that does `require('./_ghl')` gets back all the
 *      functions it destructures (catches silent `undefined` destructures)
 *   3. Every buyer-like tag (buyer-signup, TFS Buyer, etc.) — count how
 *      many contacts are missing Contact Role = Buyer (they'll be skipped
 *      by notify-buyers)
 *   4. Sample the most recent 5 "Started Marketing" Notion deals and
 *      verify at least one buyer was tagged with sent:[slug] in GHL
 *      (catches notify-buyers tag-write regressions)
 *   5. Verify no required env vars are missing from the running process
 *
 * USAGE (run locally or on Droplet):
 *   node scripts/ops-audit.js                    # full audit (reads only)
 *   node scripts/ops-audit.js --quick            # skip GHL/Notion checks
 *   SKIP_REMOTE=1 node scripts/ops-audit.js      # same as --quick
 *
 * Exits with code 0 if all checks pass, 1 if any FAIL items.
 * WARN items do not fail the run but are surfaced in the summary.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const FUNCTIONS_DIR = path.join(ROOT, 'termsforsale', 'netlify', 'functions');

const SKIP_REMOTE = process.env.SKIP_REMOTE === '1'
  || process.argv.includes('--quick');

const RESULTS = { pass: [], warn: [], fail: [] };

function pass(check, detail) { RESULTS.pass.push({ check, detail }); console.log('  ✓ ' + check + (detail ? ' — ' + detail : '')); }
function warn(check, detail) { RESULTS.warn.push({ check, detail }); console.log('  ⚠ ' + check + (detail ? ' — ' + detail : '')); }
function fail(check, detail) { RESULTS.fail.push({ check, detail }); console.log('  ✗ ' + check + (detail ? ' — ' + detail : '')); }

// ─── Check 1: all functions load cleanly ─────────────────────

function checkFunctionLoading() {
  console.log('\n[1] Module load check — all functions import cleanly');
  var files = fs.readdirSync(FUNCTIONS_DIR)
    .filter(function(f) { return f.endsWith('.js') && !f.startsWith('_'); });
  var errors = [];
  files.forEach(function(f) {
    var p = path.join(FUNCTIONS_DIR, f);
    try {
      delete require.cache[require.resolve(p)];
      require(p);
    } catch (e) {
      errors.push({ file: f, error: e.message });
    }
  });
  if (errors.length === 0) {
    pass('All ' + files.length + ' function modules loaded without errors');
  } else {
    errors.forEach(function(e) {
      fail('Load error: ' + e.file, e.error);
    });
  }
}

// ─── Check 2: _ghl.js destructure consistency ────────────────

function checkGhlDestructures() {
  console.log('\n[2] _ghl.js import check — every destructured name must exist');
  var ghlPath = path.join(FUNCTIONS_DIR, '_ghl.js');
  var ghlExports;
  try {
    delete require.cache[require.resolve(ghlPath)];
    ghlExports = Object.keys(require(ghlPath));
  } catch (e) {
    fail('Could not load _ghl.js', e.message);
    return;
  }

  var files = fs.readdirSync(FUNCTIONS_DIR).filter(function(f) { return f.endsWith('.js'); });
  var importRegex = /require\(['"]\.\/_ghl['"]\)/;
  var destructureRegex = /const\s*\{\s*([^}]+)\s*\}\s*=\s*require\(['"]\.\/_ghl['"]\)/g;
  var problems = [];

  files.forEach(function(f) {
    var src = fs.readFileSync(path.join(FUNCTIONS_DIR, f), 'utf8');
    if (!importRegex.test(src)) return;
    var m;
    while ((m = destructureRegex.exec(src)) !== null) {
      var names = m[1].split(',').map(function(s) { return s.trim().split(/[\s=:]/)[0]; }).filter(Boolean);
      names.forEach(function(n) {
        if (ghlExports.indexOf(n) === -1) {
          problems.push({ file: f, name: n });
        }
      });
    }
  });

  if (problems.length === 0) {
    pass('All _ghl.js destructures resolve to real exports (' + ghlExports.length + ' exports)');
  } else {
    problems.forEach(function(p) {
      fail('_ghl.js destructure: ' + p.file, 'requires "' + p.name + '" which does not exist');
    });
  }
}

// ─── Check 3: Contact Role backfill status ───────────────────

function ghlRequest(apiKey, method, p, body) {
  return new Promise(function(resolve, reject) {
    var opts = {
      hostname: 'services.leadconnectorhq.com',
      path: p,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + apiKey,
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function checkContactRoleBackfill() {
  console.log('\n[3] GHL Contact Role audit — buyers missing Contact Role = [Buyer]');
  var apiKey = process.env.GHL_API_KEY;
  var locId = process.env.GHL_LOCATION_ID_TERMS || process.env.GHL_LOCATION_ID;
  if (!apiKey || !locId) {
    warn('Skipped — GHL_API_KEY or GHL_LOCATION_ID not set');
    return;
  }

  var tag = 'buyer-signup';
  var res = await ghlRequest(apiKey, 'POST', '/contacts/search', {
    locationId: locId,
    page: 1,
    pageLimit: 100,
    filters: [{
      group: 'AND',
      filters: [{ field: 'tags', operator: 'contains', value: [tag] }]
    }]
  });
  if (res.status < 200 || res.status >= 300) {
    warn('GHL search failed', 'HTTP ' + res.status);
    return;
  }
  var contacts = (res.body && (res.body.contacts || res.body.data)) || [];
  if (contacts.length === 0) {
    warn('No contacts tagged "buyer-signup" yet');
    return;
  }

  var CONTACT_ROLE_FIELD_ID = 'agG4HMPB5wzsZXiRxfmR';
  var missing = 0;
  contacts.forEach(function(c) {
    var cfs = c.customFields || c.customField || [];
    var role = cfs.find(function(f) { return f.id === CONTACT_ROLE_FIELD_ID; });
    var val = role ? (role.value !== undefined ? role.value : role.field_value) : null;
    var isBuyer = Array.isArray(val)
      ? val.some(function(v) { return String(v || '').toLowerCase() === 'buyer'; })
      : String(val || '').toLowerCase() === 'buyer';
    if (!isBuyer) missing++;
  });

  if (missing === 0) {
    pass('All ' + contacts.length + ' sampled buyer-signup contacts have Contact Role = Buyer');
  } else {
    warn(missing + ' of ' + contacts.length + ' sampled buyer-signup contacts are MISSING Contact Role', 'run scripts/backfill-contact-role.js');
  }
}

// ─── Check 4: recent deal blasts wrote sent:[slug] tags ──────

async function checkRecentBlastTags() {
  console.log('\n[4] Notion/GHL cross-check — recent deals have sent:[slug] tags');
  var apiKey = process.env.GHL_API_KEY;
  var locId = process.env.GHL_LOCATION_ID_TERMS || process.env.GHL_LOCATION_ID;
  var notionToken = process.env.NOTION_TOKEN;
  var notionDb = process.env.NOTION_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';
  if (!apiKey || !locId || !notionToken) {
    warn('Skipped — missing GHL/Notion env vars');
    return;
  }

  function notion(method, p, body) {
    return new Promise(function(resolve, reject) {
      var opts = {
        hostname: 'api.notion.com',
        path: p,
        method: method,
        headers: {
          'Authorization': 'Bearer ' + notionToken,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        }
      };
      var req = https.request(opts, function(res) {
        var data = '';
        res.on('data', function(c) { data += c; });
        res.on('end', function() {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch (e) { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  // Last 14 days of Started Marketing deals
  var since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString().split('T')[0];
  var res = await notion('POST', '/v1/databases/' + notionDb + '/query', {
    filter: {
      and: [
        { property: 'Deal Status', status: { equals: 'Actively Marketing' } },
        { property: 'Started Marketing ', date: { on_or_after: since } }
      ]
    },
    page_size: 5,
    sorts: [{ property: 'Started Marketing ', direction: 'descending' }]
  });
  if (res.status !== 200) {
    warn('Notion query failed', 'HTTP ' + res.status);
    return;
  }
  var pages = (res.body && res.body.results) || [];
  if (pages.length === 0) {
    warn('No "Started Marketing" deals in last 14 days — skipping blast-tag check');
    return;
  }

  function slugify(street, city, state) {
    var parts = [street, city, state].filter(Boolean).join(' ');
    return String(parts).toLowerCase()
      .replace(/,/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }
  function prop(p, name) {
    var f = p.properties[name];
    if (!f) return '';
    if (f.type === 'title') return (f.title || []).map(function(t) { return t.plain_text; }).join('');
    if (f.type === 'rich_text') return (f.rich_text || []).map(function(t) { return t.plain_text; }).join('');
    if (f.type === 'select') return f.select ? f.select.name : '';
    return '';
  }

  var orphans = 0;
  for (var i = 0; i < pages.length; i++) {
    var p = pages[i];
    var street = prop(p, 'Street Address');
    var city = prop(p, 'City');
    var state = prop(p, 'State');
    if (!street && !city) continue;
    var slug = slugify(street, city, state);
    var tag = 'sent:' + slug;
    var label = street || city;

    var searchRes = await ghlRequest(apiKey, 'POST', '/contacts/search', {
      locationId: locId,
      page: 1,
      pageLimit: 5,
      filters: [{
        group: 'AND',
        filters: [{ field: 'tags', operator: 'contains', value: [tag] }]
      }]
    });
    var contacts = (searchRes.body && (searchRes.body.contacts || searchRes.body.data)) || [];
    if (contacts.length === 0) {
      warn('No "' + tag + '" tags found', label + ' — notify-buyers may not be writing sent:[slug] tags');
      orphans++;
    } else {
      pass('Found ' + contacts.length + '+ buyers tagged "' + tag + '"', label);
    }
  }
  if (orphans === 0) {
    pass('All ' + pages.length + ' recent deals have sent:[slug] tags in GHL');
  }
}

// ─── Check 5: env var sanity ─────────────────────────────────

function checkEnvVars() {
  console.log('\n[5] Env var sanity check');
  var REQUIRED = ['GHL_API_KEY', 'GHL_LOCATION_ID', 'NOTION_TOKEN'];
  var OPTIONAL = ['ADMIN_PASSWORD', 'CLAUDE_API_KEY', 'GOOGLE_API_KEY', 'BROOKE_CONTACT_ID', 'BROOKE_SMS_PHONE'];

  REQUIRED.forEach(function(v) {
    if (process.env[v]) pass(v + ' is set');
    else fail(v + ' is NOT set', 'required for production functions');
  });
  OPTIONAL.forEach(function(v) {
    if (process.env[v]) pass(v + ' is set (optional)');
    else warn(v + ' is not set', 'some features may not work');
  });
}

// ─── Main ────────────────────────────────────────────────────

(async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Terms For Sale — Ops Audit                                ║');
  console.log('║  ' + new Date().toISOString() + (SKIP_REMOTE ? '  [QUICK MODE]' : '') + '                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  checkFunctionLoading();
  checkGhlDestructures();
  checkEnvVars();

  if (!SKIP_REMOTE) {
    try { await checkContactRoleBackfill(); } catch (e) { fail('Contact Role check crashed', e.message); }
    try { await checkRecentBlastTags(); } catch (e) { fail('Blast-tag check crashed', e.message); }
  } else {
    console.log('\n[3-4] Skipped — quick mode (no network checks)');
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  AUDIT COMPLETE                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('Pass:  ' + RESULTS.pass.length);
  console.log('Warn:  ' + RESULTS.warn.length);
  console.log('Fail:  ' + RESULTS.fail.length);

  if (RESULTS.fail.length > 0) {
    console.log('\nFAILED CHECKS:');
    RESULTS.fail.forEach(function(f) {
      console.log('  ✗ ' + f.check + (f.detail ? ' — ' + f.detail : ''));
    });
    process.exit(1);
  }
  if (RESULTS.warn.length > 0) {
    console.log('\nWARNINGS:');
    RESULTS.warn.forEach(function(w) {
      console.log('  ⚠ ' + w.check + (w.detail ? ' — ' + w.detail : ''));
    });
  }
  process.exit(0);
})();
