#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { runScraper, listScrapers } = require('../lib/runner');
const log = require('../lib/log');

(async () => {
  const sources = listScrapers();
  const dryRun = process.argv.includes('--dry-run');
  const summary = [];
  for (const s of sources) {
    try {
      const r = await runScraper(s, { dryRun });
      summary.push({ source: s, ...r });
    } catch (e) {
      log.error('run failed', { source: s, err: e.message });
      summary.push({ source: s, error: e.message });
    }
  }
  log.info('all-scrapers done', { summary });
})();
