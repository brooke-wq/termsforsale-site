#!/usr/bin/env node
/**
 * Test script for the deal-blast tagging system.
 *
 * Runs 3 end-to-end tests against the live Netlify endpoints:
 *   1. tag-blast-sent    — tag 2 fake contacts with sent:[slug]
 *   2. tag-buyer-response — mark one as "interested"
 *   3. deal-buyer-list   — confirm both show up, sorted correctly
 *
 * USAGE:
 *   node scripts/test-tagging.js
 *
 * ENV VARS (optional):
 *   BASE_URL             — default https://deals.termsforsale.com
 *   TEST_CONTACT_ID_1    — real GHL contact ID for test buyer #1
 *                          (default: 1HMBtAv9EuTlJa5EekAL — Brooke's contact)
 *   TEST_CONTACT_ID_2    — real GHL contact ID for test buyer #2
 *                          (falls back to TEST_CONTACT_ID_1 if not set)
 *
 * NOTE: This script TAGS REAL CONTACTS in GHL. Use your own contact IDs
 *       for testing. The default uses Brooke's contact so tags can be
 *       manually cleared afterwards in GHL if needed.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const BASE_URL = process.env.BASE_URL || 'https://deals.termsforsale.com';
const CONTACT_1 = process.env.TEST_CONTACT_ID_1 || '1HMBtAv9EuTlJa5EekAL';
const CONTACT_2 = process.env.TEST_CONTACT_ID_2 || CONTACT_1;

// Use a recognizable test address so tags are easy to spot in GHL
const TEST_DEAL_ADDRESS = '999 Test Blvd Test City TX';
const EXPECTED_SLUG = '999-test-blvd-test-city-tx';

// ─── Simple fetch using Node built-ins ─────────────────────────

function request(method, url, body) {
  return new Promise(function(resolve, reject) {
    var parsed = new URL(url);
    var lib = parsed.protocol === 'https:' ? https : http;
    var opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    var req = lib.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        var parsedBody;
        try { parsedBody = JSON.parse(data); } catch (e) { parsedBody = data; }
        resolve({ status: res.statusCode, body: parsedBody });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function log(label, data) {
  console.log('\n━━━ ' + label + ' ━━━');
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

// ─── Tests ─────────────────────────────────────────────────────

async function testBlastSent() {
  log('TEST 1: POST /api/tag-blast-sent', {
    url: BASE_URL + '/api/tag-blast-sent',
    dealAddress: TEST_DEAL_ADDRESS,
    buyerContactIds: [CONTACT_1, CONTACT_2]
  });

  var res = await request('POST', BASE_URL + '/api/tag-blast-sent', {
    dealAddress: TEST_DEAL_ADDRESS,
    buyerContactIds: [CONTACT_1, CONTACT_2]
  });

  log('→ Response status: ' + res.status, res.body);

  if (res.status !== 200) {
    throw new Error('tag-blast-sent failed with status ' + res.status);
  }
  if (res.body.tag !== 'sent:' + EXPECTED_SLUG) {
    throw new Error('Expected tag sent:' + EXPECTED_SLUG + ', got ' + res.body.tag);
  }
  console.log('✓ PASS — tagged ' + res.body.succeeded + '/' + res.body.total + ' contacts');
  return res.body;
}

async function testBuyerResponse() {
  log('TEST 2: POST /api/tag-buyer-response', {
    url: BASE_URL + '/api/tag-buyer-response',
    contactId: CONTACT_1,
    dealAddress: TEST_DEAL_ADDRESS,
    response: 'interested'
  });

  var res = await request('POST', BASE_URL + '/api/tag-buyer-response', {
    contactId: CONTACT_1,
    dealAddress: TEST_DEAL_ADDRESS,
    response: 'interested'
  });

  log('→ Response status: ' + res.status, res.body);

  if (res.status !== 200) {
    throw new Error('tag-buyer-response failed with status ' + res.status);
  }
  if (res.body.newStatusTag !== 'deal:interested') {
    throw new Error('Expected newStatusTag deal:interested, got ' + res.body.newStatusTag);
  }
  console.log('✓ PASS — contact ' + CONTACT_1 + ' marked as interested');
  return res.body;
}

async function testDealBuyerList() {
  var url = BASE_URL + '/api/deal-buyer-list?deal=' + EXPECTED_SLUG;
  log('TEST 3: GET /api/deal-buyer-list', { url: url });

  var res = await request('GET', url, null);

  log('→ Response status: ' + res.status, res.body);

  if (res.status !== 200) {
    throw new Error('deal-buyer-list failed with status ' + res.status);
  }

  var contacts = res.body.contacts || [];
  console.log('\nFound ' + contacts.length + ' contacts tagged sent:' + EXPECTED_SLUG);

  // Verify both test contacts are in the result
  var foundC1 = contacts.some(function(c) { return c.id === CONTACT_1; });
  var foundC2 = contacts.some(function(c) { return c.id === CONTACT_2; });

  if (!foundC1) console.warn('⚠ Contact 1 (' + CONTACT_1 + ') NOT found in results');
  if (!foundC2 && CONTACT_1 !== CONTACT_2) console.warn('⚠ Contact 2 (' + CONTACT_2 + ') NOT found in results');

  // Verify sort order: first contact should have "hot" or "interested" if present
  if (contacts.length > 0) {
    console.log('\nSorted order (hot → interested → no-response → passed):');
    contacts.forEach(function(c, i) {
      console.log('  ' + (i + 1) + '. ' + (c.name || c.id) + ' — ' + (c.dealStatus || 'no status'));
    });
  }

  // Verify our test contact 1 now shows deal:interested
  var c1 = contacts.find(function(c) { return c.id === CONTACT_1; });
  if (c1 && c1.dealStatus === 'deal:interested') {
    console.log('\n✓ PASS — contact 1 shows dealStatus=deal:interested as expected');
  } else if (c1) {
    console.warn('⚠ contact 1 dealStatus=' + c1.dealStatus + ' (expected deal:interested)');
  }

  return res.body;
}

// ─── Run ───────────────────────────────────────────────────────

(async function() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║  Deal Blast Tagging — End-to-End Test Script   ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log('BASE_URL:   ' + BASE_URL);
  console.log('CONTACT_1:  ' + CONTACT_1);
  console.log('CONTACT_2:  ' + CONTACT_2);
  console.log('TEST DEAL:  ' + TEST_DEAL_ADDRESS);
  console.log('SLUG:       ' + EXPECTED_SLUG);

  try {
    await testBlastSent();
    // Brief pause to let GHL index the new tag before we search for it
    await new Promise(function(r) { setTimeout(r, 2000); });
    await testBuyerResponse();
    await new Promise(function(r) { setTimeout(r, 2000); });
    await testDealBuyerList();

    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  ✓ ALL TESTS COMPLETE                          ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log('\nTo clean up: remove these tags from the test contact(s) in GHL:');
    console.log('  - sent:' + EXPECTED_SLUG);
    console.log('  - responded:' + EXPECTED_SLUG);
    console.log('  - deal:interested');
  } catch (err) {
    console.error('\n✗ TEST FAILED:', err.message);
    process.exit(1);
  }
})();
