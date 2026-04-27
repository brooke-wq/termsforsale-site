# TFS GHL Cross-Reference Matrix — 2026-04-26

**Date:** 2026-04-26
**Method:** Cross-referenced GHL workflow inventory against repo specs (CLAUDE.md, BUILD_STATUS.md, WF0*.json) to identify duplicates, conflicts, and what should be live vs off.

---

## Critical Context (from CLAUDE.md + BUILD_STATUS.md)

1. **🚨 Duplicate sender incident on 2026-04-22.** Three overlapping schedulers were sending 2×–4× to buyers. Full root cause + 6 non-negotiable rules in `docs/incidents/2026-04-22-duplicate-sender-incident.md`. Incident response = bulk unpublish of n8n workflows AND likely WF02 in GHL.

2. **Canonical sender TBD.** `buyer-deal-alerts.js` needs to be written before any buyer-broadcast workflow gets re-published. Until then, keeping things in Draft is the SAFE state.

3. **WF02 SMS gap was RESOLVED 2026-04-20.** Migrated from "Contact Tag Added" trigger to Inbound Webhook trigger. Match engine now POSTs directly to webhook. Old "Tag Added" trigger was deleted to prevent double-fires.

4. **n8n is at `n8n.dealpros.io`** (BUILD_STATUS.md is canonical; CLAUDE.md may be out of date).

5. **System status: GREEN per BUILD_STATUS.md (April 19)** but partially locked down post-incident (April 22).

---

## Section 1: Repo Spec → GHL Reality (canonical buyer lifecycle)

| Repo Spec | Intended Status | GHL Folder | GHL Actual Workflow | Actual Status | Match? | Action |
|---|---|---|---|---|---|---|
| `WF01_intake_scoring.json` (single workflow) | LIVE | Buyer Lifecycle | **Split into 2:** `WF01a — Buyer Intake Sequence` + `WF01b - Scoring` | Both **Published** | ⚠️ Split, both live | **KEEP AS-IS.** Splitting was an intentional debugging decision (note in WF04 spec recommends same pattern). Update repo spec to document the split. |
| `WF02_deal_match_send.json` | LIVE per BUILD_STATUS, but post-incident lockdown | Buyer Lifecycle | `WF02 — Deal Match & Send` | **Draft** (5 enrolled) | ❌ Mismatch | **HOLD.** Per CLAUDE.md rules, keep Draft until canonical sender (`buyer-deal-alerts.js`) is written. |
| `WF03_close_recycle.json` | LIVE | Buyer Lifecycle | `WF03 — Close & Recycle` | **Published** (1 active) | ✅ Match | **KEEP.** Working correctly. |
| `WF04_maintenance.json` (workflow_4a) | LIVE | Buyer Lifecycle | `WF04a — 90-Day Dormant Check` | **Published** | ✅ Match | **KEEP.** Working correctly. |
| `WF04_maintenance.json` (workflow_4b) | LIVE | Buyer Lifecycle | `WF04b — Quarterly POF Re-Verify` | **Published** | ✅ Match | **KEEP.** Working correctly. |
| TFS Light Qualifier (referenced in WF01 spec, form lives in GHL) | LIVE | Buyer Lifecycle | `TFS Light Qualifier - Add Tag` | **Published** | ✅ Match | **KEEP.** Form deployed at termsforsale.com/buyer-qualifier. |

**6 of 6 buyer lifecycle workflows are spec'd in the repo and implemented in GHL.** Only mismatch is WF02 status — and that's intentional post-incident lockdown.

---

## Section 2: DUPLICATE Cleanup ✅ COMPLETED 2026-04-26

| GHL Item | Action Taken |
|---|---|
| `WF01 — Buyer Intake & Scoring` (standalone at root) | ✅ DELETED — was the abandoned single-workflow draft, superseded by WF01a + WF01b in folder |
| `1.2 InvestorLift → Yellow New Inquiry (Old)` | ✅ DELETED — superseded by (New) version |
| Two `3. Pipeline Changed to Assignment Sent` duplicates | ✅ COVERED — folder 4 archive contains both; if want full delete, can revisit later |

---

## Section 3: GHL ↔ n8n Bridge Workflows

| n8n Workflow (in repo) | n8n Status | GHL Side (bridge) | GHL Status | Action |
|---|---|---|---|---|
| `01_buyer_match_engine.json` (n8n match engine) | Built per BUILD_STATUS, currently unpublished post-incident | Match engine POSTs to WF02 webhook → GHL fires WF02 | WF02 Draft (Section 1) | **HOLD.** Re-enable match engine + WF02 together once canonical sender is in place. |
| `02_notion_bridge.json` (Notion → match engine bridge) | Built per BUILD_STATUS, "DEACTIVATED pending backfill of 25 existing Ready-to-Blast Notion deals" | Polls Notion every 10 min, POSTs matched deals | N/A (n8n side only) | **HOLD until backfill.** Reactivate via `POST /api/v1/workflows/Dj7d90y3ZhuyRtjy/activate` after Asset Class / Market / Summary URL are filled on the 25 deals. |
| `03_helper_increment.json` (deal counter math) | Active per BUILD_STATUS | Called by GHL WF03 via webhook `https://n8n.dealpros.io/webhook/increment-deals` | WF03 Published | ✅ Working. KEEP. |
| `04_rollover_and_deadletter.json` (monthly counter rollover) | Built 2026-04-20, n8n workflow ID `Gw4HpFAmg2EXSo5a`, cron `0 9 1 * *` America/Phoenix | N/A (n8n cron only) | N/A | ✅ KEEP. Next fire: 2026-05-01 09:00. |
| GHL `n8n` folder → `Path 3 — Auto-Enrichment Trigger` | Draft, 1 enrolled, created 2026-04-24 | Bridge trigger from GHL to n8n for auto-enrichment | Draft | **HOLD until n8n side is ready.** Path 1 and Path 2 likely live in Buyer Lifecycle folder (WF01a, WF01b). |

GHL ↔ n8n bridges are **architecturally sound** but in **partial lockdown post-incident**. Re-enabling needs to happen as a coordinated set, not piecemeal.

---

## Section 4: GHL Workflows NOT in Repo (legacy / utility / orphan)

### 4A. Real production utilities (KEEP — not in scope of build)

| Workflow / Folder | Status | Reason to Keep | Action |
|---|---|---|---|
| `Mark as Read` (root) | Published, 23,377 enrolled | Auto-mark conversations read; high volume utility | **KEEP** — confirm intent then leave. |
| `Auto-Underwrite Trigger` (root) | Published, 5 enrolled | Recent (Apr 18), part of underwriting pipeline | **KEEP** — verify downstream automation. |
| `Track Daily Call` (Reporting folder) | Published, 810 enrolled | Daily call activity tracker | **KEEP**. |
| Website folder: Login, Signup, Offer Submission, Auto-create Portal Accounts on Signup, inquiry/walkthrough request | All Published | Real termsforsale.com site infrastructure | **KEEP all 5.** |
| `3. Terms for Sale Buyer Inquiries` folder: 4.1 Walkthrough Requested, 4.2 Booked Calendar Schedule, Buyer Interest Webhook, Spanish→Eddie | Published | Active intake/booking automation | **KEEP** — but cross-check against new WF01a to confirm no overlap |
| `5. Buying Criteria` folder: Buying Criteria Form Submit (1,923 enrolled), Auto-Tag Buyer Responses (2,012 enrolled), Appointment booked → booking-notify | Published | Oldest production workflows (since 2023) | **KEEP** but **investigate overlap** with new WF01 / TFS Light Qualifier |
| Investorlift folder: 1.1 Make an Offer, 1.2 Yellow New Inquiry (New), 1.3 Red View Full Address | Published, 5 active | InvestorLift Green/Yellow/Red tier system | **KEEP** — legitimate operational workflows not in canonical spec |
| `1. Dispo Buddy` folder: DB - Stage Change Notify | Published | Active dispo notification | **KEEP**. |
| `Reporting` folder (now consolidated tracking hub): Track Daily Call + Offer Tracking + Inquiry Tracking + Walkthrough Tracking | Mostly Published | Per Brooke's restructure 2026-04-26, single source of truth for tracking workflows | **KEEP**. |

### 4B. Cleanup status

| Folder | Status | Action |
|---|---|---|
| `3.1 Deal Marketing Campaigns` (entire folder + 4 sub-folders) | ✅ ARCHIVED 2026-04-26 | Done |
| `4. Terms for Sale Buyer Offers` | ✅ ARCHIVED 2026-04-26 (after moving Offer Tracking → Reporting) | Done |
| `Manual Actions` | 8 workflows, all Draft, 362+ orphaned active enrollments | **PENDING TIER 2** — Bulk archive after clearing enrollments. Or rebuild as published workflows tied to new Buyer Lifecycle build. |
| `Sales Workflows` | 5 workflows + 1 sub-folder, all Draft, 1 lingering active in Nevada | **PENDING TIER 2** — Sales team confirmation needed |
| `JV Program` | 3 workflows, all Draft, 1 lingering active | **PENDING TIER 2** — Confirm if JV onboarding is roadmap or archive |
| `1.1 Deal Dog Academy` | 2 workflows, all Draft, 0 enrolled | **KEEP AS-IS** — planned but not active project per Brooke |
| `ACQ` | 7 workflows, all Draft, 0 enrolled | **PENDING TIER 2** — Eddie's call |
| `Archive` (4 sub-folders + 3 workflows) | Already in Archive | **PENDING TIER 2** — Clear 171 active enrollments in Abandon/Lost workflow |
| `QR Codes` | 1 workflow, Draft, 0 enrolled | **KEEP AS-IS** — small future-use placeholder |

### 4C. Standalone workflows with status TBD (need individual click)

| Workflow | Created | Action |
|---|---|---|
| Internal Notifications | Feb 10 2023 | **VERIFY status** — pre-migration infrastructure, likely safe to keep |
| Marketing (Terms for Sale) | Nov 23 2024 | **VERIFY status** — could be active marketing or legacy |
| Operations | May 16 2023 | **VERIFY status** — oldest workflow in GHL, likely operational glue |
| Wrap Notifications | Jul 05 2023 | **VERIFY type** (folder vs workflow) and status |

---

## Section 5: Pattern Analysis — The Silent Unpublish Mystery (SOLVED)

During the audit, I flagged 4 folders where workflows had heavy historical enrollment but were sitting in Draft. I called this a "silent unpublish pattern."

**Per BUILD_STATUS.md + CLAUDE.md, this pattern is NOT random.** It's the result of:

1. **Migration prep cleanup (late March 2026)** — workflows being intentionally drafted as the team moved from old per-folder logic to the new consolidated Buyer Lifecycle architecture.
2. **April 22, 2026 duplicate-sender incident response** — additional bulk unpublishing as part of immediate lockdown.

Most "Last Updated" dates in the audit cluster around March 24-26, 2026 and April 22, 2026.

**Implication:** the audit isn't surfacing a "broken production system" — it's surfacing the **incomplete cleanup state** between an old architecture and a new one, with an incident-response lockdown layered on top.

---

## Section 6: Critical Outdated Documentation Alert

The Team SOP I generated earlier this session (`tfs-build/sop/TEAM_SOP.md`) contains OUTDATED information:

| SOP claim | Reality per BUILD_STATUS.md |
|---|---|
| "WF02 SMS gap — tags applied via n8n API sometimes don't fire WF02. Workaround: Junabelle manually re-applies via GHL UI." | RESOLVED 2026-04-20. WF02 trigger migrated to webhook. The manual workaround is no longer needed. |
| "Path forward: migrate WF02 trigger from tag to webhook" | Already done. The workaround is HISTORICAL. |

### Files that need updating after this audit:

1. `tfs-build/sop/TEAM_SOP.md` — remove WF02 SMS gap workaround section
2. `tfs-build/runbooks/tfs-lifecycle-presentation.html` slide 10 — repurpose "When it breaks" slide

---

## Section 7: Verdict Summary

### ✅ Healthy / In Sync
- Repo Buyer Lifecycle build (WF01-WF04 + Light Qualifier) — all spec'd, all built, 5/6 Published, 1 Draft (intentional hold)
- Site infrastructure workflows — all Published, all firing
- n8n match engine + helper increment + monthly rollover — built per spec, awaiting safe re-enable
- Investorlift Green/Yellow/Red tier system — production active

### ⚠️ Needs Decision
- Old folders (3, 5) Published workflows that may overlap with new Buyer Lifecycle build (Buying Criteria Form Submit vs new TFS Light Qualifier)
- Auto-Underwrite Trigger, Mark as Read — verify intentional Published status
- 4 standalone workflows with no visible status

### 🧹 Cleanup
- ✅ DONE: 3.1 Deal Marketing Campaigns archived, folder 4 archived, 2 duplicates deleted
- ⏳ PENDING: bulk archive Manual Actions, Sales Workflows, JV Program (after team conversations)
- ⏳ PENDING: clear 171 orphaned in Abandon/Lost, 362+ in Manual Actions, 1 each in Nevada Manual Calls + JV Program workflow #1

### 🚨 Coordinate before action
- WF02 publish → wait for canonical sender architecture (`buyer-deal-alerts.js`)
- ACQ folder activation → confirm with Eddie
- Investorlift "Green Win It Now Price" Draft → confirm intentional vs accidental
