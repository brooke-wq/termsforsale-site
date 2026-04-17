#!/usr/bin/env node
/**
 * TFS Buyer Lifecycle — n8n Manual Import Prep (Free-tier workaround)
 *
 * n8n Cloud's public REST API at /api/v1/ is a paid-plan feature. On Free
 * trial, you can't create workflows via script. This prep step renders all
 * 3 workflows with env values already baked in so you can import them
 * through the n8n UI with zero setup.
 *
 * What it does:
 *   1. Loads the 3 workflow JSONs from tfs-build/n8n/
 *   2. Inlines {{$env.GHL_LOCATION_ID}} and {{$env.NOTION_DEAL_INVENTORY_DB_ID}}
 *      with real values from .env
 *   3. Strips the `meta` field (not allowed in import payload)
 *   4. Patches the match engine's FIELD_IDS block using the real GHL
 *      custom field IDs from tfs-build/ghl/01_custom_fields_IDS.json
 *   5. Writes ready-to-import files to tfs-build/n8n/ready-to-import/*.json
 *
 * USAGE:
 *   node scripts/prepare-n8n-manual-import.js
 *
 * Then follow tfs-build/n8n/MANUAL_IMPORT_GUIDE.md to import via n8n UI.
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

const ROOT = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const write = (p, obj) => {
  const full = path.join(ROOT, p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(obj, null, 2) + '\n');
};

const GHL_LOC  = process.env.GHL_LOCATION_ID || '';
const N_DB_ID  = process.env.NOTION_DEAL_INVENTORY_DB_ID || '';
const N_BASE   = (process.env.N8N_BASE_URL || 'https://YOUR_N8N_INSTANCE').replace(/\/+$/, '');

if (!GHL_LOC) { console.error('FATAL: GHL_LOCATION_ID must be set in .env'); process.exit(1); }

// ---------- helpers ----------
function inlineEnv(wf) {
  const clone = JSON.parse(JSON.stringify(wf));
  const json = JSON.stringify(clone)
    .replace(/\{\{\s*\$env\.GHL_LOCATION_ID\s*\}\}/g, GHL_LOC)
    .replace(/\{\{\s*\$env\.NOTION_DEAL_INVENTORY_DB_ID\s*\}\}/g, N_DB_ID)
    // match-engine posts to its own webhook URL; if the bridge was built
    // with the old self-host URL, rewrite to the user's n8n cloud base:
    .replace(/https:\/\/n8n\.dealpros\.io/g, N_BASE);
  return JSON.parse(json);
}

function scrub(wf) {
  delete wf.id;
  delete wf.versionId;
  delete wf.createdAt;
  delete wf.updatedAt;
  delete wf.tags;
  delete wf.active;
  delete wf.triggerCount;
  delete wf.staticData;
  delete wf.pinData;
  delete wf.meta;
  wf.settings = wf.settings || { executionOrder: 'v1', timezone: 'America/Phoenix' };
  return wf;
}

// ---------- match-engine field-id patch ----------
function patchMatchEngine(wf) {
  const idsPath = 'tfs-build/ghl/01_custom_fields_IDS.json';
  if (!fs.existsSync(path.join(ROOT, idsPath))) {
    console.log('  (no field IDs file — run provision-ghl.js first; match engine will use name-match fallback only)');
    return wf;
  }
  const ids = read(idsPath);
  const idByName = {};
  for (const f of ids.fields) if (f.id) idByName[f.name] = f.id;

  const matchNode = wf.nodes.find(n => n.name === 'Filter & Match Buyers');
  if (!matchNode) return wf;

  const preamble =
    `// --- auto-generated field ID preamble (${new Date().toISOString()}) ---\n` +
    `const FIELD_IDS = ${JSON.stringify(idByName, null, 2)};\n` +
    `const getFieldById = (buyer, nameKey) => {\n` +
    `  const id = FIELD_IDS[nameKey];\n` +
    `  if (!id) return null;\n` +
    `  const m = (buyer.customFields || []).find(f => f.id === id);\n` +
    `  return m ? m.value : null;\n` +
    `};\n`;

  const original = matchNode.parameters.jsCode;
  const rewritten = original.replace(
    /const getField = \(name\) => \{[\s\S]*?\};/,
    `const getField = (name) => {\n    const byId = getFieldById(buyer, name);\n    if (byId !== null && byId !== undefined) return byId;\n    const match = (buyer.customFields || []).find(f => f.name === name || f.fieldKey === name);\n    return match ? match.value : null;\n  };`
  );
  matchNode.parameters.jsCode = preamble + '\n' + rewritten;
  console.log(`  patched match engine with ${Object.keys(idByName).length} field ID lookups`);
  return wf;
}

// ---------- main ----------
const workflows = [
  { src: 'tfs-build/n8n/01_buyer_match_engine.json', dest: 'tfs-build/n8n/ready-to-import/01_buyer_match_engine.json', patch: patchMatchEngine },
  { src: 'tfs-build/n8n/02_notion_bridge.json',     dest: 'tfs-build/n8n/ready-to-import/02_notion_bridge.json' },
  { src: 'tfs-build/n8n/03_helper_increment.json',  dest: 'tfs-build/n8n/ready-to-import/03_helper_increment.json' }
];

console.log(`===== n8n Manual Import Prep =====`);
console.log(`GHL location:     ${GHL_LOC}`);
console.log(`Notion DB:        ${N_DB_ID || '(missing — bridge will not work)'}`);
console.log(`n8n base URL:     ${N_BASE}`);

for (const { src, dest, patch } of workflows) {
  console.log(`\n→ ${src}`);
  let wf = read(src);
  wf = scrub(wf);
  wf = inlineEnv(wf);
  if (patch) wf = patch(wf);
  write(dest, wf);
  console.log(`  wrote ${dest}`);
}

console.log(`\n✓ Ready-to-import workflow files are in tfs-build/n8n/ready-to-import/`);
console.log(`  Next: follow tfs-build/n8n/MANUAL_IMPORT_GUIDE.md`);
