'use strict';

const path = require('path');
const fs = require('fs');
const log = require('./log');
const { normalizeListing } = require('./normalize');
const { upsertListing, deactivateStale, logScrapeError } = require('./deduper');

const SCRAPERS_DIR = path.join(__dirname, '..', 'scrapers');

function listScrapers() {
  return fs.readdirSync(SCRAPERS_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace(/\.js$/, ''));
}

async function runScraper(name, opts = {}) {
  const file = path.join(SCRAPERS_DIR, `${name}.js`);
  if (!fs.existsSync(file)) throw new Error(`unknown scraper: ${name}`);
  const mod = require(file);
  if (typeof mod.scrape !== 'function') throw new Error(`scraper ${name} missing .scrape()`);

  const start = Date.now();
  log.info('scrape:start', { name, opts });

  let raw = [];
  try {
    raw = await mod.scrape(opts);
  } catch (e) {
    log.error('scraper threw', { name, error: e.message });
    await logScrapeError({ source: name, error_type: 'scraper_throw', error_msg: e.message });
    throw e;
  }

  const stats = { fetched: raw.length, normalized: 0, inserted: 0, updated: 0, skipped: 0 };

  for (const rec of raw) {
    const norm = normalizeListing(rec);
    if (!norm) {
      stats.skipped++;
      continue;
    }
    stats.normalized++;
    if (opts.dryRun) continue;
    try {
      const { inserted } = await upsertListing(norm);
      if (inserted) stats.inserted++; else stats.updated++;
    } catch (e) {
      log.warn('upsert failed', { source: name, url: norm.source_url, err: e.message });
      stats.skipped++;
    }
  }

  if (!opts.dryRun) {
    try {
      await deactivateStale(name, 7);
    } catch (e) {
      log.warn('deactivateStale failed', { source: name, err: e.message });
    }
  }

  const ms = Date.now() - start;
  log.info('scrape:done', { name, ms, ...stats });
  return { ms, ...stats };
}

module.exports = { runScraper, listScrapers };
