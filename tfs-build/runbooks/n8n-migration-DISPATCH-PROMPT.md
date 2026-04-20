# Dispatch Prompt — n8n Migration to Paperclip Droplet

Copy/paste this into a fresh Claude Code session, Claude.ai chat, or any capable AI agent. It's self-contained.

---

## PROMPT START

You are executing a migration task for Terms For Sale (Deal Pros LLC). Your job is to migrate 3 n8n workflows from n8n Cloud (`https://dealpros.app.n8n.cloud/`) onto a self-hosted instance on the user's existing DigitalOcean droplet called "paperclip".

### Authority + constraints

- You act on behalf of Brooke Froehlich (COO, Deal Pros LLC).
- The branch to work on is `claude/migrate-n8n-to-droplet` (create it from the latest `claude/build-tfs-buyer-lifecycle-60s5U`).
- **Never** push directly to `main`. Brooke merges after verification.
- **Never** commit `.env`. Verify `.gitignore` blocks it before every commit.
- Ask Brooke ONCE for any credentials or decisions you need. Then work heads-down.

### Context you need

Existing state (as of April 18, 2026):
- n8n Cloud has 3 active workflows: **TFS — Buyer Match Engine (GHL + Notion)**, **TFS — Helper: Deal Counter Math**, **TFS — Notion Deal Inventory Bridge**.
- Match Engine webhook: `https://dealpros.app.n8n.cloud/webhook/new-deal-inventory`
- Helper webhook: `https://dealpros.app.n8n.cloud/webhook/increment-deals` (called by GHL WF03)
- Notion bridge runs on 10-min cron, POSTs to the match engine
- Both use 2 credentials: `GHL Private Integration Token` (HTTP Header Auth) and `Notion TFS Integration` (Notion API)
- The goal is to eliminate the $20/mo n8n Cloud Starter cost by using the existing Paperclip Droplet (already paid for at $6/mo)

Target state:
- All 3 workflows running on self-hosted n8n at `https://n8n.termsforsale.com` (or whatever subdomain Brooke provides)
- Same 2 credentials re-entered on self-hosted instance
- GHL WF03 webhook URL updated to point at the new self-hosted n8n
- Notion bridge's internal "POST to Match Engine" URL updated to new n8n
- Local `.env` in the repo has `N8N_BASE_URL` updated
- n8n Cloud workflows deactivated (but not deleted yet — 7-day safety buffer)

### The runbook

Full step-by-step guide is at `tfs-build/runbooks/n8n-migration-to-droplet.md` in the repo (branch: `claude/build-tfs-buyer-lifecycle-60s5U`, on GitHub: `brooke-wq/termsforsale-site`). Read it cover-to-cover before asking Brooke for anything.

The runbook is 4 phases:
- Phase 0 — Back up workflows from Cloud (5 min)
- Phase 1 — Install n8n on Droplet with Docker + Nginx + SSL (15 min)
- Phase 2 — Re-create 2 credentials, re-import 3 workflows, publish (15 min)
- Phase 3 — Update downstream references (GHL WF03 + Notion bridge + local `.env`), run dry-run test (10 min)
- Phase 4 — Deactivate Cloud workflows (2 min, don't delete for 7 days)

### What to ask Brooke for — ONE message

Before starting any execution, ask Brooke for these items in one consolidated message:

```
To run the n8n migration I need:

1. Droplet SSH access confirmed — default creds are:
     ssh root@64.23.204.220 / password Paperclip2026!
   Confirm this still works OR paste updated creds.

2. n8n subdomain choice — I'll default to n8n.termsforsale.com
   unless you want something else. Has the DNS A record been
   pointed at 64.23.204.220 yet?

3. Two one-time secrets — generate locally with:
     openssl rand -base64 24   (admin password for n8n)
     openssl rand -hex 16      (encryption key — CRITICAL, save this)
   Paste both to me.

4. GHL Private Integration Token — your current one is
   pit-90ea9624-e782-47b0-b727-0c13382732c8. Confirm this is
   still valid OR paste a new one if you've rotated.

5. Notion Integration Secret — current is
   ntn_M2429973991b4YnRpZgrIWWLSEw2WZDnTRsD2WlcXt62cc. Confirm
   or paste new.

6. Your local Mac username — so I know what $HOME resolves to
   in your terminal commands.

7. Preferred migration window — this is a ~45 min run that
   touches production. Best done off-hours (before 8am AZ
   recommended). Any deal blast in flight? If yes, wait until
   it completes.

I'll stop after this and work heads-down. Won't drip-feed.
```

### Execution approach

- Work from the runbook, phase by phase.
- After each phase, verify success before moving on.
- If a step fails, pause and report the error with enough context to diagnose.
- **Never run destructive operations** (`docker-compose down -v`, `rm -rf` on /root/n8n-data, `git reset --hard`, etc.) without confirmation.
- Host-based API calls to GHL / Notion / n8n Cloud may be blocked by your sandbox — if so, you'll need to hand Brooke a script she runs locally or on the Droplet.

### Success criteria

Migration is complete when all of the following are true:

1. `https://n8n.termsforsale.com/` (or chosen subdomain) loads the n8n login page with valid SSL.
2. All 3 workflows are active on the self-hosted instance.
3. Credentials are attached to all GHL/Notion nodes (no red warning badges).
4. `node scripts/dry-run-match-engine.js` from Brooke's local machine returns `{"success":true,"matched_count":N}` where N≥0, pointing at the NEW self-hosted URL.
5. A test deal marked "Actively Marketing" in Notion fires the Notion bridge → match engine → WF02 → actual SMS arrives on Brooke's test phone.
6. Closing a test opportunity in GHL fires WF03 → increments Deals Last 12 Months on the test contact (via the new self-hosted /webhook/increment-deals).
7. `.env` in the repo has `N8N_BASE_URL=https://n8n.termsforsale.com` (or chosen URL). Not committed.
8. n8n Cloud workflows are DEACTIVATED (not deleted).

### Deliverables

When migration completes, commit + push these on a new branch (`claude/migrate-n8n-to-droplet`):

- Updated `BUILD_STATUS.md` — reflects new n8n base URL, notes migration date, removes Cloud from cost breakdown
- New file `tfs-build/runbooks/n8n-migration-LOG.md` — dated record of: DNS record added, password/encryption key location (password manager only, NOT in the file), new webhook URLs, any errors hit + fixes
- Any corrections to `tfs-build/runbooks/n8n-migration-to-droplet.md` if a step was wrong

Do NOT open a pull request unless Brooke explicitly asks. Push the branch, tell her the branch name + summary.

### Failure modes — halt + report

Stop and report immediately if:
- DNS hasn't propagated after 30 min of waiting
- SSL provisioning fails (certbot returns error)
- Docker fails to start on the Droplet
- `/api/v1/` on the self-hosted n8n returns 401 with the X-N8N-API-KEY header (means API setup is wrong)
- Any workflow import fails to attach a credential after 2 retries
- Dry-run returns HTTP 200 with empty body (match engine broken)
- SMS doesn't arrive on Brooke's test phone within 2 min of a test deal fire
- Any step requires modifying code outside `tfs-build/` or `scripts/` — confirm first

### Rollback criteria

Revert to n8n Cloud if ANY of the following remain broken after 30 min of debugging on the new instance:
- SMS/email not delivering on live deal blast
- Notion bridge not picking up new Actively Marketing deals
- WF03 not incrementing Deals Last 12 Months

Rollback = re-activate the 3 Cloud workflows + revert the 2 webhook URLs in GHL WF03 + Notion bridge + local `.env`. Full rollback = ~3 min.

### Writing style

Match Brooke's preference: direct, Alex Hormozi business style. No fluff. State what you did, what's next, where the risks are. No "I hope this helps" or "let me know if you need anything else."

## PROMPT END

---

## How Brooke uses this

1. Open a new Claude Code session (or Claude.ai chat with the repo attached)
2. Paste this entire PROMPT START / PROMPT END block as the first message
3. The agent will ask for the 7 items above in one consolidated message
4. Paste the answers
5. Agent runs the migration, reports back with branch name + summary
6. Brooke merges the branch to main when satisfied
