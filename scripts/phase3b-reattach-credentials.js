#!/usr/bin/env node
/**
 * phase3b-reattach-credentials.js — GETs the Match Engine workflow, adds the
 * real credential IDs back to every node that references by name only, PUTs it.
 *
 * Fixes: Phase 3's PUT-update stripped credential IDs (kept only names). n8n
 * auto-resolves names on POST/create but NOT on PUT/update — so after the PUT,
 * nodes showed "Credentials not found" even though credentials exist with the
 * right names.
 *
 * USAGE:
 *   node scripts/phase3b-reattach-credentials.js
 */

'use strict';
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(process.env.HOME, 'termsforsale-site/.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

const BASE = (process.env.N8N_BASE_URL || 'https://n8n.termsforsale.com').replace(/\/+$/, '');
const TOKEN = process.env.N8N_API_TOKEN;
const WORKFLOW_ID = 'IxCkDTYqMi0xnCZa';

// Credential IDs from Phase 2 output (see migration LOG)
const CRED_ID_BY_NAME = {
  'GHL Private Integration Token': 'DR2T0oJKfFcj1GFD',
  'Notion TFS Integration': 'PO68ONgNhNQdY0Gh'
};

if (!TOKEN) { console.error('FATAL: N8N_API_TOKEN not set'); process.exit(1); }

const HEADERS = {
  'X-N8N-API-KEY': TOKEN,
  'Content-Type': 'application/json',
  'Accept': 'application/json'
};

async function api(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method, headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

(async () => {
  console.log(`===== Reattach credentials on ${WORKFLOW_ID} =====`);
  console.log(`Base: ${BASE}\n`);

  // 1. Fetch current workflow
  console.log(`→ GET workflow`);
  const cur = await api('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
  if (!cur.ok) {
    console.log(`  ✗ ${cur.status}: ${JSON.stringify(cur.data).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`  ✓ fetched "${cur.data.name}" (${cur.data.nodes.length} nodes)`);

  // 2. Walk nodes, add IDs where missing
  let patchedCount = 0;
  const missing = [];
  for (const node of cur.data.nodes) {
    if (!node.credentials || typeof node.credentials !== 'object') continue;
    for (const [credType, credRef] of Object.entries(node.credentials)) {
      if (!credRef || !credRef.name) continue;
      const expectedId = CRED_ID_BY_NAME[credRef.name];
      if (!expectedId) {
        missing.push(`${node.name} → ${credRef.name}`);
        continue;
      }
      if (credRef.id !== expectedId) {
        credRef.id = expectedId;
        patchedCount++;
      }
    }
  }
  console.log(`\n  ✓ reattached IDs on ${patchedCount} node/credential pairs`);
  if (missing.length) {
    console.log(`  ⚠ unrecognized credential names (not reattached):`);
    missing.forEach(m => console.log(`    - ${m}`));
  }

  // 3. Build PUT body — same shape n8n accepts
  const body = {
    name: cur.data.name,
    nodes: cur.data.nodes,
    connections: cur.data.connections,
    settings: cur.data.settings || {}
  };

  // 4. Deactivate → PUT → reactivate
  console.log(`\n→ Deactivate`);
  await api('POST', `/api/v1/workflows/${WORKFLOW_ID}/deactivate`, {});
  console.log(`  ✓ (or already inactive)`);

  console.log(`\n→ PUT updated body`);
  const put = await api('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, body);
  if (!put.ok) {
    console.log(`  ✗ ${put.status}: ${JSON.stringify(put.data).slice(0, 500)}`);
    process.exit(1);
  }
  console.log(`  ✓ updated`);

  console.log(`\n→ Reactivate`);
  const act = await api('POST', `/api/v1/workflows/${WORKFLOW_ID}/activate`, {});
  console.log(act.ok ? `  ✓ activated` : `  ✗ activate failed ${act.status}`);

  console.log(`\n===== Done. Re-run dry-run: =====`);
  console.log(`  node scripts/dry-run-match-engine.js`);
})();
