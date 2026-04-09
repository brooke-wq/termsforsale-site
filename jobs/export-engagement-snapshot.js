#!/usr/bin/env node
/**
 * Export Engagement Snapshot — one-time historical pull
 *
 * PURPOSE
 * -------
 * Dumps historical buyer engagement data to CSV files so you have a reference
 * of who engaged with which deal BEFORE the new sent-/viewed-/alert- tag
 * system went live. This does NOT modify any data — it's a read-only export.
 *
 * The new tag system starts clean from today forward. This script gives you a
 * snapshot of the "before" state in case you ever need to look back.
 *
 * HOW TO RUN (on the droplet)
 * ---------------------------
 *   cd /root/termsforsale-site/jobs
 *   node export-engagement-snapshot.js
 *
 * It creates a timestamped folder like jobs/exports/2026-04-09/ with:
 *   - deals-notion.csv           : every Notion deal + its Deal ID status
 *   - contacts-engagement.csv    : every buyer with sent:* or viewed:* tags
 *   - sent-by-slug.csv           : per-slug list of buyers who were blasted
 *   - viewed-by-id-short.csv     : per-short-id list of buyers who viewed
 *   - summary.txt                : top-line counts
 *
 * To copy the files off the droplet to your laptop:
 *   scp -r root@64.23.204.220:/root/termsforsale-site/jobs/exports/2026-04-09 .
 *
 * ENV VARS
 * --------
 *   GHL_API_KEY              — required
 *   GHL_LOCATION_ID_TERMS    — optional (falls back to GHL_LOCATION_ID)
 *   NOTION_TOKEN             — required for the Notion deals dump
 *   NOTION_DB_ID             — required (the deals DB)
 *
 * COST: one big GHL paginated scan + one Notion DB query. Pennies of API usage.
 */

const fs = require('fs');
const path = require('path');

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const NOTION_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const GHL_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION =
  process.env.GHL_LOCATION_ID_TERMS || process.env.GHL_LOCATION_ID;
const NOTION_KEY = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
const NOTION_DB_ID =
  process.env.NOTION_DEALS_DB_ID ||
  process.env.NOTION_DATABASE_ID ||
  process.env.NOTION_DB_ID;

// ─────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────

function assertEnv() {
  const missing = [];
  if (!GHL_KEY) missing.push('GHL_API_KEY');
  if (!GHL_LOCATION) missing.push('GHL_LOCATION_ID_TERMS');
  if (!NOTION_KEY) missing.push('NOTION_TOKEN');
  if (!NOTION_DB_ID) missing.push('NOTION_DB_ID');
  if (missing.length > 0) {
    console.error('[export] missing env vars:', missing.join(', '));
    process.exit(1);
  }
}

function makeExportDir() {
  const stamp = new Date().toISOString().split('T')[0];
  const dir = path.join(__dirname, 'exports', stamp);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Escape a field for CSV — quote if it contains comma, quote, or newline.
function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function writeCsv(filepath, header, rows) {
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  fs.writeFileSync(filepath, lines.join('\n') + '\n');
  console.log(`[export] wrote ${rows.length} row(s) → ${filepath}`);
}

// ─────────────────────────────────────────────────────────────
// Notion deals dump
// ─────────────────────────────────────────────────────────────

async function notionFetch(pathPart, method, body) {
  const res = await fetch(`${NOTION_BASE}${pathPart}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch (e) { parsed = { raw: text }; }
  if (!res.ok) throw new Error(`Notion ${method} ${pathPart} → ${res.status}: ${parsed.message || text.substring(0, 200)}`);
  return parsed;
}

function pickRichText(prop) {
  if (!prop) return '';
  if (Array.isArray(prop.rich_text)) return prop.rich_text.map((t) => t.plain_text).join('').trim();
  if (Array.isArray(prop.title)) return prop.title.map((t) => t.plain_text).join('').trim();
  return '';
}
function pickStatus(prop) {
  if (!prop) return '';
  if (prop.status && prop.status.name) return prop.status.name;
  if (prop.select && prop.select.name) return prop.select.name;
  return '';
}

async function dumpNotionDeals(exportDir) {
  console.log('[export] pulling all deals from Notion…');
  const all = [];
  let startCursor;
  do {
    const res = await notionFetch(`/databases/${NOTION_DB_ID}/query`, 'POST', {
      page_size: 100,
      start_cursor: startCursor,
    });
    all.push(...(res.results || []));
    startCursor = res.has_more ? res.next_cursor : undefined;
  } while (startCursor);

  console.log(`[export] pulled ${all.length} Notion deals`);

  const rows = all.map((page) => {
    const p = page.properties || {};
    return [
      page.id,
      pickRichText(p['Deal ID']) || pickRichText(p['Deal Id']) || pickRichText(p['Deal Code']),
      pickStatus(p['Deal Status']) || pickStatus(p['Status']),
      pickRichText(p['Street Address']),
      pickRichText(p['City']),
      pickRichText(p['State']),
      pickRichText(p['Deal Type']),
      page.last_edited_time || '',
    ];
  });

  writeCsv(
    path.join(exportDir, 'deals-notion.csv'),
    ['notion_page_id', 'deal_id', 'deal_status', 'street_address', 'city', 'state', 'deal_type', 'last_edited'],
    rows
  );

  return all;
}

// ─────────────────────────────────────────────────────────────
// GHL contacts dump
// ─────────────────────────────────────────────────────────────

async function ghlFetch(pathPart, method, body) {
  const res = await fetch(`${GHL_BASE}${pathPart}`, {
    method,
    headers: {
      Authorization: `Bearer ${GHL_KEY}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch (e) { parsed = { raw: text }; }
  if (!res.ok) throw new Error(`GHL ${method} ${pathPart} → ${res.status}: ${parsed.message || text.substring(0, 200)}`);
  return parsed;
}

/**
 * Paginate through every contact in the Terms For Sale location using the
 * /contacts/search endpoint. GHL's bulk-list endpoint caps pages at 100.
 * We don't filter server-side — we pull everything and filter in memory.
 */
async function pullAllContacts() {
  console.log('[export] pulling all GHL contacts (this can take a minute)…');
  const all = [];
  let page = 1;
  const pageLimit = 100;
  const hardCap = 20000; // safety stop

  while (all.length < hardCap) {
    let res;
    try {
      res = await ghlFetch('/contacts/search', 'POST', {
        locationId: GHL_LOCATION,
        page,
        pageLimit,
      });
    } catch (err) {
      console.warn(`[export] contacts/search page=${page} failed: ${err.message}`);
      break;
    }
    const batch = res.contacts || res.data || [];
    all.push(...batch);
    if (batch.length === 0) break;
    const total = (res.meta && res.meta.total) || all.length;
    if (all.length >= total) break;
    if (page % 5 === 0) console.log(`[export]   …pulled ${all.length} so far`);
    page++;
  }

  console.log(`[export] pulled ${all.length} total contacts`);
  return all;
}

// ─────────────────────────────────────────────────────────────
// Tag classification
// ─────────────────────────────────────────────────────────────

// Old format: sent:<address-slug>
const SENT_COLON_RE = /^sent:(.+)$/i;
// Old format: viewed:<truncated-uuid-or-short>
const VIEWED_COLON_RE = /^viewed:(.+)$/i;
// New format: sent-[MKT-###], viewed-[MKT-###], alert-[MKT-###]
const SENT_NEW_RE = /^sent-([A-Z]+-[0-9]+)$/;
const VIEWED_NEW_RE = /^viewed-([A-Z]+-[0-9]+)$/;
const ALERT_NEW_RE = /^alert-([A-Z]+-[0-9]+)$/;

function classifyTags(tags) {
  const sentOld = [];
  const viewedOld = [];
  const sentNew = [];
  const viewedNew = [];
  const alertNew = [];

  for (const t of tags || []) {
    const s = String(t || '');
    let m;
    if ((m = SENT_NEW_RE.exec(s))) { sentNew.push(m[1]); continue; }
    if ((m = VIEWED_NEW_RE.exec(s))) { viewedNew.push(m[1]); continue; }
    if ((m = ALERT_NEW_RE.exec(s))) { alertNew.push(m[1]); continue; }
    if ((m = SENT_COLON_RE.exec(s))) { sentOld.push(m[1]); continue; }
    if ((m = VIEWED_COLON_RE.exec(s))) { viewedOld.push(m[1]); continue; }
  }
  return { sentOld, viewedOld, sentNew, viewedNew, alertNew };
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function main() {
  assertEnv();
  const exportDir = makeExportDir();
  console.log(`[export] writing to ${exportDir}`);

  // 1. Dump Notion deals
  await dumpNotionDeals(exportDir);

  // 2. Pull all GHL contacts
  const contacts = await pullAllContacts();

  // 3. Classify per-contact and build the three CSVs
  const engagementRows = [];
  const sentBySlug = new Map(); // slug → array of contact rows
  const viewedByIdShort = new Map(); // short id → array of contact rows
  let totalSentOld = 0;
  let totalViewedOld = 0;
  let totalSentNew = 0;
  let totalViewedNew = 0;
  let totalAlertNew = 0;

  for (const c of contacts) {
    const tags = Array.isArray(c.tags) ? c.tags : [];
    const cls = classifyTags(tags);

    const hasAny =
      cls.sentOld.length +
      cls.viewedOld.length +
      cls.sentNew.length +
      cls.viewedNew.length +
      cls.alertNew.length;
    if (hasAny === 0) continue;

    totalSentOld += cls.sentOld.length;
    totalViewedOld += cls.viewedOld.length;
    totalSentNew += cls.sentNew.length;
    totalViewedNew += cls.viewedNew.length;
    totalAlertNew += cls.alertNew.length;

    const row = {
      id: c.id || '',
      firstName: c.firstName || '',
      lastName: c.lastName || '',
      email: c.email || '',
      phone: c.phone || '',
    };

    engagementRows.push([
      row.id,
      row.firstName,
      row.lastName,
      row.email,
      row.phone,
      cls.sentOld.join(' | '),
      cls.viewedOld.join(' | '),
      cls.sentNew.join(' | '),
      cls.viewedNew.join(' | '),
      cls.alertNew.join(' | '),
    ]);

    for (const slug of cls.sentOld) {
      if (!sentBySlug.has(slug)) sentBySlug.set(slug, []);
      sentBySlug.get(slug).push(row);
    }
    for (const short of cls.viewedOld) {
      if (!viewedByIdShort.has(short)) viewedByIdShort.set(short, []);
      viewedByIdShort.get(short).push(row);
    }
  }

  // contacts-engagement.csv
  writeCsv(
    path.join(exportDir, 'contacts-engagement.csv'),
    [
      'contact_id', 'first_name', 'last_name', 'email', 'phone',
      'sent_old_slugs', 'viewed_old_short_ids',
      'sent_new_deal_ids', 'viewed_new_deal_ids', 'alert_new_deal_ids',
    ],
    engagementRows
  );

  // sent-by-slug.csv (one row per slug+contact pair)
  const sentRows = [];
  for (const [slug, list] of sentBySlug) {
    for (const c of list) {
      sentRows.push([slug, c.id, c.firstName, c.lastName, c.email, c.phone]);
    }
  }
  sentRows.sort((a, b) => a[0].localeCompare(b[0]));
  writeCsv(
    path.join(exportDir, 'sent-by-slug.csv'),
    ['deal_slug', 'contact_id', 'first_name', 'last_name', 'email', 'phone'],
    sentRows
  );

  // viewed-by-id-short.csv
  const viewedRows = [];
  for (const [short, list] of viewedByIdShort) {
    for (const c of list) {
      viewedRows.push([short, c.id, c.firstName, c.lastName, c.email, c.phone]);
    }
  }
  viewedRows.sort((a, b) => a[0].localeCompare(b[0]));
  writeCsv(
    path.join(exportDir, 'viewed-by-id-short.csv'),
    ['deal_id_short', 'contact_id', 'first_name', 'last_name', 'email', 'phone'],
    viewedRows
  );

  // summary.txt
  const summaryLines = [
    `Terms For Sale — Engagement Snapshot`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `Total contacts scanned:        ${contacts.length}`,
    `Contacts with any engagement:  ${engagementRows.length}`,
    ``,
    `── Old-format tags (pre-new-system) ──`,
    `Total sent:<slug> applications:    ${totalSentOld}`,
    `Unique deal slugs with sent tags:  ${sentBySlug.size}`,
    `Total viewed:<short> applications: ${totalViewedOld}`,
    `Unique short ids with viewed tags: ${viewedByIdShort.size}`,
    ``,
    `── New-format tags (sent-/viewed-/alert-) ──`,
    `sent-  tag applications:  ${totalSentNew}`,
    `viewed- tag applications: ${totalViewedNew}`,
    `alert- tag applications:  ${totalAlertNew}`,
    ``,
  ];
  fs.writeFileSync(path.join(exportDir, 'summary.txt'), summaryLines.join('\n'));
  console.log('\n' + summaryLines.join('\n'));

  console.log(`\n[export] complete — files in ${exportDir}`);
  console.log(`[export] to download to your laptop:`);
  console.log(`  scp -r root@64.23.204.220:${exportDir} .`);
}

main().catch((err) => {
  console.error('[export] fatal error:', err.stack || err.message);
  process.exit(1);
});
