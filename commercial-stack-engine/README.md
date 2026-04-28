# Commercial Stack Engine

End-to-end automated commercial real estate acquisition system that
sources, enriches, scores, and routes Stack Method-qualified leads
(60%+ equity, motivated seller signals) for **Multifamily 5-50 units**
and **Mobile Home / RV Parks** nationwide.

Hot leads push to GHL with SMS to Brooke. System auto-generates LOI
drafts on demand for one-click sending.

> **Operational cost ceiling:** $50/mo (target ~$15/mo).
> **Hosted on:** existing DigitalOcean droplet alongside `n8n.dealpros.io`.

---

## What this is (and isn't)

This is a **scaffolded v1 build**. As of this commit, the following is
shipped and ready to wire up:

- ✅ Complete Postgres schema (`db/schema.sql`) — 9 tables + 2 views + 1 trigger
- ✅ Scraper service skeleton (Express, normalize, dedupe, proxy rotation, error log)
- ✅ Crexi scraper end-to-end (API path + Playwright HTML fallback)
- ✅ LoopNet, BizBuySell, MHPFinder, Craigslist, FSBO scraper *skeletons* with
  the right shape — first-run testing required to verify selectors
- ✅ Equity calculator (mortgage amortization + national appreciation index)
- ✅ County records mapper *dispatcher* + top-25 county configs
- ✅ Stack Method scoring prompt (Claude Haiku, $0.003/property)
- ✅ LOI generation prompt
- ✅ All 6 n8n workflow files (importable JSON)
- ✅ docker-compose + Dockerfile + .env.example + .gitignore
- ✅ Health-check + test-pipeline + seed-counties ops scripts

What's **not yet shipped** (next sessions):

- ❌ Per-county assessor scrapers (`county-scrapers/<state>-<county>.js`).
  The dispatcher returns null for every county — listings go through the
  pipeline but get marked `enrichment_skipped=true` and scoring won't fire.
  Tier 1 counties (`az-maricopa`, `tx-harris`, `tx-dallas`, `fl-hillsborough`,
  `ga-fulton`) are the priority — see `docs/COUNTY_RECORDS_GUIDE.md`.
- ❌ LOI PDF rendering. The n8n workflow stops at the JSON variables stage.
  Phase 2 wires it to the existing `pdf-render-service` on the droplet.
- ❌ Test fixtures + Jest tests under `tests/` directory.
- ❌ Live verification. Every scraper needs at least one `--dry-run`
  pass against a real page to confirm selectors match the current site
  template.

This is intentional — see "Build order" below. **Do not flip
`SMS_ALERTS_LIVE=true` until at least the test-pipeline E2E passes.**

---

## Operator decisions (answered)

| # | Question | Decision |
|---|---|---|
| 1 | GHL sub-account for commercial leads | **NEW sub-account "Commercial Stack" — create before Phase B deploy** |
| 2 | Buyer entity on LOIs | `Deal Pros LLC` (default kept) |
| 3 | Earnest money | **Case-by-case per deal** — operator sets in LOI form, no auto-tier |
| 4 | Inspection / DD timeline | **Case-by-case per deal** — env defaults are starting points only, LOI form requires confirmation |
| 5 | Repo location | **Standalone `brooke-wq/acquisitions` repo** — see `docs/REPO_MIGRATION.md` |
| 6 | Slack channel | `#commercial-deals` — Brooke to create + grab webhook URL |
| 7 | SMS phone for HOT leads | `+1 480-637-3117` (default confirmed) |

**Implication of #1**: until the new GHL sub-account exists, the system runs
in **Phase A** mode — scrape + enrich + score, with HOT scores accumulating
in the `scores` table. No GHL push, no SMS. Brooke can review HOT leads via
the daily digest email + a Postgres query. **Phase B** flips on once the sub
is created and `GHL_API_KEY` / `GHL_LOCATION_ID` are filled.

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│              SCRAPER SERVICE (Node.js, port 3100)           │
│  6 scrapers → normalize → upsert into `listings`           │
│  Webshare residential proxy ($10/mo)                        │
└────────────────┬────────────────────────────────────────────┘
                 │ pg_notify('new_listing')
                 ▼
┌────────────────────────────────────────────────────────────┐
│                   POSTGRES (docker)                          │
│  listings → enriched_properties → scores → leads → loi_drafts│
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│                  n8n WORKFLOWS                              │
│  01 Sourcing Orchestrator (cron 2x/day)                     │
│  02 Enrichment Pipeline (LISTEN new_listing)                │
│  03 Stack Scoring Engine (Claude Haiku batch=10)            │
│  04 Hot Lead Router (GHL push + SMS) — gated on tier=HOT    │
│  05 LOI Generator (manual trigger from GHL)                 │
│  06 Daily Digest (email + Slack, 7am AZ)                    │
└────────────────────────────────────────────────────────────┘
```

---

## Cost projection

| Item | Monthly cost |
|---|---|
| Webshare residential proxy basic | $10 |
| Claude Haiku scoring (~500 properties × $0.003) | $1.50 |
| Claude Haiku LOI generation (~20 LOIs × $0.05) | $1 |
| GHL API calls | $0 (existing sub) |
| Postgres + n8n on existing droplet | $0 |
| **Total** | **~$13/mo** |

At 2,000 properties/month: ~$25/mo. Still well under the $50 ceiling.

The `claude_cost_log` table tracks every Haiku call; the daily digest
includes 24h spend so cost surprises surface immediately.

---

## Quickstart (operator-grade)

See **[docs/SETUP.md](docs/SETUP.md)** for the full walkthrough.
Short version (assumes you have SSH access to the droplet):

```bash
# 1. SSH into the droplet
ssh root@n8n.dealpros.io

# 2. Clone + configure
cd /root
git clone https://github.com/brooke-wq/termsforsale-site.git
cd termsforsale-site/commercial-stack-engine
git checkout claude/setup-acquisition-system-YUtAb
cp .env.example .env
nano .env   # fill in REQUIRED vars

# 3. Boot Postgres + scraper-service
docker-compose up -d
docker-compose ps     # both should show "healthy"

# 4. Health check
docker-compose exec scraper npm run health

# 5. Seed county configs
docker-compose exec scraper npm run seed:counties

# 6. Smoke-test pipeline (inserts a fake listing)
docker-compose exec scraper npm run test:pipeline

# 7. Run a dry scrape on Crexi
docker-compose exec scraper node scripts/run-scraper.js crexi --dry-run --max=10

# 8. Import all 6 n8n workflows from n8n-workflows/ via n8n UI

# 9. In n8n, set credentials: Postgres, Anthropic API, GHL API
# 10. Activate workflow #1 — it cascades through 02 → 03 → 04
```

---

## Build order (do not deviate)

This is the exact build/test sequence. Don't proceed to the next step
until the previous is verified.

1. ✅ Database schema + Docker setup — Postgres running, schemas created
2. ✅ Scraper service skeleton — Express server, /health endpoint, normalize
3. ⚠️  **NEXT:** Crexi scraper end-to-end against a live page (run with
   `--dry-run --max=10` and inspect raw_json). Verify deduper + insert.
4. ⚠️  **NEXT:** County records mapper — `az-maricopa.js` first
5. ⚠️  Enrichment pipeline workflow — equity calc, motivation signals
6. ⚠️  Scoring engine — paste system prompt into n8n node, run on 5 fixtures
7. ⚠️  GHL push — verify with TEST sub-account first
8. ⚠️  Add remaining scrapers — verify each with `--dry-run`
9. ⚠️  LOI generator — wire to pdf-render-service
10. ⚠️  Daily digest — flip live after first preview email
11. ⚠️  Full test suite
12. ⚠️  Documentation pass

---

## Critical do-nots

These are bolded for a reason — every one of them violates the cost
ceiling, the safety contract, or both:

- **DO NOT use Sonnet or Opus anywhere in this system. Haiku only.**
  This single rule keeps the system at $15/mo. Haiku is hardcoded in
  `.env.example` (`CLAUDE_MODEL`) and in every prompt header.
- **DO NOT call Claude API on properties below 60% equity.** The free
  filters in the enrichment pipeline run first. If you bypass them,
  Claude spend balloons 5-10x with no improvement in lead quality.
- **DO NOT scrape without proxy rotation.** Webshare costs $10/mo and
  it's the difference between "works for years" and "IP-banned in 48
  hours". `WEBSHARE_API_KEY` is required.
- **DO NOT skip the 30-day enrichment cache.** County scrapers are
  fragile and slow — re-enriching unchanged listings is pure waste.
- **DO NOT store full HTML dumps in Postgres.** Parse, normalize,
  store JSON only. (`raw_json` in `listings` is for the parsed
  source-specific fields, not the page HTML.)
- **DO NOT auto-send LOIs.** The LOI workflow REQUIRES a manual
  approval trigger from GHL. `LOI_AUTO_GENERATE=false` is the
  killswitch.
- **DO NOT push WARM or COLD leads to GHL with SMS alerts.** Daily
  digest only. The Hot Lead Router workflow has an `Is HOT?` gate.
- **DO NOT build all 6 asset classes in v1.** MF + MHP only. Office /
  industrial / retail / storage are config additions for v2 — see
  `docs/ADDING_NEW_ASSET_CLASS.md`.

---

## File map

```
commercial-stack-engine/
├── README.md                       ← you are here
├── docker-compose.yml
├── .env.example
├── .gitignore
├── db/
│   ├── schema.sql                  ← 9 tables, 2 views, 1 trigger
│   └── migrations/                 ← future schema changes
├── scraper-service/
│   ├── server.js                   ← Express API
│   ├── Dockerfile                  ← Playwright base image
│   ├── package.json
│   ├── lib/
│   │   ├── db.js                   ← pg connection pool
│   │   ├── log.js                  ← structured logging
│   │   ├── normalize.js            ← canonical listing shape
│   │   ├── deduper.js              ← upsert + stale flag
│   │   ├── proxy-rotator.js        ← Webshare integration
│   │   ├── playwright-fetch.js     ← for JS-heavy sites
│   │   ├── cheerio-fetch.js        ← for static HTML
│   │   ├── parser-helpers.js       ← regex bank for prices/units/etc
│   │   ├── runner.js               ← scraper dispatcher
│   │   ├── equity-calc.js          ← amortization + appreciation
│   │   ├── historical-rates.js     ← Freddie Mac PMMS rates
│   │   ├── county-configs.js       ← top 25 counties metadata
│   │   └── county-records-mapper.js ← per-county dispatcher
│   ├── scrapers/
│   │   ├── crexi.js                ← (full impl)
│   │   ├── loopnet.js              ← (skeleton, needs verify)
│   │   ├── bizbuysell.js           ← (skeleton)
│   │   ├── mhpfinder.js            ← (skeleton)
│   │   ├── craigslist.js           ← (skeleton)
│   │   └── fsbo-aggregator.js      ← (skeleton)
│   ├── county-scrapers/
│   │   └── README.md               ← per-county module contract (TODO: build az-maricopa.js etc.)
│   ├── scripts/
│   │   ├── run-scraper.js          ← CLI for one source
│   │   ├── run-all-scrapers.js     ← CLI for all sources
│   │   ├── seed-counties.js        ← Loads county_configs from county-configs.js
│   │   ├── test-pipeline.js        ← E2E smoke test
│   │   └── health-check.js         ← npm run health
│   └── tests/                      ← TODO: scraper fixture tests
├── n8n-workflows/
│   ├── 01-sourcing-orchestrator.json
│   ├── 02-enrichment-pipeline.json
│   ├── 03-stack-scoring-engine.json
│   ├── 04-hot-lead-router.json
│   ├── 05-loi-generator.json
│   └── 06-daily-digest.json
├── prompts/
│   ├── stack-scoring-prompt.md     ← Claude Haiku system prompt
│   └── loi-generation-prompt.md
└── docs/
    ├── SETUP.md
    ├── STACK_METHOD_SCORING.md
    ├── COUNTY_RECORDS_GUIDE.md
    └── ADDING_NEW_ASSET_CLASS.md
```

---

## Done criteria (current state)

| Criterion | Status |
|---|---|
| All 6 scrapers running on schedule, deduped, error-handled | 1/6 done (Crexi); 5 skeletons need verify |
| Enrichment covers top 25 metros (60%+ of national inventory) | 0/25 — Tier 1 (5) is the next milestone |
| Stack scoring producing JSON output for all enriched listings ≥60% equity | Prompt ready; n8n node ready; needs end-to-end test |
| Hot leads pushing to GHL with SMS firing within 5 min of scoring | Workflow built; needs live verify |
| LOI generator producing PDF on-demand from GHL trigger | Prompt + workflow ready; PDF render step is a stub |
| Daily digest landing in inbox at 7am MST | Workflow built; needs first preview run |
| Full test suite passing | tests/ directory exists; fixtures + Jest config TODO |
| Total operational cost verified under $20/mo for first month | Projection $13; verify after 30 days |
| `npm run health-check` green | Implemented; will be green once .env is filled |
| README operator-grade | This file + docs/SETUP.md |

---

## Next sessions — priority queue

1. Run `docker-compose up -d` on the droplet, fill `.env`, verify
   health-check turns green
2. Run Crexi `--dry-run --max=10` and inspect the captured raw_json
   for shape correctness
3. Build `county-scrapers/az-maricopa.js` end-to-end against 3 known
   parcels — verify equity calc within ±5% of true value
4. Wire the n8n workflows: import all 6, set credentials, activate #1
5. End-to-end live run: scrape → enrich → score → GHL test contact
6. Verify each remaining scraper (LoopNet, BizBuySell, MHPFinder,
   Craigslist, FSBO) with `--dry-run`; fix selectors as needed
7. Build the remaining 4 Tier 1 county scrapers (`tx-harris`,
   `tx-dallas`, `fl-hillsborough`, `ga-fulton`)
8. Wire LOI PDF rendering through the existing pdf-render-service
9. Flip `SMS_ALERTS_LIVE=true` after a full week of stable scoring
10. Add Tier 2 county scrapers (the remaining 20 from `county-configs.js`)

---

## Versioning

`commercial-stack-engine` v0.1.0 — scaffold complete, no live runs yet.
