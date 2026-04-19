#!/usr/bin/env node
/**
 * phase3-fix-match-engine.js — Pushes the toArr() fix to the live Buyer Match Engine
 * workflow on self-hosted n8n. Replaces broken `.split()` calls (which fail when GHL
 * multi-select fields return arrays) with array-aware logic.
 *
 * Reads the patched workflow JSON from the repo (must be copied in first), then:
 *   1. Deactivates workflow IxCkDTYqMi0xnCZa
 *   2. PUTs the updated body
 *   3. Reactivates
 *
 * USAGE:
 *   node scripts/phase3-fix-match-engine.js
 *
 * Requires N8N_API_TOKEN + N8N_BASE_URL in .env (already set during Phase 2).
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

if (!TOKEN) {
  console.error('FATAL: N8N_API_TOKEN not set in .env');
  process.exit(1);
}

const HEADERS = {
  'X-N8N-API-KEY': TOKEN,
  'Content-Type': 'application/json',
  'Accept': 'application/json'
};

async function api(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

function cleanForUpdate(wf) {
  return {
    name: wf.name,
    nodes: (wf.nodes || []).map(node => {
      const n = { ...node };
      if (n.credentials && typeof n.credentials === 'object') {
        const cleaned = {};
        for (const [credType, credRef] of Object.entries(n.credentials)) {
          if (credRef && credRef.name) cleaned[credType] = { name: credRef.name };
        }
        n.credentials = cleaned;
      }
      return n;
    }),
    connections: wf.connections || {},
    settings: wf.settings || {}
  };
}

(async () => {
  const wfPath = path.join(process.env.HOME, 'termsforsale-site/tfs-build/n8n/ready-to-import/01_buyer_match_engine.json');

  if (!fs.existsSync(wfPath)) {
    console.error(`FATAL: ${wfPath} not found. Did you copy the PATCHED file in?`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(wfPath, 'utf8'));

  // Sanity check the patch is actually in the file
  const filterNode = raw.nodes.find(n => n.name === 'Filter & Match Buyers');
  if (!filterNode || !filterNode.parameters || !filterNode.parameters.jsCode) {
    console.error('FATAL: Filter & Match Buyers node missing or malformed');
    process.exit(1);
  }
  if (!filterNode.parameters.jsCode.includes('toArr')) {
    console.error('FATAL: Patched file does not contain toArr — wrong file. Aborting.');
    console.error('  Re-copy the patched file from outputs/01_buyer_match_engine_PATCHED.json.');
    process.exit(1);
  }
  console.log(`✓ Patched JSON verified (toArr helper present)\n`);

  console.log(`===== Updating workflow ${WORKFLOW_ID} =====`);
  console.log(`Base: ${BASE}\n`);

  // 1. Deactivate (n8n requires inactive workflow for PUT)
  console.log(`→ Deactivate ${WORKFLOW_ID}`);
  const deact = await api('POST', `/api/v1/workflows/${WORKFLOW_ID}/deactivate`, {});
  if (!deact.ok && deact.status !== 200) {
    console.log(`  (deactivate returned ${deact.status} — may already be inactive, continuing)`);
  } else {
    console.log(`  ✓ deactivated`);
  }

  // 2. PUT updated body
  console.log(`\n→ PUT /api/v1/workflows/${WORKFLOW_ID}`);
  const body = cleanForUpdate(raw);
  const put = await api('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, body);
  if (!put.ok) {
    const msg = typeof put.data === 'string' ? put.data : JSON.stringify(put.data);
    console.log(`  ✗ ${put.status}: ${msg.slice(0, 500)}`);
    process.exit(1);
  }
  console.log(`  ✓ updated`);

  // 3. Reactivate
  console.log(`\n→ Reactivate ${WORKFLOW_ID}`);
  const act = await api('POST', `/api/v1/workflows/${WORKFLOW_ID}/activate`, {});
  if (act.ok) {
    console.log(`  ✓ activated`);
  } else {
    const msg = typeof act.data === 'string' ? act.data : JSON.stringify(act.data);
    console.log(`  ✗ ${act.status}: ${msg.slice(0, 400)}`);
    console.log(`  (you can manually reactivate in the n8n UI as a fallback)`);
  }

  console.log(`\n===== Done. Re-run dry-run to verify: =====`);
  console.log(`  node scripts/dry-run-match-engine.js`);
})();
