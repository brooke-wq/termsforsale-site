#!/usr/bin/env node
/**
 * phase3c-push-full.js — Pushes fully-credentialed workflow JSONs to the live
 * self-hosted n8n. Replaces phase3-fix and phase3b-reattach (kept for audit).
 *
 * Fixes that were in the source files from the start:
 *   - 6 GHL HTTP nodes in the Match Engine had credentials=null (A/B/C tier branches).
 *     They would have failed every execution that actually sent a deal.
 *   - 1 GHL HTTP node in Helper Increment (`GHL: Write Back`) had credentials=null.
 *     WF03 would have failed on first close-a-deal.
 *   - 3 nodes (match engine, notion bridge × 2, helper) had placeholder credential
 *     IDs that were never replaced with the real IDs after phase2 POST.
 *
 * Preserves credential IDs on PUT (unlike phase3-fix which stripped them).
 *
 * USAGE:
 *   node scripts/phase3c-push-full.js
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

function toPutBody(wf) {
  // n8n PUT accepts name/nodes/connections/settings. Preserve credentials AS-IS
  // (including IDs) — do not strip them, unlike phase3-fix did.
  return {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings || {}
  };
}

async function pushWorkflow(id, filePath, label) {
  console.log(`\n───── ${label} (${id}) ─────`);
  if (!fs.existsSync(filePath)) {
    console.log(`  ✗ source file missing: ${filePath}`);
    return false;
  }

  const wf = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log(`  loaded "${wf.name}" — ${wf.nodes.length} nodes`);

  // Sanity: count credentials to confirm we're pushing the FULL (fixed) version
  const credRefs = wf.nodes.filter(n => n.credentials && Object.keys(n.credentials).length > 0).length;
  console.log(`  credentials attached on ${credRefs} nodes`);

  console.log(`  → deactivate`);
  await api('POST', `/api/v1/workflows/${id}/deactivate`, {});

  console.log(`  → PUT updated body`);
  const put = await api('PUT', `/api/v1/workflows/${id}`, toPutBody(wf));
  if (!put.ok) {
    const msg = typeof put.data === 'string' ? put.data : JSON.stringify(put.data);
    console.log(`    ✗ ${put.status}: ${msg.slice(0, 500)}`);
    return false;
  }
  console.log(`    ✓ updated`);

  console.log(`  → reactivate`);
  const act = await api('POST', `/api/v1/workflows/${id}/activate`, {});
  if (act.ok) console.log(`    ✓ activated`);
  else console.log(`    ✗ activate failed ${act.status}: ${JSON.stringify(act.data).slice(0, 300)}`);

  return put.ok && act.ok;
}

(async () => {
  console.log(`===== Phase 3c — Push full-credential workflows =====`);
  console.log(`Base: ${BASE}`);

  const repoBase = path.join(process.env.HOME, 'termsforsale-site/tfs-build/n8n/ready-to-import');
  const results = [];

  results.push(['Buyer Match Engine',    await pushWorkflow(
    'IxCkDTYqMi0xnCZa',
    path.join(repoBase, '01_buyer_match_engine.json'),
    'TFS — Buyer Match Engine'
  )]);

  results.push(['Notion Deal Inventory Bridge', await pushWorkflow(
    'Dj7d90y3ZhuyRtjy',
    path.join(repoBase, '02_notion_bridge.json'),
    'TFS — Notion Deal Inventory Bridge'
  )]);

  results.push(['Helper Deal Counter Math', await pushWorkflow(
    '9LKLxBK24q5rikyt',
    path.join(repoBase, '03_helper_increment.json'),
    'TFS — Helper: Deal Counter Math'
  )]);

  console.log(`\n===== Summary =====`);
  for (const [name, ok] of results) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }
  console.log(`\nRe-run dry-run:  node scripts/dry-run-match-engine.js`);
})();
