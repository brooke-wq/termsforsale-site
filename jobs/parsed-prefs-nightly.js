#!/usr/bin/env node
/**
 * Nightly Parsed-Prefs Refresh — Droplet cron job
 *
 * Runs every night at 3am AZ (10:00 UTC).
 *
 * PURPOSE
 * -------
 * Keeps contact.parsed_prefs fresh as buyers accumulate notes, reply to
 * SMS, get new tags, or update their buy-box outside the form. The
 * underlying script (scripts/backfill-parsed-prefs.js) is idempotent: it
 * computes a SHA256 checksum of (buy_box + notes + tags) and compares it
 * to each buyer's parsed_prefs.source_checksum. If they match, the buyer
 * is skipped — no Claude call, zero cost. Only buyers whose inputs
 * actually changed get re-parsed.
 *
 * EXPECTED RUNTIME
 * ---------------
 * At ~10k buyers with ~100 changes/night: ~5-10 minutes.
 * Full re-parse (FORCE_REPARSE=1): ~2 hours, ~$27. Don't do that here.
 *
 * ERROR HANDLING
 * --------------
 * The script handles per-contact failures internally (continues on
 * errors). Top-level exits 0 unless something truly fatal (no env var,
 * no GHL custom field). PM2 captures stdout/stderr to
 * /var/log/parsed-prefs-nightly.log (configured in ecosystem.config.js).
 *
 * ENV VARS REQUIRED
 * -----------------
 *   GHL_API_KEY, GHL_LOCATION_ID (or GHL_LOCATION_ID_TERMS)
 *   ANTHROPIC_API_KEY
 *
 * MANUAL RUN
 * ----------
 *   node jobs/parsed-prefs-nightly.js
 *
 * This file exists only to invoke scripts/backfill-parsed-prefs.js with
 * the right defaults. Keeping them separate means ad-hoc backfills
 * (e.g. after bulk tag cleanups) don't touch the cron contract.
 */

const path = require('path');
const { spawn } = require('child_process');

const scriptPath = path.join(__dirname, '..', 'scripts', 'backfill-parsed-prefs.js');

console.log('[parsed-prefs-nightly] starting at', new Date().toISOString());

// Never force-reparse in the nightly job — checksum-based skip keeps cost
// at ~$0 on quiet nights. MAX_CONTACTS left unset = scan everyone.
const env = Object.assign({}, process.env, {
  DRY_RUN: '',
  FORCE_REPARSE: ''
});

const child = spawn('node', [scriptPath], {
  env: env,
  stdio: 'inherit'
});

child.on('exit', function (code) {
  console.log('[parsed-prefs-nightly] exit code=' + code + ' at ' + new Date().toISOString());
  process.exit(code);
});

child.on('error', function (err) {
  console.error('[parsed-prefs-nightly] spawn error:', err.message);
  process.exit(1);
});
