#!/usr/bin/env node
'use strict';

// End-to-end pipeline smoke test.
// Inserts a fake listing into the DB → triggers enrichment → scoring → GHL push (if SMS_ALERTS_LIVE=true).
//
// Set SMS_ALERTS_LIVE=false to dry-run the GHL push (will print payloads but not send).

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { pool } = require('../lib/db');
const log = require('../lib/log');

const FAKE = {
  source: 'crexi',
  source_url: 'https://example.com/test/' + Date.now(),
  source_url_hash: 'test_' + Date.now(),
  asset_class: 'mf',
  state: 'AZ', county: 'Maricopa', city: 'Phoenix', zip: '85016',
  address: '123 Test Ave',
  listing_price: 1_750_000,
  units: 12,
  year_built: 1978,
  lot_size: 0.45,
  raw_json: { test: true, hint: 'pipeline smoke test' }
};

(async () => {
  log.info('inserting fake listing', { url: FAKE.source_url });
  const r = await pool.query(
    `INSERT INTO listings (source,source_url,source_url_hash,asset_class,state,county,city,zip,address,listing_price,units,year_built,lot_size,raw_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (source_url_hash) DO UPDATE SET last_seen_at=NOW()
     RETURNING id`,
    [FAKE.source, FAKE.source_url, FAKE.source_url_hash, FAKE.asset_class,
     FAKE.state, FAKE.county, FAKE.city, FAKE.zip, FAKE.address,
     FAKE.listing_price, FAKE.units, FAKE.year_built, FAKE.lot_size, FAKE.raw_json]
  );
  const listingId = r.rows[0].id;
  log.info('listing inserted', { id: listingId });

  // Insert a fake enrichment claiming 75% equity, out-of-state owner
  await pool.query(
    `INSERT INTO enriched_properties (listing_id, parcel_number, owner_name, owner_mailing_address, owner_state, is_llc, llc_status, last_sale_date, last_sale_price, estimated_market_value, has_active_mortgage, mortgage_estimated_balance, equity_estimate_dollars, equity_estimate_percent, motivation_signals)
     VALUES ($1,'12345678','TEST OWNER LLC','123 Other St, San Diego CA 92101','CA',TRUE,'active','2010-04-15',850000,2000000,TRUE,500000,1500000,75.0,
             $2::JSONB)`,
    [listingId, JSON.stringify({ signals: ['out_of_state_owner', 'long_hold_period'] })]
  );
  log.info('fake enrichment inserted');

  // Verify the trigger fired
  log.info('test-pipeline complete — check n8n workflow logs to confirm scoring fired');
  await pool.end();
})();
