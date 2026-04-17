#!/usr/bin/env node
/**
 * TFS Buyer Lifecycle — Notion DB Schema Patch (Phase 3 prep)
 *
 * The existing TFS Deals Notion DB (env NOTION_DEAL_INVENTORY_DB_ID) was
 * built for the live site and doesn't have every property the n8n bridge
 * (tfs-build/n8n/02_notion_bridge.json) expects.
 *
 * This script PATCHes the DB to add ONLY the missing properties — it never
 * renames, removes, or changes existing ones. Safe to run against the live
 * deals DB.
 *
 * Target schema (from 02_notion_bridge.json.meta.notion_database_required_fields):
 *
 *   ADDED (if missing):
 *     - Blasted             checkbox                      — bridge dedup flag
 *     - Blasted At          date                          — audit timestamp
 *     - Asset Class         multi_select (8 options)      — SFR / MFR / Commercial / Land / etc.
 *     - Market              rich_text                     — "Phoenix AZ" format
 *     - Summary URL         url                           — link to deal package
 *
 *   ADDED OPTION (if missing): a "Ready to Blast" option on the existing "Deal Status" (or "Status") select
 *
 *   MAPPED from existing (no change):
 *     - Deal Type    existing select         → used as `Deal Type`
 *     - Asking Price existing number         → used as `Price`
 *     - Website Link existing url            → used as `Summary URL` (if Summary URL doesn't exist, the bridge is patched to read Website Link)
 *     - Street Address existing rich_text    → used as `Address`
 *
 * USAGE:
 *   node scripts/provision-notion-db.js               # live patch
 *   DRY_RUN=1 node scripts/provision-notion-db.js     # preview
 *
 * ENV:
 *   NOTION_SECRET                integration secret (ntn_... or secret_...)
 *   NOTION_DEAL_INVENTORY_DB_ID  32-char DB id
 */

'use strict';

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

const SECRET = process.env.NOTION_SECRET;
const DB_ID = process.env.NOTION_DEAL_INVENTORY_DB_ID;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

if (!SECRET) {
  console.error('FATAL: NOTION_SECRET not set. This is your integration secret starting ntn_ or secret_.');
  console.error('Get it from notion.so/my-integrations → + New integration → "TFS n8n Bridge"');
  console.error('Then share the DB with the integration: open DB in Notion → ••• → Connections → Add → TFS n8n Bridge');
  process.exit(1);
}
if (!DB_ID) {
  console.error('FATAL: NOTION_DEAL_INVENTORY_DB_ID not set.');
  process.exit(1);
}

const HEADERS = {
  'Authorization': `Bearer ${SECRET}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json'
};
const BASE = 'https://api.notion.com/v1';

async function notion(method, url, body) {
  if (DRY_RUN && method !== 'GET') {
    console.log(`  [DRY] ${method} ${url}`);
    return { __dry: true };
  }
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const err = new Error(`${method} ${url} → HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// ---------- target properties to ensure ----------
const ASSET_CLASS_OPTIONS = [
  { name: 'SFR', color: 'blue' },
  { name: 'MFR 2-4', color: 'purple' },
  { name: 'MFR 5+', color: 'pink' },
  { name: 'Commercial', color: 'orange' },
  { name: 'Land', color: 'green' },
  { name: 'Mixed-Use', color: 'yellow' },
  { name: 'NNN', color: 'gray' },
  { name: 'Mobile Home Park', color: 'brown' }
];

const TARGET_PROPS = {
  'Blasted':      { checkbox: {} },
  'Blasted At':   { date: {} },
  'Asset Class':  { multi_select: { options: ASSET_CLASS_OPTIONS } },
  'Market':       { rich_text: {} },
  'Summary URL':  { url: {} }
};

// ---------- main ----------
(async () => {
  console.log(`===== Notion DB Provisioner =====`);
  console.log(`DB:      ${DB_ID}`);
  console.log(`Dry run: ${DRY_RUN ? 'YES' : 'no'}`);

  let db;
  try {
    db = await notion('GET', `/databases/${DB_ID}`);
    const title = (db.title && db.title[0] && db.title[0].plain_text) || '(no title)';
    console.log(`  ✓ DB auth OK — title: "${title}"`);
  } catch (e) {
    console.error(`\nFATAL: Notion DB GET failed (${e.status}): ${JSON.stringify(e.body).slice(0, 240)}`);
    if (e.status === 404) {
      console.error(`DB not shared with the integration. In Notion: open DB → ••• menu → Connections → Add → select your integration.`);
    }
    process.exit(1);
  }

  const existing = db.properties || {};
  const existingNames = new Set(Object.keys(existing));

  // Resolve status property: look for "Deal Status" first, then "Status"
  const statusKey = ['Deal Status', 'Status'].find(k => existing[k]);
  const statusProp = statusKey ? existing[statusKey] : null;
  const statusType = statusProp && statusProp.type; // 'status' or 'select'

  // Build PATCH body — only add missing properties
  const propertiesPatch = {};
  const plan = [];
  for (const [name, shape] of Object.entries(TARGET_PROPS)) {
    if (existingNames.has(name)) {
      plan.push({ name, action: 'skip-exists' });
      continue;
    }
    propertiesPatch[name] = shape;
    plan.push({ name, action: 'create', shape });
  }

  // Ensure "Ready to Blast" option exists on status property
  let statusPatch = null;
  if (statusKey && statusProp) {
    const opts = (statusProp[statusType] && statusProp[statusType].options) || [];
    const hasReady = opts.some(o => (o.name || '').toLowerCase() === 'ready to blast');
    if (!hasReady) {
      if (statusType === 'status') {
        plan.push({ name: `${statusKey} option "Ready to Blast"`, action: 'cannot-patch-status-type',
          note: 'Notion "status" properties cannot have options added via API. Add manually in Notion UI, or change property type to Select.' });
      } else if (statusType === 'select') {
        statusPatch = {
          [statusKey]: {
            select: { options: [...opts, { name: 'Ready to Blast', color: 'green' }] }
          }
        };
        plan.push({ name: `${statusKey} option "Ready to Blast"`, action: 'add-select-option' });
      }
    } else {
      plan.push({ name: `${statusKey} option "Ready to Blast"`, action: 'skip-exists' });
    }
  } else {
    plan.push({ name: 'Deal Status / Status property', action: 'missing', note: 'no status property found — bridge filter will fail until one exists' });
  }

  console.log(`\nPlan:`);
  for (const p of plan) {
    const tag = p.action === 'skip-exists' ? '✓'
              : p.action === 'create' ? '+'
              : p.action === 'add-select-option' ? '+'
              : '!';
    console.log(`  ${tag} ${p.name}  — ${p.action}${p.note ? '  ('+p.note+')' : ''}`);
  }

  // Execute patches
  const patches = [];
  if (Object.keys(propertiesPatch).length) patches.push({ properties: propertiesPatch });
  if (statusPatch) patches.push({ properties: statusPatch });

  for (const body of patches) {
    try {
      await notion('PATCH', `/databases/${DB_ID}`, body);
      console.log(`  ✓ PATCH ${Object.keys(body.properties).join(', ')}`);
    } catch (e) {
      console.log(`  ✗ PATCH failed ${e.status}: ${JSON.stringify(e.body).slice(0, 300)}`);
    }
  }

  // Re-fetch to confirm
  if (!DRY_RUN) {
    const after = await notion('GET', `/databases/${DB_ID}`);
    const afterNames = new Set(Object.keys(after.properties || {}));
    const missing = Object.keys(TARGET_PROPS).filter(n => !afterNames.has(n));
    if (missing.length) {
      console.log(`\n  WARNING: still missing after patch: ${missing.join(', ')}`);
      process.exit(2);
    }
  }

  // Detect title property (Notion requires exactly one title)
  const titleProp = Object.entries(existing).find(([_, p]) => p.type === 'title');
  const recs = {
    generated_at: new Date().toISOString(),
    db_id: DB_ID,
    title_property: titleProp ? titleProp[0] : null,
    status_property: statusKey,
    status_property_type: statusType,
    mapped: {
      'Deal ID / title':   titleProp ? titleProp[0] : '(MISSING)',
      'Status':            statusKey || '(MISSING — create a Status or Select property with "Ready to Blast" option)',
      'Blasted':           'Blasted',
      'Blasted At':        'Blasted At',
      'Asset Class':       'Asset Class',
      'Market':            'Market',
      'Price':             existingNames.has('Asking Price') ? 'Asking Price (existing)' : existingNames.has('Price') ? 'Price (existing)' : '(ADD MANUALLY — number property)',
      'Deal Type':         existingNames.has('Deal Type') ? 'Deal Type (existing)' : '(ADD MANUALLY — select property)',
      'Summary URL':       existingNames.has('Summary URL') ? 'Summary URL (just created)' : 'Summary URL',
      'Address':           existingNames.has('Street Address') ? 'Street Address (existing — patch bridge to read this)' :
                           existingNames.has('Address') ? 'Address (existing)' : '(ADD MANUALLY — rich_text property)'
    },
    bridge_patches_needed: []
  };

  // Flag bridge JSON changes needed
  if (existingNames.has('Asking Price') && !existingNames.has('Price')) {
    recs.bridge_patches_needed.push(`Rename "Price" → "Asking Price" in n8n/02_notion_bridge.json transform code`);
  }
  if (existingNames.has('Website Link') && !existingNames.has('Summary URL')) {
    // Summary URL was just added so it DOES exist now; this branch won't usually hit
    recs.bridge_patches_needed.push(`Bridge can read either — no patch needed since Summary URL was just created`);
  }
  if (existingNames.has('Street Address') && !existingNames.has('Address')) {
    recs.bridge_patches_needed.push(`Rename "Address" → "Street Address" in n8n/02_notion_bridge.json transform code`);
  }

  const outPath = path.join(__dirname, '..', 'tfs-build', 'n8n', 'NOTION_DB_MAPPING.json');
  fs.writeFileSync(outPath, JSON.stringify(recs, null, 2) + '\n');
  console.log(`\n  wrote tfs-build/n8n/NOTION_DB_MAPPING.json`);

  if (recs.bridge_patches_needed.length) {
    console.log(`\n  NEXT: the n8n bridge JSON needs these edits before import:`);
    for (const p of recs.bridge_patches_needed) console.log(`    - ${p}`);
  } else {
    console.log(`\n✓ Phase 3-prep (Notion schema) complete.`);
  }
})().catch(e => {
  console.error('\nFATAL:', e.message);
  if (e.body) console.error('body:', JSON.stringify(e.body).slice(0, 500));
  process.exit(1);
});
