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

- **Team SOP published** — `tfs-build/sop/TEAM_SOP.md` (GitHub) + `TEAM_SOP_notion.md` (Notion-paste) + `TEAM_SOP_gdoc.md` (Google Doc). Covers all 4 team roles (Brooke / Eddie / Junabelle / Darise), full end-to-end flow in 12 steps, 6 mini-runbooks, troubleshooting with WF02 SMS gap workaround, escalation ladder.
- **Flow diagrams** — `tfs-build/sop/flow-diagram.md` + standalone shareable `flow-diagram.html`. Happy path + 27-node swim-lane across Notion/n8n/GHL/Buyer.
- **Team lifecycle presentation updated** — `tfs-build/runbooks/tfs-lifecycle-presentation.html`. 12 slides. Now includes separate role cards for Junabelle (CRM/Ops) and Darise (Marketing/Listings), plus dedicated "When it breaks" slide with WF02 SMS gap visual + 3-tier escalation.

---

## ⚠️ Remaining manual work

### 1. Build intake forms in GHL (~20 min)

**Light Qualifier** (the 4-field form referenced by WF01) exists in GHL but isn't embedded on the website yet. Deploy path:

- Option A: embed via iframe on `termsforsale.com/buyer-qualifier`
- Option B: Netlify redirect from `termsforsale.com/buyer-qualifier` → GHL hosted form URL

**Full Buyer Intake** (16-field post-call form) — build when needed.

### 2. WF02 SMS gap — permanent fix

**Known issue:** tags applied to GHL contacts via the API (which is how the match engine does it) occasionally don't trigger WF02 — no SMS, no email. Tags applied via the GHL UI fire WF02 reliably. Workaround documented in Team SOP: Junabelle manually re-applies the tag via UI when a buyer is missing an expected deal alert.

**Permanent fix:** swap WF02's trigger from "Contact Tag Added" to a webhook fired directly from n8n. Rough scope: 1-2 hours.

### 3. Smoke test with 3 real-ish contacts (~15 min)

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

1. **Light Qualifier form on termsforsale.com** — 10 min
2. **Smoke test with 3 tiered contacts** — 15 min
3. **WF02 SMS gap permanent fix** — 1-2 hrs
4. **Asset-type specific matching fields** — when refactoring per-asset buy-box criteria
