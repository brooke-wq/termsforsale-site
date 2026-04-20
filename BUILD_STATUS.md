# TFS Buyer Lifecycle — Build Status

**Build date:** April 17, 2026
**Last updated:** April 19, 2026
**Branch:** `claude/build-tfs-buyer-lifecycle-60s5U`
**Status:** 🟢 **SYSTEM LIVE** — full buyer lifecycle automation running end-to-end.

---

## ✅ Complete

### GHL (Terms For Sale sub-account, location `7IyUgu1zpi38MDYpSDTs`)

- **26 custom fields** on Contacts — 21 profile fields + 5 "latest deal" fields. IDs in `tfs-build/ghl/01_custom_fields_IDS.json`.
- **9 tags** — all lifecycle tags (`buyer:new`, `buyer:active`, `buyer:cold`, `buyer:dormant`, `buyer:vip`, `engage:a-tier`, `engage:b-tier`, `engage:c-tier`, `deal:new-inventory`).
- **Buyer Lifecycle pipeline** — 12 stages. Stage 10 renamed `PSA Executed → Assigned`.
- **WF01 — Buyer Intake & Scoring** — tested OK. Intake sequence + 3-way scoring.
- **WF02 — Deal Match & Send** — tested OK. Tier-staggered deal alerts (A immediate, B +1h, C +4h).
- **WF03 — Close & Recycle** — tested OK. On close: upgrades to VIP, +1 deals counter via n8n webhook, 7-day check-in SMS.
- **WF04a — 90-Day Dormant Check** — tested OK. Daily 8am AZ scheduled scan.
- **WF04b — Quarterly POF Re-Verify** — tested OK. Daily 9am AZ scheduled scan, SMS + 5-day reply window.

### Notion (Deal Pipeline DB, `a3c0a38fd9294d758dedabab2548ff29`)

- **5 new properties added**: `Blasted` (checkbox), `Blasted At` (date), `Asset Class` (multi-select), `Market` (rich_text), `Summary URL` (url).
- **Bridge filter aligned**: uses your existing `Deal Status = Actively Marketing AND Blasted = false`.
- **Transform schema-tolerant**: reads `Asking Price`/`Price`, `Street Address`/`Address`, `Website Link`/`Summary URL` interchangeably.

### n8n (self-hosted at `n8n.dealpros.io`)

- **Credentials:** `GHL Private Integration Token` (HTTP Header Auth), `Notion TFS Integration` (Notion API).
- **Buyer Match Engine** — active. Webhook: `https://n8n.dealpros.io/webhook/new-deal-inventory`.
- **Helper: Deal Counter Math** — active. Webhook: `https://n8n.dealpros.io/webhook/increment-deals`. Called by GHL WF03.
- **Notion Deal Inventory Bridge** — active. Polls Notion every 10 min, POSTs matched deals to the engine, marks Blasted.
- **Migrated off n8n Cloud trial** — now running self-hosted at $0/mo infrastructure cost.

### Team SOP + Operator Docs (April 19, 2026)

- **Team SOP published** — `tfs-build/sop/TEAM_SOP.md` (GitHub) + Notion page at https://www.notion.so/348090d675e7815e8971c41fec5a7c79. Covers all 4 team roles (Brooke / Eddie / Junabelle / Darsie), full end-to-end flow in 12 steps, 6 mini-runbooks, troubleshooting, 3-tier escalation ladder. (Historical note: the original WF02 SMS gap workaround section is now marked "Historical — fixed 2026-04-20" per the trigger migration documented in Issues & Deviations.)
- **Flow diagrams** — `tfs-build/sop/flow-diagram.md` + standalone shareable `flow-diagram.html`. Happy path + 27-node swim-lane across Notion/n8n/GHL/Buyer.
- **Team lifecycle presentation updated** — `tfs-build/runbooks/tfs-lifecycle-presentation.html`. 12 slides. Includes separate role cards for Junabelle (CRM/Ops) and Darsie (Marketing/Listings), plus a "When it breaks" slide covering the 3-tier escalation ladder.

---

## ⚠️ Remaining manual work

### 1. Build intake forms in GHL (~20 min)

**Light Qualifier** (the 4-field form referenced by WF01) exists in GHL but isn't embedded on the website yet. Deploy path:

- Option A: embed via iframe on `termsforsale.com/buyer-qualifier`
- Option B: Netlify redirect from `termsforsale.com/buyer-qualifier` → GHL hosted form URL

**Full Buyer Intake** (16-field post-call form) — build when needed.

### 2. Smoke test with 3 real-ish contacts (~15 min)

Set up one contact per tier. Verify staggered delivery, tag transitions, and SMS/email arrival.

| Contact | PoF on File | Deals 12mo | Decision Maker | Expected Tier |
|---|---|---|---|---|
| Test A | Yes | 5 | Yes | A |
| Test B | Yes | 1 | Yes | B |
| Test C | No | 0 | No | C |

Fire test deal with `node scripts/dry-run-match-engine.js`. Expected: Tier A immediate, Tier B 1h later, Tier C 4h later.

---

## 📊 Cost

| | |
|---|---|
| n8n (self-hosted on Paperclip Droplet) | $0 infrastructure |
| GHL API calls | $0 (included) |
| Notion API | $0 (free plan) |
| SMS (LC Phone) | ~$6/week at 100 buyers × 1 deal/week |
| Email (Mailgun) | ~$0.30/week |
| Claude API | $0 (not used — pure deterministic JS) |
| **Total recurring** | **~$25–30/mo at current volume** |

---

## Live Endpoints

| Purpose | URL |
|---|---|
| Match engine webhook | `https://n8n.dealpros.io/webhook/new-deal-inventory` |
| Increment-deals webhook (WF03 → n8n) | `https://n8n.dealpros.io/webhook/increment-deals` |
| Notion bridge | runs on 10-min cron |

---

## Operator Runbook

**📘 Full team-facing SOP:** [`tfs-build/sop/TEAM_SOP.md`](tfs-build/sop/TEAM_SOP.md) — buyer lifecycle operations manual for Brooke, Eddie, Junabelle, Darise. Includes RACI table, 12-step end-to-end flow, 6 mini-runbooks, troubleshooting (WF02 SMS gap workaround), 3-tier escalation ladder. Notion-paste version at [`TEAM_SOP_notion.md`](tfs-build/sop/TEAM_SOP_notion.md); Google Doc version at [`TEAM_SOP_gdoc.md`](tfs-build/sop/TEAM_SOP_gdoc.md).

**🎥 Team overview deck:** [`tfs-build/runbooks/tfs-lifecycle-presentation.html`](tfs-build/runbooks/tfs-lifecycle-presentation.html) — 12 slides. Open in a browser.

**🗺 Visual flow diagrams:** [`tfs-build/sop/flow-diagram.html`](tfs-build/sop/flow-diagram.html) — happy path + full swim-lane with break points.

### Quick reference — what the team actually does

**Daily**
- Mark new deals in Notion as `Deal Status = Actively Marketing` + `Blasted = unchecked` (Brooke)
- Within 10 minutes, the bridge picks them up → match engine fires → matched buyers get tier-staggered SMS+email alerts
- Inbound buyer replies hit GHL normally; Junabelle monitors the inbox and escalates hot replies

**Per new buyer**
- Apply tag `buyer:new` (via form submission or manual — Darise)
- WF01 runs intake sequence
- After intake call, move opportunity to "Intake Call Complete" → WF01 scoring fires

**Per closed deal**
- Move the opportunity to "Closed" stage → WF03 fires: upgrades to VIP, bumps deals counter, creates "confirm assignment fee" task for Brooke

**Passive automations (no operator work)**
- WF04a — daily dormant sweep at 8am AZ
- WF04b — daily POF re-verify at 9am AZ
- Notion bridge — every 10 min

---

## Next Phase

1. **Light Qualifier form on termsforsale.com** — ✅ live at termsforsale.com/buyer-qualifier
2. **Smoke test with tiered contacts** — ✅ completed 2026-04-20 (match engine + WF02 end-to-end verified)
3. **WF02 SMS gap permanent fix** — ✅ completed 2026-04-20 (see Issues & Deviations below)
4. **Asset-type specific matching fields** — when refactoring per-asset buy-box criteria
5. **Backfill real buyer rolodex with `buyer:active` tag** — prerequisite before production use (current buyer:active count in GHL: 1)
6. **Clear 25-deal Notion backlog** — backfill Asset Class / Market / Summary URL on Ready-to-Blast deals, then re-activate the Notion Bridge workflow (currently deactivated for safety)

---

## Issues & Deviations from Original Plan

### WF02 SMS gap — RESOLVED 2026-04-20

**Original issue.** Tags applied to GHL contacts via the API (match engine's path) occasionally didn't fire WF02 — no SMS, no email. Tags applied via the GHL UI fired reliably. Team SOP documented a manual UI re-tag workaround for Junabelle.

**Resolution.** Migrated WF02's trigger from "Contact Tag Added → deal:new-inventory" to an Inbound Webhook. Match engine now POSTs directly to the WF02 webhook in each tier branch (A/B/C) with `{ email, contact_id, tier, deal_asset_class, deal_market, deal_price, deal_type, deal_summary_url, deal_id }`. GHL identifies the contact by email. Tag application (deal:new-inventory) is preserved downstream in the match engine for history/reporting — it no longer triggers the workflow. Old "Tag Added" trigger was deleted from WF02 to prevent double-fires.

**Validated.** Direct POST to the new WF02 webhook returned `{"status":"Success: request sent to trigger execution server","id":"TiGy4XMSRkbRsjAtZiMj"}` and the email reached the contact's inbox.

**Key config.** WF02 webhook URL: `https://services.leadconnectorhq.com/hooks/7IyUgu1zpi38MDYpSDTs/webhook-trigger/ccee7507-fd4b-4a83-a468-e3b22a791b4a`. Migrated match engine exported to `tfs-build/n8n/ready-to-import/01_buyer_match_engine.json` (17 nodes, includes 3 new `POST to WF02 Webhook` HTTP nodes — one per tier branch, inserted between Write Deal Fields and Apply Tag).

### Notion Bridge field-mapping bug — RESOLVED 2026-04-20

**Root cause.** Bridge's `Transform Notion → Deal Payload` Code node was reading `page.properties` (raw Notion API shape), but n8n's Notion node returns a flattened object with `property_*` keys. Result: every deal came out with empty `asset_class`, `market`, `price=0`, etc. Compounding bug: the `POST to Match Engine` HTTP node had `bodyContentType: json` set instead of the canonical `contentType: json` + `specifyBody: json` pair — n8n V4.2 silently ignored the body and sent `{"":""}`.

**Resolution.** Rewrote Transform to read `property_*` keys with fallbacks (`property_asking_price` → `property_contracted_price`, `property_city` + `property_state` → market, `property_website_link` → summary URL, `property_property_type` → asset class), and fixed the POST body config. Snapshot of pre-fix workflow at `/tmp/bridge-wf-backup-1776647402763.json` on owner's Mac.

**Current state.** Bridge is DEACTIVATED pending backfill of the 25 existing Ready-to-Blast Notion deals (all have empty Asset Class / Market / Summary URL). Once backfilled, reactivate via `POST /api/v1/workflows/Dj7d90y3ZhuyRtjy/activate`.

### Monthly rollover workflow — BUILT 2026-04-20

**Original spec.** `tfs-build/n8n/04_rollover_and_deadletter.json` was a human-readable design spec, not an importable n8n workflow. Had to be built from scratch.

**Resolution.** Created `TFS — Monthly Deals Rollover` (n8n workflow ID `Gw4HpFAmg2EXSo5a`). Cron `0 9 1 * *` America/Phoenix. Cron-only scope for v1 (re-scoring webhook to WF01 deferred to v2). Next fire: 2026-05-01 09:00.

### Buyer list finding — discovered 2026-04-20

During smoke testing, confirmed via `POST /contacts/search` with proper tag filter that only **1 contact** in the GHL sub-account carries the `buyer:active` tag — and that contact is "Test Partner" (a JV affiliate, not a real buyer). The match engine is currently firing against an effectively empty buyer list. Before the system has real-world impact, the real buyer rolodex needs a one-time tagging pass. Added as item #5 in Next Phase.

Also noted: the match engine's `GHL: Fetch Active Buyers` node uses `/contacts/?query=buyer:active` (full-text search across indexed contact content), not a true tag filter. Works incidentally because the tag name appears in indexed content, but fragile. Candidate refactor: migrate to `POST /contacts/search` with `{ filters: [{ field: "tags", operator: "contains", value: "buyer:active" }] }`.
