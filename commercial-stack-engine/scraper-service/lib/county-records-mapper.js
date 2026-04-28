'use strict';

// county-records-mapper
// Given a (state, county) pair, returns an enrichment fetcher that pulls parcel
// + owner + sale history + mortgage data from that county's assessor / recorder.
//
// Strategy registry:
//   - 'json_api'    → simple HTTP GET, parse JSON response by config.response_path
//   - 'html_form'   → submit a search form, parse result HTML by selectors
//   - 'html_search' → scrape a search results page, then a detail page
//   - 'manual'      → return null (caller marks listing enrichment_skipped=true)
//
// IMPORTANT: This file is the *contract* — actual per-county scrape logic lives
// in `county-scrapers/<state>-<county>.js` and gets wired in lazily.
//
// Phase 1 ships only the dispatcher. Per-county scrape logic is incremental.

const path = require('path');
const fs = require('fs');
const { pool } = require('./db');
const log = require('./log');

let configCache = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

async function loadConfigs() {
  if (configCache && (Date.now() - cacheLoadedAt) < CACHE_TTL_MS) return configCache;
  const r = await pool.query(`SELECT * FROM county_configs WHERE is_active=TRUE`);
  configCache = {};
  for (const row of r.rows) {
    const key = `${row.state}|${row.county}`;
    configCache[key] = row;
  }
  cacheLoadedAt = Date.now();
  return configCache;
}

function lookupCountyScraper(state, county) {
  const key = `${state}-${county}`.toLowerCase().replace(/\s+/g, '_');
  const file = path.join(__dirname, '..', 'county-scrapers', `${key}.js`);
  if (!fs.existsSync(file)) return null;
  try {
    return require(file);
  } catch (e) {
    log.warn('failed to load county scraper', { key, err: e.message });
    return null;
  }
}

// Returns:
//   {
//     parcel_number, owner_name, owner_mailing_address, owner_state,
//     last_sale_date, last_sale_price, current_assessed_value,
//     mortgage_count, has_active_mortgage, lender_name,
//     mortgage_origination_date, mortgage_estimated_balance,
//     raw_county_json
//   }
// or null if county is unmapped / scrape strategy is 'manual'.
async function fetchCountyData({ state, county, address, city, zip }) {
  if (!state || !county) return null;
  const configs = await loadConfigs();
  const cfg = configs[`${state}|${county}`];
  if (!cfg) {
    log.debug('county unmapped', { state, county });
    return null;
  }
  if (cfg.scrape_strategy === 'manual') return null;

  // Prefer a per-county scraper module when present (most accurate)
  const custom = lookupCountyScraper(state, county);
  if (custom && typeof custom.fetch === 'function') {
    try {
      return await custom.fetch({ address, city, zip, config: cfg });
    } catch (e) {
      log.warn('per-county scraper threw', { state, county, err: e.message });
      return null;
    }
  }

  // Fallback: dispatch on strategy. v1 ships the dispatcher only — Tier 1
  // counties get per-county modules in `county-scrapers/`, dispatcher serves
  // as the safety net + logs misses for follow-up work.
  log.info('county dispatcher hit (no per-county module yet)', {
    state, county, strategy: cfg.scrape_strategy
  });
  return null;
}

module.exports = { fetchCountyData, loadConfigs };
