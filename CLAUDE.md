# Terms For Sale / Deal Pros — Claude Operating Context

This file is read by any Claude session that opens this repository.
Keep it under 250 lines. Update when architecture changes.

---

## What this codebase does

Terms For Sale (brand) / Deal Pros LLC (legal entity) is a real estate disposition
platform. Core flow: we source wholesale + creative-finance deals from sellers,
underwrite them, package them, and match them to our buyer list for a fast close.
The site is a Netlify-hosted React frontend + Netlify Functions backend, with a
DigitalOcean Droplet running persistent jobs, n8n workflows, and a PM2 process
manager. GHL (GoHighLevel, aka leadconnectorhq) is the CRM + messaging layer.

## Systems map

| Layer | Where | Purpose |
|---|---|---|
| Frontend | termsforsale.com (Netlify) | Buyer-facing site + admin |
| Netlify functions | `termsforsale/netlify/functions/*.js` | API endpoints + job handlers (also invoked from droplet cron) |
| Droplet | `root@64.23.204.220` | Cron jobs + n8n + PDF render + daemons |
| Droplet repo | `/root/termsforsale-site` | Git clone of main |
| Job dispatcher | `/root/termsforsale-site/jobs/run-job.js` | Single entrypoint: `node run-job.js <name>` loads `termsforsale/netlify/functions/<name>.js` and runs its handler |
| Crontab | droplet `crontab -l` | Schedules `run-job.js <name>` calls |
| PM2 | droplet `pm2 list` | Long-running daemons (deploy-hook, pdf-render, etc.) |
| GHL | services.leadconnectorhq.com | CRM, SMS, email, contact database |
| GHL Location | `7IyUgu1zpi38MDYpSDTs` | The Terms For Sale sub-account |
| n8n | https://n8n.termsforsale.com | Workflow automation (currently all unpublished post-incident) |

## Critical rules (non-negotiable)

### 1. One canonical buyer-broadcast sender

Exactly ONE scheduled job sends deal alerts to buyers. As of 2026-04-22:
- Canonical sender: **TBD** — `buyer-deal-alerts.js` to be written; see
  `docs/incidents/2026-04-22-duplicate-sender-incident.md` for the 6 rules it must follow
- Deprecated: `notify-buyers.js.DISABLED-2026-04-22`, `deal-follow-up.js.DISABLED-2026-04-22`

If you create, find, or propose any second sender of buyer-facing deal alerts,
STOP. That is the pattern that caused a multi-hour outage on 2026-04-22.

### 2. Kill-switch env vars — always honored at top of handler

Every sender handler checks env before any work:

    if (process.env.NOTIFY_KILLSWITCH === '1') {
      console.log('[KILLSWITCH] aborting — NOTIFY_KILLSWITCH=1');
      return { statusCode: 503, body: 'killswitch' };
    }

Kill-switch env vars in use:
- `NOTIFY_KILLSWITCH` — disables the canonical buyer broadcast sender
- `MARKETING_KILLSWITCH` — disables marketing-function sends (hardcoded in commit `fcba383`)

Both env vars default to unset (senders live). Set to `1` in **both** Netlify AND
droplet `/etc/environment` for a full stop.

### 3. Buyer-level idempotency

Before any outbound buyer send, check GHL custom field `last_blast_deal_code` on
the contact. If it equals the current deal code, skip. After success, write the
field. Prevents duplicate sends even if two invokers race.

### 4. Rate-ceiling alarm

Top of buyer loop: if > 50 sends in past 5 minutes, abort + SMS Brooke at
`+1 480-637-3117` (her cell). Catches runaway senders early.

### 5. Single scheduler

Canonical sender is invoked ONLY by droplet system crontab — never:
- Netlify scheduled functions (`export const config = { schedule: ... }`)
- PM2 cron_restart
- `/etc/cron.d/` drop-ins
- GHL workflow HTTP webhooks

### 6. Outbound identity (regulatory)

- Every buyer SMS from: **`+1 480-637-3117`** (no other sending number)
- Every buyer email from: **`Terms For Sale <info@termsforsale.com>`**
- Buyer must have `opt in` tag on their GHL contact BEFORE any marketing SMS/email

If you find a sender violating any of these, it's a compliance bug. Fix first,
explain later.

## Emergency controls

**To stop all buyer sends in < 30 seconds:**

1. Rotate `GHL_API_KEY` in GHL UI → Settings → Business Profile → API Keys
2. Set `NOTIFY_KILLSWITCH=1` in Netlify env vars AND droplet `/etc/environment`
3. On droplet: `pm2 stop all && pkill -9 -f "run-job.js"`

**To restore:**

1. Paste new key to Netlify + droplet (both sides — droplet uses its own
   `/etc/environment`, not Netlify's env)
2. Unset `NOTIFY_KILLSWITCH` in both places
3. `pm2 start <daemon>` for legit daemons only

## Known gotchas

- **Droplet env vs Netlify env are separate.** Rotating the GHL key in Netlify
  does NOT update droplet. Update both.
- **Running Node processes cache env at start.** Rotating env vars doesn't stop
  an already-running buyer loop — must `kill -9 <PID>` to force restart.
- **`run-job.js` loads files from `../termsforsale/netlify/functions/`, not
  `./jobs/`.** If you look for a job file in `jobs/`, you won't find it.
- **`crontab -l | sed | crontab -` wipes the crontab if sed errors** (empty
  stdin overwrites). Always test sed with `echo ... | sed ...` first.
- **Netlify env var changes take 30–60s to propagate to Lambda instances.**

## Common ops

| Task | Command |
|---|---|
| List jobs | `pm2 list` + `crontab -l` |
| Tail logs | `tail -f /var/log/paperclip.log` |
| Run a job manually | `cd /root/termsforsale-site/jobs && node run-job.js <name>` |
| Deploy | commit to `main`, push → Netlify auto-deploys |
| See recent deploys | https://app.netlify.com/sites/jolly-marzipan-8fc443/deploys |

## Weekly health audit

See `docs/ops/weekly-health-audit.md` for the Monday 8am MST playbook. Catches
the class of bugs that caused the 2026-04-22 incident before they become one.

## Incident history

- `2026-04-22` — Duplicate sender incident. Three overlapping schedulers sending
  2×–4× to buyers. Full root cause + permanent rules in
  `docs/incidents/2026-04-22-duplicate-sender-incident.md`.
- `fcba383` — hardcoded marketing kill-switch in 3 sender functions (preventive).
