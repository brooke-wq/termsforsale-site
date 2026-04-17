# TFS Buyer Lifecycle — Build Status

**Build date:** April 16, 2026
**Branch:** `claude/build-tfs-buyer-lifecycle-60s5U`
**Total time so far:** ~3 hours (provisioning + 3 n8n imports)

---

## ✅ Done (Automated via scripts + 1 n8n UI paste-per-workflow)

### GHL (Terms For Sale sub-account, location `7IyUgu1zpi38MDYpSDTs`)
- [x] **26 custom fields** on Contacts: 21 profile fields + 5 "latest deal" fields for WF02. IDs saved in `tfs-build/ghl/01_custom_fields_IDS.json`.
- [x] **9 tags** (`buyer:new`, `buyer:active`, `buyer:cold`, `buyer:dormant`, `buyer:vip`, `engage:a-tier`, `engage:b-tier`, `engage:c-tier`, `deal:new-inventory`). IDs in `02_tags_IDS.json`.
- [x] **Buyer Lifecycle pipeline** with 12 stages (built manually — PIT scope issue, see Issues). Stage 10 renamed `PSA Executed → Assigned` per your call.

### Notion (Deal Pipeline DB, `a3c0a38fd9294d758dedabab2548ff29`)
- [x] **5 new properties added**: `Blasted` (checkbox), `Blasted At` (date), `Asset Class` (multi-select), `Market` (rich_text), `Summary URL` (url).
- [x] **Bridge filter aligned** to your live DB schema: filters on `Deal Status = "Actively Marketing"` + `Blasted = false` (not the spec's "Ready to Blast" — kept your existing lifecycle).
- [x] **Transform code schema-tolerant**: reads `Asking Price`/`Price`, `Street Address`/`Address`, `Website Link`/`Summary URL` (preserves your live naming).

### n8n (Cloud, `dealpros.app.n8n.cloud` — free trial)
- [x] **2 credentials** created: `GHL Private Integration Token` (HTTP Header Auth), `Notion TFS Integration` (Notion API).
- [x] **Workflow 1 — TFS — Buyer Match Engine (GHL + Notion)**: imported, all 7 GHL nodes credentialed, Published. Webhook URL: `https://dealpros.app.n8n.cloud/webhook/new-deal-inventory`. Dry-run verified: returns `{"success":true,"matched_count":0}`. Graceful gate added so incomplete deals don't break the chain.
- [x] **Workflow 2 — TFS — Helper: Deal Counter Math**: imported, credentialed, Published. Webhook URL: `https://dealpros.app.n8n.cloud/webhook/increment-deals`. Used by GHL WF03 to +1 the Deals Last 12 Months counter.
- [x] **Workflow 3 — TFS — Notion Deal Inventory Bridge**: imported, credentialed, Published. Polls every 10 min. **End-to-end verified** — Notion deal → transformed → POSTed to match engine → marked Blasted. All green.

---

## ⚠️ Still Manual (~60–90 min of click-work)

Everything below is GHL UI-only — the GHL Workflow Builder doesn't have an import API. Checklist below, in order.

### 1. Build 2 Intake Forms  (~20 min)

**GHL → Sites → Forms → Builder → + New Form**

Use `tfs-build/forms/intake_forms.json` as the spec. For each form field, map to the GHL custom field listed below using its ID.

#### Form 1: `TFS — Light Qualifier (Pre-Intake)` — 4 fields

| Form Field | Maps to Custom Field | Field ID |
|---|---|---|
| First Name | (built-in) contact.first_name | — |
| Phone | (built-in) contact.phone | — |
| What type of deals are you looking for? | Buyer Asset Class | `NT3w93SU9mkNugSZjHLB` |
| What markets are you buying in? | Buyer Market | `Rt1ETvZZSh3pFlFZkhro` |

**On submit:** apply tag `buyer:new`, update Last Touch Date = today, redirect to `https://termsforsale.com/thanks-qualifier`.

Slug: `/buyer-qualifier` (embed this URL in WF01 SMS copy).

#### Form 2: `TFS — Full Buyer Intake` — 16 fields

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
| Deals closed in last 12 months | Deals Last 12 Months | `ToK46ItNIDFiEcEFNN5m` |
| Are you the final decision maker? | Decision Maker | `06k53PRZ8o9hs2Zy5F4h` |
| Preferred contact method | Preferred Contact Method | `qoFIBxIWRow8HQy3GOw1` |
| Anything else we should know? | (built-in) contact.notes | — |

**On submit:** move pipeline stage to `Intake Call Scheduled`, update Last Touch Date = today, redirect to `https://termsforsale.com/thanks-intake`.

Slug: `/buyer-intake`.

### 2. Build WF01 — Buyer Intake & Scoring  (~20 min)

**GHL → Automations → Workflows → + New Workflow → Start with AI**

1. Open `tfs-build/ghl/WF01_intake_scoring.json` → copy the `ai_builder_prompt` string (the long one) → paste into GHL's AI Builder prompt field → Generate.
2. AI Builder produces a draft flow. Sanity-check ordering; fix any mis-ordered nodes by dragging.
3. Open each SMS / Email node in the generated flow and paste the copy from the `messages` block of the JSON file:
   - `WF01_SMS_Welcome` → the "Welcome SMS" node
   - `WF01_Email_Welcome` → the "Welcome email" node (subject + body)
   - `WF01_SMS_Qualifier` → the "Qualifier SMS" node
   - `WF01_SMS_BookCall` → the "Book call" SMS node
   - `WF01_SMS_Reengage_Day3` → the "Day 3 re-engage SMS" node
   - `WF01_Email_Reengage_Day7` → the "Day 7 re-engage email" node
   - `WF01_SMS_TierA_Confirm` → the Branch A confirmation SMS
   - `WF01_SMS_TierB_Confirm` → Branch B SMS
   - `WF01_SMS_TierC_Confirm` → Branch C SMS
4. **Test:** add a test contact with tag `buyer:new` manually → verify Step 1 (welcome SMS + email) fires within 1 minute.

### 3. Build WF02 — Deal Match & Send  (~15 min)

Paste `ai_builder_prompt` from `tfs-build/ghl/WF02_deal_match_send.json`. Paste messages:
- `WF02_SMS_DealAlert_A` → Tier A branch SMS
- `WF02_SMS_DealAlert_B` → Tier B branch SMS
- `WF02_SMS_DealAlert_C` → Tier C branch SMS
- `WF02_Email_DealAlert` → Email node (shared across all 3 branches)

**Critical:** Step 4 of the workflow must remove the `deal:new-inventory` tag. Verify it's there. Without it, the workflow won't re-fire on subsequent deals.

### 4. Build WF03 — Close & Recycle  (~10 min)

Paste `ai_builder_prompt` from `tfs-build/ghl/WF03_close_recycle.json`. Paste message:
- `WF03_SMS_NextDeal` → the day-7 follow-up SMS

**Critical step 2 — Webhook action:**
- Method: POST
- URL: `https://dealpros.app.n8n.cloud/webhook/increment-deals`
- Body (JSON): `{ "contact_id": "{{contact.id}}" }`

This hits the Helper: Deal Counter Math workflow which does the +1 increment on Deals Last 12 Months.

### 5. Build WF04a + WF04b — Maintenance  (~10 min)

Two separate scheduled workflows. Prompts in `tfs-build/ghl/WF04_maintenance.json`.

- **WF04a — 90-Day Dormant Check**: daily at 8am AZ. No message.
- **WF04b — Quarterly POF Re-Verify**: daily at 9am AZ. One SMS: `WF04b_SMS_Reverify`.

### 6. Smoke Test  (~15 min)

Create 3 test contacts, one per tier:

| Contact | Buyer Asset Class | Buyer Market | Price Min | Price Max | PoF on File | Deals Last 12 Months | Decision Maker | Expected Tier |
|---|---|---|---|---|---|---|---|---|
| Test A | SFR | Phoenix AZ | 100000 | 300000 | Yes | 5 | Yes | A |
| Test B | SFR | Phoenix AZ | 100000 | 300000 | Yes | 1 | Yes | B |
| Test C | SFR | Phoenix AZ | 100000 | 300000 | No | 0 | No | C |

Apply tag `buyer:active` + `engage:a-tier` / `engage:b-tier` / `engage:c-tier` to each accordingly. Then fire a test deal:

```bash
node scripts/dry-run-match-engine.js
```

Expected: Test A gets SMS + email immediately, Test B 1 hour later, Test C 4 hours later. Match engine response should show `"matched_count": 3`.

---

## 🔧 Environment Setup

Nothing to do. n8n Cloud: env values were inlined directly into the imported workflow JSONs (location ID, Notion DB ID, field IDs, cross-workflow webhook URL). No Variables needed.

---

## 📊 Cost Breakdown

| | |
|---|---|
| **Provisioning** | $0 (one-time scripts) |
| **n8n Cloud — free trial** | $0 for 14 days. After that: $20/mo Starter if you stay on Cloud, or $0 if you migrate to self-hosted on your existing Paperclip Droplet. |
| **GHL API** | $0 (included in sub-account) |
| **Notion API** | $0 (free plan) |
| **SMS sends (LC Phone)** | ~$0.015/msg. 100 buyers × 1 deal/week = ~$6/week |
| **Email sends (Mailgun)** | ~$0.00068/msg. Same volume = ~$0.30/week |
| **Total recurring** | **~$25–30/mo** at current volume (SMS + email only). Add $20/mo if staying on n8n Cloud. |

No Claude API calls in the matching engine. Pure deterministic JS.

---

## 🚨 Issues & Deviations from Original Plan

### What didn't go per plan, and what I patched

1. **Sandbox proxy blocked all outbound API calls.** I was running in an environment where every external host was 403-blocked (GHL, n8n, Notion, Slack, GitHub). Had to pivot to writing idempotent provisioning scripts you run locally. Same end result, one hop of user action. Scripts are in `scripts/` and documented in their headers.

2. **GHL API doesn't support custom field folders.** `POST /locations/{id}/customFields/folder` returns 404 — this endpoint doesn't exist in the v2 API. Folders are UI-only. All 26 fields were created at the root of Contacts. You can drag them into a "Buyer Profile" group manually if you want visual tidiness (GHL → Settings → Custom Fields → Contacts).

3. **GHL option payload format.** First attempt sent `{key, label, position}` option objects — API threw `"v.trim is not a function"`. Fix: pass plain string labels. 5 dropdown/multi-select fields affected, all recovered on second run.

4. **GHL PIT scope issue — pipeline create 401.** Your Private Integration Token has contacts + customFields + tags scopes but is missing `opportunities.readonly` / `opportunities.write`. This may not be available on your GHL plan/tier. The pipeline was built manually in GHL UI as a result (the 12 stages, with PSA Executed renamed to Assigned per your decision). No functional impact — the AI-built GHL workflows (WF01–WF04) reference stages by name and don't need the pipeline ID.

5. **n8n Cloud REST API is paid-plan only.** Your free trial blocks `/api/v1/` so the `provision-n8n.js` script couldn't auto-import. Pivoted to a manual-import path:
   - `scripts/prepare-n8n-manual-import.js` renders ready-to-import JSONs with your location ID, Notion DB ID, field IDs, and cross-workflow URL all inlined.
   - `tfs-build/n8n/MANUAL_IMPORT_GUIDE.md` + direct walkthrough to paste each workflow into the n8n UI.
   - **~15 min per workflow** of click-work (3 workflows = 45 min) — replaces what would have been a 1-command script run.
   - **Recommendation:** when trial ends, consider self-hosting on your existing Paperclip Droplet (spec already assumed self-hosted; would unblock the API path + eliminate the $20/mo subscription).

6. **n8n MCP-server JWT is not a REST API key.** The token you initially provided had `"aud": "mcp-server-api"` in its JWT payload — specifically scoped to n8n's MCP server endpoint. Even with paid tier it wouldn't work on `/api/v1/`. Documented for future reference — if you ever upgrade to Starter, generate a real API key at Settings → API.

7. **Notion DB — existing schema uses "status" property type for Deal Status.** Notion's API can't add options to `status` properties (only `select`). Pivoted the bridge filter from the spec's `Status = "Ready to Blast"` to your existing `Deal Status = "Actively Marketing"`. This actually aligns better with your current lifecycle — operators already use "Actively Marketing" as the blast-ready signal. No schema change to your status property.

8. **Property-name drift between spec and live TFS DB.** Spec called for `Market / Price / Address / Summary URL`. Live DB has `Market / Asking Price / Street Address / Website Link`. Patched the bridge transform to be schema-tolerant — reads either naming convention. No data migration needed.

9. **Match engine Normalize node was too strict.** Originally `throw new Error()` on missing asset_class/market/price. When your first real Notion deal had a blank Asset Class (the new property — no deals had it populated), the throw returned an HTML error page, which the bridge couldn't parse as JSON. Patched in-place: missing fields now flag `_incomplete` and the Filter node skips matching, returning 0 cleanly. Valid JSON response every time.

10. **Stale credential IDs on workflow re-import.** When you fixed the "Header Name" config on the GHL credential, n8n regenerated the credential's internal ID. The already-imported workflow still referenced the old ID. Manual fix (re-select credential on each node) worked; `scripts/prepare-n8n-manual-import.js` was then patched to strip placeholder credential IDs from exported JSON so future imports resolve by name only.

### What I didn't do

- **Slack webhook** — you said skip. If you want it later, add it manually in GHL WF02 Step 3 and WF03 Step 5 as a Webhook action posting to your Slack incoming webhook URL.
- **Dead-letter log** (`n8n/04_rollover_and_deadletter.json`) — defined in JSON but NOT imported. Build it later as a 2nd round if you want visibility into zero-match deals.
- **Monthly rollover cron** — same file, same deferral. Only matters after you have buyers closing multiple deals over 12+ months.
- **BUILD_STATUS.md — auto-generated from the IDS files** — you're reading it.

---

## File Map (for reference)

```
tfs-build/
├── sop/TFS_Buyer_Lifecycle_Build_SOP.md        Master SOP (unchanged from package)
├── ghl/
│   ├── 01_custom_fields.json                   Spec: 21 fields
│   ├── 01_custom_fields_IDS.json               LIVE: 26 fields with real IDs ✓
│   ├── 02_tags.json                            Spec: 9 tags
│   ├── 02_tags_IDS.json                        LIVE: 9 tags with real IDs ✓
│   ├── 03_pipeline.json                        Spec: 12 stages (with "Assigned" rename)
│   ├── 03_pipeline_IDS.json                    pipeline.id = null (user built manually)
│   ├── WF01_intake_scoring.json                AI Builder prompt + 9 messages
│   ├── WF02_deal_match_send.json               AI Builder prompt + 4 messages
│   ├── WF03_close_recycle.json                 AI Builder prompt + 1 message
│   └── WF04_maintenance.json                   AI Builder prompts (4a + 4b)
├── forms/intake_forms.json                     2 forms, 20 field mappings
├── n8n/
│   ├── 01_buyer_match_engine.json              Source workflow (patched transform)
│   ├── 02_notion_bridge.json                   Source (schema-tolerant, TFS filter)
│   ├── 03_helper_increment.json                Source (+1 math)
│   ├── 04_rollover_and_deadletter.json         Spec only, not imported
│   ├── NOTION_DB_MAPPING.json                  Live Notion property mapping
│   ├── MANUAL_IMPORT_GUIDE.md                  Step-by-step UI import walkthrough
│   └── ready-to-import/                        Pre-rendered, env-inlined, ID-patched
│       ├── 01_buyer_match_engine.json          IMPORTED + ACTIVE ✓
│       ├── 02_notion_bridge.json               IMPORTED + ACTIVE ✓
│       └── 03_helper_increment.json            IMPORTED + ACTIVE ✓

scripts/
├── provision-ghl.js                            Idempotent GHL provisioner
├── provision-notion-db.js                      Idempotent Notion DB patch
├── provision-n8n.js                            API-based n8n import (requires paid plan)
├── prepare-n8n-manual-import.js                Free-tier alternative — renders ready-to-import/
└── dry-run-match-engine.js                     Fires a test deal, verifies webhook
```

---

## Live Endpoints

| Purpose | URL |
|---|---|
| Match engine webhook | `https://dealpros.app.n8n.cloud/webhook/new-deal-inventory` |
| Increment-deals webhook (for WF03) | `https://dealpros.app.n8n.cloud/webhook/increment-deals` |
| Notion bridge | runs on 10-min cron, no external URL |

---

## Next Session — Recommended Order of Attack

1. **Build the 2 intake forms in GHL** (~20 min). Use the field ID tables above.
2. **Build WF01 via GHL AI Builder** (~20 min). Test with a dummy `buyer:new` contact.
3. **Build WF02** (~15 min). Test by manually tagging a contact `deal:new-inventory` after writing the 5 "latest deal" custom fields on them.
4. **Build WF03** (~10 min). Remember the webhook action to the increment-deals URL.
5. **Build WF04a + WF04b** (~10 min).
6. **Smoke test with 3 dummy contacts** (~15 min). Fires real SMS — do it when you're ready to accept a few cents of SMS spend.

Total: ~90 minutes. Then the system is end-to-end live.
