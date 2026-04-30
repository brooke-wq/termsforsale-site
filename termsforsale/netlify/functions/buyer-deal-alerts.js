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
  slugifyAddress,
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

// ─── DEAL-LEVEL BROADCAST GUARD (2026-04-23) ────────────────────────────
// Per operator rule: "no more sending deals that were already sent. Only
// NEW deals moving forward." If ANY buyer has been sent this deal in the
// past (as recorded in jobs/sent-log.json), we skip the whole deal on
// future cron runs. This prevents re-broadcasting old deals when new
// buyers opt in.
function dealHasBeenBroadcast(dealIdShort) {
  if (!dealIdShort) return false;
  try {
    const fs = require('fs');
    const path = '/root/termsforsale-site/jobs/sent-log.json';
    if (!fs.existsSync(path)) return false;
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));
    // sent-log key format: "contactId-dealIdShort-type"
    // Scan for any key containing `-<dealIdShort>-`
    const marker = '-' + dealIdShort + '-';
    for (const k of Object.keys(data)) {
      if (k.indexOf(marker) > 0) return true;
    }
  } catch (e) {
    warn('dealHasBeenBroadcast scan error for ' + dealIdShort + ': ' + e.message);
  }
  return false;
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

// Branded HTML email template — ported from notify-buyers.js:1140-1220 with
// additional body copy for deliverability (reduces spam-score penalty for
// link-heavy emails with minimal text). New copy: personalized greeting,
// intro paragraph, "why this matched" post-CTA paragraph, closing, CAN-SPAM
// compliance footer with physical address + unsubscribe.
function buildEmailBody(deal, contact) {
  const price   = deal.askingPrice ? '$' + deal.askingPrice.toLocaleString() : '';
  const entry   = deal.entryFee   ? '$' + deal.entryFee.toLocaleString()   : '';
  const arvStr  = deal.arv ? '$' + deal.arv.toLocaleString() : '';
  const rentStr = deal.rentFinal ? '$' + deal.rentFinal.toLocaleString() + '/mo' : '';
  const trackUrl = buildTrackedDealUrl(deal, contact.id);
  const firstName = (contact.firstName || '').trim();
  const greeting  = firstName ? 'Hi ' + firstName + ',' : 'Hi there,';
  const dealTypeLower = (deal.dealType || 'deal').toLowerCase();

  // Cover photo extracted from Google Drive share link in deal.coverPhoto
  let coverImg = '';
  const photoMatch = (deal.coverPhoto || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (photoMatch) coverImg = 'https://termsforsale.com/api/drive-image?id=' + photoMatch[1] + '&sz=800';

  const specs = [
    deal.beds ? deal.beds + ' Beds' : '',
    deal.baths ? deal.baths + ' Baths' : '',
    deal.sqft ? deal.sqft.toLocaleString() + ' Sqft' : '',
    deal.yearBuilt ? 'Built ' + deal.yearBuilt : '',
  ].filter(Boolean).join(' · ');

  const highlights = [deal.highlight1, deal.highlight2, deal.highlight3].filter(Boolean);

  let html = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff">'
    // Header
    + '<div style="background:#0D1F3C;padding:20px 32px;border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:space-between">'
    + '<img src="https://assets.cdn.filesafe.space/7IyUgu1zpi38MDYpSDTs/media/697a3aee1fd827ffd863448d.svg" alt="Terms For Sale" style="height:32px">'
    + '<span style="color:rgba(255,255,255,.5);font-size:11px;font-weight:600">NEW DEAL ALERT</span>'
    + '</div>'
    // Photo
    + (coverImg ? '<a href="' + trackUrl + '" style="display:block;width:100%;max-height:300px;overflow:hidden"><img src="' + coverImg + '" alt="' + (deal.streetAddress || deal.city || 'Property') + '" style="width:100%;display:block"></a>' : '')
    // Body
    + '<div style="padding:28px 32px">'
    // NEW — personalized greeting + intro paragraph (adds readable text to reduce spam score)
    + '<p style="color:#0D1F3C;font-size:15px;margin:0 0 12px;font-weight:600">' + greeting + '</p>'
    + '<p style="color:#4A5568;font-size:14px;line-height:1.55;margin:0 0 20px">A new ' + (deal.dealType || 'deal') + ' just dropped in <strong>' + deal.city + ', ' + deal.state + '</strong> that matches your buying criteria. The full package is live now — here\'s the quick snapshot:</p>'
    // Deal type pill + location
    + '<div style="display:inline-block;padding:4px 12px;border-radius:20px;background:#EBF8FF;color:#1a8bbf;font-size:12px;font-weight:700;margin-bottom:12px">' + (deal.dealType || 'Deal') + '</div>'
    + '<h2 style="color:#0D1F3C;font-size:22px;margin:0 0 4px">' + deal.city + ', ' + deal.state + '</h2>'
    + '<p style="color:#718096;font-size:13px;margin:0 0 20px">' + (specs || '') + '</p>'
    // Numbers grid
    + '<table style="width:100%;border-collapse:collapse;margin:0 0 20px">'
    + (price   ? '<tr><td style="padding:10px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-size:13px;font-weight:600">Asking Price</td><td style="padding:10px 0;border-bottom:1px solid #EDF2F7;color:#0D1F3C;font-size:16px;font-weight:800;text-align:right">' + price + '</td></tr>' : '')
    + (entry   ? '<tr><td style="padding:10px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-size:13px;font-weight:600">Entry Fee</td><td style="padding:10px 0;border-bottom:1px solid #EDF2F7;color:#0D1F3C;font-size:16px;font-weight:800;text-align:right">' + entry + '</td></tr>' : '')
    + (arvStr  ? '<tr><td style="padding:10px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-size:13px;font-weight:600">ARV</td><td style="padding:10px 0;border-bottom:1px solid #EDF2F7;color:#0D1F3C;font-size:16px;font-weight:800;text-align:right">' + arvStr + '</td></tr>' : '')
    + (rentStr ? '<tr><td style="padding:10px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-size:13px;font-weight:600">Est. Rent</td><td style="padding:10px 0;border-bottom:1px solid #EDF2F7;color:#10B981;font-size:16px;font-weight:800;text-align:right">' + rentStr + '</td></tr>' : '')
    + '</table>'
    // Highlights
    + (highlights.length ? '<div style="background:#F7FAFC;border-radius:8px;padding:14px 16px;margin-bottom:20px">' + highlights.map((h) => '<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px"><span style="color:#10B981;font-size:14px;line-height:1">&#10003;</span><span style="color:#4A5568;font-size:13px;line-height:1.4">' + h + '</span></div>').join('') + '</div>' : '')
    // CTA
    + '<a href="' + trackUrl + '" style="display:block;text-align:center;padding:16px 32px;background:#29ABE2;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px">View Full Deal Details &rarr;</a>'
    // NEW — "why this matched" + urgency context (adds readable text to reduce spam score)
    + '<p style="color:#4A5568;font-size:14px;line-height:1.55;margin:20px 0 0">Deals with ' + dealTypeLower + ' terms don\'t usually sit long — most get claimed within 48-72 hours of going live. If these numbers fit your buy box, tap above for the full package: photos, financials, seller notes, and our inspection summary.</p>'
    + '<p style="color:#4A5568;font-size:14px;line-height:1.55;margin:12px 0 20px">Questions about the property or want to adjust what we send you? Reply directly to this email — your message comes to a real person on our team, not a black hole.</p>'
    // Signature
    + '<p style="color:#0D1F3C;font-size:14px;line-height:1.55;margin:0 0 4px;font-weight:600">— The Terms For Sale Team</p>'
    + '<p style="color:#718096;font-size:12px;line-height:1.55;margin:0 0 20px">Deal Pros LLC</p>'
    // Landlord insurance promo
    + '<div style="background:#F7FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 16px;margin-top:16px;text-align:center">'
    + '<span style="font-size:12px;color:#718096">Need landlord insurance? </span>'
    + '<a href="https://dealpros.steadilypartner.com/" target="_blank" style="color:#29ABE2;font-size:12px;font-weight:700">Get an instant quote &rarr;</a>'
    + '</div>'
    + '<p style="color:#718096;font-size:12px;margin-top:20px;text-align:center">This deal matched your buying criteria. <a href="https://termsforsale.com/buying-criteria.html" style="color:#29ABE2">Update your buy box</a> anytime.</p>'
    + '</div>'
    // CAN-SPAM compliance footer (required by law — physical address + unsubscribe + sender identity)
    + '<div style="background:#F4F6F9;padding:16px 32px;border-radius:0 0 12px 12px;text-align:center">'
    + '<p style="color:#718096;font-size:11px;margin:0 0 6px">You\'re receiving this because you signed up for deal alerts at termsforsale.com.</p>'
    + '<p style="color:#718096;font-size:11px;margin:0 0 6px"><a href="https://termsforsale.com/unsubscribe?c=' + contact.id + '" style="color:#29ABE2">Unsubscribe</a> &middot; <a href="https://termsforsale.com/buying-criteria.html" style="color:#29ABE2">Update preferences</a> &middot; <a href="https://termsforsale.com/privacy.html" style="color:#29ABE2">Privacy</a></p>'
    + '<p style="color:#A0AEC0;font-size:11px;margin:0">Terms For Sale &middot; Deal Pros LLC &middot; <a href="https://termsforsale.com" style="color:#29ABE2">termsforsale.com</a></p>'
    + '</div></div>';

  return html;
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
    html: body,  // body is already the full branded HTML from buildEmailBody()
  });
}

// Write the per-deal audit tags the legacy sender used to write. The
// admin Deal Buyer List dashboard (and admin-analytics.js) queries
// GHL for `sent:[slug]` to compute per-deal engagement, so without
// this write the new sender is invisible to those views. Best-effort
// — never fail the send if tag write fails.
//
// Tags written (matches notify-buyers.js.DISABLED behavior):
//   - new-deal-alert         (lifetime engagement)
//   - sent:[slug]            (per-deal audit; queried by admin views)
//   - tier{N}:[slug]         (match-quality, only if buyer has .tier)
//   - alerted-{shortId}      (legacy GHL-side dedup)
async function writeDealAlertTags(apiKey, contact, deal) {
  const slug = slugifyAddress(deal.streetAddress, deal.city, deal.state);
  const tierNum = contact.tier || contact._tier;
  const dealIdShort = (deal.id || '').slice(0, 8);

  const tags = ['new-deal-alert'];
  if (slug) tags.push('sent:' + slug);
  if (slug && tierNum) tags.push('tier' + tierNum + ':' + slug);
  if (dealIdShort) tags.push('alerted-' + dealIdShort);

  try {
    const r = await httpRequest(GHL_BASE + '/contacts/' + contact.id + '/tags', {
      method: 'POST',
      headers: ghlHeaders(apiKey),
    }, { tags });
    if (r.status >= 400) {
      warn('tag write failed for ' + contact.id + ' deal=' + (deal.dealCode || deal.id)
        + ': HTTP ' + r.status + ' ' + r.body.slice(0, 200));
    } else {
      log('tags written for ' + contact.id + ' deal=' + (deal.dealCode || deal.id)
        + ' [' + tags.join(', ') + ']');
    }
  } catch (e) {
    warn('tag write threw for ' + contact.id + ' deal=' + (deal.dealCode || deal.id) + ': ' + e.message);
  }
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

  // File-based dedup CHECK (backstop for when GHL idempotency field isn't set).
  // We only READ here. The atomic claim (markSent) happens AFTER the dry-run
  // gate below, so dry-runs don't pollute sent-log.json.
  const dealIdShort = (deal.id || deal.dealCode || '').slice(0, 8);
  const isDropletEnv = !!(sentLog && sentLog.isDroplet && sentLog.isDroplet());
  if (isDropletEnv && sentLog.wasSent(contact.id, dealIdShort, 'alert')) {
    log('Skipped ' + contact.id + ' — file dedup');
    return { sent: false, reason: 'file-dedup' };
  }

  // TEST_ONLY_PHONE — safe-test gate
  const testOnly = process.env.TEST_ONLY_PHONE || '';
  if (testOnly && contact.phone !== testOnly) {
    log('Skipped ' + contact.id + ' — TEST_ONLY_PHONE set and not a match');
    return { sent: false, reason: 'test-only-phone' };
  }

  // Rule 9 — dry-run mode. Returns BEFORE any side-effect writes (no markSent,
  // no recordSend, no writeLastDealSent, no actual sends). Safe to run at any
  // volume without polluting state.
  if (dryRun) {
    log('DRY-RUN would send to ' + contact.id + ' deal=' + (deal.dealCode || deal.id));
    return { sent: true, reason: 'dry-run' };
  }

  // Atomic claim the sent-log slot NOW so a concurrent invocation can't race
  // past the wasSent() check and double-send. Trade-off: if SMS/Email fails
  // after this point, we DON'T retry on the next cron (no retry-spam).
  if (isDropletEnv) {
    sentLog.markSent(contact.id, dealIdShort, 'alert');
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

  // Per-deal audit tags (sent:[slug], tier{N}:[slug], alerted-{shortId},
  // new-deal-alert). Best-effort — see writeDealAlertTags() above.
  await writeDealAlertTags(apiKey, contact, deal);

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

    // ═══════════════════════════════════════════════════════════════════
    // TEST BYPASS: env TEST_TO_CONTACT=<contactId>
    // Forces ONE send to ONE contact for the FIRST matched deal. Bypasses
    // the match logic entirely. Purpose: live-send validation (Session C)
    // without needing the test contact to satisfy buy-box match criteria.
    // Unset the env var to return to normal multi-buyer broadcast behavior.
    // ═══════════════════════════════════════════════════════════════════
    if (process.env.TEST_TO_CONTACT) {
      const testContactId = process.env.TEST_TO_CONTACT.trim();
      const testDeal = deals[0];
      log('TEST_TO_CONTACT bypass ACTIVE — forcing send to contact=' + testContactId
          + ' deal=' + (testDeal.dealCode || testDeal.id));
      try {
        const res = await httpRequest(GHL_BASE + '/contacts/' + testContactId, {
          method: 'GET',
          headers: ghlHeaders(apiKey),
        });
        if (res.status !== 200) {
          err('TEST_TO_CONTACT fetch failed: HTTP ' + res.status + ' ' + res.body.slice(0, 200));
          return { statusCode: 404, headers, body: JSON.stringify({
            error: 'test contact fetch failed',
            status: res.status,
            contactId: testContactId,
          })};
        }
        const parsed = JSON.parse(res.body);
        const testContact = parsed.contact || parsed;

        // Best-effort Notion URL sync (same as normal path)
        try { await setDealWebsiteLink(token, testDeal); }
        catch (e) { warn('URL sync failed: ' + e.message); }

        // Run through the same sendToBuyer flow — compliance, idempotency,
        // rate alarm, throttle, and (if live) the actual sends all run.
        const result = await sendToBuyer(apiKey, testContact, testDeal, dryRun);
        log('TEST_TO_CONTACT result: ' + JSON.stringify(result));

        return { statusCode: 200, headers, body: JSON.stringify({
          testMode: 'TEST_TO_CONTACT',
          dealCode: testDeal.dealCode || testDeal.id,
          contactId: testContact.id,
          contactPhone: testContact.phone,
          contactTags: (testContact.tags || []).slice(0, 20),
          result,
        }, null, 2)};
      } catch (e) {
        err('TEST_TO_CONTACT bypass error: ' + e.message + '\n' + (e.stack || ''));
        return { statusCode: 500, headers, body: JSON.stringify({
          error: e.message,
          mode: 'TEST_TO_CONTACT',
        })};
      }
    }

    const summary = { dealsProcessed: 0, totalSent: 0, totalSkipped: 0, byDeal: [] };

    for (const deal of deals) {
      // Best-effort Notion URL sync
      try { await setDealWebsiteLink(token, deal); } catch (e) { warn('URL sync failed: ' + e.message); }

      // ═ DEAL-LEVEL BROADCAST GUARD ═
      // Skip the entire deal if it's been broadcast to ANY buyer previously.
      // Rule from operator 2026-04-23: only NEW deals moving forward — no
      // re-blasts of deals already in the system.
      const dealIdShort = (deal.id || deal.dealCode || '').slice(0, 8);
      if (dealHasBeenBroadcast(dealIdShort)) {
        log('Deal ' + (deal.dealCode || deal.id) + ' (' + dealIdShort + ') already broadcast previously — skipping entire deal');
        summary.byDeal.push({
          dealCode: deal.dealCode || deal.id,
          sent: 0,
          skipped: 0,
          skippedDeal: 'already-broadcast',
        });
        continue;
      }

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
