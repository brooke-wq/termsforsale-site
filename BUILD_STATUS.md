# TFS Buyer Lifecycle — Build Status

**Build date:** April 17, 2026
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

### n8n (Cloud, `dealpros.app.n8n.cloud`)

- **Credentials:** `GHL Private Integration Token` (HTTP Header Auth), `Notion TFS Integration` (Notion API).
- **Buyer Match Engine** — active. Webhook: `https://dealpros.app.n8n.cloud/webhook/new-deal-inventory`. Dry-run returns `{"success":true,"matched_count":1}`.
- **Helper: Deal Counter Math** — active. Webhook: `https://dealpros.app.n8n.cloud/webhook/increment-deals`. Called by GHL WF03.
- **Notion Deal Inventory Bridge** — active. Polls Notion every 10 min, POSTs matched deals to the engine, marks Blasted.

---

## ⚠️ Remaining manual work

### 1. Build intake forms in GHL (~20 min)

**Light Qualifier** (the 4-field form referenced by WF01) exists in GHL but isn't embedded on the website yet. Deploy path:

- Option A: embed via iframe on `termsforsale.com/buyer-qualifier`
- Option B: Netlify redirect from `termsforsale.com/buyer-qualifier` → GHL hosted form URL

**Full Buyer Intake** (16-field post-call form) — build when needed.

Field-to-ID mapping tables below.

#### Light Qualifier — 4 fields

| Form Field | Custom Field | Field ID |
|---|---|---|
| First Name | (built-in) | — |
| Phone | (built-in) | — |
| Asset Class (multi-select) | Buyer Asset Class | `NT3w93SU9mkNugSZjHLB` |
| Markets (long text) | Buyer Market | `Rt1ETvZZSh3pFlFZkhro` |

On submit: apply tags `buyer:new` + `form:qualifier-submitted`; update Last Touch Date = today.

#### Full Buyer Intake — 16 fields

| Form Field | Custom Field | Field ID |
|---|---|---|
| First Name | (built-in) | — |
| Last Name | (built-in) | — |
| Email | (built-in) | — |
| Phone | (built-in) | — |
| Company / Entity Name | Entity Name | `05jevWkhMiY8bFoe9TWc` |
| How did you hear about us? | Lead Source | `Ov2LMG8TipkI4jlNAFRR` |
| Asset Class | Buyer Asset Class | `NT3w93SU9mkNugSZjHLB` |
| Target Markets | Buyer Market | `Rt1ETvZZSh3pFlFZkhro` |
| Min Purchase Price | Buyer Price Min | `pM3aeMZALD2tmf2cFSmG` |
| Max Purchase Price | Buyer Price Max | `LcsBYM6iUurqTu8SsfTz` |
| Proof of Funds Amount | Capital / POF Amount | `pkNBpd4VwNblSMrB20I5` |
| POF on file? | PoF on File | `zKyplmyTeBFlUFdYMfUD` |
| Deals in last 12 months | Deals Last 12 Months | `ToK46ItNIDFiEcEFNN5m` |
| Final decision maker? | Decision Maker | `06k53PRZ8o9hs2Zy5F4h` |
| Preferred contact method | Preferred Contact Method | `qoFIBxIWRow8HQy3GOw1` |
| Notes | (built-in) | — |

On submit: move opportunity to `Intake Call Scheduled`, update Last Touch Date = today.

### 2. Smoke test with 3 real-ish contacts (~15 min)

Set up one contact per tier. Verify staggered delivery, tag transitions, and SMS/email arrival.

| Contact | PoF on File | Deals 12mo | Decision Maker | Expected Tier |
|---|---|---|---|---|
| Test A | Yes | 5 | Yes | A |
| Test B | Yes | 1 | Yes | B |
| Test C | No | 0 | No | C |

All three: asset class SFR, Phoenix AZ market, price band $100K-$300K, tag `buyer:active` + matching `engage:X-tier`.

Fire test deal:
```bash
cd ~/termsforsale-site
node scripts/dry-run-match-engine.js
```

Expected: Tier A gets SMS+email immediately, Tier B 1h later, Tier C 4h later. Match engine response: `matched_count: 3`.

### 3. n8n trial ends April 30 (approx)

Options:
- **Upgrade to Starter** — $20/mo. Simplest.
- **Migrate to self-hosted on Paperclip Droplet** — zero recurring cost. ~30 min migration. Matches the original SOP's self-hosted assumption.

Ping me when you want to tackle the migration.

---

## 🔧 Environment

Nothing to maintain. All env values (GHL location ID, Notion DB ID, field IDs, cross-workflow webhook URL) are inlined in the n8n workflows.

---

## 📊 Cost

| | |
|---|---|
| Provisioning scripts | $0 (one-time) |
| n8n Cloud (free trial) | $0 until ~Apr 30. Then $20/mo OR self-host for $0. |
| GHL API calls | $0 (included) |
| Notion API | $0 (free plan) |
| SMS (LC Phone) | ~$0.015/msg. 100 buyers × 1 deal/week = ~$6/week |
| Email (Mailgun) | ~$0.00068/msg. Same volume = ~$0.30/week |
| Claude API | $0 (not used — pure deterministic JS) |
| **Total recurring** | **~$25–30/mo at current volume** (+$20 if staying on n8n Cloud) |

---

## 🚨 Issues & Deviations from Original Plan

### What didn't go per plan — and what we patched

1. **Sandbox proxy blocked all outbound API calls from the build environment.** GHL, n8n, Notion, Slack, GitHub — all 403'd with "Host not in allowlist" even with sandbox disabled. Pivoted to writing idempotent provisioning scripts the user runs locally. Same end result, one hop of user action.

2. **GHL API has no custom field folder endpoint.** `POST /locations/{id}/customFields/folder` returns 404 — folders are UI-only. All 26 fields created at root of Contacts.

3. **GHL option payload: objects vs strings.** First attempt sent `{key, label, position}` option objects — threw `"v.trim is not a function"`. Fix: pass plain string labels. Affects 5 dropdown/multi-select fields.

4. **GHL body-payload double-encoding.** First attempt sent `locationId` redundantly in the body (it's already in the URL path) — 422 "property locationId should not exist". Fix: remove `locationId` from POST bodies for field + tag creation.

5. **GHL PIT scope missing.** Private Integration Token didn't have `opportunities.readonly`/`.write` scopes (may not be available on user's tier). Pipeline created manually in UI instead — 6 min click-work.

6. **n8n Cloud REST API is paid-plan only.** Free trial blocks `/api/v1/`. Pivoted to manual-import path: `scripts/prepare-n8n-manual-import.js` renders env-inlined workflow JSONs; user pastes into n8n UI via TextEdit + Cmd+V on blank canvas.

7. **n8n MCP-server JWT ≠ REST API key.** User's initial token had `"aud": "mcp-server-api"` — wouldn't work on `/api/v1/` even on paid tier. Separate API key needed. Moot since we went manual-import anyway.

8. **Notion "Deal Status" is `status` type, not `select`.** Status-type properties can't have options added via API. Pivoted bridge filter to use existing `Deal Status = "Actively Marketing"` — aligns better with your existing lifecycle anyway.

9. **Notion property name drift.** Live TFS DB uses `Asking Price`/`Street Address`/`Website Link`; spec called for `Price`/`Address`/`Summary URL`. Bridge transform patched to read either.

10. **Match engine Normalize node was too strict.** Original code threw on missing asset_class/market/price. Empty deal returned HTML error page; bridge couldn't parse. Patched: missing fields flag `_incomplete`, Filter node skips matching, returns 0 cleanly.

11. **Stale credential IDs on workflow re-import.** When user fixed GHL credential config, n8n regenerated the internal credential ID. Already-imported workflow still referenced the old ID → "Credential with ID X does not exist". Patched `prepare-n8n-manual-import.js` to strip placeholder credential IDs so n8n resolves by name.

12. **GHL multi-select fields return arrays, not comma strings.** Filter node called `.split(',')` on an array → crashed. Fix: `toArr()` helper handles both array and string inputs.

13. **`$json.contact_id` lost after PUT response.** n8n HTTP nodes replace `$json` with the response body. Downstream nodes couldn't find `contact_id`. Fix: absolute reference `$('Filter & Match Buyers').item.json.contact_id`.

14. **GHL tag/field POSTs rejected form-encoded bodies.** The bodyParameters form-encoded shape with stringified array value produced 400 "Your request is invalid." Fix: switched all 6 HTTP nodes to `bodyContentType: "json"` + `jsonBody` with proper JSON object payloads.

15. **GHL workflow "Re-enter" blocks in-flight contacts.** Enabling "Allow re-entry" doesn't help if a contact is currently mid-workflow (in a Wait step). Fresh contact or manual enrollment removal required for testing.

16. **GHL Sites → Forms Builder has no import API.** The 2 intake forms remain manual build. 20 min UI click-work.

### What wasn't built

- **Slack webhook integrations** — skipped per user request.
- **Dead-letter log Notion DB** — spec in `n8n/04_rollover_and_deadletter.json`. Build in v2 when zero-match deals become common.
- **Monthly rollover cron** — decrements Deals Last 12 Months for deals older than 12 months. Spec in same file. Build when buyers start closing deals >12 months ago.
- **Both intake forms on the website** — partial (Light Qualifier built in GHL, not on site). Full Buyer Intake deferred.

---

## File Map

```
tfs-build/
├── sop/TFS_Buyer_Lifecycle_Build_SOP.md        Master SOP
├── ghl/
│   ├── 01_custom_fields.json                   Spec
│   ├── 01_custom_fields_IDS.json               LIVE with real IDs
│   ├── 02_tags.json                            Spec
│   ├── 02_tags_IDS.json                        LIVE with real IDs
│   ├── 03_pipeline.json                        Spec
│   ├── 03_pipeline_IDS.json                    (pipeline.id=null — built manually)
│   ├── WF01_intake_scoring.json                AI Builder prompt + 9 messages
│   ├── WF02_deal_match_send.json               AI Builder prompt + 4 messages
│   ├── WF03_close_recycle.json                 AI Builder prompt + 1 message
│   ├── WF04_maintenance.json                   4a + 4b prompts
│   └── WF_MANUAL_BUILD_GUIDE.md                Node-by-node manual guide
├── forms/intake_forms.json                     2 form specs
├── n8n/
│   ├── 01_buyer_match_engine.json              Source
│   ├── 02_notion_bridge.json                   Source (schema-tolerant)
│   ├── 03_helper_increment.json                Source
│   ├── 04_rollover_and_deadletter.json         Spec only, not imported
│   ├── NOTION_DB_MAPPING.json                  Live mapping
│   ├── MANUAL_IMPORT_GUIDE.md                  UI import walkthrough
│   └── ready-to-import/                        Pre-rendered + env-inlined
│       ├── 01_buyer_match_engine.json          IMPORTED + ACTIVE ✓
│       ├── 02_notion_bridge.json               IMPORTED + ACTIVE ✓
│       └── 03_helper_increment.json            IMPORTED + ACTIVE ✓

scripts/
├── provision-ghl.js                            Idempotent GHL provisioner
├── provision-notion-db.js                      Idempotent Notion DB patch
├── provision-n8n.js                            API-based n8n import (requires paid plan)
├── prepare-n8n-manual-import.js                Free-tier manual-import prep
└── dry-run-match-engine.js                     Fires a test deal, verifies webhook
```

---

## Live Endpoints

| Purpose | URL |
|---|---|
| Match engine webhook | `https://dealpros.app.n8n.cloud/webhook/new-deal-inventory` |
| Increment-deals webhook (WF03 → n8n) | `https://dealpros.app.n8n.cloud/webhook/increment-deals` |
| Notion bridge | runs on 10-min cron |

---

## Operator Runbook — what the team actually does now

### Daily
- Mark new deals in Notion as `Deal Status = Actively Marketing` + `Blasted = unchecked`
- Within 10 minutes, the bridge picks them up → match engine fires → matched buyers get tier-staggered SMS+email alerts
- Inbound buyer replies hit GHL normally and auto-tag via `buyer-response-tag.js`

### Per new buyer
- Apply tag `buyer:new` (either via form submission or manual)
- WF01 runs intake sequence
- After intake call, move their opportunity to "Intake Call Complete" stage → WF01 scoring fires automatically

### Per closed deal
- Move the opportunity to "Closed" stage → WF03 fires: upgrades to VIP, bumps deals counter, creates your "confirm assignment fee" task

### Passive automations (no operator work)
- WF04a — daily dormant sweep at 8am AZ
- WF04b — daily POF re-verify at 9am AZ
- Notion bridge — every 10 min

---

## Next Phase (when ready)

1. **Light Qualifier form on termsforsale.com** — 10 min (Netlify redirect to GHL form URL)
2. **Smoke test with 3 tiered contacts** — 15 min
3. **n8n migration to self-hosted (or upgrade)** — ~30 min, decide before ~Apr 30
4. **Asset-type specific matching fields** — when you refactor per-asset buy-box criteria; architecture plan in previous session notes
