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
- **buyer-response-tag.js** — auto-tags buyer responses (IN/MAYBE/PASS, 1/2/3) and maps to deal-hot/deal-warm/deal-paused to stop follow-up sprint
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

## Commercial / Multifamily Lane

A separate lane for $5M-$20M commercial deals with NDA-gated access. Built April 2026.

### Architecture
- **Notion database:** "Commercial Deals" — separate from residential. ID stored in `NOTION_COMMERCIAL_DB_ID` env var.
- **Public hub:** `/commercial.html` — blind teaser cards (NO addresses, NO data room URLs, NO tenant/seller names)
- **Pipeline:** GHL "Commercial / Multifamily" with stages: Profile Completed → Teaser Inquiry → NDA Requested → NDA Sent → NDA Signed → Data Room Accessed → Soft Offer → LOI In → Under Contract → Dead
- **E-sign:** GHL native (Documents & Contracts module) — not PandaDoc
- **Buyer scoring:** A = $5M+ AND <=7 day decision AND proof; B = $3M+ AND <=14 days; C = everything else

### Notion "Commercial Deals" Schema
| Field | Type |
|---|---|
| Deal Code | Title (e.g. CMF-027) |
| Status | Select (Active, NDA Only, Under Contract, Closed, Dead) |
| Metro | Text |
| Submarket | Text |
| Property Type | Select (Multifamily, Mixed-Use, Retail, Office, Industrial, Self-Storage, Hotel, Other) |
| Units or Sqft | Text |
| Vintage / Class | Text |
| NOI Range | Text (range only, never exact) |
| Price Range | Text (range only, never exact) |
| Deal Story 1/2/3 | Text (no tenant/seller names) |
| Structure Summary | Text |
| Address (PRIVATE) | Text — never exposed publicly |
| Data Room URL (PRIVATE) | URL — only sent post-NDA |
| CIM URL (PRIVATE) | URL |

### CRITICAL Rules for Commercial Lane
- **NEVER expose** Address, Data Room URL, CIM URL, tenant names, seller identity in any public API or page
- `commercial-deals.js` API explicitly omits private fields
- Data room link only sent via email AFTER NDA signed (webhook-triggered)
- Each deal has a unique `Deal Code` (CMF-XXX) used as the public identifier — full GHL contact ID never exposed

### Built So Far (Session 1)
- `commercial-deals.js` — Notion API function returning blind teasers only
- `commercial.html` — public hub with filters (metro, type, price range)
- Nav link added to deal.html, deals.html, index.html
- `/api/commercial-deals` redirect in netlify.toml

### TODO for Commercial Lane (next sessions)
1. **Buyer profile form** (`commercial-buyer.html` + `commercial-buyer-submit.js`) — global buyer onboarding with A/B/C scoring
2. **Deal-specific NDA request** (`commercial-deal.html` + `commercial-nda-request.js`) — passes deal_code, creates GHL opportunity at "NDA Requested"
3. **NDA send + webhook** — GHL contract template + webhook receiver for "Document Signed" event → moves opportunity to "NDA Signed" + emails data room link
4. **Data room tracking redirect** — `/api/commercial-dataroom-track?c=&d=` → logs view + moves opportunity to "Data Room Accessed"
5. **Admin dashboard** (`/admin/commercial.html`) — VA view of all buyers, NDA statuses, pipeline stages
6. **GHL pipeline setup** (manual in GHL UI) — create "Commercial / Multifamily" pipeline with 9 stages
7. **GHL custom fields** — `cmf_deal_code`, `cmf_buyer_score`, `cmf_typical_size_min`, `cmf_typical_size_max`, `cmf_strategy`, `cmf_capital_source`
8. **Env vars to add:** `NOTION_COMMERCIAL_DB_ID`, `GHL_PIPELINE_ID_CMF`, `GHL_STAGE_CMF_PROFILE`, `GHL_STAGE_CMF_NDA_REQUESTED`, `GHL_STAGE_CMF_NDA_SIGNED`, `GHL_STAGE_CMF_DATAROOM_VIEWED`

---

## TODO — Next Session

1. **Dispo Buddy Go-Live** — After end-to-end testing on `dispobuddy.netlify.app`: set `NOTIFICATIONS_LIVE=true` in Netlify env vars, test one real submission, re-enable `dispo-buddy-triage` cron on Droplet, point `dispobuddy.com` domain.

2. **GHL Client Portal** — Portal apps configured (Contracts + Shared Files enabled). Set up contract templates with merge fields for assignment contracts. Build automated workflow: Offer Submitted → Contract Sent → Signed → EMD Instructions → Closed.

3. **Deal Photo Management** — Photos sort by name (alphabetical) from Google Drive API. Consider adding a photo reorder UI or requiring Cover Photo field in Notion for all deals.
