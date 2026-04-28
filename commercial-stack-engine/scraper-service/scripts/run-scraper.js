#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { runScraper } = require('../lib/runner');
const log = require('../lib/log');

(async () => {
  const name = process.argv[2];
  if (!name) {
    console.error('Usage: node run-scraper.js <name> [--dry-run] [--max=N]');
    process.exit(2);
  }
  const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--dryRun');
  const maxArg = process.argv.find(a => a.startsWith('--max='));
  const maxListings = maxArg ? Number(maxArg.split('=')[1]) : undefined;

  try {
    const out = await runScraper(name, { dryRun, maxListings });
    log.info('done', out);
    process.exit(0);
  } catch (e) {
    log.error('run-scraper failed', { name, err: e.message, stack: e.stack });
    process.exit(1);
  }
})();
