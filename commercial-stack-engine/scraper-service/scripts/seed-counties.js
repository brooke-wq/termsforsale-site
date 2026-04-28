#!/usr/bin/env node
'use strict';

// Seed `county_configs` with the top US metros covering ~60% of national MF
// inventory. Idempotent — uses ON CONFLICT to update existing rows.
//
// Run: node scripts/seed-counties.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { pool } = require('../lib/db');
const COUNTIES = require('../lib/county-configs');
const log = require('../lib/log');

(async () => {
  let inserted = 0, updated = 0;
  for (const c of COUNTIES) {
    const sql = `
      INSERT INTO county_configs (state, county, metro_name, assessor_url, scrape_strategy, scrape_config, estimated_share_pct, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (state, county) DO UPDATE SET
        metro_name = EXCLUDED.metro_name,
        assessor_url = EXCLUDED.assessor_url,
        scrape_strategy = EXCLUDED.scrape_strategy,
        scrape_config = EXCLUDED.scrape_config,
        estimated_share_pct = EXCLUDED.estimated_share_pct,
        is_active = EXCLUDED.is_active
      RETURNING (xmax = 0) AS inserted
    `;
    const r = await pool.query(sql, [
      c.state, c.county, c.metro_name, c.assessor_url,
      c.scrape_strategy, c.scrape_config || {}, c.estimated_share_pct || null, c.is_active !== false
    ]);
    if (r.rows[0].inserted) inserted++; else updated++;
  }
  log.info('seed-counties done', { inserted, updated, total: COUNTIES.length });
  await pool.end();
})();
