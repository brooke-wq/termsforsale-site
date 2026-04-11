# Deal Pros LLC — Codebase Guide + Paperclip AI OS

## MANDATORY SESSION RULES

**Before ending ANY session, you MUST:**
1. Update the "Completed" section of this file with a summary of what was built/changed
2. Update the "TODO" section with any new items or remove completed ones
3. Commit and push the updated CLAUDE.md to main
4. This is NON-NEGOTIABLE — do not end a session without updating this file

**Before making ANY outbound API call that sends SMS/email:**
1. Verify test mode is active (check env vars, URL params)
2. NEVER run notify-buyers, deal-follow-up, or any messaging function without confirming it won't send live messages
3. When in doubt, ASK the user before running

## Project Overview

Deal Pros LLC is a real estate wholesale company that operates two public-facing sites and an AI-powered back-office stack called **Paperclip**:

- **Terms For Sale** (`termsforsale/`) — buyer-facing deal marketplace. Sellers submit leads, buyers browse and claim deals, VIP buyers get early access.
- **Dispo Buddy** (`dispobuddy/`) — JV partner-facing site where wholesalers submit off-market deals to Deal Pros' buyer network.
- **Netlify Functions** (`termsforsale/netlify/functions/`) — serverless API layer powering all dynamic features: CRM sync, AI underwriting, deal alerts, auth, image proxying, and more.

The stack is intentionally lightweight: plain HTML/CSS/JS on the front end, Netlify Functions on the back end, GoHighLevel (GHL) as the CRM, Notion as the deal database, and Claude AI for underwriting.

---

## Repo Structure

```
/
├── index.html                        Root redirect/landing
├── netlify.toml                      Netlify build config + /api/* redirect rules
├── termsforsale/
│   ├── index.html                    Homepage
│   ├── deal.html                     Individual deal page (dynamic, loads from Notion)
│   ├── buy-box.html                  Buyer criteria page
│   ├── vip-buyers.html               VIP buyer signup + QR funnel
│   ├── admin/                        Internal admin pages
│   ├── blog/                         Blog posts (static HTML)
│   ├── emails/                       Email templates
│   └── netlify/functions/            ALL serverless function source files
│       ├── _ghl.js                   GHL API helpers (shared)
│       ├── _claude.js                Claude API helper (shared)
│       └── *.js                      Individual functions (see below)
└── dispobuddy/
    ├── index.html                    Dispo Buddy homepage
    ├── submit-deal.html              JV deal submission form
    └── netlify/                      Dispo Buddy sub-config
```

---

## Netlify Functions Reference

All functions live in `termsforsale/netlify/functions/`. They are deployed automatically when pushed to `main`. Accessible at `/.netlify/functions/<name>` or via `/api/<name>` aliases defined in `netlify.toml`.

| Function | Path | Purpose |
|---|---|---|
| `auth-login.js` | `/api/auth-login` | GHL contact lookup by email — returns verified user for portal login |
| `auth-signup.js` | `/api/auth-signup` | Creates/upserts GHL contact on registration |
| `deals.js` | `/api/deals` | Fetches active deals from Notion (status = "Actively Marketing") |
| `deal-package.js` | `/api/deal-package` | Generates deal package content |
| `underwriting.js` | `/api/underwriting` | Claude AI underwriting analysis — triggered by GHL webhook or manual POST |
| `underwriting-poller.js` | `/api/underwriting-poller` | Polls for underwriting results |
| `notify-buyers.js` | `/api/notify-buyers` | Matches new deals to buyer criteria + fires GHL alerts |
| `acquisition-assist.js` | `/api/acquisition-assist` | Tags/alerts contacts when acquisitions match buyer criteria |
| `vip-buyer-submit.js` | `/api/vip-buyer-submit` | VIP buyer QR funnel — creates/upserts contact in GHL |
| `dispo-buddy-submit.js` | `/api/dispo-buddy-submit` | JV deal submission — creates deal in GHL "3. JV Deals" pipeline |
| `dispo-buddy-triage.js` | `/api/dispo-buddy-triage` | Triages incoming JV deals |
| `lead-intake.js` | `/api/lead-intake` | Seller lead intake from website forms |
| `seller-call-prep.js` | `/api/seller-call-prep` | Pre-call prep sheet for seller appointments |
| `buyer-relations.js` | `/api/buyer-relations` | Buyer relationship management actions |
| `equity-exit-intake.js` | `/api/equity-exit-intake` | Equity exit / creative finance intake |
| `ceo-briefing.js` | `/api/ceo-briefing` | Generates a daily CEO briefing |
| `weekly-synthesis.js` | `/api/weekly-synthesis` | Weekly pipeline/activity synthesis |
| `drive-photos.js` | `/api/drive-photos` | Proxies Google Drive folder photo list |
| `drive-thumb.js` | `/api/drive-thumb` | Proxies Google Drive thumbnails |
| `drive-image.js` | `/api/drive-image` | Returns raw image bytes from Google Drive |
| `hud-fmr.js` | `/api/hud-fmr` | HUD Fair Market Rents lookup (no API key needed) |
| `create-post.js` | `/api/create-post` | VA Post Builder — creates blog HTML via GitHub API |
| `sitemap.js` | `/api/sitemap` | Generates sitemap.xml from Google Sheet + posts-index.json |
| `alert-test-one.js` | `/api/alert-test-one` | Test function for alert tagging workflow |

### Shared Helpers

**`_ghl.js`** — GoHighLevel API utilities. Import with:
```js
const { getContact, upsertContact, addTag, removeTag, updateContactField } = require('./_ghl');
```

**`_claude.js`** — Claude API wrapper (native fetch, no SDK). Import with:
```js
const { askClaude } = require('./_claude');
```
**Always use `claude-haiku-4-5-20251001` model** in `_claude.js` calls to minimize API costs. Haiku is fast and cheap; reserve Sonnet only if output quality is provably insufficient.

---

## Environment Variables

These are set in Netlify's environment variable dashboard. **Never hardcode values — always use `process.env.VARIABLE_NAME`.**

```
GHL_API_KEY             GoHighLevel private API key
GHL_LOCATION_ID         GHL location/sub-account ID
NOTION_TOKEN            Notion integration secret
NOTION_DATABASE_ID      Main deals database
CLAUDE_API_KEY          Anthropic Claude API key
GITHUB_TOKEN            GitHub API token (for create-post VA builder)
GOOGLE_SERVICE_ACCOUNT  Google Drive service account JSON (base64)
```

---

## Coding Conventions

- **Runtime:** Node 18+ (Netlify default)
- **Module format:** CommonJS (`require` / `module.exports`) — no ES modules
- **No npm packages:** Use Node built-ins and native `fetch` only. No `axios`, `node-fetch`, or other HTTP libraries.
- **CORS headers:** Every function must return `Access-Control-Allow-Origin: *` and handle `OPTIONS` preflight
- **Error handling:** Always wrap handler body in `try/catch`, return `500` with `{ error: err.message }`
- **Logging:** Use `console.log` / `console.error` — logs appear in Netlify function logs
- **No frameworks:** Plain JS, no Express, no Hapi

### Function Template

```js
exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // your logic here
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
```

---

## Deployment

Pushing to `main` triggers an automatic Netlify deploy. There is no manual build step.

```bash
git add -A
git commit -m "describe your change"
git push origin main
```

Monitor deploys at: https://app.netlify.com/sites/termsforsale/deploys

The VS Code "Deploy to Netlify" task (Cmd+Shift+B) automates this.

---

## Key Notes for AI Agents

- `deal.html` has an `init();` call at the bottom of its `<script>` block — **do not remove it**
- **Deal page label rules (DO NOT CHANGE):**
  - "IF not Cash" field → MUST be labeled **"Entry Fee"** with **"+ CC/TC"** suffix
  - SubTo deals payment → MUST be labeled **"PITI (est)"** (NOT "Principle & Interest")
  - Seller Finance deals payment → MUST be labeled **"Principal & Interest"** (NOT "SF Payment")
  - Hybrid/Morby deals with SF portion → SF portion uses "Principal & Interest", SubTo portion uses "PITI (est)"
  - **No "Close of Escrow" or "Closes in X days"** anywhere on deal pages or cards
  - **Street address visibility rules (CRITICAL — DO NOT BREAK):**
    - **Logged-in users MUST ALWAYS see the full street address** on the deal page (header, map iframe, map badge, sidebar, anywhere it applies). This includes ALL deal types (Cash, SubTo, Seller Finance, Hybrid, Morby, etc.).
    - **Logged-out users MUST NEVER see street addresses** anywhere on the site (deal cards, map popups, deal page header, map iframe). Only City, State, ZIP.
    - **Outbound marketing NEVER shows street addresses** — emails, SMS, deal alerts, blog posts show city/state only regardless of user login status.
    - Do not remove the `loggedIn && d.streetAddress` conditional from deal page display. This rule has been broken twice in development — DO NOT BREAK IT AGAIN.
- **Photo display rules:**
  - Photos sort by `name` (alphabetical) from Google Drive API
  - Do NOT change photo sort order
  - Photo grid orientation must remain consistent (landscape main photo, square thumbs)
- `/api/*` routes are aliases for `/.netlify/functions/*` — both work; prefer `/api/` in frontend code
- Notion deal status `"Actively Marketing"` is the filter used by `deals.js` to show live deals
- GHL is the source of truth for contacts/leads; Notion is the source of truth for deal inventory
- The `termsforsale-site/lead-engine/` subdirectory is a separate Next.js app — do not modify unless specifically working on it

---

## Paperclip AI OS — Infrastructure

Paperclip is the automated AI operating system that runs Deal Pros' back-office operations.

### DigitalOcean Droplet

- **Name:** paperclip
- **IP:** 64.23.204.220
- **Login:** `ssh root@64.23.204.220` / password: `Paperclip2026!`
- **OS:** Ubuntu 22.04 LTS, Node.js 18+
- **Repo:** `/root/termsforsale-site` (auto-pulls on push via GitHub webhook on port 9000)
- **Logs:** `/var/log/paperclip.log`
- **Cost:** $6/month

### Cron Jobs (crontab on Droplet)

All jobs run via `jobs/run-job.js` which wraps Netlify functions for standalone execution.

| Job | Schedule | Trigger Tag | What It Does |
|---|---|---|---|
| underwriting-poller | */15 * * * * | `uw-requested` | Claude underwriting → GHL note |
| deal-package-poller | */15 * * * * | `pkg-requested` | Claude marketing package → GHL note |
| lead-intake | */15 * * * * | `lead-new` | Score seller leads 1-50, route hot to UW |
| seller-call-prep | */15 * * * * | `uw-complete` | Generate Eddie's call brief |
| buyer-relations | */30 * * * * | `buyer-signup` | Tag + profile new buyer signups |
| dispo-buddy-triage | */15 * * * * | `jv-submitted` | Claude viability screen (DEFERRED) |
| notify-buyers | */30 * * * * | (scans Notion) | Match deals to buyers, send SMS + email |
| deal-dog-poller | 0 * * * * | `birddog-submitted` | Review bird dog student leads |
| equity-exit-intake | */30 * * * * | `equity-exit-inquiry` | Process co-ownership inquiries |
| follow-up-nudge | */30 * * * * | `lead-warm`/`lead-hot` | Auto-SMS stale leads after 7 days |
| ceo-briefing | 0 14 * * * | (scheduled) | Daily 7am AZ briefing → SMS to Brooke |
| weekly-synthesis | 0 15 * * 1 | (scheduled) | Monday 8am AZ weekly report |
| partner-scorecard | 0 15 * * 5 | (scheduled) | Friday partner performance report |
| revenue-tracker | 0 14 1 * * | (scheduled) | Monthly P&L summary |
| watchdog | 0 */6 * * * | (scheduled) | Health check, alerts Brooke if down |

### Auto-Deploy

GitHub webhook fires on push to main → Droplet's `deploy-hook.js` (port 9000) pulls latest code automatically.

### GHL Configuration (Single Location)

- **Location ID:** `7IyUgu1zpi38MDYpSDTs` (Terms For Sale — used for all sub-accounts)
- **API Key:** stored in `GHL_API_KEY` env var
- **CEO Briefing Contact ID:** `qO4YuZHrhGTTBaFKPDYD`
- **Brooke Contact ID:** `1HMBtAv9EuTlJa5EekAL`
- **Brooke Phone:** `+15167120113`

### Tag-Based Automation Flow

```
Seller submits form → lead-new tag → lead-intake scores it
  → if hot (35+): uw-requested tag → underwriting-poller
  → uw-complete tag → seller-call-prep → call-prepped tag

Buyer signs up → buyer-signup tag → buyer-relations profiles them
  → buyer-active tag → notify-buyers matches to deals → SMS + email

JV partner submits → jv-submitted tag → dispo-buddy-triage (DEFERRED)
  → if viable: uw-requested → underwriting → partner SMS

Contact tagged pkg-requested → deal-package-poller → pkg-complete
```

### SMS & Email Confirmations

All form submissions send confirmation SMS + email:
- **Signup** → welcome SMS + branded email (via auth-signup.js)
- **VIP Signup** → VIP welcome SMS + email (via vip-buyer-submit.js)
- **Buying Criteria** → recap email + internal SMS to Brooke (via buyer-inquiry.js)
- **Deal Match** → SMS + branded deal alert email with photo (via notify-buyers.js)

### Notion Database

- **DB ID:** `a3c0a38fd9294d758dedabab2548ff29`
- **Key fields:** Street Address, City, State, Deal Type, Asking Price, Entry Fee, Deal Status, Date Funded, Amount Funded, Date Assigned
- **"Closed" detection:** Uses `Date Funded` field (not last_edited_time)

### Monthly Cost

- DigitalOcean Droplet: $6/mo
- Claude API (Sonnet): ~$4/mo at current volume
- **Total: ~$10/mo**

---

## Completed — April 11 2026 On-Site Deal URL Short-Path Fix

Buyer complaint: every deal link on the site was still rendering as
`https://termsforsale.com/deal.html?id=32f090d6-75e7-81b6-bb34-ed95b4758b76`
even though the April 9 session had migrated all outbound SMS/email/blog
links to the short `/d/{city}-{zip}-{code}` format. Root cause: the short-
path work only touched server-side functions (`notify-buyers`, `auto-blog`,
`sitemap`, `deal-package`). Client-side JS on the HTML pages was still
building URLs as `'deal.html?id=' + encodeURIComponent(id)` because the
inline handlers only had the Notion page ID in scope — not the city/zip/
dealCode needed to build a slug.

Branch: `claude/fix-domain-url-format-ZnqYQ`, commit `3e1518c`.

### Files shipped

- **`termsforsale/deal-url.js` (new)** — 30-line shared client-side slug
  builder that mirrors `termsforsale/netlify/functions/_deal-url.js`.
  Exposes `window.buildDealPath(deal)` which returns
  `/d/{city}-{zip}-{code}` from a deal object. Same slugify rules, same
  shortCode derivation (prefers Notion `dealCode` like `PHX-001` →
  `phx001`, falls back to first 8 chars of Notion UUID for legacy
  deals). Falls back to `/d/{uuid}` if neither city nor zip nor code
  are present.

- **10 HTML pages + 1 backend function** updated to use the short path:
  - `termsforsale/index.html` — `clickDeal()` uses `buildDealPath(d)`
  - `termsforsale/deals.html` — `clickDeal()` + map popup "View Deal" button
  - `termsforsale/about.html` — `clickDeal()`
  - `termsforsale/blog/index.html` — `clickDeal()`
  - `termsforsale/deal.html` — similar deals grid `<a class="sim-card">` links
  - `termsforsale/map.html` — map popup "View Deal" button
  - `termsforsale/dashboard.html` — recently viewed / saved deal row links
  - `termsforsale/deal-alerts.html` — alert card links
  - `termsforsale/admin/deals.html` — admin table row "View Deal" buttons
  - `termsforsale/netlify/functions/saved-deals.js` — GHL "DEAL SAVED"
    note URL now uses `buildDealUrl()` from `_deal-url.js` instead of
    hardcoding `https://termsforsale.com/deal.html?id=`.

Each HTML page got a `<script src="/deal-url.js"></script>` include
above the existing inline `<script>` block so `window.buildDealPath`
is defined before any handler fires.

### Backwards compatibility preserved

- `clickDeal()` keeps the old `/deal.html?id=X` URL as a fallback when
  the deal isn't in `DEAL_STORE` (defensive — shouldn't normally hit).
- `deal.html` already supports three URL formats (short `/d/` path,
  legacy `?id=UUID`, `?slug=` escape hatch) so old SMS/email links,
  bookmarks, and GHL click history all still resolve.
- `track-view.js` GET mode intentionally NOT changed — it still redirects
  legacy `?id=UUID` links with the 1500 ms timeout race, because there's
  no point paying a Notion round trip on a legacy link just to produce
  a prettier URL.

### Verification

- Client-side `buildDealPath` smoke-tested with 4 cases (full deal →
  `/d/phoenix-85016-phx001`, UUID fallback → `/d/mesa-85201-32f090d6`,
  no city/zip → `/d/tuc005`, empty → `/d/`) — 4/4 pass.
- `saved-deals.js` and `_deal-url.js` both load cleanly as modules.
- Searched the repo for any remaining `deal.html?id=` references — only
  matches left are (a) defensive fallbacks, (b) `track-view.js`
  intentional legacy handling, and (c) docs (`MASTER-REFERENCE.md/.html`).

### Follow-up discussion: GHL trigger links

User asked whether we should autogenerate GHL trigger links instead.
Answer: trigger links would be additive for outbound (SMS/email) click
analytics but wouldn't solve the on-site navigation problem, which is
what buyers were actually seeing. `notify-buyers.js` already builds
tracked short URLs with `?c=contactId`; GHL trigger links are a
separate analytics layer that can be added later if desired. The
on-site fix above is the direct answer to the user's complaint.

---

## Completed — April 9 2026 Steadily Quote Helper Refactor + Metadata Support

Branch: `claude/add-quote-metadata-support-8E65T`.

Refactor of the landlord-insurance quoting path off of Steadily. The old
`insurance-quote.js` had three problems: (1) the staging API key was
hardcoded as a fallback on line 56, (2) it used the legacy Node `https`
module instead of native `fetch` (violates the CLAUDE.md "native fetch
only" convention), and (3) the HTTP call was inlined so no other function
could reuse it. Branch name also indicated we needed to start accepting
the `metadata` / `property_details` passthrough fields the curl example
shows.

**Files shipped:**

- **`termsforsale/netlify/functions/_steadily.js` (new)** — shared Steadily
  helper, same pattern as `_claude.js` / `_ghl.js`. Prefix `_` so Netlify
  won't deploy it as a function. Exports:
  - `quoteEstimate(payload, opts?)` — POSTs to `/v1/quote/estimate` using
    the `X-Steadily-ApiKey` header (this is the header the curl example
    uses; the legacy code was sending `Authorization: Api-Key` + `x-api-key`
    neither of which matched the curl). Reads `STEADILY_API_KEY` from env
    (no hardcoded fallback — throws cleanly if unset). Routes to
    `api.staging.steadily.com` by default; set `STEADILY_LIVE=1` to hit
    `api.steadily.com`. 15s AbortController timeout. Returns
    `{status, body}` on 2xx; throws on non-2xx with `.status` + `.body`
    attached.
  - `buildPropertyPayload({address, propertyId, propertyDetails,
    propertyMetadata, metadata})` — convenience builder for single-property
    requests. Only `address` is required; everything else is optional
    passthrough so we can send the richer payload the curl example shows
    (size_sqft, year_built, property_type, stories, bedrooms, etc.) once
    the deal page knows those fields.

- **`termsforsale/netlify/functions/insurance-quote.js`** — rewritten to
  use the helper. Removed the hardcoded key. Removed the `https` module
  in favor of the shared `fetch`-based helper. Request body now accepts
  the optional `property_id`, `property_details`, `property_metadata`,
  and top-level `metadata` fields in addition to the existing address
  fields, so future callers can send richer payloads without touching
  this function again. Response projection (`available`, `annual`,
  `monthly`, `startUrl`, `propertyId`) is unchanged — backward compatible
  with the existing `deal.html` caller at line 1130.

**Docs caveat (flagged in `_steadily.js` header comment):** the Steadily
Redoc page at
`https://api.steadily.com/estimate-api/redoc#tag/Quote-Estimates/operation/quote_estimate`
returned 403 from every fetch attempt in the build environment (direct
WebFetch, curl, and alternate doc URLs all blocked). The helper therefore
returns the full parsed JSON body as-is so callers can read whichever
fields the current API version documents. `insurance-quote.js` still
projects `estimates[0].estimate.lowest` / `start_url` / `property_id`
based on the observed staging response shape the old code was parsing;
if the canonical schema names anything differently, that projection may
need adjustment. Payload shape is verified against the user-provided
curl command and is an exact match.

**Smoke tests (all pass):**
- `buildPropertyPayload()` with full inputs from the curl example produces
  byte-identical structure to the curl JSON body.
- `buildPropertyPayload()` throws on missing `address.street_address` /
  `city` / `state`.
- `quoteEstimate()` throws on empty `properties` array.
- `quoteEstimate()` throws cleanly when `STEADILY_API_KEY` is unset.
- `insurance-quote.js` loads cleanly as a module.
- `scripts/ops-audit.js` local-mode confirms all 62 function modules load
  without errors.

**Env vars required:** `STEADILY_API_KEY` (set in Netlify dashboard — the
hardcoded fallback was removed so this is now mandatory). Optional:
`STEADILY_LIVE=1` to flip from staging to production.

**Post-deploy hotfix (same day, branch
`claude/fix-steadily-property-id-required`):** The staging API returned a
422 on the first live call with `{"detail":[{"loc":["body","properties",0,
"property_id"],"msg":"field required"}]}`. Despite the curl example showing
`property_id` as just another passthrough field, Steadily actually rejects
requests that omit it. Since we couldn't reach Redoc to learn this from the
schema, we only found out via the live 422. Fixed in `insurance-quote.js`
by auto-generating a stable property_id from a SHA1 hash of
`street|city|state|zip` (lowercased), prefixed with `tfs_` — same address
always gets the same ID (good for Steadily's internal tracking). Callers
can still override via `body.property_id` if they want to pass their own.
`_steadily.js` header comment now documents the empirical schema notes
(property_id required, property_details/property_metadata/metadata
optional) so future maintainers don't repeat the mistake.

## Completed — April 9 2026 Domain Migration to Apex termsforsale.com

Brooke promoted `termsforsale.com` to the Netlify primary domain (with
`deals.termsforsale.com` auto-301'ing to it). This session migrated every
buyer-facing URL in the repo to the apex so emails, SMS, marketing copy,
SEO canonicals, and sitemap all consolidate signals on the primary brand.

**Three commits on `claude/fix-offer-form-population-zqU2f` (PR #38):**

1. **`aeaced5` — Customer-facing SMS/email/marketing** (15 files)
   - Outbound functions: `auth-signup`, `vip-buyer-submit`, `buyer-inquiry`,
     `notify-buyers`, `buyer-contract-lifecycle`, `deal-package`,
     `deal-package-poller`, `deal-follow-up`, `auto-blog`, `saved-deals`,
     `track-view`, `track-click`
   - Marketing copy: `ghl-nurture-sequence.md`, `buying-criteria.html` step 5
     display text, `emails/portal-access-granted.html`

2. **`a80f065` — Nav links, legal copy, CORS defensive fix** (23 files)
   - All 8 Dispo Buddy static pages footer link to Terms For Sale
   - 3 termsforsale static pages (`buyingcriteria-standalone`, `dispo-submit`,
     `va-post-builder`)
   - `privacy.html` legal copy, `cowork-sign.html` doc footer
   - `commercial-deal.js` + `sign-commercial-nda.js`: CORS const replaced
     with `cors(event)` helper that dynamically echoes the request Origin
     if it matches `[termsforsale.com, www.termsforsale.com,
     deals.termsforsale.com]`. Added `Vary: Origin`. Both old + new domains
     work, no transition breakage.
   - Internal docs: `MASTER-REFERENCE.md`/`.html`, both admin SOPs,
     function doc comments (`buyer-alert`, `nda-signed-webhook`,
     `underwriting`), `scripts/test-tagging.js` BASE_URL default

3. **`2a1ba57` — SEO canonicals + sitemap** (21 files)
   - Static HTML canonicals/OG/JSON-LD: root `index.html`, `termsforsale/`
     index/deals/about/commercial + `commercial-deal.html`, `blog/index.html`,
     all 8 blog posts + `deal-post-template.html`
   - `sitemap.js` BASE_URL, `robots.txt` Sitemap line,
     `blog/posts-index.json` (8 post URLs), `create-post.js` generated
     canonicals for future blog posts
   - `drive-photos.js` Referer/Origin headers now match primary domain

**Deliberately kept at `deals.termsforsale.com`:**
- `ALLOWED_ORIGINS` arrays in both commercial CORS functions (backward
  compat during transition)
- Explanatory note in `paperclip-sop.html` about the migration

**PR #38 also includes the offer/inquiry form audit** (see next section).

## Completed — April 9 2026 Offer/Inquiry Form Audit

Triage of the buyer-facing offer + inquiry forms on `deal.html`. The
confirmation email was never showing the buyer's funding structure or notes,
and the inquiry form was bypassing Netlify entirely (posted straight to a GHL
webhook → we had zero control over the buyer email).

Items shipped on branch `claude/fix-offer-form-population-zqU2f`:

- **`termsforsale/netlify/functions/submit-offer.js`** — logs the full received
  body at the top so missing fields are visible in Netlify function logs;
  accepts `structure` as a first-class field instead of having the frontend
  cram it into `notes`; the GHL note now includes buyer name/phone/email,
  funding source, target close, and notes in a clearly sectioned block; the
  opportunity name includes the amount; Brooke's SMS includes structure +
  close timeline; the confirmation email now renders every submitted field in
  a labeled table (offer amount, funding source, target close, buyer notes)
  and falls back to a visible warning if the email arrives with no details so
  the buyer knows to reply. Email error handling now actually checks the
  response status instead of logging "sent" for 4xx.
- **`termsforsale/netlify/functions/submit-inquiry.js`** (NEW) — mirror of
  submit-offer for the "Request Info" form. Logs payload, verifies contact,
  posts a comprehensive note, applies `Website Inquiry` + `Active Buyer` +
  `TFS Buyer` + `inquiry-[dealId]` tags, SMSes Brooke with the buyer's
  question, and sends the buyer a branded confirmation email that lists the
  deal, their phone/email, and the question they asked.
- **`netlify.toml`** — `/api/submit-inquiry` → `/.netlify/functions/submit-inquiry`.
- **`termsforsale/deal.html`** —
  - New `prefillDealForms()` helper that auto-populates both forms with the
    logged-in user's first/last/phone/email (called after `renderDeal()`), so
    buyers don't re-type their info every time.
  - `submitRequest()`: logged-in users now route through `/api/submit-inquiry`
    with the full deal context (`city`, `state`, `dealType`, `streetAddress`)
    — not just the raw GHL webhook. Logged-out users still hit the webhook as
    before.
  - `submitOffer()`: sends `structure`, `notes`, `coe`, `name`, `phone`,
    `email` each as their own key. Previously `structure` was prefixed onto
    `notes` and the backend never saw it as a separate field.

**Verification:** local simulation (mocked `fetch`) confirms the offer and
inquiry functions produce correct GHL notes, opportunity body, Brooke SMS,
and branded confirmation email with every submitted field rendered. Degraded
case (empty amount) now shows a red "we didn't receive offer details —
please reply" banner in the email instead of silently omitting the line.
All 60 Netlify function modules load cleanly.

## Completed — April 9 2026 Admin Console Rebuild

Rebuilt `/admin/*` into a real corporate back-office hub with shared
sidebar navigation, live stats from Notion + GHL, and proper landing
pages for every operational view.

**Shared shell** (`termsforsale/admin/admin.css` + `admin.js`):
- Navy sidebar with grouped nav (Overview / Operations / Content /
  System / External), pulsing "Live · Production" indicator, and sign-
  out button. Mobile-collapsible with overlay.
- `AdminShell.renderShell(activeKey)` injects the sidebar + mobile
  toggle into any page that has `<div class="admin-shell">` + `<main
  class="main">`. Sets the correct active nav item.
- `AdminShell.requireAuth(onReady)` shows the password gate if no
  session, otherwise runs `onReady`. Session stored in
  `sessionStorage.tfs_admin_pw`.
- `AdminShell.fetch(url, opts)` auto-injects `X-Admin-Password` header
  and re-prompts on 401.
- Shared helpers: `toast()`, `esc()`, `fmtMoney()`, `fmtNum()`,
  `fmtDate()`, `copy()`, `slugifyAddress()`.

**New pages**:
- `admin/index.html` — dashboard hub. Hero card, 4 stat tiles (active
  deals / total buyers / VIP / closed), quick-action grid, recently
  updated deals table, pipeline-mix progress bars, and the full
  Paperclip cron-job status table. Pulls live data from `/api/admin-
  stats`. Replaces the old Decap-CMS-only index.
- `admin/buyers.html` — full buyer list with search, 4-tab filter
  (All / VIP / Buy Box / No Buy Box), 4 stat cards, avatar initials,
  market/strategy chips, CSV export. Pulls from `/api/admin-buyers`.
- `admin/deals.html` — active deals from Notion (via existing
  `/api/deals`), type + state filters, per-row buttons linking to the
  public deal page + the deal-buyers lookup. Portfolio value + metro
  count stat tiles.
- `admin/blog.html` — content management landing page that links to
  the Decap CMS and explains the two collections (deal spotlights +
  education). Replaces the old bare Decap index.
- `admin/cms.html` — the raw Decap CMS loader (moved here since it
  used to live at `admin/index.html`). Reads sibling `config.yml`.

**Existing pages rewrapped**:
- `admin/deal-buyers.html` — rebuilt with the shared shell. Same
  lookup logic + CSV export, now with stat cards and navy sidebar.
- `admin/paperclip-sop.html` — rebuilt with the shared shell; all 13
  SOP sections preserved. Scoped its old styles to `.sop` so they
  don't collide with shared shell classes. Print button in topbar.

**Backend endpoints** (both gated by `ADMIN_PASSWORD`):
- `termsforsale/netlify/functions/admin-buyers.js` — POST-searches GHL
  for contacts with any buyer-identifying tag (tfs buyer / buyer-
  signup / VIP Buyer List / buy box complete / use:buyer / etc.),
  paginates up to 1000, dedupes by id, returns shape with
  `{id, name, email, phone, isVip, hasBuyBox, markets[], strategies[],
  dateAdded, lastActivity, tags[]}` plus aggregate `stats` (total,
  vip, hasBuyBox, newThisWeek). Supports `?q=`, `?filter=`, `?limit=`.
- `termsforsale/netlify/functions/admin-stats.js` — single-shot
  dashboard stats. Paginates Notion for `Deal Status = Actively
  Marketing` + `Closed`, computes breakdowns by Deal Type and State,
  returns the 5 most recently edited active deals, and does cheap
  first-page GHL tag counts for total + VIP buyers.

**netlify.toml** — added `/api/admin-buyers` and `/api/admin-stats`
redirects.

**Nav addresses the user's complaint**: the Buyer List is now a top-
level sidebar item on every admin page, and the per-deal buyer lookup
is separate (Deal Buyer Lookup) so the two are no longer conflated.

## Completed — April 9 2026 track-view Hang Hotfix (PR #40)

Day 2 follow-up SMS link (`https://deals.termsforsale.com/api/track-view?c=…&d=…&r=1`)
was spinning forever for buyers. Root cause: the GET handler was `await`-ing
up to 5 serial GHL/Notion API hops (`getContact` + `addTags` + `postNote` +
Notion page fetch + JV-partner GET + JV-partner PUT) before returning the 302.
Any cold start or slow hop pushed the click past Netlify's 10s function timeout.

**Fix shipped in `termsforsale/netlify/functions/track-view.js` (commit 7f1de56):**
- GET mode now ALWAYS redirects. Tracking writes (addTags + postNote) are
  raced against a 1500 ms timeout — if GHL hangs we redirect anyway.
- Dropped the `r=1` requirement. If a carrier strips the trailing `&r=1`, the
  link still lands the buyer on `/deal.html?id=…` instead of falling through
  to POST mode and returning raw JSON.
- Dropped `getContact` (only used for a log line, one wasted round trip).
- Dropped `incrementJvPartnerViews` entirely — 3 serial API hops on a Dispo
  Buddy metric path this file flags as not-yet-wired-up, and the most likely
  actual hanger. If we want buyer_views metrics back, they belong in a
  separate fire-and-forget job, not in the redirect hot path.
- Missing `dealId` falls back to `/deals.html` instead of a 400 JSON.
- POST mode (frontend view tracking from `deal.html`) unchanged.

Smoke-tested all 8 code paths locally; timed a single GET with a stubbed-hang
underlying fetch — redirect fires in ~1500 ms (vs the previous ≥10 s timeout).

## Completed — April 9 2026 Alert-Preference A/B/C Handler

The Day 2 follow-up SMS in `deal-follow-up.js:180` prompts buyers with:
> Last ping on [deal]. Want me to:
> A) Keep sending you stuff like this
> B) Tighten to [city] only
> C) Pause alerts for now
> Reply A/B/C.

But `buyer-response-tag.js` only matched `1/2/3` + `IN/MAYBE/PASS`, so every
A/B/C reply was logged as "unmatched" and had zero effect. This session wires
it up end-to-end.

**Tag model** (3 mutually exclusive preference tags — writing one clears the other two):

| Reply | Tag | Semantic | Enforcement |
|---|---|---|---|
| A | `pref-keep-all` | Default — no change | none (no-op) |
| B | `pref-market-only` | Only deals in buyer's `targetCities` | `matchesBuyBox` hard-rejects non-matching city; tier-3 fallback also rejects |
| C | `alerts-paused` | Stop all future alerts | `fetchAllBuyers` filters these out of the buyer universe entirely |

All three also stamp `buyer-responded` so the follow-up sprint stops on that deal.

**Changes shipped:**

- `termsforsale/netlify/functions/buyer-response-tag.js`
  - Added 6 new patterns for A/B/C (bare letter, punctuated `a.`/`a)`, and
    natural-language aliases: `keep`, `keep sending`, `tighten`, `market only`,
    `city only`, `pause`, `pause alerts`, `stop for now`).
  - Split `ALL_RESPONSE_TAGS` into `DEAL_RESPONSE_TAGS` (IN/MAYBE/PASS family)
    and `PREF_TAGS` (A/B/C family). Pref replies now only clear other prefs;
    deal replies only clear deal sprint tags. No cross-contamination.
  - Note heading switches between "BUYER RESPONSE" (deal) and "ALERT PREF" (pref).
  - Response payload adds `kind: 'deal' | 'pref'` so the GHL workflow can
    branch downstream if needed.

- `termsforsale/netlify/functions/notify-buyers.js`
  - `fetchAllBuyers` skips any contact tagged `alerts-paused` — paused buyers
    are invisible to notify-buyers until the tag is manually removed.
  - `matchesBuyBox` reads `contact.tags` and if `pref-market-only` is set,
    converts the existing soft city match into a hard reject (no target
    cities on buy box → fail; target cities set but deal city not in list
    → fail). State/price/structure/etc. criteria still apply as before.
  - Tier 3 (state-only fallback) bypasses `matchesBuyBox`, so the same
    `pref-market-only` check is inlined into the tier 3 buyer loop.

**Smoke tests (temp harness, not checked in):**
- 27 reply-parsing cases (1/2/3 regression + all new A/B/C patterns + unmatched) — 27/27 pass
- 5 tag-swap side-effect cases — verified pref replies clear pref tags only and deal replies clear deal tags only, no cross-contamination — 5/5 pass
- `notify-buyers.js` static + `require()` load test — passes

**Reuses existing GHL workflow**: no new webhook needed. The existing
"Customer Reply" workflow already POSTs every inbound SMS/email to
`/api/buyer-response-tag`; the new patterns just extend the match table.

**Open caveat:** a buyer who types a bare `a`, `b`, or `c` outside the Day 2
follow-up context will still get tagged — same ambiguity the existing 1/2/3
matcher has. Low cost (recoverable by tag removal), consistent with the
status quo.

## Completed — April 9 2026 Maintenance Audit

Triage session that caught two silent regressions that were breaking buyer
targeting and ~20 Netlify functions. Items shipped:

- **Contact Role bug on signup** — `auth-signup.js` was creating contacts
  without setting Contact Role = `['Buyer']`. `notify-buyers.js` filters by
  Contact Role === 'Buyer' → every website signup since real auth launched
  (April 3) was invisible to the deal blast matcher. Fixed at
  `termsforsale/netlify/functions/auth-signup.js:93-99` (explicit custom field
  `id: agG4HMPB5wzsZXiRxfmR`, value `['Buyer']`).
- **notify-buyers missing sent:[slug] tag** — it only wrote
  `alerted-[shortId]` and `new-deal-alert`, never the `sent:[slug]` tag the
  admin Deal Buyer List dashboard queries. Historical data was backfilled by
  `scripts/migrate-sent-tags.js` on April 9, but every new blast since was
  invisible to `/admin/deal-buyers.html`. Fixed at
  `termsforsale/netlify/functions/notify-buyers.js` — added `slugifyAddress()`
  helper (same rules as migration script) and appended `sent:[slug]` to the
  tag array in `triggerBuyerAlert()`.
- **CATASTROPHIC: _ghl.js rewrite on April 7 broke ~20 functions** — commit
  `e9a4b4c` ("Add files via upload") replaced `_ghl.js` with a commercial-lane-
  only version, removing `cfMap`, `CF_IDS`, `findByTag`, `searchContacts`,
  `getContact`, `postNote`, `addTags`, `removeTags`, `swapTags`, `updateContact`,
  `updateCustomFields`, `sendSMS`, `sendEmail`, and changed `upsertContact`
  signature. Silently broke: `buy-box-save`, `vip-buyer-submit`, `buyer-inquiry`,
  `buyer-relations`, `buyer-import`, `buyer-response-tag`, `lead-intake`,
  `equity-exit-intake`, `track-view`, `submit-offer`, `booking-notify`,
  `follow-up-nudge`, `saved-deals`, `seller-call-prep`, `weekly-synthesis`,
  `deal-dog-poller`, `deal-package-poller`, `ceo-briefing`, `partner-scorecard`.
  Restored all legacy exports and made `upsertContact` polymorphic (detects
  3-arg legacy call vs 1-arg commercial call). Now exports 24 functions total —
  14 legacy + 10 commercial lane. Ops audit confirms all 59 function modules
  load cleanly and every `_ghl.js` destructure resolves.
- **`scripts/backfill-contact-role.js`** — retroactive backfill for existing
  website signups missing Contact Role = Buyer. Scans GHL contacts tagged
  `buyer-signup`, `tfs buyer`, `TFS Buyer`, `use:buyer`, `Website Signup`,
  `VIP Buyer List`, `buy box complete`; deduplicates by id; sets
  `Contact Role = ['Buyer']` if missing. Supports `DRY_RUN=1` and `MAX_CONTACTS`.
- **`scripts/ops-audit.js`** — regular maintenance health check. Validates
  (1) all function modules load without errors, (2) every `_ghl.js` destructure
  resolves to a real export, (3) sampled buyer contacts have Contact Role set,
  (4) recent "Started Marketing" deals have `sent:[slug]` tags in GHL,
  (5) required env vars are present. Run `node scripts/ops-audit.js` for full
  audit, `SKIP_REMOTE=1 node scripts/ops-audit.js` or `--quick` for local
  static checks only. Exit code 1 if any FAIL items.

**Run on Droplet to finish the backfill:**
```
cd /root/termsforsale-site
git pull origin main
DRY_RUN=1 node scripts/backfill-contact-role.js    # preview
node scripts/backfill-contact-role.js              # apply
node scripts/ops-audit.js                          # verify
```

**Recommended: add weekly PM2 cron for ops-audit:**
```
pm2 start scripts/ops-audit.js --name ops-audit --no-autorestart --cron "0 13 * * 1"
pm2 save
```
Monday 6am AZ. Sends findings to stdout / `/var/log/paperclip.log` for review.

## Completed — April 2026 Audit/Stabilization Session

All items below were completed and deployed:

### Infrastructure
- **File-based dedup** (`jobs/sent-log.js`) on ALL outbound messaging functions: notify-buyers, deal-follow-up, ceo-briefing, weekly-synthesis, follow-up-nudge
- **All 14 cron jobs** tested individually and re-enabled on Droplet (only dispo-buddy-triage remains disabled)
- **notify-buyers test mode fix** — `test=true` or `deal_id` param now forces test mode regardless of `DEAL_ALERTS_LIVE` env var
- **deal-follow-up** — capped at 1 message per contact per run, runs 8am-8pm AZ only
- **notify-buyers** — runs 8am-8pm AZ only

### Site Structure
- **Homepage** (`/`) = about/hero page with working search → redirects to `/deals.html`
- **Deals page** (`/deals.html`) = split-screen map + deal cards with sort/filter
- **Old `/about.html`** → 301 redirects to `/`
- **`/browse`** and **`/deals`** → redirect to `/deals.html`

### Deal Page
- **Terms table** restructured: Price → Entry → ARV → SubTo details → SF details
- **"Down Payment" removed** — uses "Entry Fee" per CLAUDE.md rules
- **Deal type matching** — case-insensitive (`Subject To` = `SubTo` = `sub-to`)
- **HOA formatting** — extracts dollar amount, shows "$129/mo HOA" not raw text
- **Photo grid** — 1 large + 2 thumbs, 380px height desktop, 260px mobile
- **Photos** sorted by `name` (alphabetical) from Google Drive API
- **Share buttons** — Text, Email, Copy Link on every deal page
- **Address hidden** from logged-out users in map popups

### Auth & Funnel
- **All login/signup** uses `/api/auth-login` and `/api/auth-signup` (not raw webhooks)
- **Welcome SMS + email** sent on every signup via auth-signup.js
- **Post-signup** → auto-redirect to `/buying-criteria.html`
- **Login** → returns `hasBuyBox` and `isVip` from GHL tags; nudges buy box completion
- **GHL portal bridge** — "My Portal" links pass email via `?email=` param
- **Signup form** — simplified to name, email, phone, password only

### Automations
- **buyer-response-tag.js** — auto-tags buyer responses. Deal sprint replies (1/2/3, IN/MAYBE/PASS) → buyer-interested / buyer-maybe / buyer-pass + deal-hot/deal-warm/deal-paused to stop follow-up sprint. Day-2 alert-preference replies (A/B/C) → pref-keep-all / pref-market-only / alerts-paused; notify-buyers skips paused contacts entirely and enforces hard city match for market-only contacts.
- **booking-notify.js** — sends SMS to Brooke on new bookings (was previously just logging)
- **Tracked links** — all deal URLs in alert emails/SMS route through `/api/track-view` for GHL logging
- **Deal view tracking** — website views (logged-in) + email clicks both tracked on GHL contact
- **Auto-blog posts** — `auto-blog.js` creates deal spotlight posts via GitHub API when notify-buyers processes new deals
- **Saved deals** — sync to GHL with notes + "Active Saver" tag

### Dashboard
- **Recently Viewed** tab showing last 20 deals the buyer viewed
- **Deals Viewed** stat card

### SEO
- **Sitemap** updated to use Notion API (not Google Sheets), includes all pages

### Offer Pipeline
- **submit-offer.js** — creates GHL opportunity in "Buyer Inquiries" → "Offer Submitted", notifies Brooke via SMS, sends buyer confirmation email, syncs property address to opportunity
- **Pipeline ID:** `JqPNGn6dao8hBfTzbLRG` (env: `GHL_PIPELINE_ID_BUYER`)
- **Stage ID:** `cd4df0dc-731b-4885-a54e-2c2a3bf7acfc` (env: `GHL_STAGE_OFFER_RECEIVED`)

### Authentication System
- **Real password auth** — PBKDF2 hashing (10,000 iterations + random salt)
- **Password hash** stored on GHL contact custom field (auto-generated ID, matched by value format `hex32:hex128`)
- **Password reset** — 6-digit code via email + SMS, 15-min expiry, stored on contact (matched by value format `6digits:13digitTimestamp`)
- **Legacy users** (pre-April 3 2026) — no hash stored, let in but flagged as `legacyUser`
- **Endpoints:** `/api/auth-signup`, `/api/auth-login`, `/api/auth-reset`
- **GHL custom fields:** `tfs_password_hash` (Large Text), `tfs_reset_code` (Large Text) — note: GHL assigns auto-generated IDs, code matches by value pattern not field key

### GHL Webhooks (configured by Brooke)
- Calendar booking webhook → `/api/booking-notify`
- Customer Reply (SMS/Email) workflow → `/api/buyer-response-tag`

---

## Completed — Dispo Buddy Site Build (April 2026)

### Site Pages (all in `dispobuddy/`)
- **Landing page** (`index.html`) — hero, pitch, process timeline, deal types, buyers map callout, social proof, CTA
- **Deal submission form** (`submit-deal.html`) — 4-step wizard with auto-save, conditional SubTo/SF fields, review step
- **Partner dashboard** (`dashboard.html`) — login by phone/email, deal status tracking with stats cards
- **Process page** (`process.html`) — 6-step visual timeline of deal flow
- **What We Look For** (`what-we-look-for.html`) — deal criteria, accepted types, target markets
- **Proof page** (`proof.html`) — stats, testimonial, example deals, comparison table
- **FAQ** (`faq.html`) — 6-tab accordion covering basics, partnership, process, money
- **Join/Onboard** (`join.html`) — partner application form
- **Contact** (`contact.html`) — contact form + info cards
- **Active Buyers Map** (`buyers-map.html`) — interactive buyer demand map
- **404 page** (`404.html`) — branded error page

### Netlify Functions (`dispobuddy/netlify/functions/`)
- **`dispo-buddy-submit.js`** — deal submission → GHL contact + opportunity + Notion page + SMS/email confirmations. `jv-submitted` tag re-enabled. All outbound messaging gated behind `NOTIFICATIONS_LIVE=true` env var.
- **`partner-onboard.js`** — partner join + contact form → GHL contact + opportunity + notifications. Same `NOTIFICATIONS_LIVE` gate.
- **`partner-login.js`** — authenticate partners by phone/email, verify `dispo-buddy` tag
- **`partner-deals.js`** — fetch partner's JV pipeline opportunities with stage-to-label mapping
- **`buyer-demand.js`** — buyer demand data for map
- **`sitemap.js`** — generates sitemap.xml

### Safety Gates
- **`NOTIFICATIONS_LIVE`** env var — must be set to `"true"` to send ANY SMS/email. Default OFF. CRM writes (contact, opportunity, tags, notes) always work.
- **`jv-submitted` tag** — re-enabled in buildTags(). Triage cron on Droplet remains disabled until manually re-enabled.
- **OPTIONS/CORS** — all functions handle OPTIONS preflight with `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Headers: Content-Type`

### Deployment
- **Netlify site:** `dispobuddy.netlify.app` → configure base directory to `dispobuddy/`
- **Custom domain:** point `dispobuddy.com` at this Netlify site
- **Env vars needed:** `GHL_API_KEY`, `GHL_LOCATION_ID`, `NOTION_TOKEN` (optional), `NOTIFICATIONS_LIVE` (set to `true` only after full testing), `INTERNAL_ALERT_PHONE` (optional), `INTERNAL_ALERT_EMAIL` (optional)

---

## Completed — Deal Engagement Tag Tracking (April 2026)

End-to-end system for tracking which buyers were sent, viewed, and expressed
interest in each deal — using ephemeral GHL tags that flush into permanent
history once the deal closes.

### Tag shape
Every deal has a Deal ID like `PHX-001` / `MSA-042` (stored on the Notion
deals DB under "Deal ID" and on the GHL deal contact as `deal_id`). Per buyer
per deal we apply:
- `sent-[deal-id]`   — buyer was blasted this deal
- `viewed-[deal-id]` — buyer clicked the deal link
- `alert-[deal-id]`  — buyer replied INTERESTED

### Files shipped (merged to main via PRs #30-#33)
- **`termsforsale/netlify/functions/deal-view-tracker.js`** — POST `/api/deal-view-tracker`. Validates `{contactId, dealId}`, adds `viewed-[dealId]` tag + GHL note. Never throws (silent fail so it can't break the page load).
- **`termsforsale/deal-page-tracker.js`** — vanilla JS snippet included on `deal.html` via `<script src="/deal-page-tracker.js" defer>`. Reads `?cid=` from URL + `<meta name="deal-id" content="PHX-001">` from the page head. Uses MutationObserver to handle dynamic pages where the meta tag is injected after async deal load. Silent fail.
- **`termsforsale/deal.html`** — includes the tracker script in `<head>` and dynamically injects the deal-id meta tag after fetching the deal from `/api/deals`.
- **`termsforsale/netlify/functions/deals.js`** — now exposes `dealCode` field (the new `Deal ID` from Notion) alongside existing fields.
- **`termsforsale/netlify/functions/buyer-alert.js`** — POST `/api/buyer-alert`. GHL webhook receiver fired when a buyer replies INTERESTED/YES. Fetches the contact from GHL (tags aren't always in the webhook payload), finds every `sent-[deal-id]` tag, promotes each to `alert-[deal-id]`, posts notes, and SMSes Brooke with the deal list. Handles no-sent-tag fallback gracefully.
- **`jobs/deal-cleanup.js`** — Weekly droplet cron. Registered with PM2 `--cron "0 6 * * 1"` (Monday 06:00 UTC = Sunday 11pm AZ). Introspects the Notion DB schema at runtime to discover the real property names + status options, intersects desired statuses against available options (so invalid values get silently dropped instead of crashing), paginates closed deals, flushes per-buyer engagement into `buyer_deal_history` (comma-separated, deduped), removes the 3 tags, and marks `Tags Cleaned=true` on the Notion page. Legacy deals with no Deal ID are summarized into a single skip line. Env-configurable via `CLEANUP_STATUSES` (default `"Closed,Archived"` — `Archived` is silently dropped since it doesn't exist in the current DB, so effectively `Closed` only).
- **`jobs/export-engagement-snapshot.js`** — One-time CSV dump of historical engagement tags. Uses cursor-based pagination against `/contacts/` GET endpoint (not the 10k-capped `/contacts/search` POST). Run once on 2026-04-09 — scanned 17,073 contacts, found only 79 with old-format engagement tags (1 sent:<slug>, 116 viewed:<short-id> events across 23 deals). Very sparse historical data — the new tag system effectively starts from a clean slate.

### Droplet env vars confirmed
- `NOTION_TOKEN` ✅, `NOTION_DB_ID` ✅ (`a3c0a38fd9294d758dedabab2548ff29`)
- Script falls back: `NOTION_API_KEY || NOTION_TOKEN`, `NOTION_DEALS_DB_ID || NOTION_DATABASE_ID || NOTION_DB_ID`

### Droplet PM2 install (done)
```bash
cd /root/termsforsale-site/jobs
pm2 start deal-cleanup.js --name deal-cleanup --no-autorestart --cron "0 6 * * 1"
pm2 save
```
First scheduled run: Monday 2026-04-13 06:00 UTC.

### GHL workflow setup (TODO — see next section)
A "Buyer Interest Webhook" workflow in the Terms For Sale sub-account needs to be created manually (trigger: Customer Replied → Inbound SMS contains INTERESTED/YES; action: Webhook POST to `/api/buyer-alert` with Custom Data `contactId={{contact.id}}`). The function fetches the rest of the contact (including tags) from GHL directly, so only contactId is required.

### Deal page tracker install (TODO)
Every deal detail page needs:
```html
<meta name="deal-id" content="PHX-001">
<script src="/deal-page-tracker.js" defer></script>
```
The meta tag must be templated with the actual Deal ID per deal.

---

## Completed — Deal Tracking Tag System Hotfix (April 9, 2026)

End-to-end verification session that shook out two production bugs in the
engagement tag tracking system:

1. **404 on `/api/buyer-alert` and `/api/deal-view-tracker`** — `netlify.toml`
   has no wildcard `/api/*` rule, every function needs an explicit redirect.
   I had shipped the new functions without adding their redirect entries, so
   the bottom catchall `/* → /404.html` was swallowing every request. Fixed
   in PR #35.

2. **Regex missed lowercased tags** — GHL normalizes all tags to lowercase on
   save. Our case-sensitive `[A-Z]+` regexes never matched real stored tags,
   so `buyer-alert` always hit the "no sent- tags found" fallback path. Fixed
   in PR #37:
   - `termsforsale/netlify/functions/buyer-alert.js` — regex now
     `/^sent-([a-z]+-[0-9]+)$/i`, captured dealId uppercased for display
   - `termsforsale/netlify/functions/deal-view-tracker.js` — regex
     `/^[A-Z]+-[0-9]+$/i`, dealId normalized to uppercase before tag write
   - `jobs/deal-cleanup.js` — regex `/^[A-Z]+-[0-9]+$/i`, tag names
     lowercased before GHL search/remove, contact tag arrays lowercased
     before comparison (handles old mixed-case tags too)

**Verified live:** curl against `/api/buyer-alert` with a real contactId
that has `sent-test-001` returns `{"success":true,"dealIds":["TEST-001"]}`,
adds `alert-test-001`, posts the note, and SMSes Brooke.

The GHL "Buyer Interest Webhook" workflow is configured and live in the
Terms For Sale sub-account. The full chain is now working end-to-end:
buyer texts INTERESTED → GHL workflow fires → `/api/buyer-alert` → tags +
notes + SMS to Brooke.

---

## Completed — April 9 2026 Notion Website Link Autopopulate

Follow-up to the short-deal-link-paths session: `notify-buyers.js` now
writes the short `/d/{city}-{zip}-{code}` URL back to the Notion deals
DB's `Website Link` URL property whenever it processes a deal, so the
Notion views show a clickable live link alongside every Actively
Marketing deal. Brooke's team no longer has to copy/paste URLs.

### Files shipped

- **`termsforsale/netlify/functions/_notion-url.js` (new)** — shared
  helper. Exports `patchWebsiteLink(token, pageId, url)` and
  `setDealWebsiteLink(token, deal)`. PATCHes the Notion page's
  `Website Link` URL property via `/v1/pages/{pageId}`. Never throws —
  caller handles `{ok, status, body}` result. Used by both the Netlify
  function and the standalone backfill script.

- **`termsforsale/netlify/functions/notify-buyers.js`** — in the main
  handler deal loop, calls `setDealWebsiteLink(token, deal)` once per
  recent deal before `findMatchingBuyers`. Write is best-effort and
  wrapped in try/catch so a Notion blip never blocks the SMS/email
  blast. Logs success/failure per deal.

- **`scripts/backfill-notion-website-links.js` (new)** — one-shot
  sweep for legacy Actively Marketing deals that were created before
  the notify-buyers hook went live. Queries the Notion deals DB
  (default filter: `Deal Status = Actively Marketing`), skips pages
  whose `Website Link` already matches the computed short URL,
  PATCHes the rest. Supports `DRY_RUN=1`, `MAX_DEALS=N`, and
  `STATUSES="Closed,Canceled"` to re-link historical pages too.

### Notion schema confirmed

Verified the deals DB (`a3c0a38fd9294d758dedabab2548ff29` →
`collection://6498ce51-68a9-40b7-8377-14fe077fdd62`) has a `Website
Link` property of type `url` already defined. There's also a
`Website Published` checkbox; this session does NOT touch that field
since it may be used as a manual admin workflow signal.

### Run on Droplet to finish the backfill:
```
cd /root/termsforsale-site
git pull origin main
DRY_RUN=1 node scripts/backfill-notion-website-links.js   # preview
node scripts/backfill-notion-website-links.js             # apply
```

From that point forward, every deal that hits `notify-buyers` (on the
30-min cron or via `/api/notify-test?deal_id=…`) will keep its
`Website Link` field in sync automatically.

## Completed — April 9 2026 Short Deal Link Paths + Notion Description

Outbound deal links (SMS, email, blog, sitemap, deal package) now use a
short, city/zip-aware path instead of the raw Notion UUID. Old format was
`https://deals.termsforsale.com/deal.html?id=a1b2c3d4-e5f6-7890-abcd-...`
(~75 chars). New format is
`https://deals.termsforsale.com/d/phoenix-85016-phx001` (~50 chars) —
shorter, and buyers + search engines see the city + ZIP right in the path.

### Files shipped

- **`termsforsale/netlify/functions/_deal-url.js` (new)** — shared builder
  used by every outbound link path. Exports `buildDealUrl(deal)`,
  `buildDealPath(deal)`, `buildDealSlug(deal)`, `buildTrackedDealUrl(deal,
  contactId)`. Slug format: `{city-slug}-{zip}-{code}` where `code` is the
  Notion "Deal ID" (e.g. `PHX-001` → `phx001`), falling back to the first
  8 alphanumeric chars of the Notion UUID for legacy deals. Missing
  city/zip pieces are dropped gracefully — a deal with no city and no zip
  still resolves to `/d/{code}`.

- **`netlify.toml`** — added `/d/* → /deal.html` status-200 rewrite. The
  pretty URL stays visible in the browser and the deal page's JS parses
  the slug out of `window.location.pathname`.

- **`termsforsale/deal.html`** — init() now accepts all three link forms:
  new short path (`/d/phoenix-85016-phx001`), legacy `?id=<uuid>`, and
  `?slug=` escape hatch. `findDealBySlug()` matches the last hyphen
  segment of the slug against `deal.dealCode` (normalized to lowercase
  alphanumeric) and falls back to the first 8 chars of the Notion UUID
  for pre-Deal-ID deals. If a recipient arrives via `/d/...?c=CONTACT_ID`
  (the format SMS/email now send), the page fires a track-view POST
  on load with `source: 'sms-email'` so engagement still logs to GHL.

- **`termsforsale/netlify/functions/notify-buyers.js`** — `parseDeal()`
  now pulls `dealCode` from Notion and builds `dealUrl` via
  `buildDealUrl()`. SMS and email blast paths both use
  `buildTrackedDealUrl(deal, contact.id)` for the `/d/...?c=...` format.
  Saves ~25 chars per SMS, leaves more headroom under the 160-char cap.

- **`termsforsale/netlify/functions/sitemap.js`** — sitemap entries for
  active deals now use `buildDealPath()`.

- **`termsforsale/netlify/functions/auto-blog.js`** — blog-post CTA
  buttons link via `buildDealUrl()`.

- **`termsforsale/netlify/functions/deal-package.js`** — Claude marketing
  package prompt passes the short URL when no explicit `deal_url` custom
  field is set on the deal.

- **`termsforsale/netlify/functions/track-view.js`** — POST-mode note URL
  consolidated into a single `noteUrl` const. GET mode intentionally left
  alone — legacy SMS/email links still redirect to `/deal.html?id=...`
  with the 1500 ms timeout race, because there's no point paying a Notion
  round trip on a legacy link just to produce a prettier URL.

### Backwards compatibility

- `?id=<uuid>` links still work — old SMS/email history + any bookmarks
  resolve exactly as they always did.
- The new flow is functionally equivalent for tracking: previously,
  `track-view.js` GET mode added `viewed:`, `Active Viewer`, `Last View:`
  tags and a note, then redirected. Now, `/d/...?c=CONTACT_ID` lands
  directly on the deal page and the page JS POSTs to `/api/track-view`
  which runs the same tag+note writes via the existing `trackView()`
  function. Same tags, same notes, just fires on page-load instead of
  pre-redirect.
- Legacy deals without a Deal ID still get a usable short path —
  `/d/phoenix-85016-a1b2c3d4` (city, zip, 8-char UUID prefix). The
  `findDealBySlug` fallback matches on UUID prefix so these links still
  resolve.

### Notion "Description" field now renders on the deal page

Separate fix in the same session: `deals.js` was pulling `Details` but
not `Description`, and `deal.html` wasn't rendering either one. Two
changes:

- **`termsforsale/netlify/functions/deals.js`** — added `description`
  field alongside `details`. Tries `Description`, `Property Description`,
  `Deal Description`, `Summary` (in that order) so it picks up whatever
  the actual Notion column is called.
- **`termsforsale/deal.html`** — new "About This Deal" card rendered
  above the tabs (between `.tags-row` and `.tabs`). Uses
  `d.description || d.details` as the source, HTML-escaped, with
  `white-space: pre-wrap` so manual line breaks in Notion carry through.
  New `.deal-desc` CSS block added. Card only renders when a description
  exists — deals without one look identical to before.

## Completed — April 9 2026 OTP Login Fix + Deal ID Auto-Gen + URL Cleanup

Three fixes shipped in commits `96af2ae`, `aa25bd7`, and `f786ed6`:

### 1. Dispo Buddy OTP login fix (`partner-login.js`)
Partners could request an OTP via SMS but entering the code returned
"No code on file." Root cause: the PUT to store the code used a string
`key: 'portal_otp_code'` which GHL silently dropped — it needs the actual
field UUID. The field also may not have existed yet on the location.

- Added `getCustomFieldMap()` (same pattern as `dispo-buddy-submit.js`)
  that fetches `/locations/{id}/customFields` and builds a key → UUID map
- Added `createOtpField()` that auto-creates the `portal_otp_code` text
  field if the map lookup comes up empty — so it's self-healing on first run
- `findOtpFieldId()` checks multiple possible key names
  (`portal_otp_code`, `contact.portal_otp_code`, lowercase variants)
- Store now uses `[{ id: fieldId, value: storedValue }]` with a
  key-based PUT as a fallback if the ID-based one fails
- OTP value format changed from `CODE:EXPIRY` to `OTP:CODE:EXPIRY` so it
  can't collide with TFS reset codes on shared contacts (which use
  `6digits:13digitTimestamp`)
- On verify, matches by **value pattern** (`/^OTP:\d{6}:\d+$/`) instead
  of key name — robust against any GHL key naming weirdness
- Verbose logging added throughout so the next bug is diagnosable from
  Netlify function logs alone

### 2. Dispo Buddy auto-generate Deal ID (`dispo-buddy-submit.js`)
Every JV partner submission now gets a Deal ID written to Notion in
format `PHX-001` / `MSA-042` so the weekly `deal-cleanup` cron can pick
it up instead of skipping it forever.

- `CITY_CODE_MAP` — 36 AZ cities pre-mapped to 3-letter codes:
  Phoenix=PHX, Mesa=MSA, Scottsdale=SCT, Tempe=TMP, Chandler=CHD,
  Gilbert=GIL, Glendale=GLN, Peoria=PEO, Surprise=SUR, Goodyear=GDY,
  Buckeye=BKY, Avondale=AVN, Tucson=TUC, Flagstaff=FLG, Sedona=SDN,
  Yuma=YUM, Prescott=PRC, etc.
- `getDealPrefix(city, state)` — checks city map first, falls back to
  first 3 alpha chars of city, final fallback is 2-letter state + X
- `generateDealId(token, dbId, city, state)` — queries Notion with
  `filter: { property: 'Deal ID', rich_text: { starts_with: '${prefix}-' } }`,
  paginates up to 5 pages (500 deals), finds max sequence, returns
  `${prefix}-${String(max + 1).padStart(3, '0')}`
- Wired into `createNotionDeal` — runs before props are built, writes
  via the existing `text('Deal ID', dealId)` helper
- Format matches `jobs/deal-cleanup.js` regex `/^[A-Z]+-[0-9]+$/i`
- Non-fatal: if generation throws or Notion is down, submission still
  succeeds without a Deal ID
- Known limitation: concurrent submissions from the same city within
  seconds can race to the same sequence number. Volume is low enough
  this doesn't matter yet; if it does, swap to a GHL counter field.

### 3. `dispobuddy.netlify.app` → `dispobuddy.com` in outbound content
Updated email template logo srcs and admin SOP references in:
- `dispobuddy/netlify/functions/partner-onboard.js` (×2 email logos)
- `dispobuddy/netlify/functions/partner-stage-notify.js` (email shell logo)
- `dispobuddy/netlify/functions/dispo-buddy-submit.js` (confirmation email)
- `dispobuddy/admin/sop.html` (×5 references — Live Site, Test Mode,
  Partner Dashboard URLs, system status, tech stack row)

CLAUDE.md references to `dispobuddy.netlify.app` left alone as historical
deploy context.

---

## TODO — Next Session

1. **Dispo Buddy Go-Live** — After end-to-end testing on `dispobuddy.com` (which should now be pointed at the Netlify site): verify the OTP login flow works end to end (Brooke's phone → SMS → enter code → dashboard), confirm `NOTIFICATIONS_LIVE=true` is set in Netlify env vars, test one real submission (should produce a Deal ID like `PHX-001` in Notion), re-enable `dispo-buddy-triage` cron on Droplet.

2. **Deal Tracking Tag System — All wire-up complete as of April 9, 2026** ✅
   - ✅ Branch merged to main (PRs #30–#37)
   - ✅ `deal.html` wired: includes `/deal-page-tracker.js` and dynamically injects `<meta name="deal-id">` after Notion load
   - ✅ `deals.js` exposes new `dealCode` field (`PHX-001` format)
   - ✅ `deal-cleanup` PM2 cron running on droplet (Mondays 06:00 UTC)
   - ✅ Historical engagement snapshot captured (17,073 contacts scanned, only 79 with any old-format tags — clean slate for new system)
   - ✅ Netlify redirects added for `/api/buyer-alert` and `/api/deal-view-tracker` (PR #35)
   - ✅ Regex case-insensitivity fix for GHL lowercasing tags on save (PR #37)
   - ✅ GHL "Buyer Interest Webhook" workflow live in Terms For Sale sub-account
   - ✅ End-to-end verified: curl test on real contact returns `{"success":true,"dealIds":["TEST-001"]}`, tag+note+SMS all fire
   - ✅ **Deal ID auto-population** — Dispo Buddy submissions now auto-generate `PHX-001`-style IDs in Notion on creation (commit `f786ed6`). Legacy deals still need backfill if you want them cleanable.
   - 🔧 Optional: expand `CLEANUP_STATUSES` env var on droplet if you want Lost/Canceled/Abandoned/EMD Released/Not Accepted deals also auto-cleaned: `echo 'CLEANUP_STATUSES="Closed,Lost,Canceled,Abandoned,EMD Released,Not Accepted"' >> /etc/environment`

3. **GHL Client Portal — Buyer Contract Lifecycle** — The webhook function `buyer-contract-lifecycle.js` handles automated partner-style notifications on Buyer Inquiries pipeline stage changes (Offer Submitted → Contract Sent → Contract Signed → EMD Received → Closed / Lost). To activate:
   - Create one GHL workflow: Trigger = Opportunity Stage Changed (Pipeline = Buyer Inquiries). Action = Webhook POST to `/.netlify/functions/buyer-contract-lifecycle` with Custom Data body `{contactId, opportunityId, stageName, pipelineName}`.
   - Build assignment contract template in GHL Documents & Contracts with merge fields for buyer name, property address, offer amount. The template's signing URL can be stored on the contact as `contract_signing_link` custom field — if present, the "Contract Sent" email includes a Sign Contract button.
   - Optional contact custom fields the emails will use if populated: `contract_signing_link`, `emd_wire_instructions` (Large Text), `closing_date`.

4. **Deal Photo Management** — Photos sort by name (alphabetical) from Google Drive API. Consider adding a photo reorder UI or requiring Cover Photo field in Notion for all deals.

5. **Dispo Buddy Buyer Interest Metrics** — The deal detail page (`/deal-detail`) is wired to show Views/Inquiries/Showings/Offers from contact custom fields, but the fields don't exist in GHL yet and metrics are hidden until populated. To activate:
   - Create 4 Number custom fields in GHL contacts: `buyer_views`, `buyer_inquiries`, `buyer_showings`, `buyer_offers`
   - Option A (manual): team updates counts as buyers engage
   - Option B (automated): wire up Terms For Sale `/api/track-view` deal clicks to increment these counters on the matching JV partner contact
   - Once any metric has a value >0 and the deal is in Actively Marketing or later, the metrics section auto-appears on the deal detail page
## Commercial / Multifamily Lane

### Session 1 — SHIPPED
- `termsforsale/commercial.html` — public hub with blind teaser cards
- `termsforsale/netlify/functions/commercial-deals.js` — returns active deals from Notion (camelCase: `dealCode`, `propertyType`, `metro`, `submarket`, `unitsOrSqft`, `vintageClass`, `noiRange`, `priceRange`, `dealStory`, `structureSummary`, `status`)
- Notion "Commercial Deals" DB created and populated
- Env: `NOTION_COMMERCIAL_DB_ID`

### Session 2 — SHIPPED ✅ (April 7, 2026)
**Files in repo:**
- `termsforsale/commercial-buyer.html` — global buyer profile form (name, email, phone, entity, role, website, LinkedIn, deal size min/max, preferred markets, strategy, capital source, proof type, decision speed, notes)
- `termsforsale/commercial-deal.html` — deal-specific NDA request page; reads `?code=CMF-XXX` and fetches via `/.netlify/functions/commercial-deals` using camelCase fields
- `termsforsale/netlify/functions/_ghl.js` — shared GHL helper exposing `upsertContact`, `createOpportunity`, `sendSmsToBrooke`, `sendEmailToContact`, `getStageIdByName` (resolves stage IDs by name with in-memory cache), `isTest`. All outbound calls honor `TEST_MODE`.
- `termsforsale/netlify/functions/commercial-buyer-submit.js` — upserts contact with `buyer-commercial` + `tier-{a|b|c}` + market tags, A/B/C scoring, creates opportunity at "Profile Completed", sends welcome email, SMS to Brooke
- `termsforsale/netlify/functions/commercial-nda-request.js` — upserts contact with `buyer-commercial` + `nda-requested` + `deal-{code}` tags, creates opportunity at "NDA Requested" with custom fields (`deal_code`, `deal_type`, `price_range`), sends confirmation email, SMS to Brooke

**Buyer A/B/C scoring**
- Tier A: min size ≥ $5M AND decision ≤ 7 days AND proof_type provided
- Tier B: min size ≥ $3M AND decision ≤ 14 days
- Tier C: everything else

**GHL pipeline (live):** Commercial / Multifamily — pipeline ID `HTpFvaMGATSXsECYFhoB`
Stages (in order): Profile Completed → NDA Requested → NDA Signed → Package Delivered → LOI Submitted → Under Contract → Closed Won / Dead

**Netlify env vars added in Session 2:**
- `GHL_COMMERCIAL_PIPELINE_ID` ✅
- `BROOKE_CONTACT_ID` ✅
- `BROOKE_SMS_PHONE` ✅
- `TEST_MODE` ✅ (toggle `true`/`false` — `true` short-circuits all SMS/email/GHL writes to `[TEST_MODE]` console logs)
- (Existing from Session 1: `GHL_API_KEY`, `GHL_LOCATION_ID`, `NOTION_COMMERCIAL_DB_ID`)

**Important pattern note:** Stage IDs are resolved by NAME at runtime via `getStageIdByName()` — they're NOT stored in env vars. If you rename a stage in GHL, update the string literal in the corresponding function (`'Profile Completed'` in commercial-buyer-submit.js, `'NDA Requested'` in commercial-nda-request.js).

**Critical rules (carryover):**
- NEVER expose street addresses, data room URLs, or CIM URLs on public pages
- NEVER send live SMS/email without confirming `TEST_MODE=true` first when iterating
- Logged-in users see addresses on residential deals only
- Commercial deals use `dealCode` (format `CMF-XXX`) as the public identifier — never the address

### Session 3 — TODO
**Goal:** Close the loop between NDA Requested and Package Delivered. When a buyer signs the NDA, automatically release the data room and advance the opportunity stage.

**Scope:**
1. **E-sign integration** for the NDA — pick provider (DocuSign, Dropbox Sign, or GHL native docs) and generate a signed NDA from a template, prefilled with buyer name + entity + deal code
2. **Webhook receiver** (`netlify/functions/nda-signed-webhook.js`) that:
   - Validates the e-sign provider's signature
   - Looks up the buyer's contact in GHL by email
   - Advances the opportunity from "NDA Requested" → "NDA Signed"
   - Triggers data room delivery
3. **Data room delivery function** — emails the buyer a tokenized, expiring link to the full CIM + data room (NEVER the raw URL stored in Notion). Token logged with contact ID + deal code so we can track who accessed what.
4. **Stage update to "Package Delivered"** after the email send confirms
5. Update Notion deal record with `nda_signed_at` timestamp + buyer contact ID

**Critical Session 3 rules:**
- NEVER expose data room URLs or CIM URLs in any client-side response — always wrap in tokenized links
- Webhook MUST validate provider signature before doing anything
- All outbound (email + GHL stage move) must honor `TEST_MODE`
