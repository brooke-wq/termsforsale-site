#!/usr/bin/env node
/**
 * TFS Buyer Lifecycle — Match Engine Dry Run (Phase 4)
 *
 * Fires a test deal payload at the n8n webhook, then queries the n8n
 * executions endpoint to confirm the run. Reports node-level success/fail.
 *
 * USAGE (from repo root):
 *   node scripts/dry-run-match-engine.js
 *
 * ENV (from .env):
 *   N8N_BASE_URL
 *   N8N_API_TOKEN
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

const N8N_BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const N8N_TOKEN = process.env.N8N_API_TOKEN;

if (!N8N_BASE || !N8N_TOKEN) {
  console.error('FATAL: N8N_BASE_URL and N8N_API_TOKEN required');
  process.exit(1);
}

const HEADERS = { 'X-N8N-API-KEY': N8N_TOKEN, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const DEAL = {
  deal_id: `test-dryrun-${Date.now()}`,
  source: 'manual',
  asset_class: 'SFR',
  market: 'Phoenix AZ',
  price: 200000,
  deal_type: 'Wholesale',
  summary_url: 'https://example.com/dryrun',
  address: '123 Test St, Phoenix AZ'
};

(async () => {
  console.log(`===== Match Engine Dry Run =====`);
  console.log(`Base:    ${N8N_BASE}`);
  console.log(`Payload: ${JSON.stringify(DEAL)}`);

  // 1) Verify webhook endpoint exists (HEAD or GET would return 405; POST below is the real test)
  const webhookUrl = `${N8N_BASE}/webhook/new-deal-inventory`;

  // 2) Fire
  console.log(`\n[1] POST ${webhookUrl}`);
  const t0 = Date.now();
  let res, text;
  try {
    res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DEAL)
    });
    text = await res.text();
  } catch (e) {
    console.error(`  ✗ network error: ${e.message}`);
    process.exit(1);
  }
  const elapsed = Date.now() - t0;
  console.log(`  → HTTP ${res.status} (${elapsed} ms)  body=${text.slice(0, 200)}`);
  if (!res.ok) {
    console.error(`\n  ✗ webhook returned non-2xx. Is the workflow active in n8n?`);
    process.exit(1);
  }

  // 3) Fetch recent execution (requires n8n Starter+ plan — skip gracefully on Free)
  console.log(`\n[2] GET /api/v1/executions?limit=5`);
  await new Promise(r => setTimeout(r, 1500)); // let n8n persist
  let execRes, execText;
  try {
    execRes = await fetch(`${N8N_BASE}/api/v1/executions?limit=5`, { headers: HEADERS });
    execText = await execRes.text();
  } catch (e) {
    console.log(`  network error: ${e.message} — skipping execution detail check`);
    console.log(`\n✓ webhook fired OK. Check n8n UI → your workflow → "Executions" tab.`);
    process.exit(0);
  }
  if (!execRes.ok || execText.trim().startsWith('<')) {
    console.log(`  (${execRes.status} — n8n free trial doesn't expose /api/v1/; check UI manually)`);
    console.log(`\n✓ webhook returned 200 — match engine is accepting deals.`);
    console.log(`  Verify the execution succeeded by opening the workflow in n8n and clicking the "Executions" tab.`);
    console.log(`  Expected: 1 successful execution, "Filter & Match Buyers" returns 0 items (no active buyers yet).`);
    process.exit(0);
  }
  let execJson;
  try { execJson = JSON.parse(execText); } catch { console.log(`  (non-JSON response — skipping)`); process.exit(0); }
  const executions = execJson.data || execJson.executions || [];
  const recent = executions[0];
  if (!recent) {
    console.log(`  no recent executions returned — check n8n UI at ${N8N_BASE}/executions`);
    process.exit(0);
  }

  console.log(`  latest execution: id=${recent.id}  status=${recent.status || recent.finished ? 'finished' : '?'}  mode=${recent.mode}  wf=${recent.workflowId}`);
  if (recent.stoppedAt) console.log(`  stopped at:  ${recent.stoppedAt}`);
  if (recent.status === 'error' || recent.finished === false) {
    console.log(`\n  ✗ execution did NOT complete successfully. Fetch details:`);
    const det = await fetch(`${N8N_BASE}/api/v1/executions/${recent.id}?includeData=true`, { headers: HEADERS });
    const detJson = await det.json();
    const nodes = (detJson.data && detJson.data.resultData && detJson.data.resultData.runData) || {};
    for (const [node, runs] of Object.entries(nodes)) {
      const r = runs[0];
      const hasErr = r && r.error;
      console.log(`    ${hasErr ? '✗' : '✓'} ${node}${hasErr ? ' — ' + (r.error.message || JSON.stringify(r.error).slice(0, 140)) : ''}`);
    }
    process.exit(2);
  }

  console.log(`\n✓ dry run successful. Zero-match is expected if no active buyers exist yet.`);
  console.log(`  Inspect detail in n8n UI: ${N8N_BASE}/workflow/${recent.workflowId}/executions/${recent.id}`);
})().catch(e => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
