#!/usr/bin/env node
/**
 * Paperclip Droplet cron wrapper for the weekly team digest.
 *
 * Schedule: Mondays 7am AZ = 14:00 UTC
 *   pm2 register: pm2 start jobs/weekly-digest-cron.js --name weekly-digest \
 *                   --no-autorestart --cron "0 14 * * 1"
 *
 * Wraps `weekly-digest.js` Netlify function and invokes its handler directly.
 * The function honors DIGEST_LIVE=true to actually send (otherwise preview only).
 *
 * Idempotent: file-based dedup via jobs/sent-log.js prevents double-sends
 * if the cron fires twice in the same week.
 */

const path = require('path');

const FUNCTION_PATH = path.join(__dirname, '..', 'termsforsale', 'netlify', 'functions', 'weekly-digest');

async function main() {
  const startTime = Date.now();
  console.log(`[weekly-digest-cron] Starting at ${new Date().toISOString()}`);

  // Confirm DIGEST_LIVE before running. Refuse to send unless explicitly enabled.
  if (process.env.DIGEST_LIVE !== 'true') {
    console.log('[weekly-digest-cron] DIGEST_LIVE is not "true" — running in preview mode (no sends)');
    console.log('[weekly-digest-cron] To enable live sends, set DIGEST_LIVE=true in /etc/environment');
  }

  try {
    const fn = require(FUNCTION_PATH);
    const event = {
      httpMethod: 'POST',
      body: '{}',
      queryStringParameters: {}
    };
    const result = await fn.handler(event);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[weekly-digest-cron] Status: ${result.statusCode}, ran in ${elapsed}s`);

    // Pretty-print summary line
    try {
      const body = JSON.parse(result.body);
      if (body.mode === 'sent') {
        console.log(`[weekly-digest-cron] SENT: email=${body.email?.sent}/${body.email?.errors?.length ?? 0} errors, slack=${body.slack?.ok}, notion=${body.notion?.ok}`);
      } else if (body.mode === 'preview') {
        console.log(`[weekly-digest-cron] PREVIEW: ${body.stats?.completedCount} shipped items, ${body.stats?.commitsCount} commits, ${body.stats?.activeDeals} active deals`);
      } else if (body.mode === 'skipped') {
        console.log(`[weekly-digest-cron] SKIPPED: ${body.reason}`);
      }
    } catch (e) {
      // ignore parse failures
    }

    process.exit(result.statusCode >= 200 && result.statusCode < 300 ? 0 : 1);

  } catch (err) {
    console.error('[weekly-digest-cron] Fatal error:', err.message, err.stack);
    process.exit(1);
  }
}

main();
