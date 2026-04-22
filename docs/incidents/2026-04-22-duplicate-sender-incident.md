# Duplicate-Sender Incident — 2026-04-22

## Summary

Paying buyers received 2x-4x duplicate SMS and email alerts for the same deal,
within ~1 minute of each other. Example template:

> "New Subject To deal in Maricopa, AZ - $372,850 entry $50,000 + CC/TC. View: https://termsforsale.com/d/maricopa-85138-1bc090d6?c=..."

## Root cause

Three independent schedulers each invoked a buyer-broadcast function on
overlapping minute marks:

1. Droplet system crontab had two lines for `notify-buyers` (`*/30 15-23` and `*/30 0-3`)
2. Droplet system crontab had two lines for `deal-follow-up` on the SAME schedule pattern
3. PM2 had a `notify-buyers-poller` daemon as a third invoker

All three ran the same type of deal-alert loop that directly POSTed to
GHL `/conversations/messages` with `type: 'SMS'` and `type: 'Email'`.
When two or more fired at the same minute (`:00` or `:30`), each buyer
received one message per invoker.

Published/guarded components that looked like the cause but were NOT:
- n8n Hybrid Tier Router workflow (a downstream amplifier, not the trigger)
- GHL workflow WF02 "Deal Match Send" (present but not the invoker)
- Netlify scheduled functions (none were configured)

## How it was contained (2026-04-22)

1. n8n all workflows unpublished
2. GHL WF02 drafted (Published -> Draft)
3. PM2 `notify-buyers-poller` stopped
4. Droplet system crontab `notify-buyers` lines removed
5. Droplet system crontab `deal-follow-up` lines commented `# PAUSED`
6. Running notify-buyers Node process (PID 112961) + bash wrapper (112949) killed
7. Both Netlify function files renamed on disk:
   - `termsforsale/netlify/functions/notify-buyers.js.DISABLED-2026-04-22`
   - `termsforsale/netlify/functions/deal-follow-up.js.DISABLED-2026-04-22`
8. GHL API key rotated -> new key placed in Netlify env AND droplet `/etc/environment`
9. Commit `49b4995` locks the rename; Netlify auto-deploy returns 404 on any HTTP invocation of the old function paths

## Rules for any future buyer-broadcast sender

### 1. Single canonical sender

EXACTLY ONE scheduled job sends deal alerts to buyers. Everything else is
deprecated, deleted, or an analytical/internal job. Name it unambiguously
(e.g. `buyer-deal-alerts`). Document the name in `CLAUDE.md`. Any other
file that sends a buyer-facing deal alert is a bug; delete or rename on sight.

### 2. Kill-switch env var

Top of the canonical sender handler, before any work:

    if (process.env.NOTIFY_KILLSWITCH === '1') {
      console.log('[KILLSWITCH] aborting - NOTIFY_KILLSWITCH=1');
      return { statusCode: 503, body: 'killswitch' };
    }

One env var flip = instant stop, no deploy. Document in CLAUDE.md under "Emergency controls."

### 3. Buyer-level idempotency

Before sending to any buyer, check GHL custom field `last_blast_deal_code`.
If it equals the current deal code, skip + log "already sent." After successful
send, write the field. Receiver-side dedup: even if two senders fire at the
same time in the future, each buyer receives at most one message per deal.

Accept `force=1` URL parameter for manual resends (manual test only).

### 4. Rate-ceiling alarm

Top of the buyer loop:

    const sentLast5Min = countSentSince(Date.now() - 5 * 60 * 1000);
    if (sentLast5Min > 50) {
      sendOpsSMS(`[RATE ALARM] ${sentLast5Min} sends in 5min - aborting`);
      return { statusCode: 429, body: 'rate alarm' };
    }

Catches a runaway sender before buyers notice. Default 50; tune to real traffic.

### 5. One scheduler only

Canonical sender invoked by ONLY the droplet system crontab. NEVER:
- Netlify scheduled functions (`export const config = { schedule: ... }`)
- PM2 cron_restart or tick
- `/etc/cron.d/` drop-ins
- GHL workflow HTTP webhooks

If you find a redundant trigger, delete it. Add comment `# DO NOT DUPLICATE - single-scheduler rule 2026-04-22` above the crontab line.

### 6. Deprecation discipline

When replacing a sender:
1. Rename old file `.js` -> `.js.DEPRECATED-YYYY-MM-DD`
2. Remove dispatch entry from `jobs/run-job.js`
3. Remove cron entry
4. Commit `DEPRECATE <name> - replaced by <new name>`
5. After 30 days clean, delete the `.DEPRECATED` file

Never leave two senders co-existing "just in case." That IS the bug.

## Restore checklist (when resuming buyer broadcasts)

Do NOT re-enable `notify-buyers` or `deal-follow-up`. Instead:

- [ ] Decide canonical sender name (recommend rewriting as `buyer-deal-alerts.js` from scratch, ~200 lines with rules 1-6 built in)
- [ ] Write `buyer-deal-alerts.js` with all six rules applied
- [ ] Add one droplet crontab line for it (no duplicate)
- [ ] Add `NOTIFY_KILLSWITCH` env on droplet + Netlify (unset/absent = enabled)
- [ ] Provision GHL custom field `last_blast_deal_code` on Contact object
- [ ] Dry-run in staging with one test buyer. Verify exactly one SMS + one email.
- [ ] Dry-run prod with one contact tagged `internal-test`. Verify exactly one.
- [ ] Flip `NOTIFY_KILLSWITCH=0` (or unset). Go live.
- [ ] Watch logs for first two cron fires. Confirm no dup bursts.

## Change log

- 49b4995 2026-04-22 - EMERGENCY: disable notify-buyers + deal-follow-up duplicate senders
