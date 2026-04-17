#!/usr/bin/env node
/**
 * TFS Buyer Lifecycle — GHL Provisioner (Phase 2)
 *
 * Creates in the Terms For Sale GHL sub-account, in order:
 *   1. "Buyer Profile" custom-field folder
 *   2. 21 custom fields from tfs-build/ghl/01_custom_fields.json
 *   3. 5 additional "latest deal" fields from WF02 JSON
 *   4. 9 tags from tfs-build/ghl/02_tags.json
 *   5. "Buyer Lifecycle" pipeline with 12 stages from tfs-build/ghl/03_pipeline.json
 *
 * Idempotent: every resource is GET-first, skip-if-exists. Safe to re-run.
 * Saves generated IDs to:
 *   - tfs-build/ghl/01_custom_fields_IDS.json
 *   - tfs-build/ghl/02_tags_IDS.json
 *   - tfs-build/ghl/03_pipeline_IDS.json
 *
 * USAGE (from repo root):
 *   node scripts/provision-ghl.js                # live run
 *   DRY_RUN=1 node scripts/provision-ghl.js      # preview only (no POSTs)
 *
 * ENV (from .env):
 *   GHL_API_TOKEN      Private Integration Token (pit-...)
 *   GHL_LOCATION_ID    TFS sub-account location id
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------- env ----------
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

const TOKEN = process.env.GHL_API_TOKEN;
const LOCATION_ID = process.env.GHL_LOCATION_ID;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

if (!TOKEN || !LOCATION_ID) {
  console.error('FATAL: GHL_API_TOKEN and GHL_LOCATION_ID must be set (via .env or shell)');
  process.exit(1);
}

const BASE = 'https://services.leadconnectorhq.com';
const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Version': '2021-07-28',
  'Accept': 'application/json',
  'Content-Type': 'application/json'
};

// ---------- io helpers ----------
const ROOT = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const write = (p, obj) => fs.writeFileSync(path.join(ROOT, p), JSON.stringify(obj, null, 2) + '\n');

// ---------- api wrapper ----------
async function api(method, url, body) {
  const fullUrl = url.startsWith('http') ? url : `${BASE}${url}`;
  if (DRY_RUN && method !== 'GET') {
    console.log(`  [DRY] ${method} ${url}${body ? ` body=${JSON.stringify(body).slice(0, 120)}` : ''}`);
    return { __dry: true };
  }
  const res = await fetch(fullUrl, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${method} ${url} → HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// ---------- field type mapping ----------
// Our JSON "type" string → GHL API dataType
const TYPE_MAP = {
  'Text': 'TEXT',
  'Text (long)': 'LARGE_TEXT',
  'Number': 'NUMERICAL',
  'Monetary': 'MONETORY', // GHL spells it this way
  'Date': 'DATE',
  'Checkbox': 'CHECKBOX',
  'Dropdown (single)': 'SINGLE_OPTIONS',
  'Multi-select': 'MULTIPLE_OPTIONS'
};

function mapType(t) {
  const v = TYPE_MAP[t];
  if (!v) throw new Error(`Unknown field type: ${t}`);
  return v;
}

// ---------- STEP 1: field folder ----------
// GHL v2 public API doesn't support folder creation — folders are UI-only.
// Fields land at the root of the Custom Fields list. User can drag them into
// a "Buyer Profile" group in GHL UI after provisioning for visual tidiness.
async function ensureFieldFolder(name) {
  console.log(`\n[1/5] Field folder: "${name}"  — SKIPPED (GHL API does not support folder creation)`);
  console.log(`       Fields will be created at the root level.`);
  console.log(`       After provisioning, manually group them in GHL UI if desired:`);
  console.log(`         Settings → Custom Fields → Contacts → drag fields into a new "Buyer Profile" folder`);
  return null;
}

// ---------- STEP 2/3: custom fields ----------
async function listExistingFields() {
  const r = await api('GET', `/locations/${LOCATION_ID}/customFields?model=contact`);
  return r.customFields || r.fields || r.data || [];
}

function buildFieldPayload(fieldSpec, folderId) {
  const payload = {
    name: fieldSpec.name,
    dataType: mapType(fieldSpec.type),
    locationId: LOCATION_ID,
    model: 'contact',
    position: 0,
    placeholder: ''
  };
  if (folderId) payload.parentId = folderId;
  if (fieldSpec.options && fieldSpec.options.length) {
    payload.options = fieldSpec.options.map((o, i) => ({
      key: String(o).toLowerCase().replace(/\s+/g, '_'),
      label: String(o),
      position: i
    }));
  }
  return payload;
}

async function upsertField(spec, folderId, existingByName) {
  const key = spec.name.toLowerCase().trim();
  const existing = existingByName.get(key);
  if (existing) {
    console.log(`  ✓ ${spec.name.padEnd(30)} exists id=${existing.id}`);
    return { name: spec.name, id: existing.id, type: spec.type, fieldKey: existing.fieldKey || spec.field_key, existed: true };
  }
  const body = buildFieldPayload(spec, folderId);
  try {
    const r = await api('POST', `/locations/${LOCATION_ID}/customFields`, body);
    const id = r.id || (r.customField && r.customField.id) || (r.field && r.field.id);
    const fieldKey = r.fieldKey || (r.customField && r.customField.fieldKey) || spec.field_key;
    console.log(`  + ${spec.name.padEnd(30)} created id=${id || '(dry)'}`);
    return { name: spec.name, id, type: spec.type, fieldKey, created: true };
  } catch (e) {
    console.log(`  ✗ ${spec.name.padEnd(30)} FAILED ${e.status}: ${JSON.stringify(e.body).slice(0, 160)}`);
    return { name: spec.name, error: String(e.body && e.body.message || e.message), type: spec.type };
  }
}

async function provisionFields() {
  const folderId = await ensureFieldFolder('Buyer Profile');

  console.log(`\n[2/5] Custom fields: 21 profile + 5 "latest deal" = 26 total`);
  const profile = read('tfs-build/ghl/01_custom_fields.json').fields;
  const wf02 = read('tfs-build/ghl/WF02_deal_match_send.json').additional_custom_fields_required_for_wf02
    .map(f => ({ name: f.name, field_key: f.field_key, type: f.type }));

  const all = [...profile, ...wf02];
  const existing = await listExistingFields();
  const existingByName = new Map(existing.map(f => [(f.name || '').toLowerCase().trim(), f]));

  const results = [];
  for (const spec of all) {
    const r = await upsertField(spec, folderId, existingByName);
    results.push(r);
  }

  const out = {
    generated_at: new Date().toISOString(),
    location_id: LOCATION_ID,
    folder: { name: 'Buyer Profile', id: folderId },
    fields: results
  };
  write('tfs-build/ghl/01_custom_fields_IDS.json', out);
  console.log(`\n  wrote tfs-build/ghl/01_custom_fields_IDS.json (${results.length} fields)`);
  return out;
}

// ---------- STEP 4: tags ----------
async function listExistingTags() {
  const r = await api('GET', `/locations/${LOCATION_ID}/tags`);
  return r.tags || r.data || [];
}

async function provisionTags() {
  console.log(`\n[3/5] Tags`);
  const tagsSpec = read('tfs-build/ghl/02_tags.json').tags;
  const existing = await listExistingTags();
  const existingByName = new Map(existing.map(t => [(t.name || '').toLowerCase().trim(), t]));

  const results = [];
  for (const t of tagsSpec) {
    const key = t.name.toLowerCase().trim();
    const ex = existingByName.get(key);
    if (ex) {
      console.log(`  ✓ ${t.name.padEnd(22)} exists id=${ex.id}`);
      results.push({ name: t.name, id: ex.id, existed: true });
      continue;
    }
    try {
      const r = await api('POST', `/locations/${LOCATION_ID}/tags`, { name: t.name, locationId: LOCATION_ID });
      const id = r.id || (r.tag && r.tag.id);
      console.log(`  + ${t.name.padEnd(22)} created id=${id || '(dry)'}`);
      results.push({ name: t.name, id, created: true });
    } catch (e) {
      console.log(`  ✗ ${t.name.padEnd(22)} FAILED ${e.status}: ${JSON.stringify(e.body).slice(0, 160)}`);
      results.push({ name: t.name, error: String(e.body && e.body.message || e.message) });
    }
  }

  const out = { generated_at: new Date().toISOString(), location_id: LOCATION_ID, tags: results };
  write('tfs-build/ghl/02_tags_IDS.json', out);
  console.log(`\n  wrote tfs-build/ghl/02_tags_IDS.json (${results.length} tags)`);
  return out;
}

// ---------- STEP 5: pipeline ----------
async function provisionPipeline() {
  console.log(`\n[4/5] Pipeline: Buyer Lifecycle (12 stages)`);
  const spec = read('tfs-build/ghl/03_pipeline.json');

  const list = await api('GET', `/opportunities/pipelines?locationId=${LOCATION_ID}`);
  const pipelines = list.pipelines || list.data || [];
  const existing = pipelines.find(p => (p.name || '').toLowerCase() === spec.pipeline_name.toLowerCase());

  const stagesPayload = spec.stages.map((s, i) => ({
    name: s.name,
    position: i + 1,
    showInFunnel: true,
    showInPieChart: true
  }));

  let pipelineObj;
  if (existing) {
    console.log(`  ✓ pipeline exists id=${existing.id} — checking stage coverage…`);
    const existingStageNames = new Set((existing.stages || []).map(s => (s.name || '').toLowerCase()));
    const missing = spec.stages.filter(s => !existingStageNames.has(s.name.toLowerCase()));
    if (missing.length) {
      console.log(`  ! ${missing.length} stage(s) missing: ${missing.map(s => s.name).join(', ')}`);
      console.log(`    (pipeline update not attempted — add manually in GHL UI or delete + re-run)`);
    } else {
      console.log(`  ✓ all 12 stages present`);
    }
    pipelineObj = existing;
  } else {
    const body = {
      name: spec.pipeline_name,
      locationId: LOCATION_ID,
      stages: stagesPayload
    };
    try {
      const r = await api('POST', `/opportunities/pipelines`, body);
      pipelineObj = r.pipeline || r;
      console.log(`  + created pipeline id=${pipelineObj.id || '(dry)'}`);
    } catch (e) {
      console.log(`  ✗ pipeline create FAILED ${e.status}: ${JSON.stringify(e.body).slice(0, 240)}`);
      pipelineObj = { error: String(e.body && e.body.message || e.message) };
    }
  }

  const stages = (pipelineObj.stages || stagesPayload).map((s, i) => ({
    name: s.name,
    id: s.id || null,
    position: s.position != null ? s.position : i + 1,
    color_in_spec: spec.stages[i] && spec.stages[i].color || null,
    trigger_event_in_spec: spec.stages[i] && spec.stages[i].trigger_event || null
  }));

  const out = {
    generated_at: new Date().toISOString(),
    location_id: LOCATION_ID,
    pipeline: { name: spec.pipeline_name, id: pipelineObj.id || null },
    stages
  };
  write('tfs-build/ghl/03_pipeline_IDS.json', out);
  console.log(`\n  wrote tfs-build/ghl/03_pipeline_IDS.json (${stages.length} stages)`);
  return out;
}

// ---------- main ----------
(async () => {
  console.log(`===== GHL Provisioner — Terms For Sale =====`);
  console.log(`Location: ${LOCATION_ID}`);
  console.log(`Dry run:  ${DRY_RUN ? 'YES (no POSTs)' : 'no'}`);

  try {
    // preflight
    const loc = await api('GET', `/locations/${LOCATION_ID}`);
    const name = loc.location && loc.location.name;
    console.log(`  ✓ auth OK — location: ${name || '(name not returned)'}`);
  } catch (e) {
    console.error(`\nFATAL: GHL auth failed (${e.status}): ${JSON.stringify(e.body).slice(0, 240)}`);
    process.exit(1);
  }

  try {
    const fields = await provisionFields();
    const tags = await provisionTags();
    const pipeline = await provisionPipeline();

    console.log(`\n[5/5] Summary`);
    console.log(`  fields:   ${fields.fields.filter(f => f.id).length}/${fields.fields.length} provisioned`);
    console.log(`  tags:     ${tags.tags.filter(t => t.id).length}/${tags.tags.length} provisioned`);
    console.log(`  pipeline: ${pipeline.pipeline.id ? 'OK' : 'FAILED'} (id=${pipeline.pipeline.id || 'n/a'})`);

    const failed = [
      ...fields.fields.filter(f => f.error).map(f => `field:${f.name}`),
      ...tags.tags.filter(t => t.error).map(t => `tag:${t.name}`)
    ];
    if (failed.length) {
      console.log(`\n  ${failed.length} item(s) FAILED:`);
      for (const f of failed) console.log(`    - ${f}`);
      console.log(`  → check tfs-build/ghl/*_IDS.json for error details`);
      process.exit(2);
    }

    console.log(`\n✓ Phase 2 (GHL foundation) complete. Commit the *_IDS.json files.`);
  } catch (e) {
    console.error(`\nFATAL:`, e.message);
    if (e.body) console.error('body:', JSON.stringify(e.body).slice(0, 500));
    process.exit(1);
  }
})();
