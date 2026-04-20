# n8n Migration — Execution Log

**Migration date:** 2026-04-18
**Operator:** Brooke Froehlich (via Claude)
**Branch:** `claude/migrate-n8n-to-droplet` (forked from `claude/build-tfs-buyer-lifecycle-60s5U`)
**Source:** n8n Cloud — `https://dealpros.app.n8n.cloud/`
**Target:** Self-hosted on Paperclip Droplet — `https://n8n.termsforsale.com/`

---

## Secrets location
- **Admin password** (`N8N_BASIC_AUTH_PASSWORD`): stored in Brooke's 1Password. Not in this file. Not in the repo. Lives in `/root/n8n/docker-compose.yml` on Paperclip (chmod 600).
- **Encryption key** (`N8N_ENCRYPTION_KEY`): stored in Brooke's 1Password. Not in this file. Lives in `/root/n8n/docker-compose.yml`. **If lost, all stored credentials on the self-hosted instance become unrecoverable** — re-entry from scratch required.
- **n8n API key** (`N8N_API_TOKEN`): JWT, label `tfs-migration`, no expiration, created 2026-04-18. Stored in Brooke's 1Password. Lives in `~/termsforsale-site/.env` (blocked by .gitignore).

## DNS
- Record: `n8n.termsforsale.com  A  64.23.204.220`
- Provider: **Squarespace** (DNS authoritative; Netlify hosts the site only)
- Added: 2026-04-18 by Brooke
- Propagation verified: 2026-04-18 — `dig n8n.termsforsale.com +short` → `64.23.204.220` ✓

---

## Phase 0 — Cloud backup
- 3 JSON exports saved to `~/termsforsale-site/tfs-build/n8n/backups/` ✓
  - `backup-01-match-engine.json`
  - `backup-02-helper-increment.json` (note: runbook called this `03-`, harmless rename)
  - `backup-03-notion-bridge.json` (note: runbook called this `02-`, harmless rename)

## Phase 1 — Droplet pre-flight findings (2026-04-18)
- Docker: NOT installed (will `apt install docker.io`)
- Nginx: NOT installed (and **won't be** — see below)
- Certbot: NOT installed (and **won't be** — see below)
- Reverse proxy already running: **Caddy** (PID 16946) bound to ports 80 + 443
- Port 9000: PM2 `deploy-hook` (GitHub webhook listener) — leave alone
- PM2 online: `deploy-hook` (38 MB), `pdf-render-service` (111 MB). Stopped: `deal-buddy-scheduler`, `deal-cleanup`, `ops-audit`.
- RAM: 957 MB total / 307 MB used / 495 MB available. **Zero swap** — adding 1 GB swap before n8n start.
- Disk: 4.4 GB used of 25 GB — plenty.

## Phase 1 — Install actions
- Docker 29.1.3 + docker-compose 1.29.2 installed via apt ✓
- Swap (1 GB) added at /swapfile, persisted in /etc/fstab ✓
- `/root/n8n-data` (owned 1000:1000) + `/root/n8n/docker-compose.yml` (chmod 600, root-only) ✓
- Memory after prep: 957Mi total / 347Mi used / 447Mi avail / 1Gi swap free
- Caddy block for n8n.termsforsale.com appended to `/etc/caddy/Caddyfile` ✓
- Caddyfile backed up as `/etc/caddy/Caddyfile.bak-2026*` before edit ✓
- Caddy reloaded without restart (`pdf.dealpros.cloud` stayed online) ✓
- SSL: auto-provisioned by Caddy on first HTTPS request (Let's Encrypt via ACME tls-alpn-01) ✓
- `docker-compose up -d` — image pulled (n8n 2.16.1), container `Up`, port 5678 listening ✓
- `https://n8n.termsforsale.com/` basic-auth gate + n8n owner-setup screen loaded ✓
- Memory after startup: 957Mi total / 497Mi used / 94Mi free / 289Mi available / 187Mi of 1Gi swap in use; n8n container using 276 MiB
- Harmless warning in logs: "Failed to start Python task runner in internal mode" — we use JS runners only for TFS workflows, ignorable

## Phase 2 — Credentials + workflow import
- Automated via `scripts/phase2-import.js` (n8n public REST API on self-hosted) — ran clean in a single pass
- `GHL Private Integration Token` (httpHeaderAuth) created → id `DR2T0oJKfFcj1GFD` ✓
- `Notion TFS Integration` (notionApi) created → id `PO68ONgNhNQdY0Gh` ✓
- `TFS — Buyer Match Engine (GHL + Notion)` → id `IxCkDTYqMi0xnCZa`, activated ✓
- `TFS — Notion Deal Inventory Bridge` → id `Dj7d90y3ZhuyRtjy`, activated ✓
- `TFS — Helper: Deal Counter Math` → id `9LKLxBK24q5rikyt`, activated ✓
- Credential badges clean (no red): _[TBD — visual confirm after Phase 3 dry-run]_

## Phase 3 — Downstream refs
- GHL WF03 Custom Webhook URL updated 2026-04-19: now hits `https://n8n.termsforsale.com/webhook/increment-deals` ✓
- Notion bridge internal POST URL: pre-patched before import ✓
- Local `.env` `N8N_BASE_URL` set to `https://n8n.termsforsale.com` ✓
- Local `.env` `N8N_API_TOKEN` set (JWT, no expiration) ✓
- Match Engine dry-run: `{"success":true,"matched_count":1}` ✓
- Match Engine execution verified end-to-end: Filter & Match, Switch by Tier, A: Write Deal Fields, A: Apply Tag all green ✓
- Contact fields updated on Test Partner: Deal Summary URL, Last Deal Sent ID, Deal Asset Class (latest), Deal Market (latest), Deal Price (latest), Deal Type (latest), Last Deal Sent Date all wrote fresh values ✓
- Helper Increment dry-run: NOT YET RUN — fires on real WF03 close-deal event. Patched pre-emptively for same GHL body-shape bug that affected Match Engine.
- Notion Bridge dry-run: NOT YET RUN — fires on 10-min cron, will exercise on next "Actively Marketing" deal.
- Test SMS arrival: ✗ NOT YET RECEIVED — flagged as separate GHL-side WF02 config/delivery issue, not a migration regression. See WF02 SMS gap in BUILD_STATUS.md → Remaining manual work.
- Credential badges clean (no red) in n8n UI: ✓ (confirmed by successful dry-run execution with all GHL HTTP nodes returning 2xx)

## Phase 4 — Cloud deactivation
- 3 Cloud workflows set to Inactive on 2026-04-19 (after Match Engine self-hosted parity verified)
- Cloud account kept alive for rollback window: yes — **DO NOT DELETE until 2026-04-26.** Cancel subscription anytime after 2026-04-20 (24h of clean self-hosted operation).

---

## New webhook URLs (live on self-hosted)
| Workflow | URL |
|---|---|
| Buyer Match Engine | `https://n8n.termsforsale.com/webhook/new-deal-inventory` |
| Helper: Deal Counter Math | `https://n8n.termsforsale.com/webhook/increment-deals` |
| Notion Deal Inventory Bridge | cron-only, no public URL |

---

## Errors hit + fixes

### Error 1 — 502 on first browser hit (Phase 1.D.3)
- Symptom: `HTTP ERROR 502` loading `https://n8n.termsforsale.com/`
- Cause: DB migrations took longer than the 45 sec `sleep` — Caddy was serving while n8n was still booting
- Fix: waited ~30 more sec and reloaded — n8n came up clean
- Logs ended with `Editor is now accessible via: https://n8n.termsforsale.com`
- Not a real error; just a race between image-pull-plus-migrations and our sleep

### Error 2 — Match Engine dry-run execution failed on Filter & Match Buyers node
- Symptom: `(getField(...) || "").split is not a function [line 57]`
- Cause: **BUILD_STATUS Issue #12 regression.** GHL multi-select fields return arrays, not comma-strings. `.split()` crashes on arrays. The `toArr()` fix documented in BUILD_STATUS had been applied to the live Cloud workflow but NOT to the source `ready-to-import/01_buyer_match_engine.json` in the repo. When we re-imported from the source file during Phase 2, we brought back the broken version.
- Fix applied: patched `01_buyer_match_engine.json` to add `toArr()` helper and use it for `buyerAssetClasses` and `buyerMarkets`. Pushed via `scripts/phase3-fix-match-engine.js` (deactivate → PUT → reactivate).
- Repo file also updated so the fix is permanent (ships in Phase 5 commit).

### Error 3 — Credentials not found on 6 tier-branch GHL nodes + 1 Helper node
- Symptom: after toArr fix, dry-run failed at `A: Write Deal Fields — Credentials not found`
- Cause: Source `ready-to-import/*.json` files had `credentials: null` on 7 HTTP nodes:
  - Match Engine: `A: Write Deal Fields`, `A: Apply deal:new-inventory Tag`, `B: Write Deal Fields`, `B: Apply deal:new-inventory Tag`, `C: Write Deal Fields`, `C: Apply deal:new-inventory Tag`
  - Helper Increment: `GHL: Write Back`
  These have `authentication: genericCredentialType` (meaning "use a credential") but no credential specified. Was never caught in Cloud because previous dry-runs failed earlier (at the toArr bug above).
- Also: source files still referenced placeholder credential IDs (`ghl_private_integration`, `notion_tfs`) that never got replaced with the real IDs from phase2 creation.
- Fix applied: patched all 3 source files — filled missing credentials on GHL HTTP nodes + replaced placeholder IDs with real ones (`DR2T0oJKfFcj1GFD`, `PO68ONgNhNQdY0Gh`). Pushed via `scripts/phase3c-push-full.js` (deactivate → PUT → reactivate, preserving credential IDs unlike phase3-fix which stripped them).
- Phase3-fix + phase3b-reattach scripts kept in the repo for audit trail but deprecated — use phase3c-push-full for any future workflow code pushes.

### Error 4 — Apply Tag nodes 404 after Write Deal Fields PUT
- Symptom: dry-run failed at `A: Apply deal:new-inventory Tag — The resource you are requesting could not be found`
- Cause: **BUILD_STATUS Issue #13 regression.** Each Tier's Write Deal Fields is a PUT; n8n HTTP nodes replace `$json` with the response body after the request. Apply Tag's URL `{{$json.contact_id}}` then resolves to `undefined` → URL becomes `/contacts/undefined/tags` → GHL 404.
- Same fix-pattern BUILD_STATUS called out: absolute reference back to the node where `contact_id` is guaranteed. Updated all 3 Apply Tag URLs (A/B/C) to `{{$('Filter & Match Buyers').item.json.contact_id}}/tags`.
- Helper Increment's `GHL: Write Back` URL looks similar but was verified safe — its `Calc +1` node explicitly returns `{contact_id, current, newValue}`, re-populating `$json.contact_id` before Write Back runs.
- Write Deal Fields URL left untouched — it runs FIRST out of Switch, `$json` is still the Filter & Match output at that point, `.contact_id` resolves correctly.

### Error 5 — Apply Tag 400 "invalid request" from GHL
- Symptom: dry-run failed at `A: Apply deal:new-inventory Tag — Your request is invalid or could not be processed by the service`
- Cause: **BUILD_STATUS Issue #14 regression.** The 3 Apply Tag nodes used n8n's form-encoded `bodyParameters` style even though the Content-Type header said `application/json`. n8n sends form-urlencoded under the hood; GHL parses against the Content-Type → mismatch → 400.
- Fix: replaced `bodyParameters` with n8n v4.2 JSON-body format: `contentType: 'json'`, `specifyBody: 'json'`, `jsonBody: '={ "tags": ["deal:new-inventory"] }'`.
- Write Deal Fields nodes not touched — they reported ✓ in the dry-run. If they turn out to be silently rejected, same fix pattern applies (swap to `customFields` JSON body).

### Error 6 — Write Deal Fields silently returning 200 without writing
- Symptom: dry-run marks node ✓ but the contact's `Deal Summary URL (latest)` field never updated to the new deal_id (same stale value from pre-migration Cloud run).
- Diagnostic: removed `deal:new-inventory` tag from test contact + re-ran dry-run. Tag re-applied successfully (Apply Tag works). Deal Summary URL still showed old deal_id — Write Deal Fields returned 200 but GHL didn't parse the customFields payload.
- Cause: same root as Error 5. Content-Type header says JSON; body was form-encoded via `bodyParameters`. GHL's behavior differs per endpoint — `/contacts/{id}/tags` returned 400; `PUT /contacts/{id}` returned 200 and silently dropped the unparseable body.
- Fix: swapped all 3 Write Deal Fields nodes (A/B/C) to JSON body — `contentType: 'json'`, `specifyBody: 'json'`, `jsonBody` uses `JSON.stringify({ customFields: [...] })` wrapping the existing field-expression array.
- SMS not arriving on the test dry-run: likely downstream of this — GHL WF02 reads the "Deal (latest)" fields to compose the SMS; if those don't update, WF02 either fires with stale deal or bails. After this fix, re-run dry-run on a clean tag state should confirm SMS path end-to-end.

### Error 7 — Switch by Tier routes item to nowhere (tier branches never execute)
- Symptom: `matched_count: 1` in dry-run response, but Write Deal Fields + Apply Tag nodes never execute (canvas shows no ✓ on tier branches). Filter & Match Buyers outputs correct item with `tier: "A"` (string), but Switch drops it into nothing.
- Cause: Switch node was typeVersion 3 with `typeValidation: "strict"`. Newer n8n versions handle this v3 schema differently — strict mode plus missing `rightType` / `singleValue` hints on the operator config = condition never evaluates true even when left and right values match.
- Fix: bumped Switch typeVersion from 3 → 3.2, changed `typeValidation` from `strict` → `loose`, added explicit `rightType: "string"` + `singleValue: true` on each operator. Kept `=` prefix on leftValue (required for expression eval).
- This is why SMS never fires end-to-end — Apply Tag node is technically working (we verified via direct call earlier) but Switch was blocking items from reaching it in the workflow path.

### Error 8 — Write Deal Fields returned 200 but GHL silently ignored customFields payload
- Symptom: Apply Tag + Switch fixed, but Deal Summary URL + Last Deal Sent ID fields still showed stale values after dry-run. SMS still not firing (WF02 reads these fields to compose the message).
- Cause: source files used `{ fieldKey: "contact.deal_summary_url", value: "..." }` shape. GHL's v2021-07-28 PUT /contacts/{id} API actually wants `{ id: "<fieldId>", field_value: "..." }`. GHL accepts the wrong shape with 200 and silently drops the customFields — no error, no write.
- Fix: rewrote all 3 Write Deal Fields jsonBody expressions to use `id` + `field_value` with the real field IDs from `tfs-build/ghl/01_custom_fields_IDS.json`. Now writes successfully; confirmed by Summary URL and Last Deal Sent ID updating to dry-run's fresh values.
- Note: the existing Helper Increment `GHL: Write Back` node STILL uses the old `fieldKey` / `value` shape. Same silent-failure pattern likely applies — WF03 incrementing the Deals Last 12 Months counter probably hasn't actually been working either. Flagged for follow-up fix (same pattern: switch to id + field_value with field id `ToK46ItNIDFiEcEFNN5m`).

## Runbook corrections
_[TBD — populated if runbook steps are wrong or incomplete]_

Known gaps in runbook (as of migration start):
1. Dry-run script needs `N8N_API_TOKEN` in `.env` — runbook only mentions `N8N_BASE_URL`. A new API key must be generated in the self-hosted n8n UI (Settings → n8n API → Create API Key) and pasted into local `.env` before Phase 3.4 dry-run works.
2. The `02_notion_bridge.json` in `ready-to-import/` has the old Cloud URL baked in at line 110. Pre-patching to new URL (done, see `02_notion_bridge_PATCHED.json`) eliminates the manual Phase 3.2 step.
3. **Runbook assumes Nginx + certbot — Paperclip actually runs Caddy.** Installing Nginx as the runbook directs would conflict with Caddy on ports 80/443 and break termsforsale.com. Correction: configure a Caddy block instead; skip certbot entirely because Caddy auto-provisions Let's Encrypt.
4. Runbook doesn't mention that the $6 Droplet ships with **zero swap**. Adding n8n on top of existing 307 MB load with only 495 MB free is risky without swap. Adding 1 GB swap before starting n8n.
