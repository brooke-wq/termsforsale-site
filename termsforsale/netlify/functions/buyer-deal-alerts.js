// termsforsale/netlify/functions/buyer-deal-alerts.js
//
// Canonical buyer deal-alert sender for Terms For Sale / Deal Pros.
// Replaces the deprecated notify-buyers.js + deal-follow-up.js pair
// that caused the 2026-04-22 duplicate-sender incident.
//
// ═══════════════════════════════════════════════════════════════════════
// INVARIANT — this is the ONE scheduled sender of buyer-facing deal alerts.
// If you find another, delete/rename it. No exceptions.
// See: docs/incidents/2026-04-22-duplicate-sender-incident.md
// ═══════════════════════════════════════════════════════════════════════
//
// ENV VARS:
//   NOTION_TOKEN, NOTION_DB_ID       — Notion access (deals live in Notion)
//   GHL_API_KEY                      — GoHighLevel API key
//   GHL_LOCATION_ID                  — GHL location/sub-account ID
//   NOTIFY_KILLSWITCH                — "1" = instant stop (soft kill, no deploy needed)
//   NOTIFY_DRY_RUN                   — "1" = log what would send, send nothing
//   AI_MATCH_LIVE                    — "true" = enable optional AI fit pass (opt-in)
//   ANTHROPIC_API_KEY                — required if AI_MATCH_LIVE=true
//   TEST_ONLY_PHONE                  — if set, only send to this phone (safe testing)
//
// SAFETY RULES (from 2026-04-22 incident post-mortem — non-negotiable):
//   1. Single canonical sender  — this file is it. Nothing else.
//   2. Kill-switch env var      — NOTIFY_KILLSWITCH=1 aborts before any work.
//   3. Idempotency              — GHL custom field contact.last_deal_sent_id.
//                                 Skip if already sent this deal to this buyer.
//   4. Rate-ceiling alarm       — >50 sends in 5 min → abort + SMS Brooke.
//   5. Single scheduler         — ONE cron line, nothing else fires this.
//   6. Compliance               — TCPA dnd check, opt-out tag, opt-in required.

const https = require('https');
const { buildDealUrl, buildTrackedDealUrl } = require('./_deal-url');
const { setDealWebsiteLink } = require('./_notion-url');

// Legacy helpers (extracted 2026-04-22 from notify-buyers.js.DISABLED).
// Exposes: matchesBuyBox, findMatchingBuyers, loadDynamicFieldIds,
// fetchAllBuyers, getRecentDeals, getDealById, getDealByCode,
// getParsedPrefs, parsedPrefsReject, parsedPrefsTierBump,
// slugifyAddress, getCF, getCFByKey, DEAL_STRUCTURE_MAP, CF.
const legacy = require('./_legacy-sender-helpers');
const {
  findMatchingBuyers,
  loadDynamicFieldIds,
  getCF,
  CF,
} = legacy;

// Optional helpers — load if present, skip gracefully if not
let sentLog;
try { sentLog = require('../../../jobs/sent-log'); } catch (e) { sentLog = null; }

let autoBlog;
try { autoBlog = require('./auto-blog'); } catch (e) { autoBlog = null; }

// ─── CONSTANTS ──────────────────────────────────────────────────────────

const SENDER_NAME           = 'buyer-deal-alerts';
const SMS_FROM_NUMBER       = '+14806373117';
const EMAIL_FROM_ADDRESS    = 'Terms For Sale <info@termsforsale.com>';
const BROOKE_PHONE          = '+14806373117';
const GHL_BASE              = 'https://services.leadconnectorhq.com';

// Rate-ceiling — abort if we send more than this in a sliding 5-min window.
// Tuned for Terms For Sale's normal volume:
//   - A single deal match can produce ~300-500 buyer sends
//   - Normal peak load is ~150-300 sends per 5-min window
//   - The 2026-04-22 incident pattern was ~1 send/sec sustained across
//     MULTIPLE parallel processes = 300+ sends/5min from a SINGLE window
//   - 500 gives headroom for legitimate big blasts, still catches runaway
const RATE_CEILING_COUNT    = 500;
const RATE_CEILING_WINDOW_MS = 5 * 60 * 1000;

// Throttle between buyer loop iterations
const PER_BUYER_SLEEP_MS    = 150;

// Notion deal query window for scheduled runs
const DEAL_LOOKBACK_MIN     = 35;

// What we write into contact.last_deal_sent_id per send.
// 'notionId' = deal.id (Notion page UUID — guaranteed unique)
// 'dealCode' = deal.dealCode (e.g. "PHX-001"). Set this if existing workflows
// already rely on the short code in this field.
const SENDER_IDEMPOTENCY_VALUE = 'notionId';

// ─── HTTP HELPERS ───────────────────────────────────────────────────────

function httpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function ghlHeaders(apiKey) {
  return {
    'Authorization': 'Bearer ' + apiKey,
    'Version': '2021-07-28',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg)  { console.log('['  + SENDER_NAME + '] ' + msg); }
function warn(msg) { console.warn('[' + SENDER_NAME + '] ' + msg); }
function err(msg)  { console.error('['+ SENDER_NAME + '] ' + msg); }

// ─── RATE ALARM (in-memory sliding 5-min window) ────────────────────────

const sentTimestamps = [];

function recordSend() {
  const now = Date.now();
  sentTimestamps.push(now);
  const cutoff = now - RATE_CEILING_WINDOW_MS;
  while (sentTimestamps.length && sentTimestamps[0] < cutoff) sentTimestamps.shift();
}

function rateAlarm() {
  return sentTimestamps.length > RATE_CEILING_COUNT;
}

async function sendRateAlarmSMS(apiKey, count) {
  const msg = '[' + SENDER_NAME + '] RATE ALARM: ' + count + ' sends in 5 min — aborting.';
  try {
    await httpRequest(GHL_BASE + '/conversations/messages', {
      method: 'POST',
      headers: ghlHeaders(apiKey),
    }, {
      type: 'SMS',
      toNumber: BROOKE_PHONE,
      message: msg,
      fromNumber: SMS_FROM_NUMBER,
    });
  } catch (e) {
    err('failed to send rate-alarm SMS to Brooke: ' + e.message);
  }
}

// ─── IDEMPOTENCY (contact.last_deal_sent_id) ────────────────────────────

// The legacy loadDynamicFieldIds doesn't know about last_deal_sent_id (that
// field was added after notify-buyers was written), so we discover it
// ourselves and stash the id on the shared CF object.
async function ensureLastDealSentIdField(apiKey, locationId) {
  if (CF.LAST_DEAL_SENT_ID) return;
  try {
    const res = await httpRequest(GHL_BASE + '/locations/' + locationId + '/customFields?model=contact', {
      method: 'GET',
      headers: ghlHeaders(apiKey),
    });
    if (res.status !== 200) {
      warn('ensureLastDealSentIdField: HTTP ' + res.status);
      return;
    }
    const data = JSON.parse(res.body);
    const fields = data.customFields || [];
    const match = fields.find((f) => {
      const key = (f.fieldKey || '').toLowerCase();
      const name = (f.name || '').toLowerCase();
      return key === 'contact.last_deal_sent_id' || key === 'last_deal_sent_id'
          || name === 'last deal sent id' || name === 'last_deal_sent_id';
    });
    if (match) {
      CF.LAST_DEAL_SENT_ID = match.id;
      log('ensureLastDealSentIdField: bound CF.LAST_DEAL_SENT_ID = ' + match.id);
    } else {
      warn('ensureLastDealSentIdField: contact.last_deal_sent_id field not found in GHL — idempotency will be SKIPPED (best-effort)');
    }
  } catch (e) {
    warn('ensureLastDealSentIdField error: ' + e.message);
  }
}

function idempotencyValueFor(deal) {
  if (SENDER_IDEMPOTENCY_VALUE === 'dealCode') return String(deal.dealCode || '').trim();
  return String(deal.id || '').trim();
}

async function writeLastDealSent(apiKey, contactId, deal) {
  if (!CF.LAST_DEAL_SENT_ID) return; // silently skip if we couldn't bind it
  const value = idempotencyValueFor(deal);
  const res = await httpRequest(GHL_BASE + '/contacts/' + contactId, {
    method: 'PUT',
    headers: ghlHeaders(apiKey),
  }, {
    customFields: [{ id: CF.LAST_DEAL_SENT_ID, value }],
  });
  if (res.status >= 400) {
    warn('failed to write last_deal_sent_id for ' + contactId + ': HTTP ' + res.status + ' ' + res.body.slice(0, 200));
  }
}

function alreadyBlasted(contact, deal) {
  if (!CF.LAST_DEAL_SENT_ID) return false; // no field, no dedup possible → don't block
  const existing = getCF(contact, CF.LAST_DEAL_SENT_ID);
  return String(existing || '').trim() === idempotencyValueFor(deal);
}

// ─── MESSAGE TEMPLATES (ported verbatim from notify-buyers.js:1112+) ────

function buildSmsText(deal, contact) {
  const price = deal.askingPrice ? '$' + deal.askingPrice.toLocaleString() : '';
  const entry = deal.entryFee   ? '$' + deal.entryFee.toLocaleString()   : '';
  let msg = 'New ' + deal.dealType + ' deal in ' + deal.city + ', ' + deal.state;
  if (price) msg += ' — ' + price;
  if (entry) msg += ' entry ' + entry;
  msg += '. View: ' + buildTrackedDealUrl(deal, contact.id);
  if (msg.length > 160) msg = msg.slice(0, 157) + '...';
  return msg;
}

function buildEmailSubject(deal) {
  const price = deal.askingPrice ? ' — $' + deal.askingPrice.toLocaleString() : '';
  return 'New ' + (deal.dealType || 'Deal') + ' in ' + deal.city + ', ' + deal.state + price;
}

// Plain-text fallback. TODO SESSION C (or later): port the branded HTML from
// notify-buyers.js.DISABLED around line 1222+ if you want the richer email.
function buildEmailBody(deal, contact) {
  const lines = [
    'A new ' + (deal.dealType || 'deal') + ' matching your criteria is live:',
    '',
    '  ' + [deal.streetAddress, deal.city, deal.state].filter(Boolean).join(', '),
    deal.askingPrice ? '  Price: $' + deal.askingPrice.toLocaleString() : null,
    deal.entryFee   ? '  Entry: $' + deal.entryFee.toLocaleString()   : null,
    '',
    'View the full package: ' + buildTrackedDealUrl(deal, contact.id),
    '',
    '—',
    'Terms For Sale',
    'Reply STOP to unsubscribe from SMS. Reply HELP for support.',
  ].filter(Boolean);
  return lines.join('\n');
}

// ─── GHL SEND ───────────────────────────────────────────────────────────

async function ghlSendSms(apiKey, contactId, message) {
  return httpRequest(GHL_BASE + '/conversations/messages', {
    method: 'POST',
    headers: ghlHeaders(apiKey),
  }, {
    type: 'SMS',
    contactId,
    message,
    fromNumber: SMS_FROM_NUMBER,
  });
}

async function ghlSendEmail(apiKey, contactId, subject, body) {
  return httpRequest(GHL_BASE + '/conversations/messages', {
    method: 'POST',
    headers: ghlHeaders(apiKey),
  }, {
    type: 'Email',
    contactId,
    subject,
    emailFrom: EMAIL_FROM_ADDRESS,
    html: '<p>' + body.replace(/\n/g, '<br>') + '</p>',
  });
}

// ─── COMPLIANCE GATE ────────────────────────────────────────────────────

// Opt-in tags — buyer must have ONE of these to receive marketing SMS/email.
// Normalized comparison: case-insensitive, spaces/hyphens/underscores equivalent.
// So 'Active Buyer', 'active-buyer', 'ACTIVE_BUYER', and 'active buyer' all match.
const OPT_IN_TAGS = new Set(['opt in', 'active buyer']);

function normalizeTag(t) {
  return String(t || '').toLowerCase().trim().replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
}

function complianceRejection(contact) {
  // 1. GHL native Do Not Disturb flag
  if (contact.dnd === true) return 'dnd';

  // 2. Explicit opt-out or unsubscribe tags
  const optOutTag = (contact.tags || []).find((t) => {
    const n = normalizeTag(t);
    return n.indexOf('opt out') === 0 || n.indexOf('unsubscribe') === 0;
  });
  if (optOutTag) return 'opt-out-tag:' + optOutTag;

  // 3. Opt-in required. Accepts: 'opt in' OR 'active buyer' (both normalized).
  //    To disable this gate, set REQUIRE_OPT_IN=0 in env.
  const requireOptIn = process.env.REQUIRE_OPT_IN !== '0';
  if (requireOptIn) {
    const hasOptIn = (contact.tags || []).some((t) => OPT_IN_TAGS.has(normalizeTag(t)));
    if (!hasOptIn) return 'no-opt-in-tag';
  }

  return null;
}

// ─── PER-BUYER SEND ─────────────────────────────────────────────────────

async function sendToBuyer(apiKey, contact, deal, dryRun) {
  // Rule 6 — compliance gate first
  const rejection = complianceRejection(contact);
  if (rejection) {
    log('Skipped ' + contact.id + ' — compliance: ' + rejection);
    return { sent: false, reason: 'compliance:' + rejection };
  }

  // Rule 3 — receiver-side idempotency (GHL contact.last_deal_sent_id)
  if (alreadyBlasted(contact, deal)) {
    log('Skipped ' + contact.id + ' — already sent ' + (deal.dealCode || deal.id));
    return { sent: false, reason: 'already-sent' };
  }

  // File-based dedup backstop (droplet only)
  const dealIdShort = (deal.id || deal.dealCode || '').slice(0, 8);
  if (sentLog && sentLog.isDroplet && sentLog.isDroplet()) {
    if (sentLog.wasSent(contact.id, dealIdShort, 'alert')) {
      log('Skipped ' + contact.id + ' — file dedup');
      return { sent: false, reason: 'file-dedup' };
    }
    sentLog.markSent(contact.id, dealIdShort, 'alert');
  }

  // TEST_ONLY_PHONE — safe-test gate
  const testOnly = process.env.TEST_ONLY_PHONE || '';
  if (testOnly && contact.phone !== testOnly) {
    log('Skipped ' + contact.id + ' — TEST_ONLY_PHONE set and not a match');
    return { sent: false, reason: 'test-only-phone' };
  }

  // Rule 9 — dry-run mode. Does NOT call recordSend() — dry-run sends nothing,
  // so it shouldn't count toward the rate alarm. Otherwise a dry-run of a big
  // buyer list would trigger the alarm and give a false "aborted" signal.
  if (dryRun) {
    log('DRY-RUN would send to ' + contact.id + ' deal=' + (deal.dealCode || deal.id));
    return { sent: true, reason: 'dry-run' };
  }

  // SMS (independent failure)
  try {
    const r = await ghlSendSms(apiKey, contact.id, buildSmsText(deal, contact));
    if (r.status >= 400) err('SMS failed ' + contact.id + ' deal=' + (deal.dealCode||deal.id) + ': HTTP ' + r.status + ' ' + r.body.slice(0, 200));
    else log('SMS sent to ' + contact.id + ' deal=' + (deal.dealCode||deal.id));
  } catch (e) {
    err('SMS threw for ' + contact.id + ' deal=' + (deal.dealCode||deal.id) + ': ' + e.message);
  }

  // Email (independent failure)
  try {
    const r = await ghlSendEmail(apiKey, contact.id, buildEmailSubject(deal), buildEmailBody(deal, contact));
    if (r.status >= 400) err('Email failed ' + contact.id + ' deal=' + (deal.dealCode||deal.id) + ': HTTP ' + r.status + ' ' + r.body.slice(0, 200));
    else log('Email sent to ' + contact.id + ' deal=' + (deal.dealCode||deal.id));
  } catch (e) {
    err('Email threw for ' + contact.id + ' deal=' + (deal.dealCode||deal.id) + ': ' + e.message);
  }

  // Rule 3 — write idempotency mark (AFTER sends, best-effort)
  await writeLastDealSent(apiKey, contact.id, deal);

  recordSend();
  return { sent: true, reason: 'sent' };
}

// ─── MAIN HANDLER ───────────────────────────────────────────────────────

exports.handler = async function (event) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event && event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // ═ Rule 2 — KILLSWITCH (first thing) ═
  if (process.env.NOTIFY_KILLSWITCH === '1') {
    warn('KILLSWITCH active (NOTIFY_KILLSWITCH=1) — aborting');
    return { statusCode: 503, headers, body: JSON.stringify({
      aborted: true, reason: 'NOTIFY_KILLSWITCH=1', at: new Date().toISOString(),
    })};
  }

  const dryRun = process.env.NOTIFY_DRY_RUN === '1';
  if (dryRun) log('DRY-RUN MODE — nothing will actually send');

  const token      = process.env.NOTION_TOKEN;
  const dbId       = process.env.NOTION_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';
  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !apiKey || !locationId) {
    err('Missing env vars: token=' + !!token + ' apiKey=' + !!apiKey + ' locationId=' + !!locationId);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  const params = (event && event.queryStringParameters) || {};

  try {
    // Load GHL field IDs (populates legacy CF.*)
    await loadDynamicFieldIds(apiKey, locationId);
    // Augment with our own idempotency field
    await ensureLastDealSentIdField(apiKey, locationId);

    // Fetch deals
    let deals = [];
    if (params.deal_id) {
      const d = await legacy.getDealByCode(token, dbId, params.deal_id)
             || await legacy.getDealById(token, dbId, params.deal_id);
      if (d) deals = [d];
      else return { statusCode: 404, headers, body: JSON.stringify({ error: 'Deal not found', tried: params.deal_id }) };
    } else {
      deals = await legacy.getRecentDeals(token, dbId, DEAL_LOOKBACK_MIN);
    }

    if (!deals.length) {
      log('No deals to process');
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'no deals' }) };
    }

    const summary = { dealsProcessed: 0, totalSent: 0, totalSkipped: 0, byDeal: [] };

    for (const deal of deals) {
      // Best-effort Notion URL sync
      try { await setDealWebsiteLink(token, deal); } catch (e) { warn('URL sync failed: ' + e.message); }

      // Use the legacy tiered match — returns sorted array of buyers with .tier + .matchReasons
      const matched = await findMatchingBuyers(apiKey, locationId, deal);
      log('Deal ' + (deal.dealCode || deal.id) + ' — matched ' + matched.length + ' buyers');

      // Rule 4 — pre-loop rate ceiling check
      if (rateAlarm()) {
        await sendRateAlarmSMS(apiKey, sentTimestamps.length);
        return { statusCode: 429, headers, body: JSON.stringify({ aborted: 'rate-alarm', at: new Date().toISOString() }) };
      }

      let dealSent = 0, dealSkipped = 0;
      const seenContactIds = new Set();

      for (const buyer of matched) {
        if (seenContactIds.has(buyer.id)) { dealSkipped++; continue; }
        seenContactIds.add(buyer.id);

        // findMatchingBuyers returns a leaner entry object — we need the full
        // contact with customFields and tags for compliance + idempotency.
        // The entry already has id, name, email, phone, tier, matchReasons.
        // The customFields/tags we need live on the buyer object as loaded by
        // fetchAllBuyers → findMatchingBuyers attaches them as `_raw` in some
        // versions, otherwise we can query one-off.
        const contact = buyer._raw || buyer;

        const result = await sendToBuyer(apiKey, contact, deal, dryRun);
        if (result.sent) dealSent++;
        else dealSkipped++;

        // Rule 8 — throttle
        await sleep(PER_BUYER_SLEEP_MS);

        // Rule 4 — mid-loop rate ceiling re-check
        if ((dealSent % 10) === 0 && rateAlarm()) {
          await sendRateAlarmSMS(apiKey, sentTimestamps.length);
          summary.byDeal.push({ dealCode: deal.dealCode, sent: dealSent, skipped: dealSkipped, abortedByRateAlarm: true });
          summary.totalSent += dealSent;
          summary.totalSkipped += dealSkipped;
          return { statusCode: 429, headers, body: JSON.stringify(summary) };
        }
      }

      summary.dealsProcessed++;
      summary.totalSent += dealSent;
      summary.totalSkipped += dealSkipped;
      summary.byDeal.push({ dealCode: deal.dealCode || deal.id, sent: dealSent, skipped: dealSkipped });

      // Auto-blog (fire-and-forget, live-only)
      if (autoBlog && !dryRun) {
        try { await autoBlog.createDealPost(deal); } catch (e) { warn('auto-blog failed: ' + e.message); }
      }
    }

    log('Finished. sent=' + summary.totalSent + ' skipped=' + summary.totalSkipped + ' deals=' + summary.dealsProcessed);
    return { statusCode: 200, headers, body: JSON.stringify(summary) };

  } catch (e) {
    err('Handler error: ' + e.message + '\n' + (e.stack || ''));
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
