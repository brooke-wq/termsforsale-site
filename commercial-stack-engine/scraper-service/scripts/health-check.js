#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { pool } = require('../lib/db');

const REQUIRED_ENV = [
  'POSTGRES_PASSWORD', 'SCRAPER_AUTH_TOKEN',
  'ANTHROPIC_API_KEY', 'GHL_API_KEY', 'GHL_LOCATION_ID', 'BROOKE_PHONE'
];
const RECOMMENDED_ENV = ['WEBSHARE_API_KEY', 'GHL_PIPELINE_ID_COMMERCIAL', 'GHL_STAGE_STACK_CANDIDATE'];

(async () => {
  const out = { ok: true, env: {}, db: {}, recent: {} };

  for (const k of REQUIRED_ENV) {
    out.env[k] = process.env[k] ? 'set' : 'MISSING';
    if (!process.env[k]) out.ok = false;
  }
  for (const k of RECOMMENDED_ENV) {
    out.env[k] = process.env[k] ? 'set' : 'unset (recommended)';
  }

  try {
    const r = await pool.query('SELECT version() AS v, NOW() AS now');
    out.db.connected = true;
    out.db.version = r.rows[0].v.split(' ').slice(0, 2).join(' ');
    const tables = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
    out.db.tables = tables.rows.map(r => r.tablename);

    const stats = await pool.query(`SELECT * FROM v_pipeline_stats_30d`);
    out.recent = stats.rows[0];
  } catch (e) {
    out.ok = false;
    out.db.connected = false;
    out.db.error = e.message;
  }

  console.log(JSON.stringify(out, null, 2));
  await pool.end().catch(() => {});
  process.exit(out.ok ? 0 : 1);
})();
