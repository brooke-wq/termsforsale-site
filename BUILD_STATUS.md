# TFS Buyer Lifecycle — Build Status

**Build date:** April 17, 2026
**Migrated to self-hosted:** April 19, 2026
**Branch:** `claude/migrate-n8n-to-droplet` (based on `claude/build-tfs-buyer-lifecycle-60s5U`)
**Status:** 🟢 **SYSTEM LIVE** — full buyer lifecycle automation running end-to-end on self-hosted n8n.

---

## ✅ Complete

### GHL (Terms For Sale sub-account, location `7IyUgu1zpi38MDYpSDTs`)

- **26 custom fields** on Contacts — 21 profile fields + 5 "latest deal" fields. IDs in `tfs-build/ghl/01_custom_fields_IDS.json`.
- **9 tags** — all lifecycle tags (`buyer:new`, `buyer:active`, `buyer:cold`, `buyer:dormant`, `buyer:vip`, `engage:a-tier`, `engage:b-tier`, `engage:c-tier`, `deal:new-inventory`).
- **Buyer Lifecycle pipeline** — 12 stages. Stage 10 renamed `PSA Executed → Assigned`.
- **WF01 — Buyer Intake & Scoring** — tested OK.
- **WF02 — Deal Match & Send** — tested OK. ⚠ See "Remaining work" below — SMS delivery gap under investigation.
- **WF03 — Close & Recycle** — URL updated to self-hosted n8n on 2026-04-19. Hits `https://n8n.termsforsale.com/webhook/increment-deals`.
- **WF04a — 90-Day Dormant Check** — tested OK.
- **WF04b — Quarterly POF Re-Verify** — tested OK.

### Notion (Deal Pipeline DB, `a3c0a38fd9294d758dedabab2548ff29`)

- **5 new properties added**: `Blasted` (checkbox), `Blasted At` (date), `Asset Class` (multi-select), `Market` (rich_text), `Summary URL` (url).
- **Bridge filter aligned**: uses existing `Deal Status = Actively Marketing AND Blasted = false`.
- **Transform schema-tolerant**: reads `Asking Price`/`Price`, `Street Address`/`Address`, `Website Link`/`Summary URL` interchangeably.

### n8n (self-hosted on Paperclip Droplet — `n8n.termsforsale.com`)

- **Host:** DigitalOcean Droplet "paperclip" (`64.23.204.220`), Ubuntu 22.04, 1 GB RAM + 1 GB swap, `n8n.termsforsale.com` via Caddy reverse proxy + Let's Encrypt SSL.
- **Runtime:** n8n 2.16.1 in Docker (SQLite). Admin basic-auth gate + n8n owner login. Encryption key in 1Password.
- **Credentials:** `GHL Private Integration Token` (HTTP Header Auth), `Notion TFS Integration` (Notion API).
- **Buyer Match Engine** — active. Webhook: `https://n8n.termsforsale.com/webhook/new-deal-inventory`.
- **Helper: Deal Counter Math** — active. Webhook: `https://n8n.termsforsale.com/webhook/increment-deals`. Called by GHL WF03.
- **Notion Deal Inventory Bridge** — active. Polls Notion every 10 min, POSTs matched deals to the engine, marks Blasted.

---

## ⚠️ Remaining manual work

### 1. WF02 SMS delivery gap (GHL-side, non-blocking)

As of 2026-04-19, the n8n pipeline fires correctly end-to-end — tag `deal:new-inventory` applied to matched buyers, custom fields written with the current deal — but test SMS doesn't arrive. Tag application verified in the contact record; SMS delivery is not.

The gap is downstream of n8n — either:
- WF02 trigger not firing on the tag (check trigger config: "tag added = deal:new-inventory"?)
- WF02 enrollment blocked (contact already enrolled once + re-enrollment disabled — see "issues" item #15)
- LC Phone SMS delivery issue (check Test Partner's opt-in status + LC Phone provider config)

Debug path: manually add the `deal:new-inventory` tag to a clean test contact in GHL UI. If SMS fires → it's a re-enrollment issue on Test Partner. If it doesn't → WF02 trigger config or SMS-provider issue.

### 2. Build intake forms in GHL (~20 min)

Same as before. Light Qualifier form exists in GHL but isn't on the website yet. Full Buyer Intake — build when needed.

### 3. Smoke test with 3 real-ish contacts (~15 min)

Blocked on WF02 SMS debug above.

### 4. Decommission n8n Cloud (7-day rollback window)

1. Cloud workflows set to Inactive on 2026-04-19 (Phase 4 of migration).
2. Wait until 2026-04-26 before deleting the Cloud account.
3. Cancel Cloud subscription anytime after 24h of self-hosted running clean.

---

## 🔧 Environment

Nothing to maintain. Env values (GHL location ID, Notion DB ID, field IDs, encryption key) inlined in `/root/n8n/docker-compose.yml` on Paperclip (chmod 600, not in repo). Local `.env` holds only `N8N_BASE_URL` + `N8N_API_TOKEN` (gitignored).

---

## 📊 Cost

| | |
|---|---|
| Provisioning scripts | $0 (one-time) |
| n8n (self-hosted on Paperclip) | $0 recurring — Droplet already paid at $6/mo |
| GHL API calls | $0 (included) |
| Notion API | $0 (free plan) |
| SMS (LC Phone) | ~$0.015/msg. 100 buyers × 1 deal/week = ~$6/week |
| Email (Mailgun) | ~$0.00068/msg. Same volume = ~$0.30/week |
| Claude API | $0 (not used — pure deterministic JS) |
| **Total recurring** | **~$25–30/mo at current volume** |

Savings vs. prior n8n Cloud Starter: **$20/mo = $240/year**.

---

## 🚨 Issues & Deviations from Original Plan

### Original build-phase issues (pre-migration — see git history for context)

1. Sandbox proxy blocked outbound API calls — pivoted to user-run scripts.
2. GHL API has no custom field folder endpoint.
3. GHL option payload: objects vs strings.
4. GHL body-payload double-encoding.
5. GHL PIT scope missing.
6. n8n Cloud REST API is paid-plan only (resolved by migrating to self-hosted).
7. n8n MCP-server JWT ≠ REST API key.
8. Notion "Deal Status" is `status` type, not `select`.
9. Notion property name drift.
10. Match engine Normalize node was too strict.
11. Stale credential IDs on workflow re-import.
12. GHL multi-select fields return arrays, not comma strings.
13. `$json.contact_id` lost after PUT response.
14. GHL tag/field POSTs rejected form-encoded bodies.
15. GHL workflow "Re-enter" blocks in-flight contacts.
16. GHL Sites → Forms Builder has no import API.

### Issues found + fixed during 2026-04-19 self-hosted migration

See `tfs-build/runbooks/n8n-migration-LOG.md` for full detail. Summary:

- **7 GHL HTTP nodes missing credentials.** Source files had `credentials: null` on A/B/C tier branches (Match Engine) and Helper's Write Back. Added real credential IDs via patched files + `scripts/phase3c-push-full.js`.
- **Placeholder credential IDs** (`ghl_private_integration`, `notion_tfs`) throughout source files. Replaced with the real IDs phase2-import created (`DR2T0oJKfFcj1GFD`, `PO68ONgNhNQdY0Gh`).
- **Switch by Tier never routing.** typeVersion 3 with strict typeValidation silently dropped items. Bumped to 3.2 with `typeValidation: loose` + explicit operator type hints.
- **Write Deal Fields + Helper Write Back silently failing.** GHL accepted form-encoded body with 200 response but didn't parse customFields. Fix: JSON body with `{id: <fieldId>, field_value: ...}` shape per GHL v2021-07-28 API docs.
- **Apply Tag URL used stale `$json.contact_id`.** After the preceding PUT, `$json` is the response body — `contact_id` gone. Fix: `$('Filter & Match Buyers').item.json.contact_id`.
- **toArr helper regression** (BUILD_STATUS #12). `ready-to-import/01_buyer_match_engine.json` was missing the fix applied to Cloud. Re-added.
- **Infrastructure:** runbook assumed Nginx + certbot. Paperclip actually runs Caddy. Switched to Caddy config (simpler, auto-SSL).
- **Added 1 GB swap** to Paperclip before running n8n — 1 GB RAM droplet otherwise tight at n8n's ~300 MB resident footprint.

### What wasn't built (unchanged)

- **Slack webhook integrations** — skipped per user request.
- **Dead-letter log Notion DB** — spec in `n8n/04_rollover_and_deadletter.json`. Build in v2.
- **Monthly rollover cron** — spec in same file.
- **Both intake forms on the website** — partial.

---

## Live Endpoints

| Purpose | URL |
|---|---|
| Match engine webhook | `https://n8n.termsforsale.com/webhook/new-deal-inventory` |
| Increment-deals webhook (WF03 → n8n) | `https://n8n.termsforsale.com/webhook/increment-deals` |
| Notion bridge | runs on 10-min cron |
| n8n admin UI | `https://n8n.termsforsale.com/` (basic-auth + owner login) |

---

## Operator Runbook — what the team actually does now

### Daily
- Mark new deals in Notion as `Deal Status = Actively Marketing` + `Blasted = unchecked`
- Within 10 minutes, the bridge picks them up → match engine fires → matched buyers get tier-staggered SMS+email alerts (once WF02 SMS gap is resolved)
- Inbound buyer replies hit GHL normally and auto-tag via `buyer-response-tag.js`

### Per new buyer
- Apply tag `buyer:new` (form submission or manual)
- WF01 runs intake sequence

### Per closed deal
- Move the opportunity to "Closed" stage → WF03 fires: upgrades to VIP, bumps deals counter via self-hosted webhook, creates "confirm assignment fee" task

### Passive automations (no operator work)
- WF04a — daily dormant sweep at 8am AZ
- WF04b — daily POF re-verify at 9am AZ
- Notion bridge — every 10 min

---

## Next Phase (when ready)

1. **WF02 SMS debug** — GHL-side triage. Not blocking anything else.
2. **Light Qualifier form on termsforsale.com** — 10 min (Netlify redirect to GHL form URL).
3. **Smoke test with 3 tiered contacts** — 15 min. Needs SMS path working first.
4. **Asset-type specific matching fields** — when you refactor per-asset buy-box criteria.
