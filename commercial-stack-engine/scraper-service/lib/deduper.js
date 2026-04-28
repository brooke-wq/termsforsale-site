'use strict';

const crypto = require('crypto');
const { pool } = require('./db');
const log = require('./log');

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// Insert OR update (mark last_seen_at). Returns { id, inserted: true|false }.
async function upsertListing(normalized) {
  const hash = sha256(normalized.source_url);
  const sql = `
    INSERT INTO listings (
      source, source_url, source_url_hash, asset_class,
      state, county, city, zip, address,
      listing_price, units, year_built, lot_size, raw_json,
      scraped_at, last_seen_at, is_active
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW(),TRUE)
    ON CONFLICT (source_url_hash) DO UPDATE
      SET last_seen_at  = NOW(),
          is_active     = TRUE,
          listing_price = COALESCE(EXCLUDED.listing_price, listings.listing_price),
          raw_json      = EXCLUDED.raw_json
    RETURNING id, (xmax = 0) AS inserted
  `;
  const params = [
    normalized.source, normalized.source_url, hash, normalized.asset_class,
    normalized.state, normalized.county, normalized.city, normalized.zip, normalized.address,
    normalized.listing_price, normalized.units, normalized.year_built, normalized.lot_size,
    normalized.raw || {}
  ];
  const r = await pool.query(sql, params);
  return { id: r.rows[0].id, inserted: r.rows[0].inserted };
}

// Mark listings stale if not seen for `days` days.
async function deactivateStale(source, days = 7) {
  const r = await pool.query(
    `UPDATE listings SET is_active=FALSE
     WHERE source=$1 AND is_active=TRUE AND last_seen_at < NOW() - ($2 || ' days')::INTERVAL
     RETURNING id`,
    [source, String(days)]
  );
  if (r.rowCount) log.info(`deactivated ${r.rowCount} stale ${source} listings`);
  return r.rowCount;
}

async function logScrapeError(opts) {
  try {
    await pool.query(
      `INSERT INTO scrape_errors (source, source_url, error_type, error_msg, http_status, user_agent, proxy_used)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [opts.source, opts.source_url || null, opts.error_type || 'unknown',
       (opts.error_msg || '').slice(0, 1000), opts.http_status || null,
       opts.user_agent || null, opts.proxy_used || null]
    );
  } catch (e) {
    log.warn('logScrapeError failed', { error: e.message });
  }
}

module.exports = { sha256, upsertListing, deactivateStale, logScrapeError };
