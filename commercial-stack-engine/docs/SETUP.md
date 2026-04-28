# SETUP — Commercial Stack Engine

Step-by-step deployment guide. Written for a non-developer operator.
Estimated time: 60-90 minutes for first deploy, 10 minutes for redeploys.

---

## Prerequisites

- SSH access to the existing DigitalOcean droplet (the one running
  `n8n.dealpros.io`)
- Git installed on the droplet (it already is)
- Docker + docker-compose installed (already are if n8n is running)
- An Anthropic API key (already exists per CLAUDE.md)
- A GHL API key for the chosen sub-account
- A Webshare account ($10/mo plan)
- Brooke's cell number for SMS alerts: `+14806373117`
- Brooke's GHL contact ID: `1HMBtAv9EuTlJa5EekAL`

---

## Step 1 — Webshare proxy account (~5 min, $10/mo)

1. Go to https://www.webshare.io/
2. Sign up. Pick the **Residential Lite** tier ($10/mo, 100 IPs).
3. Once logged in, go to **Dashboard → API Keys**
4. Click **Generate API Key**, copy the value
5. Save it for the `.env` file in step 4

> The proxy is what stops LoopNet, Crexi, and Craigslist from IP-banning
> us. Webshare rotates IPs per request automatically when configured
> with the rotating endpoint. Don't skip this step.

---

## Phase A vs Phase B — deploy sequence

Per Brooke's decision, commercial leads will live in a **NEW** GHL
sub-account ("Commercial Stack") that doesn't exist yet. The deploy is
therefore split into two phases:

**Phase A (do this now):**
- Deploy the scraper service + Postgres + n8n workflows
- Run scraping → enrichment → scoring end-to-end
- Workflow 04 (Hot Lead Router) silently no-ops because GHL_API_KEY
  is blank
- Brooke reviews HOT scores via the daily email digest + a Postgres
  query (`SELECT * FROM v_hot_leads_24h`)
- Lets us validate the pipeline + tune scoring on real listings
  before any GHL integration

**Phase B (do this after Phase A is stable, ~1-2 weeks later):**
- Create the new "Commercial Stack" GHL sub-account
- Build the pipeline + stages (steps below)
- Fill `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_PIPELINE_ID_COMMERCIAL`,
  `GHL_STAGE_STACK_CANDIDATE` in `.env`
- Activate workflow 04 → hot leads start pushing to GHL with SMS

If you're in Phase A, **skip Step 2 below** — the rest of SETUP works
without GHL configured.

---

## Step 2 — GHL pipeline setup (Phase B only, ~15 min)

You need a NEW GHL sub-account first. Once created:

1. Log into GHL (the Terms For Sale sub-account)
2. **Settings → Pipelines → Create New Pipeline**
3. Name: `Commercial Stack`
4. Add stages in order:
   - `Stack Candidate — Call Now`  (this is the inbound stage)
   - `Initial Contact Made`
   - `LOI Sent`
   - `LOI Accepted`
   - `Under Contract`
   - `Closed Won`
   - `Lost`
5. Save. Copy the **Pipeline ID** from the URL bar (after `/pipelines/`).
6. Click on the `Stack Candidate — Call Now` stage. Copy its **Stage ID**.
7. Save both for the `.env` in step 4 (`GHL_PIPELINE_ID_COMMERCIAL`,
   `GHL_STAGE_STACK_CANDIDATE`).

---

## Step 3 — Slack webhook (optional, ~3 min)

Skip this if you don't want a Slack digest yet.

1. https://api.slack.com/apps → **Create New App** → From scratch
2. Name: `Commercial Stack Engine`. Workspace: yours.
3. Features → **Incoming Webhooks** → toggle ON
4. **Add New Webhook to Workspace** → pick `#commercial-deals` (create
   the channel first if it doesn't exist) → Allow
5. Copy the URL starting `https://hooks.slack.com/services/...`
6. Save for the `.env` in step 4 (`SLACK_WEBHOOK_URL`).

---

## Step 4 — Clone + configure the repo (~10 min, on the droplet)

```bash
ssh root@n8n.dealpros.io  # or whatever the droplet's hostname / IP is

cd /root
# If termsforsale-site is already cloned, just pull
if [ -d termsforsale-site ]; then
  cd termsforsale-site && git fetch && git checkout claude/setup-acquisition-system-YUtAb && git pull
else
  git clone https://github.com/brooke-wq/termsforsale-site.git
  cd termsforsale-site
  git checkout claude/setup-acquisition-system-YUtAb
fi

cd commercial-stack-engine
cp .env.example .env
nano .env
```

Fill in **at minimum** these vars:

```
POSTGRES_PASSWORD=<openssl rand -hex 24>
SCRAPER_AUTH_TOKEN=<openssl rand -hex 32>
WEBSHARE_API_KEY=<from step 1>
ANTHROPIC_API_KEY=<existing>
GHL_API_KEY=<from chosen sub-account>
GHL_LOCATION_ID=<sub-account location ID>
GHL_PIPELINE_ID_COMMERCIAL=<from step 2>
GHL_STAGE_STACK_CANDIDATE=<from step 2>
BROOKE_PHONE=+14806373117
BROOKE_GHL_CONTACT_ID=1HMBtAv9EuTlJa5EekAL
SLACK_WEBHOOK_URL=<from step 3, or leave blank>
```

Leave the killswitches at their defaults:

```
GHL_PUSH_LIVE=false
SMS_ALERTS_LIVE=false
LOI_AUTO_GENERATE=false
```

Save and exit (Ctrl+O, Enter, Ctrl+X in nano).

---

## Step 5 — Boot Postgres + scraper-service (~5 min)

```bash
docker-compose up -d
docker-compose ps
```

Both `cse-postgres` and `cse-scraper` should be `Up (healthy)`. If
not, check logs:

```bash
docker-compose logs postgres   # should show "database system is ready"
docker-compose logs scraper    # should show "scraper-service listening on :3100"
```

The schema (`db/schema.sql`) is automatically applied on first boot of
Postgres because the file is mounted into
`/docker-entrypoint-initdb.d/`. To verify:

```bash
docker-compose exec postgres psql -U cse -d stack_engine -c "\dt"
```

You should see all 9 tables (`listings`, `enriched_properties`, `scores`,
`leads`, `loi_drafts`, `scrape_errors`, `county_configs`, `claude_cost_log`,
`digest_log`).

---

## Step 6 — Health check + seed counties (~2 min)

```bash
docker-compose exec scraper npm run health
```

Should print `"ok": true` and confirm DB connection + all required
env vars are set.

```bash
docker-compose exec scraper npm run seed:counties
```

Should print `seed-counties done { inserted: 5, updated: 0, total: 25 }`
on first run (only Tier 1 counties have `is_active=true`; Tier 2
gets seeded as inactive until per-county scrapers ship).

---

## Step 7 — Smoke-test pipeline (~2 min)

```bash
docker-compose exec scraper npm run test:pipeline
```

Inserts a fake Phoenix MF listing into the DB. Then check that the
enrichment + scoring pipeline picks it up (this requires n8n
workflows to be running — see step 9).

---

## Step 8 — First dry scrape (~5 min)

```bash
docker-compose exec scraper node scripts/run-scraper.js crexi --dry-run --max=5
```

This runs the Crexi scraper without writing to the DB. Inspect the
output — you should see ~5 listings with normalized fields. If you see
errors, check that `WEBSHARE_API_KEY` is set and the Crexi API endpoint
is reachable.

---

## Step 9 — Import n8n workflows (~10 min, in n8n UI)

1. Open n8n at https://n8n.dealpros.io (or wherever your n8n lives)
2. **Workflows → Import** for each file in `n8n-workflows/`:
   - `01-sourcing-orchestrator.json`
   - `02-enrichment-pipeline.json`
   - `03-stack-scoring-engine.json`
   - `04-hot-lead-router.json`
   - `05-loi-generator.json`
   - `06-daily-digest.json`
3. Set up credentials (gear icon → Credentials):
   - **Postgres**: host `postgres` (the docker-compose service name),
     port 5432, db `stack_engine`, user `cse`, password from `.env`
   - **Anthropic**: API key from `.env` (used in workflows 03 + 05)
   - **GHL**: API key from `.env` (used in workflows 04 + 05)
4. **Paste the Stack scoring system prompt** into workflow 03's
   `Claude Haiku score` node (replace the
   `<<<PASTE prompts/stack-scoring-prompt.md SYSTEM PROMPT>>>` placeholder
   with the actual content of that file's "SYSTEM PROMPT" code block).
5. Same for workflow 05's `Claude Haiku — fill LOI vars` node — paste
   from `prompts/loi-generation-prompt.md`.
6. Set the env var `N8N_INTERNAL_URL` on the n8n container (or in
   n8n's settings) to the n8n base URL — this is how workflows fire
   each other via internal webhooks.

---

## Step 10 — Activate workflows in dependency order (~5 min)

Activate in this order, verifying each one fires before moving on:

1. **04 Hot Lead Router** — needs to be live before 03 fires it.
   Don't worry, the killswitches are still on.
2. **03 Stack Scoring Engine** — needs to be live before 02 fires it.
3. **02 Enrichment Pipeline** — listens for new_listing pg_notify.
4. **05 LOI Generator** — manual trigger only, safe to activate any time.
5. **06 Daily Digest** — cron-driven; next fire is 14:00 UTC.
6. **01 Sourcing Orchestrator** — fires every 12 hours. Activate LAST.

> Workflow 04's SMS Brooke node will silently no-op as long as
> `SMS_ALERTS_LIVE=false` (you'll add a guard expression to that node
> that checks the env var). For the first 1-2 weeks, keep it false and
> only review hot leads via the daily digest + GHL contact list.

---

## Step 11 — First live scrape + verification (~30 min total)

Manually trigger workflow 01 from the n8n UI:

1. Watch the execution view as it cascades through:
   - Source list (loop) → Run scraper (one execution per source)
2. Each scraper run should insert ~50-200 rows into `listings`:
   ```bash
   docker-compose exec postgres psql -U cse -d stack_engine \
     -c "SELECT source, COUNT(*) FROM listings WHERE scraped_at >= NOW() - INTERVAL '1 hour' GROUP BY source"
   ```
3. The pg_notify trigger fires workflow 02 for each new listing.
   Until per-county scrapers ship, every listing will get marked
   `enrichment_skipped=true` and the equity gate will fail (so 03
   never fires).
4. Check `scrape_errors` for any failures:
   ```bash
   docker-compose exec postgres psql -U cse -d stack_engine \
     -c "SELECT source, error_type, COUNT(*) FROM scrape_errors WHERE occurred_at >= NOW() - INTERVAL '1 hour' GROUP BY 1,2"
   ```

---

## Step 12 — Wire up Tier 1 county scrapers (next session)

This is the highest-leverage next-session task. Without per-county
scrapers, no listing can be enriched, so no scoring fires, so no GHL
push happens.

See **[docs/COUNTY_RECORDS_GUIDE.md](COUNTY_RECORDS_GUIDE.md)** for the
per-county module contract and the priority order:

1. `az-maricopa.js` (Phoenix metro, ~4.5% of national inventory)
2. `tx-harris.js` (Houston, ~3.8%)
3. `tx-dallas.js` (Dallas, ~3.2%)
4. `ga-fulton.js` (Atlanta, ~2.4%)
5. `fl-hillsborough.js` (Tampa, ~2.0%)

Total Tier 1 coverage: ~16% of national inventory. Tier 2 (the
remaining 20 counties) brings it to ~60%.

---

## Daily operations

### Manual scrape trigger

```bash
docker-compose exec scraper node scripts/run-scraper.js crexi --max=100
```

Or via the API:

```bash
curl -X POST http://localhost:3100/scrape/run \
  -H "X-Auth-Token: $SCRAPER_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"crexi","maxListings":100}'
```

### Tail logs

```bash
docker-compose logs -f scraper       # scraper-service
docker-compose logs -f postgres      # database
```

### Tail Claude spend

```bash
docker-compose exec postgres psql -U cse -d stack_engine \
  -c "SELECT date_trunc('day', called_at) AS day, SUM(cost_usd) AS spend
      FROM claude_cost_log
      WHERE called_at >= NOW() - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 1 DESC"
```

If spend goes above $0.20/day for 3+ days in a row, check that the
60% equity gate is working — that's almost always the cause of cost
runaway.

### Restart everything

```bash
cd /root/termsforsale-site/commercial-stack-engine
docker-compose down
docker-compose up -d
```

### Update code (after a `git pull`)

```bash
cd /root/termsforsale-site && git pull
cd commercial-stack-engine
docker-compose up -d --build  # rebuilds scraper image if Dockerfile changed
```

---

## Troubleshooting

**Postgres won't start, errors about `cse_pgdata` volume**
The volume retains data across `docker-compose down`. To wipe it:
`docker-compose down -v`. WARNING: this deletes all listings + scores
+ leads. Only use during initial setup.

**`docker-compose exec scraper npm run health` reports `MISSING` env vars**
Open `.env` and confirm the variable name + value. After saving,
`docker-compose up -d` reloads the env.

**Crexi scraper returns 0 listings**
Crexi's API path may have changed. Check `scrape_errors` for the
exact error. The Playwright fallback should kick in after 3 failures
— look for `crexi: switching to Playwright fallback` in the logs.

**LoopNet returns 0 listings**
LoopNet has aggressive anti-bot. Verify Webshare is configured. If
errors are 403/captcha, slow down (`SCRAPE_RATE_LIMIT_MS=8000`) or
restrict to one asset class for now.

**Claude API call fails with 401**
`ANTHROPIC_API_KEY` is wrong. Generate a new one at
https://console.anthropic.com.

**GHL push fails with 401**
`GHL_API_KEY` is wrong or the wrong sub-account's key. Verify in GHL
Settings → Business Profile → API Keys.

**SMS to Brooke isn't arriving**
Check `SMS_ALERTS_LIVE=true` is set. Check the GHL conversations log
for the contact ID. Verify the from number has SMS enabled in GHL.

---

## Done

If you got this far, you've shipped v1 of the Commercial Stack Engine.

The system is now:
- Sourcing 6 channels of commercial inventory 2x/day
- Caching enrichment 30 days
- Filtering on free signals before any paid API call
- Scoring on Haiku at $0.003/property
- Routing HOT leads to GHL with SMS to Brooke
- Generating LOIs on demand
- Sending daily digests at 7am AZ

Total cost: ~$15/mo. Manual ops time: ~10 min/day to triage HOT leads.
