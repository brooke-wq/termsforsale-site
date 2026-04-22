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

## Campaign Sender Identity (REQUIRED)

**Every outbound SMS and email — campaigns and transactional alike — MUST originate from the company channels:**

- **SMS from:** `+1 480-637-3117` (set via `fromNumber` on every `/conversations/messages` SMS POST)
- **Email from:** `Terms For Sale <info@termsforsale.com>` (set via `emailFrom` on every `/conversations/messages` Email POST)

These are exposed as `CAMPAIGN_FROM_PHONE` and `CAMPAIGN_FROM_EMAIL` in `_ghl.js`. The shared `sendSMS()` and `sendEmail()` helpers default to these values; functions that hit `/conversations/messages` directly (e.g. `notify-buyers.js`, `deal-follow-up.js`, `auth-signup.js`, `auth-reset.js`) include `fromNumber` / `emailFrom` explicitly.

**Never use** `Brooke Froehlich <brooke@mydealpros.com>` or any personal sender — replies must route to the shared company inbox.

## Buyer Opt-In Requirement (REQUIRED for ALL campaigns)

**Every buyer-facing campaign send (deal alerts, follow-ups, nudges) MUST verify the recipient has the `opt in` tag (case-insensitive) BEFORE sending.**

- Tag value: `opt in` (matched lower-cased and trimmed — `OPT IN`, `Opt In`, ` opt in ` all match)
- Helper: `hasOptInTag(contactOrTags)` exported from `_ghl.js`
- Constant: `OPT_IN_TAG` exported from `_ghl.js`

**Where it's enforced:**
- `notify-buyers.js` — `fetchAllBuyers()` filters out any contact without `opt in` (also still filters `alerts-paused` and `Contact Role !== Buyer`)
- `deal-follow-up.js` — top of the contact loop skips any contact without `opt in`
- `follow-up-nudge.js` — gates the SMS send on `opt in`; stale-tagging (data-only) still runs

**Adding a new campaign function?** You MUST gate sends on `hasOptInTag(contact)`. Failing to do so violates company policy and may violate TCPA/CAN-SPAM.

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
- **Avoiding response timeouts on large file writes:** when writing or rewriting files that will be 400+ lines (or when assembling a large file from scratch), spawn a background Agent (`run_in_background: true`) to do the write instead of inlining the full content in the main assistant response. The main response gets cut off by the stream-idle timeout on very long outputs; the Agent runs independently, isn't subject to the same timeout, and notifies the session when it's done. Always verify the Agent's work after it completes (read the file back) before reporting the task done.

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

## Completed — April 22 2026 Deal Page Description Reformat

Branch: `claude/reformat-deal-description-sWnzq`.

Brooke asked to reformat the "About This Deal" description on the deal
page so it's visually connected to the Terms section rather than
sitting above the tabs and pushing the terms table down the page.

### Files shipped

- **`termsforsale/deal.html`**:
  - Removed `${descHtml}` from its old position between `.tags-row`
    and `.tabs` (so the description no longer blocks the tabs + terms
    table from being visible above the fold).
  - Inserted `${descHtml}` inside the `#tab-terms` panel, directly
    below the `.terms-map-grid` closing div so it renders underneath
    the terms table + map grid as a full-width block.
  - `.deal-desc` CSS: swapped `margin-bottom:24px` → `margin-top:20px`
    to match its new position (below the terms/map grid instead of
    above the tabs).

### Behavior

- Terms tab (default view) now shows: terms table (left) + map (right)
  at the top, then the "About This Deal" description below. Much
  cleaner visual hierarchy — buyers see the numbers first, then the
  context/highlights.
- Highlights / Analysis / Buy Process tabs are unchanged.
- Empty-description deals still render no card (existing
  `descText?...:''` guard preserved).

### Verified

- Tag balance on `deal.html`: 267/267 div, 5/5 script, 35/35 button,
  0/0 section — all balanced.
- No backend changes.

---

## Completed — April 22 2026 Recently Closed — Mini Case-Study Reframe

Branch: `claude/add-closed-deals-showcase-9mDMO`.

Second-pass rework of the Recently Closed sections on `/` and
`/deals.html` per $100M Playbook / $100M Offers feedback. Ships on
top of the initial 120-day showcase (earlier entry below).

### Framing rewrite

- **Eyebrow**: "Closed Deals · Last 12 Months"
- **Headline**: "Deals Our Buyers Closed Through Terms For Sale"
- **Subhead**: "Contracts our JV partners brought us that turned into
  real checks for them and real properties for our buyers — all
  closed with creative / investor-friendly terms, no banks required."

### 4 stat tiles (computed live from Notion, 12-month window)

Each tile auto-hides if the underlying data is empty:

| Tile | Source field(s) | Computation |
|---|---|---|
| Deals Closed | `Deal Status = Closed` + `Date Funded` | count within 365 days |
| In Assignments Paid | `Amount Funded` | sum; sub-label shows avg per partner |
| Avg Days to Assignment | `Started Marketing` → `Date Assigned` (fallback `Date Funded`) | average across deals with both dates |
| Creative / Terms Deals | `Deal Type` | % where type !== "Cash" |

### Card grid — mini case studies (120-day window + under-20-days-to-close gate)

Per Brooke's follow-up: the card grid now ONLY shows closed deals
where ready-to-market → under-contract happened in **under 20 days**,
AND funded within the last 120 days. Slower deals still count toward
the 12-month stat tiles but don't get a card. Requires `Started
Marketing` on the Notion page — if it's missing, the deal is
excluded.

Each card is a mini case study:

- **Photo + badge overlay** (top-left corner, stacked):
  1. Navy/green "Closed in X days" (primary badge)
  2. Orange "Creative Finance" type (Subto/SF/Hybrid) or green "Cash"
- **Headline line**: "$18K Entry — 3/2 in City, State" (entry fee or
  asking, beds/baths, city+state only — no street per visibility
  rules)
- **Story**: pulls from Notion `Description` field (or `Details`
  fallback). 3-line clamped. Skipped entirely if empty — Brooke can
  add short 1-2 sentence stories on closed deals as she goes.
- **Outcomes row** (dashed border, bullet list):
  - "Dispo strategy:" — "Matched to a creative-finance buyer" (creative)
    or "Cash buyer, no financing contingency" (cash)
  - "Buyer cash flow: ~$X/mo projected" — shown only when both
    `LTR Market Rent` and `PITI` (or `SF Payment`) are populated
  - Deliberately does NOT show per-deal assignment fee publicly
    (exposed only in the aggregate "In Assignments Paid" stat tile).
    JV partner identity is NOT shown (per Brooke — that's a Dispo
    Buddy-side concern; public Terms For Sale cards stay anonymous).

### Dual CTA bar under the grid

Navy gradient card, split 50/50:

| Side | Label | Button |
|---|---|---|
| Left | "Want deals like these?" / "Join the VIP buyer list — first access…" | **Apply as VIP Buyer** → `/buying-criteria.html` |
| Right | "Sitting on a contract you can't move?" / "Bring it to our buyer network…" | **Submit My JV Deal** → `https://dispobuddy.com/submit-deal.html` |

Stacks to single column on screens <960px.

### Files shipped

- **`termsforsale/netlify/functions/deals.js`** — added
  `startedMarketing` field to every deal in the API response.
  Required for the "Closed in X days" badge + avg-days stat tile +
  under-20-days filter.
- **`termsforsale/deals.html`**:
  - New `.cs-*` (case-study) CSS namespace alongside existing
    `.closed-*` wrapper styles — handles card photo/badges/headline/
    story/outcomes + the navy dual-CTA footer block.
  - Stat tiles rewired from 2 → 4 (deals, assignments, days,
    creative %). Each `#cs-stat-*-wrap` is `display:none` by default
    and only reveals when the data is present.
  - Recently Closed markup rewritten — eyebrow/title/subhead copy,
    new stat tile IDs, dual-CTA footer.
  - `renderClosedSection()` rewritten: computes 12-month stats from
    `CLOSED_DEALS_12MO`, renders card grid from `CLOSED_DEALS`
    (120-day + under-20d-to-close) via new `csMakeCard()` helper.
  - New state variable `CLOSED_DEALS_12MO` populated in init.
  - `CLOSED_DEALS` (card set) now filtered to
    `csDaysToAssignment(d) < 20` in addition to the 120-day window.
- **`termsforsale/index.html`**:
  - `.rc-*` CSS namespace expanded to match the deals.html
    case-study layout (stats grid, badges, outcomes, dual CTA).
  - Markup rewritten to include the 4 stat tiles + dual CTA
    alongside the 4-card strip.
  - `renderRecentlyClosed()` rewritten to mirror
    `renderClosedSection()` — 12-month stats + 120-day + under-20d
    card filter.

### Data dependencies (what Brooke needs in Notion)

| Field | Required for | What happens if blank |
|---|---|---|
| `Deal Status = Closed` | everything | deal excluded entirely |
| `Date Funded` | 12-month stat window + sort | deal excluded from stats AND cards |
| `Started Marketing` | "Closed in X days" badge + avg-days stat + under-20d filter | deal excluded from card grid (still counts toward closed-count + funded stats) |
| `Date Assigned` | "Closed in X days" badge preferred source | falls back to `Date Funded` |
| `Amount Funded` | assignments-paid stat + avg-per-partner | stat tile hides if nothing populated |
| `Description` | per-card story line | line omitted from that card |
| `LTR Market Rent` + `PITI` (or `SF Payment`) | buyer cash-flow outcome line | line omitted from that card |
| `Entry Fee` | card headline "$X Entry" | falls back to `Asking Price` |
| `Beds` + `Baths` | card headline "3/2" | omitted (headline still shows entry + city) |
| `Cover photo` / Google Drive link | card thumbnail | shows muted house icon on green gradient |

### Verified

- 9-case filter harness: under-20-days filter shows correctly for 5/9
  cases (5d / 11d / 19d / 12d-no-dateAssigned / boundary exact 20d
  hides / 25d hides / 45d hides / missing-startedMarketing hides /
  6mo-old hides).
- Tag balance: deals.html 5/5 section, 341/341 div, 13/13 script;
  index.html 6/6 section, 213/213 div, 8/8 script.
- JS parse: all 8 inline JS blocks on deals.html + 5 on index.html
  compile (only JSON-LD "failures" expected).

### Known caveats

- The under-20-days filter can be strict. If Notion's `Started
  Marketing` isn't populated on closed deals, the card grid will
  render empty while the stat tiles still show (since those use a
  looser window). Brooke should backfill `Started Marketing` on her
  8-12 favorite closed deals to seed the showcase.
- Card stories are empty by default — the `Description` field on
  closed deals is rarely filled in. Brooke can add 1-2 sentence
  "mini-pitch" stories on her top closed deals to get the "wholesaler
  sat on this 45 days, we brought 9 buyers, closed in 11" case-study
  feel. Without stories, the cards still show the headline + badges +
  outcomes which is a decent minimum.
- Assignment fee is NOT shown per-card (only in aggregate via the
  "In Assignments Paid" stat). If Brooke wants per-card fees later,
  flip a simple flag in `csMakeCard()` (and on the homepage
  `rcMakeCard()`).

---

## Completed — April 22 2026 Recently Closed Showcase (Homepage + 4-Month Window)

Branch: `claude/add-closed-deals-showcase-9mDMO`.

User asked for a section on the website that showcases recently closed deals
from Notion, capped at a 3-4 month span. A "Recently Closed" section already
existed on `/deals.html` (added April 15) with no time cap and up to 8 cards.
Shipped two changes:

### What changed

1. **`/deals.html` — added a 120-day (~4 month) rolling window** to the
   existing Recently Closed section. Closed deals with `dateFunded` (or
   `lastEdited` as fallback) older than 120 days now drop off the page so
   the social-proof block stays fresh. Kept the existing 8-card cap, stat
   tiles (Deals Closed / Total Funded), and card styling.
2. **`/` (homepage) — new "Recently Closed" social-proof strip** placed
   between the Streamlined section and the Testimonials block. Pulls from
   the same `/api/deals` fetch already happening on page load (no extra
   API call), applies the same 120-day filter, sorts newest-first, and
   renders up to 4 cards in a responsive 4-col grid (2-col on tablet,
   1-col on phones). Section is `display:none` by default and only reveals
   if at least one closed deal falls inside the window — keeps the
   homepage visually clean when the track record is empty. A
   "See full track record →" link deep-links to the deals.html closed
   section.

### Files shipped

- **`termsforsale/deals.html`** (init block at line 1700) — added the
  `CLOSED_WINDOW_DAYS=120` cutoff filter before the existing sort.
- **`termsforsale/index.html`**:
  - New `.rc-*` CSS namespace (`.rc`, `.rc-inner`, `.rc-head`, `.rc-grid`,
    `.rc-card`, `.rc-photo`, `.rc-badge`, `.rc-body`, `.rc-loc`, `.rc-type`,
    `.rc-meta`, `.rc-price`, `.rc-date`) in the stylesheet — scoped so it
    can't collide with the `.closed-*` styles on deals.html.
  - New `<section class="rc" id="rc-section">` markup between Streamlined
    and Testimonials.
  - New JS: `renderRecentlyClosed(deals)` + helpers (`rcEscape`,
    `rcFmtPrice`, `rcFmtDate`, `rcDriveId`, `rcImgSrc`). Called from the
    existing init flow right after `updateStats(activeCount)` so it
    reuses the already-fetched deals array.

### Filter math verified

Test harness against "today = 2026-04-22":
- Funded today → SHOW
- Funded 30 days ago → SHOW
- Funded 119 days ago → SHOW
- Funded 121 days ago → HIDE
- Funded 12 months ago → HIDE
- Closed with no `Date Funded` in Notion → HIDE (Date Funded is now
  required; previously fell back to `last_edited_time` but Brooke flagged
  that as too imprecise)
- Active deals → correctly skipped by the status filter upstream

Both files passed div/section/script tag-balance checks. All 5 real inline
JS blocks on `index.html` parse cleanly (the 1 failure is the JSON-LD
structured data block, which isn't JS — expected). `renderRecentlyClosed`
compiles via `new Function(body)`.

### Address visibility compliance

Per CLAUDE.md "Street address visibility rules": the homepage cards show
**city + state only** (no street address), regardless of login status. The
deal-card link routes to `/deal.html?id=<notion-id>` where the existing
address visibility rules apply (logged-in users see the full address;
logged-out users still see city/state only).

### Known caveats

- Image thumbnails use the `coverPhoto` field from Notion, routed through
  `/api/drive-thumb?id=<driveId>` when it's a Google Drive link. If
  `coverPhoto` is empty, the card shows a muted house-icon placeholder on
  a green gradient. No per-card lazy folder lookup on the homepage (that
  path is only on `/deals.html` via `loadCardThumbnails()`) to keep the
  homepage render fast.
- Deal-type labels use whatever Notion's "Deal Type" select holds
  verbatim ("Subject To", "Seller Finance", "Cash", etc.) — no
  normalization. Consistent with the existing deals.html Recently Closed
  cards.
- Homepage only shows 4 cards, capped. If Brooke wants more on the
  homepage, change the `.slice(0,4)` in `renderRecentlyClosed`.
- The 120-day window is hardcoded as a const in both files
  (`CLOSED_WINDOW_DAYS=120` in deals.html, `WINDOW_DAYS=120` inside
  `renderRecentlyClosed` in index.html). If operations wants to tune it
  later, they'd need to edit both — acceptable for now.

---

## Completed — April 21 2026 Smarter Buyer Matching — Pre-Parsed Preferences (Option D)

Branch: `claude/ghl-fields-tags-documentation-aux2c`.

Shipped the AI-parsed preferences layer that makes deal matching far smarter without blowing up costs. Before this, notify-buyers re-parsed the buyer's `contact.buy_box` free text on EVERY deal blast (every 30 min × every buyer × every deal) and only caught HOA rejections. After this, each buyer's preferences are AI-parsed ONCE into structured JSON stored on `contact.parsed_prefs`, and matching reads that blob directly — no AI at match time.

### What's smarter now

Where before matching only checked Max Price / Min Beds / HOA checkbox / Market, it now honors (from parsed_prefs):

- **cities_only / cities_avoid** — hard filters. "Phoenix only, no Mesa" parses into `cities_only=['Phoenix, AZ']`, `cities_avoid=['Mesa, AZ']`, and the match engine rejects non-Phoenix deals even if state fallback would've passed before.
- **states_only** — hard state whitelist
- **hoa_acceptable: false** — auto-reject HOA deals (was previously only caught by raw checkbox check)
- **requires_pool: true** — deal must mention "pool" in highlights/details
- **min_year_built / min_sqft / min_baths** — hard numeric gates
- **deal_killers** — generic rejection phrases ("flood zone", "septic", "cash only", etc.) scanned against deal features
- **deal_delights** — matching features bump tier UP (e.g., "pool" + "ADU" hits → tier 2 → tier 1)
- **structure_pref** — buyer's preferred deal type bumps tier up on match

### Files shipped

- **`termsforsale/netlify/functions/_parse-preferences.js`** (NEW) — Claude Haiku-powered parser. `parsePreferences(claudeKey, {buyBox, notes, tags, structuredFields})` returns a normalized JSON object with 23 fields (cities_only, cities_avoid, states_only, min_beds/baths/sqft/year_built, max_price/entry/arv/monthly_piti, min_cashflow, max_interest_rate, max_repair_budget, property_types, structure_pref/open_to, hoa_acceptable, requires_pool, occupancy_pref, remodel_tolerance, deal_killers, deal_delights, persona_notes, confidence). Includes `source_checksum` (SHA256 truncated to 16 chars) for idempotency — backfill skips unchanged buyers. Returns `null` on any failure (missing API key, parse error, network) so callers fall through gracefully. Uses `claude-haiku-4-5-20251001` per CLAUDE.md cost rules (~$0.001/buyer).

- **`termsforsale/netlify/functions/buy-box-save.js`** — calls `parsePreferences()` after the main save, writes result to `contact.parsed_prefs` custom field. Failures are non-fatal (wrapped in try/catch) — the form save always succeeds even if the parse fails. Gated on `ANTHROPIC_API_KEY` env var being set. Gracefully skips write if `contact.parsed_prefs` field doesn't exist in GHL yet (logs warning and moves on).

- **`termsforsale/netlify/functions/notify-buyers.js`** — two new helpers:
  - `getParsedPrefs(contact)` — reads and JSON-parses `contact.parsed_prefs`
  - `parsedPrefsReject(prefs, deal)` — applies 9 hard-filter checks (cities_only, cities_avoid, states_only, hoa_acceptable, requires_pool, min_year_built, min_sqft, min_baths, deal_killers)
  - `parsedPrefsTierBump(prefs, deal)` — applies soft tier bumps based on deal_delights + structure_pref matches

  Filters run BEFORE legacy checks in `matchesBuyBox()`. If parsed_prefs says reject, we skip the buyer without running the legacy filter path (faster AND more accurate). If parsed_prefs says OK or buyer has no parsed_prefs yet, we fall through to the existing logic — safe gradual rollout.

- **`scripts/backfill-parsed-prefs.js`** (NEW) — one-shot backfill script that scans all buyer-tagged contacts and parses each one. Flags:
  - `DRY_RUN=1` — preview, no writes
  - `MAX_CONTACTS=N` — cap for testing
  - `FORCE_REPARSE=1` — ignore checksum, reparse everyone

  Idempotent: computes the SHA256 checksum of current `(buyBox + notes + tags)` and compares to `parsed_prefs.source_checksum`. If they match, skips the API call entirely (~0 cost re-runs). Rate limited to 5/sec (200ms sleep between contacts).

### Cost math

- Initial backfill: 8,964 buyers × $0.001 = **~$9 one-time**
- Per buy-box save: ~$0.001 (handful of saves per day) = **~$0.05/day**
- Matching: $0 — all comparisons are pure field reads, no API calls

Total ongoing Claude cost after backfill: **~$2/month**. Matching itself is now free.

### Prerequisites for go-live

1. **Create `contact.parsed_prefs` custom field in GHL:**
   - Settings → Custom Fields → Contacts → Add Field
   - Type: Large Text
   - Name: Parsed Preferences (AI)
   - Field Key: `contact.parsed_prefs`
2. **Set `ANTHROPIC_API_KEY` env var** on Netlify (Terms For Sale site) AND on the Droplet `/etc/environment`.
3. **Run backfill dry-run** first:
   ```
   cd /root/termsforsale-site
   DRY_RUN=1 node scripts/backfill-parsed-prefs.js | head -50
   ```
4. **Run backfill on small batch** to verify real writes:
   ```
   MAX_CONTACTS=10 node scripts/backfill-parsed-prefs.js
   ```
5. **Spot-check in GHL UI** — open 2-3 contacts, view the `Parsed Preferences (AI)` field, confirm it's valid JSON with reasonable values.
6. **Full backfill:**
   ```
   node scripts/backfill-parsed-prefs.js
   ```
   Total runtime: ~30 min for 8,964 buyers at 200ms/contact + Claude latency.
7. **Set up nightly re-parse cron** (optional, once stable): after a buyer gets a new note or updates their buy box, their source_checksum will change and next nightly run re-parses them.

### Graceful fallback

If `contact.parsed_prefs` doesn't exist yet on a contact (buyer never saved buy box, or hasn't been backfilled), `getParsedPrefs()` returns `null` and the existing legacy match logic runs exactly as before. **Zero risk to current buyers' alerts.**

### Nightly refresh cron (Option 2 — shipped April 21 2026)

- **`jobs/parsed-prefs-nightly.js`** (NEW) — pm2-managed cron wrapper that runs `scripts/backfill-parsed-prefs.js` every night at 03:00 AZ (10:00 UTC). Because the backfill is idempotent via `source_checksum`, only buyers whose buy-box/notes/tags actually changed get re-parsed. Quiet nights cost ~$0; active nights cost ~$0.05-$0.30 depending on how many buyers picked up new notes.
- **`jobs/ecosystem.config.js`** — registers the cron with pm2 (`cron_restart: '0 10 * * *'`, `autorestart: false`).

**To activate on Droplet:**
```
cd /root/termsforsale-site
git pull origin main
pm2 startOrReload jobs/ecosystem.config.js
pm2 save
pm2 logs parsed-prefs-nightly --lines 50    # verify first run
```

### What's NOT done (intentional deferrals)

- **Not wired into GHL note-added webhook** — real-time re-parse on every note would cost ~$9/month for negligible gain over the 24hr cron delay. Revisit if staleness becomes a visible problem.
- **Not yet used by any GHL email template** — the parsed_prefs JSON is visible in GHL UI but no email template references it yet. Could show buyer-specific "we matched because: deal has pool (which you wanted)" lines.
- **No admin UI** — to audit or correct parsed_prefs output, operators have to view/edit the raw JSON in the GHL contact record. A lightweight admin page could visualize it.

### Team brief

User-facing explainer at `docs/smart-matching-team-brief.md` — share with ops team to explain how the Parsed Preferences (AI) field works, why low-confidence scores = call opportunities, and how adding a note auto-updates prefs overnight.

---

## Completed — April 21 2026 GoHighLevel Reference Documentation (CSV Format)

Branch: `claude/ghl-fields-tags-documentation-aux2c`. Commit `5b09c48`.

User requested comprehensive GHL field/tag/pipeline reference split between TFS and Dispo Buddy, laid out in easy-to-read spreadsheet format with full field keys, IDs, definitions, triggers, and code mappings. Delivered as 6 CSV files (Excel-friendly, no timeouts).

### Files shipped

- **`docs/ghl-reference/tfs-fields.csv`** (45 rows) — Contact custom fields for TFS buyer network. Columns: field_name, ghl_field_key, ghl_field_id, type, purpose, set_by. Includes critical fields: Contact Role (agG4HMPB5wzsZXiRxfmR, REQUIRED for buyer visibility), Target States/Cities (for market-only filtering), Deal Structures, Property Type, Max Price, Alert Preference fields, HOA Tolerance, Buy Box completion tracking, password hash storage. Set by: auth-signup.js, buy-box-save.js, vip-buyer-submit.js, notify-buyers.js.

- **`docs/ghl-reference/tfs-tags.csv`** (65+ rows) — All TFS tags organized by 13 categories: Signup/Opt-In (opt in, TFS Buyer, buyer-signup), Buyer Type/Strategy (use:fix-flip, use:rental-buyer, use:creative-finance, use:wholetail), Deal Response (buyer-interested, buyer-maybe, buyer-pass), Alert Preference (pref-keep-all, pref-market-only, alerts-paused — mutually exclusive), Deal Sprint (deal-hot, deal-warm, deal-paused), Engagement (new-deal-alert, Active Viewer, Active Buyer), Per-Deal Tracking (sent:[slug], viewed-[dealCode], alert-[dealCode]), Lead Scoring (lead-new, lead-warm, lead-hot, lead-dead), Underwriting (uw-requested, uw-complete, call-prepped), Bird Dog, Equity Exit, Commercial (buyer-commercial, tier-a/b/c, nda-requested), Cross-Brand (dispo-buddy, jv-partner). Set by: 15+ functions covering buyer signup, response tagging, engagement tracking, lead scoring, underwriting automation.

- **`docs/ghl-reference/tfs-opportunities.csv`** (17 rows) — Two pipelines: Buyer Inquiries (env:GHL_PIPELINE_ID_BUYER) with 7 stages (New Lead via webhook → Offer Submitted cd4df0dc... → Contract Sent → Contract Signed → EMD Received → Closed/Won → Lost); Commercial/Multifamily (HTpFvaMGATSXsECYFhoB) with 8 stages (Profile Completed → NDA Requested → NDA Signed → Package Delivered → LOI Submitted → Under Contract → Closed Won → Dead). Most stages GHL-manual or webhook-triggered; stage IDs resolved by name at runtime via getStageIdByName() for Commercial lane.

- **`docs/ghl-reference/dispobuddy-fields.csv`** (37 rows) — Dispo Buddy partner submission custom fields. Columns: field_key, display_name, type, purpose, set_by. Includes: partner identity (jv_partner_name, jv_phone_number, jv_partner_email), property details (address, occupancy, access instructions, photos/docs links), deal structure (deal_type select parsing maps to db-* tags), pricing (contracted_price, asking_price, arv_estimate, buyer_entry_fee, etc.), financing details (subto_loan_balance, interest_rate, monthly_payment, loan_maturity, subto_balloon, seller_finance amounts/rates/terms), property attributes (beds, baths, sqft, year_built, lot_size), OTP login (portal_otp_code). All set by: dispo-buddy-submit.js or partner-login.js. Key pattern: uses field_key (runtime resolved) not hardcoded IDs — getCustomFieldMap() builds the key→ID resolution at startup.

- **`docs/ghl-reference/dispobuddy-tags.csv`** (16 rows) — Dispo Buddy tags organized by 4 categories: Identity (dispo-buddy, jv-partner, jv-submitted which triggers deferred cron), Deal Type (db-cash, db-subto, db-seller-finance, db-hybrid, db-morby, db-lease-option, db-novation — auto-applied by deal_type field parsing), Relationship (db-first-deal, db-affiliate-referred, db-direct-to-seller, db-jv-with-wholesaler), Triage (jv-viable, jv-rejected — both deferred). All set by: dispo-buddy-submit.js buildTags() function which parses the deal_type field and applies zero or more type tags + zero or more relationship tags per contact.

- **`docs/ghl-reference/dispobuddy-opportunities.csv`** (11 rows) — JV Deals pipeline (XbZojO2rHmYtYa8C0yUP). Nine stages in order: New JV Lead (cf2388f0-fdbf-4fb1-b633-86569034fcce, auto-created on submission) → Under Review (GHL manual) → JV Agreement Sent → JV Agreement Signed → Actively Marketing → Assignment Sent → Assigned with EMD → Closed → Lost. Mapped to trigger events via partner-stage-notify.js webhook (fired on stage change in GHL workflow).

### Data source verification

All 6 CSVs reverse-engineered from production source code and validated against:
- `_ghl.js:111-143` — CF_IDS hardcoded object (25 TFS field IDs)
- `auth-signup.js:97-100` — Contact Role requirement + signup tags
- `buy-box-save.js:73-142` — buy-box form mappings to 25+ custom fields
- `vip-buyer-submit.js:41-82` — VIP signup tags + buyer type strategy tags
- `notify-buyers.js:217-272` — buyer field access patterns (CF constants) + deal matching filters
- `buyer-response-tag.js:27-69` — response tag patterns + preference tag system
- `dispo-buddy-submit.js:19-560` — field_key resolution, buildTags() logic, deal type mapping
- `partner-login.js:23-60` — OTP encoding format
- Notion schema inspection for deal type select options and opportunity stage IDs

### Why CSV format instead of markdown

Previous attempts to write detailed markdown with inline tables consistently timed out (stream idle timeout — partial response received) across 4+ sessions. CSV format:
- Smaller per-file output size (avoids timeout)
- Native Excel/Google Sheets import (more useful than markdown for field reference)
- Easier to maintain and version-control (structured data, not narrative)
- All critical details preserved in columns (field names, IDs, purposes, triggers, code references)
- Can be imported directly into GHL admin docs or team wikis

### Limitations (intentional omissions)

- No markdown narrative guide included (deferred to avoid timeout risk; CSVs alone are the primary deliverable)
- Field ID values for Dispo Buddy not included (all runtime-resolved via getCustomFieldMap(); use function logs to find real IDs on first run)
- GHL webhook workflows not included (must be configured manually in GHL UI — CSVs document the fields/tags they write to)
- Historical data cleanup + deal engagement tracking flows documented in separate CLAUDE.md sections already

---

## Completed — April 21 2026 Dispo Buddy Submission Triage (PR #103)

Branch: `claude/fix-deal-submission-issue-3WLfn`. A JV partner reported
multiple failed deal submissions on `dispobuddy.com/submit-deal` with
nothing but a generic "Submission failed: Submission failed. Call
(480) 842-5332." banner. Triage uncovered two bugs: a UX bug that
hid the real backend error, and the actual cause — an invalid GHL
Private Integration token on the Dispo Buddy Netlify site.

### Root cause

Netlify function log for `dispo-buddy-submit` showed:
```
Custom field lookup failed: 401 {"statusCode":401,"message":"Invalid Private Integration token"}
Contact upsert failed: 401 {"statusCode":401,"message":"Invalid Private Integration token"}
```

The `GHL_API_KEY` env var on the Dispo Buddy Netlify site was stale /
had been rotated in GHL without the new value being pushed to Netlify.
Every contact upsert was being rejected before any business logic ran,
so no contact, opportunity, Notion page, or notification ever fired.
Brooke rotated the token in Netlify's Dispo Buddy site dashboard mid-
session and confirmed submissions are working again.

### Why the partner didn't know what happened

`dispobuddy/submit-deal.html:1445` was reading the wrong field off the
error response:

```js
var err = await res.json().catch(function() { return {}; });
throw new Error(err.message || 'Submission failed');
```

But `dispo-buddy-submit.js` returns errors as `{ error: '...' }`, not
`{ message: '...' }`. So every failure — missing field, bad phone,
GHL 401, Netlify timeout, anything — collapsed to the same useless
generic banner. Partner had no idea what went wrong and the only cue
was the phone number at the end of the message.

### Files shipped (both in PR #103, merged)

- **`dispobuddy/submit-deal.html`** (commit `dfae943`) — error banner
  now reads `err.error` first, falling back to `err.message` then to
  `'HTTP ' + res.status`. Next failure surfaces the real reason.
- **`dispobuddy/netlify/functions/dispo-buddy-submit.js`** (commit
  `7d02efb`) — contact upsert now specifically detects `401` and
  returns a clean `503` with a human message ("Our CRM is temporarily
  unreachable. Please try again in a few minutes or call (480) 842-
  5332.") instead of the generic 502 "Failed to create contact". The
  detailed 401 still lands in the Netlify function log via the
  existing `console.error` so the next token rotation is diagnosable
  in under a minute.

### Operational follow-up (Brooke owned, in-session)

- Rotated `GHL_API_KEY` in Netlify → Dispo Buddy site → Environment
  variables. Submissions now succeed.
- TODO (Brooke): ping the partner who called so they re-submit. Their
  earlier attempts never reached GHL or Notion — there's no CRM
  record of them whatsoever.

### Deliberately NOT touched

- The sequential control flow in `dispo-buddy-submit.js` (custom
  field map → upsert → tags → opportunity → Notion retry loop →
  notifications) — still a 10s Netlify timeout risk if Notion schema
  drifts again. Flagged in the diagnosis but no changes this pass.
  If it bites again, the cleanest fix is to fire Notion creation +
  notifications as fire-and-forget (don't `await`) and return 200 to
  the partner as soon as the GHL upsert succeeds.
- The frontend validation path — no regression there; the real
  failure was server-side.

### Other known caveats

- The Dispo Buddy Netlify site and the Terms For Sale Netlify site
  each maintain their own copy of `GHL_API_KEY`. If you rotate a
  Private Integration token in GHL, you have to push the new value
  to BOTH Netlify sites or one of them will start 401-ing silently.
  The Terms For Sale side wasn't affected this time but is vulnerable
  to the same failure mode.

---

## Completed — April 21 2026 Auto-Enrichment Go-Live + Schema Hotfixes

Follow-up session that took the Path 3 pipeline from "code merged" to
"fully live end-to-end". Shipped 5 commits on `main` after merging the
feature branch.

### What went live

- **Full round-trip verified on SAN-02** (13420 Homestead Way, San Antonio, TX). Curl POST to `/api/auto-enrich` with a real Notion pageId:
  - RentCast AVM $231k (vs $265k asking) + 4 comps
  - RentCast rent $1,410/mo + 4 comps
  - HUD FMR $1,750/mo (San Antonio-New Braunfels, medium tier)
  - Claude Haiku narrative (hook/whyExists/3 strategies/buyerFit/redFlags/"High" confidence)
  - Notion PATCH succeeded (`LTR Market Rent`, `Enriched at`, `ARV`, `Description`, `Beds/Baths/Living Area/Year Built`)
  - Paperclip `/render` produced a `.docx` in `/Deal Analyses/`
  - Cost: $0.0025/deal Claude Haiku

### Hotfixes shipped (in order)

1. **`aa19244`** — `'Deal Narrative'` → `'Description'` (real Notion property name)
2. **`569795e`** — Smart-retry regex rewrite. Old regex only matched backtick-wrapped errors; Notion's real format is unquoted (`Enriched At is not a property that exists`). Now handles both formats AND type-mismatch errors (`expected to be rich_text`).
3. **`88129c3`** — `'Enriched At'` → `'Enriched at'` (lowercase "a" in actual Notion schema — confirmed by querying the database schema via Notion API).
4. **`69803b0`** — `BROOKE_CONTACT_ID` hardcoded to `qO4YuZHrhGTTBaFKPDYD` (CEO Briefing contact, no phone/email) → `1HMBtAv9EuTlJa5EekAL` (Brooke's actual contact). Now reads from `BROOKE_CONTACT_ID` env var with that as fallback. Fixes 422/400 GHL errors on SMS + email.

### Notion schema updates (done by Brooke in the UI)

- `LTR Market Rent` → changed from Rich Text to **Number**
- `Enriched at` → confirmed exists as **Date** (lowercase "a")
- `Description` → confirmed exists as Rich Text

### Env var updates

- **Netlify `AUTOENRICH_AUTH_TOKEN`** — was initially set to the literal text `openssl rand -hex 32` (command, not value). Regenerated via `openssl rand -hex 32` and pasted the real hex string.
- **Netlify `ANTHROPIC_API_KEY`** — added. Value came from paperclip where the key had been typo'd as `ANTHROPIC_API_KY` in `/etc/environment`. Fixed typo on paperclip (restarted pm2 processes with `--update-env`). Confirmed valid against `api.anthropic.com/v1/messages`.
- **Old Anthropic key** (`sk-ant-api03-KQOe...` from `/root/.pm2/dump.pm2`) returned 401 — was revoked. Only the `5NEmt3q6...` key in `/etc/environment` is live on paperclip.

### Known follow-ups

- **Google Drive .docx quality gap** — the current `auto-underwrite/generate_pdf.js` produces a minimal ~half-page doc (Property table + Economics table + optional sections). Brooke's reference template is a full **9-page institutional investment report** with: Cover sheet, Property Overview, Price & Tax History (+ tax-reset math), Comparable Sales, Flood & Risk Assessment, 3-scenario Rehab Budget, 4-scenario Investment Returns, PASS/PROCEED recommendation, branded footer every page. Huge gap — tracked in TODO below as multi-session project.
- **SMS + email verification still pending** — the `69803b0` contact-ID fix was pushed but Brooke hadn't re-run the live curl to confirm the SMS/email actually land after the fix. First task next session: re-run the curl, verify both arrive.
- **Rotate the Anthropic key that was visible in chat** — `sk-ant-api03-KQOe...` is already revoked (good), but the newer working key visible during troubleshooting should be rotated at https://console.anthropic.com/settings/keys for hygiene.

---


## Completed — April 21 2026 Auto-Enrichment Workflow (Path 3)

Branch: `claude/auto-enrichment-workflow-myS1p`.

Built the full auto-enrichment pipeline that reduces manual deal data-gathering from ~35 min to ~3–5 min.

### What was built

- **`termsforsale/netlify/functions/auto-enrich.js`** — POST `/api/auto-enrich`. Auth-gated (Bearer token). Fetches the Notion deal page, runs 4 parallel enrichment calls (RentCast property record + AVM value + AVM rent + HUD FMR, each with 6s timeout via `Promise.allSettled`), calls Claude Haiku to produce a 6-key narrative JSON (hook, whyExists, strategies, buyerFitYes, redFlags, confidence), smart-patches Notion back (up to 5 retries, drops unknown properties), calls the Paperclip `/render` service to produce a `.docx` in Google Drive, and notifies Brooke via GHL note + SMS + email.

- **`auto-underwrite/n8n/auto-enrichment.workflow.json`** — Importable n8n workflow. Schedule trigger every 5 min → Notion database query (filter: Deal Status = Ready to Underwrite) → Code node to extract page IDs → HTTP Request POST to `/api/auto-enrich` per deal.

- **`auto-underwrite/n8n/README.md`** — Setup guide: Netlify env vars, n8n Variables, import steps, curl test example, Notion schema notes.

- **`netlify.toml`** — `/api/auto-enrich` → `/.netlify/functions/auto-enrich` redirect (already present from prior session scaffolding).

### Env vars to add in Netlify (Terms For Sale site)

| Var | Value |
|---|---|
| `AUTOENRICH_AUTH_TOKEN` | `openssl rand -hex 32` |
| `RENTCAST_API_KEY` | copy from Dispo Buddy env |
| `RENDER_SERVICE_URL` | `http://64.23.204.220:3001/render` |
| `RENDER_SERVICE_TOKEN` | from `/home/brooke/pdf-render-service/.env` AUTH_TOKEN |

### n8n Variables to create

| Variable | Value |
|---|---|
| `NOTION_TOKEN` | Notion integration secret |
| `AUTOENRICH_AUTH_TOKEN` | same value as Netlify env var |

### Notion schema requirements

The following Notion properties must exist on the deals DB for full enrichment:
- `Deal Status` (status) — must have "Ready to Underwrite" as an option
- `LTR Market Rent` (number) — written by enrichment
- `Enriched At` (date) — written by enrichment
- `Deal Narrative` (rich_text) — written speculatively (dropped silently if missing)
- `ARV`, `Beds`, `Baths`, `Living Area`, `Year Built` — filled in if blank

### Cost per deal

- RentCast: 3 API calls (counts against monthly quota)
- Claude Haiku: ~1200 input tokens + ~400 output tokens ≈ $0.003/deal
- Paperclip render: compute only (no additional cost)

---

## Completed — April 20 2026 GSC "Page with redirect" Email Triage

Branch: `claude/fix-email-issue-JK3sa`. Commit `5034c09`.

Brooke received a Google Search Console "New reasons prevent pages from
being indexed" email flagging "Page with redirect" on
`https://deals.termsforsale.com/`. Diagnosed as an expected consequence
of the April 9 apex migration — not a bug.

### Diagnosis

- Every URL on `deals.termsforsale.com/*` correctly 301s to
  `termsforsale.com/*` via `netlify.toml:9-19`.
- GSC's "Page with redirect" is its generic label for "URL you
  registered doesn't resolve to an indexable page because it redirects"
  — which is exactly what we want post-migration.
- Verified the code side is clean:
  - All `<link rel="canonical">` tags point to apex ✅
  - `termsforsale/robots.txt` advertises apex sitemap ✅
  - `sitemap.js:9` emits apex URLs ✅
  - No static HTML references `deals.termsforsale.com` in a way that
    would tell Google to index the old host
- Live curl (from Brooke's Mac) confirmed
  `HTTP/2 301` + `location: https://termsforsale.com/` on the old
  subdomain — textbook correct redirect.

### Code change shipped

- **`termsforsale/netlify/functions/_deal-url.js`** — removed a stale
  doc comment that used `https://deals.termsforsale.com/` in the
  inline example (misleading since `BASE_URL` has been pinned to apex
  since April 9). Added a short note documenting why `BASE_URL` stays
  on apex (avoids the 301 redirect hop on every outbound SMS/email/
  sitemap link).

### Search Console steps Brooke completed during session

1. Added `termsforsale.com` as a **Domain property** via DNS TXT
   verification in Squarespace DNS. The required TXT record
   (`google-site-verification=YiqqTkp_37ngeGti0nFUUN69Socz7tm5tBqpQZStGZI`)
   was already present on `@` from a prior attempt — verified
   instantly.
2. Submitted `https://termsforsale.com/sitemap.xml` — initially
   "Couldn't fetch" (cosmetic — GSC hadn't crawled the property yet),
   then flipped to **Success** after using URL Inspection → Request
   Indexing to push it into Google's crawl queue.
3. Attempted Change of Address from old
   `https://deals.termsforsale.com/` property → new
   `termsforsale.com` Domain property. Validator repeatedly returned
   "Failed — 301-redirect from homepage" despite the redirect being
   clean. Concluded this is a known flaky GSC validator issue
   (sometimes works after a few days' cache settling). Not worth
   fighting further since Change of Address is optional polish — the
   301s themselves are what transfer ranking signals.

### Open follow-up for Brooke (Search Console only, no code)

- **Recommended:** Remove the old `https://deals.termsforsale.com/`
  property from GSC (Settings → Remove property). Stops the "Page
  with redirect" warning emails immediately. Historical data on
  that property is already effectively frozen since every URL there
  redirects, so nothing useful is being lost.
- **Alternative:** Leave it and ignore the emails — they'll subside
  on their own as Google recrawls.
- **Optional:** Retry Change of Address in 2-3 days if the green
  checkmark is wanted. No code changes will help — the 301s are
  already correct; the validator is just grumpy.

### Deliberately NOT changed

- The `netlify.toml` 301 redirect rules for `deals.termsforsale.com`
  → apex. They're working as designed and are exactly what the
  migration requires.
- The 2 commercial-lane CORS `ALLOWED_ORIGINS` arrays in
  `commercial-deal.js` and `sign-commercial-nda.js` that still
  include `deals.termsforsale.com`. Per CLAUDE.md these are
  intentionally kept during the transition for backward compat.
- `termsforsale/admin/paperclip-sop.html` line 424 — historical
  migration documentation, not live marketing copy.

### Verified locally

- Static grep confirmed no remaining `deals.termsforsale.com` URLs in
  static HTML canonicals, og:url, or JSON-LD across
  `termsforsale/**/*.html`.
- `sitemap.js` reviewed — it makes 2 internal HTTP calls (to
  `/api/deals` and `/blog/posts-index.json`) with **no timeouts**.
  Not a problem today (sitemap submitted successfully), but flagged
  as a potential defensive hardening opportunity if "Couldn't fetch"
  recurs in the future: add `AbortController` with a 4s timeout to
  each internal fetch so the sitemap always responds quickly even
  when Notion is slow.

---

## Completed — April 18 2026 Auto-Underwrite PDF Render Service on Paperclip

Branch: `claude/setup-nodejs-oauth-service-fpTNc`.

Built and deployed a small Node.js service on the paperclip Droplet
that takes a deal JSON payload and renders it into a `.docx` file
in the `/Deal Analyses/` Google Drive folder. This is the
"infrastructure half" of the auto-underwriting pipeline — the n8n
workflow that calls it (with Claude-underwritten content) is the
next piece, planned for a separate session.

### What's running

- **Service:** `pdf-render-service` under pm2 on paperclip
  (`/home/brooke/pdf-render-service/`), pm2 id 4, cluster mode,
  auto-restart enabled, persisted via `pm2 save` so it survives
  reboots alongside the existing 4 paperclip jobs (deploy-hook,
  deal-cleanup, ops-audit, deal-buddy-scheduler).
- **Endpoint:** `POST http://64.23.204.220:3001/render`
  - Header: `X-Auth-Token: <shared secret>` (32 random bytes hex)
  - Body: `{ "dealId": "TEST-001", "deal": { ... freeform fields ... } }`
  - Returns: `{ ok, dealId, filename, driveFileId, driveWebViewLink, driveWebContentLink }`
- **Health:** `GET http://64.23.204.220:3001/health` (no auth) returns
  `{ ok, service, uptime, driveFolderConfigured, oauthConfigured, authTokenConfigured }`.
  Smoke test on April 18: all four flags `true`, sample render
  succeeded — file `1VOACezYrqK6FDLgStzVGdxgMm1N9Czt-` landed in
  `/Deal Analyses/` and opened cleanly in Google Docs.

### Files shipped (all under `/auto-underwrite/` in the repo)

- **`server.js`** — Express app. Two routes: `/health` (open),
  `POST /render` (gated by `X-Auth-Token`). Calls
  `generateDealDoc()` then `uploadToDrive()`. JSON body limit 2 MB.
  Returns 401 on bad token, 500 with `error` + (in non-prod) `stack`
  on failure.
- **`generate_pdf.js`** — Builds the `.docx` using the `docx`
  package. Renders a centered title, deal-ID/city header,
  Property table (address, type, beds/baths, sqft, year built, lot),
  Economics table (deal type, asking, entry fee, ARV, est rent, PITI,
  loan balance, rate, SF terms), and optional Summary / Why This
  Exists / Strategies / Ideal Buyer / Underwriting Notes sections
  for whatever the caller passes. Money values normalized via a
  `money()` helper that strips `$` / `,` and re-formats. Filename
  is `<slug>-<timestamp>.docx` so collisions are impossible.
  Despite the historical filename, the output is `.docx` not PDF —
  the `pdf-render-service` name is preserved for continuity with
  the existing paperclip directory structure.
- **`google_drive.js`** — googleapis OAuth2 client. Creates a
  client from `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
  `GOOGLE_REFRESH_TOKEN`, sets the refresh token on the credentials,
  and uploads the buffer via `drive.files.create()` into the
  configured `DRIVE_FOLDER_ID`. Uses `supportsAllDrives: true` so
  shared drives work too. Returns `{ id, name, webViewLink,
  webContentLink }`.
- **`get-refresh-token.js`** — One-shot CLI helper that mints the
  refresh token. Spins up an HTTP server on `localhost:8765`,
  prints the OAuth consent URL to the terminal, and after the user
  approves in the browser, exchanges the code for tokens and prints
  `GOOGLE_REFRESH_TOKEN=...`. Scope: `drive.file` only (least
  privilege — can only touch files the app creates).
- **`ecosystem.config.js`** — pm2 config. Service name
  `pdf-render-service`, cwd `/home/brooke/pdf-render-service`,
  env `NODE_ENV=production` `PORT=3001`,
  `max_memory_restart: 400M`, logs to
  `/var/log/pdf-render-service.{error,out}.log`.
- **`deploy.sh`** — rsync-based deploy from laptop to paperclip.
  Excludes `.env`, `node_modules/`, `.git/`, `*.log`. Honors
  `INSTALL_DEPS=1` env var to also run `npm install --omit=dev`
  on remote. Uses `pm2 reload` if the app already exists, `pm2
  start ecosystem.config.js` otherwise, then `pm2 save` and a
  `curl /health` check.
- **`.env.example`** + **`.gitignore`** + **`README.md`** with the
  full Google Cloud Console walkthrough (consent screen, scope,
  client ID, redirect URI, refresh token mint, folder ID, AUTH_TOKEN
  generation, paperclip prep, deploy, smoke test, troubleshooting).
- **`package.json`** — pinned deps: `express ^4.19.2`,
  `docx ^8.5.0`, `googleapis ^133.0.0`, `dotenv ^16.4.5`. Node 18+.

### Google Cloud setup (one-time, done April 18)

- Project: `deal-pros-automation`
- Drive API: enabled
- OAuth consent screen: published to "In production" (External user
  type, app name `Deal Pros Auto-Underwrite`). Refresh tokens are
  now permanent — they would have expired after 7 days if left in
  Testing mode.
- OAuth scope granted: `https://www.googleapis.com/auth/drive.file`
  (least privilege — only touches files the app creates, cannot
  read or modify pre-existing Drive content).
- OAuth Client ID: type **Web application**, name
  `pdf-render-service`. Authorized redirect URI:
  `http://localhost:8765/oauth2callback` (only used when re-minting
  the refresh token; never hit in production).
- Refresh token: tied to Brooke's Google account (the owner of
  `/Deal Analyses/`).

### Env vars on paperclip (`/home/brooke/pdf-render-service/.env`)

| Var | Purpose |
|---|---|
| `PORT=3001` | Express bind port |
| `AUTH_TOKEN=<64 hex>` | Shared secret for `X-Auth-Token` header |
| `GOOGLE_CLIENT_ID` | from Cloud Console |
| `GOOGLE_CLIENT_SECRET` | from Cloud Console |
| `GOOGLE_REFRESH_TOKEN` | minted via `get-refresh-token.js` |
| `DRIVE_FOLDER_ID` | last URL segment of `/Deal Analyses/` folder |

### Operational notes

- **Firewall:** `ufw` is currently `Status: inactive` on paperclip,
  so port 3001 is open to the internet by default. The `AUTH_TOKEN`
  is the only thing protecting `/render` from anonymous calls.
  `ufw allow 3001/tcp` was applied for when the firewall is later
  turned on. **TODO:** decide whether to enable ufw and lock down
  to a known caller IP (n8n Cloud egress range, or a Cloudflare
  tunnel) — see TODO list below.
- **Service-account JSON keys are blocked by GCP org policy** for
  this project, which is why we went the OAuth refresh-token route.
  Don't try to switch back to a service account without first
  changing the org policy.
- **Refresh token compromise:** the token Brooke minted on April 18
  was visible in chat during setup. Per the security follow-up
  in TODO, it should be revoked at
  https://myaccount.google.com/permissions and re-minted before
  the n8n workflow goes live.

### How to call from anywhere

```
curl -sS -X POST http://64.23.204.220:3001/render \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
  -d '{"dealId":"PHX-007","deal":{"streetAddress":"...","city":"Phoenix","state":"AZ","dealType":"Subject To","askingPrice":385000,"arv":450000,"hook":"...","analysis":"..."}}'
```

The `deal` object is freeform — any of `streetAddress`, `city`,
`state`, `zip`, `propertyType`, `beds`, `baths`, `sqft`, `lotSize`,
`yearBuilt`, `dealType`, `askingPrice`/`price`, `entryFee`, `arv`,
`estRent`, `piti`, `loanBalance`, `interestRate`, `sfTerms`,
`headline`/`title`, `hook`/`summary`/`dealStory`, `whyExists`,
`strategies`, `buyerFitYes`, `analysis` will be rendered if
present. Missing fields render as `—`. Unknown fields are
silently ignored.

### Backwards compatibility

No existing functions or pm2 jobs touched. The new service runs
alongside `deploy-hook` (the GitHub auto-deploy listener on port
9000) and the four cron-driven jobs without conflict.

## Completed — April 15 2026 Dispo Buddy Go-Live + Notion Field Sync Hotfixes

Branch: `claude/improve-logo-favicon-Av2Gm`. Live walkthrough with Brooke
to ship `dispobuddy.com` to production end-to-end, then iterate on Notion
sync bugs that surfaced during real submissions.

### What went live

- **Domain**: `dispobuddy.com` DNS pointed off Squarespace (registrar
  unchanged) onto Netlify via `A 75.2.60.5` for apex + `CNAME` for www.
  Let's Encrypt SSL auto-provisioned.
- **Netlify env vars set**: `GHL_API_KEY`, `GHL_LOCATION_ID` =
  `7IyUgu1zpi38MDYpSDTs`, `NOTION_TOKEN`, `NOTION_DATABASE_ID` =
  `a3c0a38fd9294d758dedabab2548ff29`, `INTERNAL_ALERT_PHONE` =
  `+15167120113`, `INTERNAL_ALERT_EMAIL`, and finally `NOTIFICATIONS_LIVE`
  = `true` after silent-mode tests passed.
- **GHL workflow live**: Partner Stage Change Notifications — fires on
  opportunity stage change in `3. JV Deals` pipeline, POSTs to
  `/api/partner-stage-notify` with `{contactId, opportunityId, stageName,
  pipelineName}`.
- **End-to-end verified live**: form submission writes contact +
  opportunity + Notion deal with auto-generated Deal ID, sends partner
  confirmation SMS + email + internal alert SMS + email. OTP login flow
  works (SMS arrives, code verifies, dashboard loads).

### Hotfixes shipped during go-live

Four commits on the branch — each one shipped because the previous
attempt surfaced a new Notion validation error in the live function
log:

1. **`4efe71f` — Subject To dealTypeMap** — `dispo-buddy-submit.js:589`
   was mapping `Subto` → `SubTo` but Notion's actual select option is
   `Subject To` (with space). Rejected payload was falling back to a
   minimal-fields retry that dropped Deal ID + 13 other fields.
2. **`92dfa97` — 6 Notion property validation errors** — from real
   error log:
   - `Contracted Entry is not a property` → removed write (property
     genuinely doesn't exist in the DB)
   - `Beds expected to be number` → `text()` → `num()`
   - `Baths expected to be number` → `text()` → `num()`
   - `Living Area expected to be number` → `text()` → `num()`
   - `SF Rate expected to be number` → `text()` → `num()`
   - `Details  is not a property` → temporarily removed trailing space
     (later reverted in `f71ee4c`)

   Also upgraded `num()` helper to strip commas + non-numeric chars
   before `parseFloat()` so user input like `"1,450"` parses as `1450`
   instead of `1`.
3. **`4dd39cd` — Expanded `?test` autofill** — added `propertyType`,
   `propBeds`, `propBaths`, `propSqft`, `propYearBuilt`, `propLotSize`,
   `contractedEntryFee`, `estTaxesInsurance`, `subtoMaturity`,
   `subtoBalloon`, `additionalNotes` to the test-mode prefill so the
   field-type fixes could be validated end-to-end without manually
   filling 30 fields each test.
4. **`f71ee4c` — Smart-retry + restore Details trailing space** —
   restored `'Details '` (with trailing space) since that IS the actual
   Notion property name (the previous interpretation of the error
   message was wrong — the double-space in `"Details  is not a
   property"` was because the property is literally named `"Details "`).

   More importantly, replaced the all-or-nothing minimal-fields fallback
   with a **smart-retry loop**: parses Notion's error message, identifies
   any property names mentioned, drops them from the payload, retries.
   Up to 5 attempts. This means any single schema mismatch in the
   future only drops that one property — every other field still
   makes it into Notion. No more 14-field cliff.

   Also wired the form's `additional_notes` textarea into the Details
   block (was previously dropped entirely).

   The minimal-fields fallback (last-resort path after 5 smart-retry
   attempts give up) now also preserves the auto-generated Deal ID so
   `PHX-XXX` sticks even in worst case.

### Files touched

- `dispobuddy/netlify/functions/dispo-buddy-submit.js` — all 4 commits
- `dispobuddy/submit-deal.html` — `?test` autofill expansion only
- `CLAUDE.md` — session log

### Backwards compatibility

- All form field names unchanged — no breaking changes to existing
  submissions in flight.
- All GHL custom field IDs unchanged — contact + opportunity creation
  still works identically.
- The `Subto` → `Subject To` mapping change means new deals get the
  correct Notion option going forward; existing deals already in Notion
  with the auto-created `SubTo` option are unaffected. Brooke can
  manually merge / delete the duplicate `SubTo` option from the Notion
  Deal Type select if desired.

### Open issues for next session

Three Notion fields don't sync from Dispo Buddy submissions and were
deferred:

1. **Occupancy** — code writes as `multi_select`. Need to confirm
   Notion's property type (likely single `select` or `rich_text`).
2. **Access** — code writes to property name `Access`. Property may
   actually be named `Property Access` or similar. Need exact name.
3. **Internal Notes** — currently the `additional_notes` form input
   gets pushed into the combined `Details ` block rather than its own
   field. If a separate `Internal Notes` property exists in Notion,
   need exact name to write directly.

Smart-retry is silently dropping these; the Netlify function log line
`Removed N props [Occupancy, Access, ...]` confirms which ones are
being rejected. Just need to confirm the real Notion schema.

Also still pending: County + HOA fields (Brooke confirmed the Notion
properties exist but the form doesn't collect them yet).

---

## Completed — April 15 2026 Dispo Buddy Proof Stat Refresh

Branch: `claude/update-deal-metrics-uUFC4` (merged via PR #88).

Brooke asked to swap the outdated stats on the Dispo Buddy landing page
"Partners Who've Done It" proof section for current real numbers.

### Files shipped

- **`dispobuddy/index.html:474-486`** — reduced the four-stat grid to
  three accurate figures:
  - `$47M+ in deals closed` → removed
  - `320+ deals assigned` → **`200+ deals assigned`**
  - `47 days avg time to close` → **`<16 days avg time to close`**
    (encoded as `&lt;16 days` so the `<` renders safely)
  - `4.9★ from 200+ partners` → removed from this grid
  - Added **`$1.7M+ in funded assignment fees`**
- **`dispobuddy/index.html:266-267`** — aligned the two hero badges
  so they don't contradict the proof grid below:
  - `4.9★ from 200+ partners` → **`4.9★ partner rating`** (dropped
    "200+ partners" to avoid colliding with the new "200+ deals
    assigned" stat)
  - `$47M+ in deals closed` → **`$1.7M+ in funded assignment fees`**
    (matches the proof grid)

### Deliberately NOT touched

- Jeremy R. testimonial (still `$18k` easiest deal) — left alone.
- `dispobuddy/proof.html`, `dispobuddy/index.html` "Social Proof"
  narrative copy — not in scope for this request. If those also carry
  the old `$47M` / `320+` / `47-day` numbers, a follow-up sweep can
  retarget them.

### Verified

- Both commits (`3e56879`, `f619206`) landed on the feature branch,
  Netlify preview built clean, PR merged to main (`85e0af9`).
- Post-merge grep confirms `$47M+` / `320+` / `47 days` no longer
  appear anywhere under `dispobuddy/`.

---

## Completed — April 15 2026 Mobile Nav Collapsible Hamburger

Branch: `claude/mobile-nav-collapse-O6uig`.

Brooke reported the Terms For Sale mobile nav bar looked messy —
the existing mobile CSS had `.nav-links{display:none}` so the 6
primary links (Browse Deals / Sell Your Deal / Get Deal Alerts /
Commercial / Deal Map / Help) were completely unreachable on phones,
and the remaining `.nav-right` still crammed `#tfs-buybox-container
+ My Portal + Sign Up + Login` (4 items) into a tight bar. Replaced
with a real hamburger-to-drawer pattern that works on all 4 pages
that use the shared `<nav id="main-nav">` shell.

### Files shipped (all 4 get the same additive change)

- **`termsforsale/index.html`** — CSS block added before `</style>`,
  `<button class="nav-toggle">` added at the end of `<nav>`, and JS
  `toggleMobileNav()` + outside-click-on-link + Escape handler added
  next to the existing `main-nav` scroll listener.
- **`termsforsale/deals.html`** — same additions.
- **`termsforsale/blog/index.html`** — same additions (uses
  `min-height:60px` to match blog's existing 60px nav bar; no
  `#tfs-buybox-container` rule since blog nav doesn't have one).
- **`termsforsale/about.html`** — same additions.

### How it works

- **Desktop (≥769px):** zero visual change. The hamburger has
  `display:none`, nav-links and nav-right render inline as before.
- **Mobile (≤768px):** nav is now `flex-wrap:wrap; height:auto;
  min-height:56px`. A 3-bar hamburger sits at the right of the
  logo row. Tapping it applies `.open` to `<nav>`, which reveals
  both `.nav-links` (stacked, full-width, single list with
  per-row borders) and `.nav-right` (stacked, full-width buttons
  at 12px padding / 14px font so they're tap-friendly) as two
  ordered siblings below the logo row. The hamburger animates
  into an X via three transformed `<span>` bars.
- Tapping any link inside the drawer auto-closes the drawer
  (delegation on `#main-nav .nav-links a, #main-nav .nav-right a`).
- Escape key closes the drawer.
- `aria-expanded` toggles between `"true"` and `"false"` on the
  button for screen readers. `aria-controls="main-nav"` wires the
  button to the disclosure target.

### Selector specificity math

The override selectors use `nav#main-nav.open .nav-links` /
`nav#main-nav.open .nav-right` which beat the pre-existing mobile
rules (`.nav-links{display:none}` / `.nav-right{gap:6px}`) via
ID-selector specificity, so the new rules reliably win on mobile
without `!important` except where padding/font-size needed to
override inline styles on `#tfs-buybox-container a`.

### Verified

- All 4 files: `<nav>` balance 1 open / 1 close, `<button>` balance
  matches before+1 on each file.
- Each file has exactly 1 `nav-toggle` button, 1 `toggleMobileNav`
  function, and 7-8 `nav#main-nav.open` CSS rules (blog has 7 since
  it lacks the buybox container row).
- Desktop CSS untouched — the only `@media(max-width:768px)` rule
  that hits is additive.

### Deliberately NOT touched

- Any other page with its own custom nav (dashboard, admin shell,
  buying-criteria form, deal.html, blog posts). Those either don't
  use the shared `<nav id="main-nav">` pattern or have their own
  responsive layouts already.
- Desktop nav behavior / scroll shadow / hover colors / existing
  auth modal — zero changes.
- The VA post builder, dispobuddy pages, admin pages — all
  out of scope.

### Known caveats

- The drawer is rendered inline inside `<nav>` (not as a fullscreen
  overlay), so when open it overlaps ~300-400px of hero content
  beneath it. That's standard dropdown-drawer behavior and matches
  the pattern used on dispobuddy. If Brooke wants the drawer to
  slide-in from the right as a full-height overlay (like dispobuddy
  has), that's a separate pass.
- No body-scroll-lock when open. The page is still scrollable
  behind the drawer. Not a bug — just a design choice; if Brooke
  wants it locked, add `document.documentElement.style.overflow =
  open ? 'hidden' : ''` inside `toggleMobileNav()`.

---

## Completed — April 15 2026 Deal Status Display Lifecycle

Branch: `claude/deal-status-display-Y0upg`.

Brooke asked: widen what the public website shows so operators aren't
forced to leave deals at "Actively Marketing" once the deal is under
contract. Specifically:
- **Assignment Sent** → keep showing as **Active** on the site.
- **Assigned with EMD** → keep showing but mark as **Pending** so
  buyers see the status change.
- **Closed** → move into a **"Recently Closed"** social-proof section
  so the track record is visible to new buyers.
- **All other statuses** (Missing Information, Ready to Market, Not
  Accepted, Lost, etc.) → continue to stay hidden.

### Files shipped

- **`termsforsale/netlify/functions/deals.js`** — filter widened from
  `'Actively Marketing'` only to a `PUBLIC_STATUSES` list:
  `['Actively Marketing', 'Assignment Sent', 'Assigned with EMD',
   'Closed']`. Uses a Notion `or` filter with both `status` and
  `select` shapes, falling back to client-side filtering if the
  server-side shape is rejected. Also now surfaces three additional
  Notion fields on every deal object: `dateFunded`, `dateAssigned`,
  `amountFunded` — used by the closed-section stat cards and the
  per-deal "Closed on <date>" banner.

- **`termsforsale/deals.html`** — split loaded deals at init time
  into `ALL_DEALS` (active + pending, main list + map) and
  `CLOSED_DEALS` (sorted newest first, rendered into the new
  "Recently Closed" section). `makeCard()` now reads `dealStatus`
  and renders:
  - **Pending badge** (orange `⏳ Pending`) on the photo top-left
    for `Assigned with EMD` deals. Also swaps the "Just Listed"
    price-row tag for a muted "⏳ Pending" chip.
  - **Closed badge** (green `✓ Closed`) on the photo top-left for
    `Closed` deals. Swaps "Just Listed" for a "✓ Closed" chip,
    hides the Save heart, dims the card slightly (`is-closed`
    class).
  - COE countdown + urgency badges suppressed on pending/closed
    cards so buyers aren't told to hurry on a deal that's already
    under contract or funded.
  - Map popup now renders a tiny inline `PENDING` chip next to the
    deal type when `dealStatus === 'assigned with emd'` so the
    status is visible from the map view too.
  - New "Recently Closed" section renders between the map and the
    testimonials block. Stat tiles for Deals Closed + Total Funded
    (the Total Funded card auto-hides when no `Amount Funded`
    values are populated in Notion, so partial data doesn't show
    `$0K`). Grid caps at 8 most recent closed deals; each reuses
    `makeCard()` for consistent styling.

- **`termsforsale/deal.html`** — `renderDeal()` gained:
  - Top-of-content status banner right under the photo grid.
    Orange pending banner ("Pending — EMD Received") or green
    closed banner ("Closed on <date>" when `dateFunded` is set).
    Active/Assignment Sent deals show no banner (silent — the deal
    just works).
  - Sidebar body swaps for `Closed` deals: replaces the Request
    Info / Submit Offer tabs with a centered "Deal Closed" card
    that says the property has funded and links to `/deals.html`.
    Consent/submit note also hidden.
  - Sidebar for `Assigned with EMD` deals: hides the "Submit
    Offer" tab entirely and expands Request Info to full width —
    buyers can still ask a question, but new offers aren't being
    taken. Header copy changes to "Under Contract / EMD".

- **`termsforsale/map.html`** — standalone map filters out
  `dealStatus === 'closed'` so the live map doesn't render
  markers for funded deals. Pending deals still show (same color /
  pin as active for now; could be dimmed later if needed).
  `dealStatus` is now carried through the map's internal deal model
  so future work can branch on it.

- **`termsforsale/index.html`** — homepage "X active deals" stat now
  excludes Closed from the count (the deals API returns them, but
  the homepage banner is only meant for available inventory).

- **`termsforsale/admin/deals.html`** — panel subtitle updated from
  "Live from Notion — filter for 'Actively Marketing'" to reflect
  the widened filter. Admins now see pipeline visibility across
  all four public statuses in one list.

### Deliberately NOT changed

- **`termsforsale/netlify/functions/notify-buyers.js`** — still
  queries Notion directly for `Deal Status = Actively Marketing` only.
  We don't want new-deal SMS/email blasts firing on pending or
  closed deals. Verified.
- **`termsforsale/netlify/functions/sitemap.js`** — now includes
  closed deals in the sitemap (intentional — closed listings are
  real historical pages that add social-proof signal for Google).
- **Existing `Under Contract` / `Sold` badge paths in `makeCard()`**
  — kept intact. Those were legacy GHL opportunity statuses
  (`dealStatus: 'under contract'`, `dealStatus: 'sold'`) not tied
  to Notion. They still work exactly as before.
- **`notify-buyers.js` dedup + tagging** — still uses `sent:[slug]`
  on per-buyer blast. No impact from the filter widening.

### Filter verification (local harness)

Simulated Notion filter behavior against 9 status values:

| Status | Result | Frontend bucket |
|---|---|---|
| Actively Marketing | SHOW | ALL_DEALS (active) |
| Assignment Sent | SHOW | ALL_DEALS (active) |
| Assigned with EMD | SHOW | ALL_DEALS (Pending badge) |
| Closed | SHOW | CLOSED_DEALS |
| Missing Information | HIDE | — |
| Ready to Market | HIDE | — |
| Not Accepted | HIDE | — |
| Lost | HIDE | — |
| (empty) | HIDE | — |

Div/script tag balance checked on all 4 modified HTML files after
edit — all balanced. `deals.js` loads cleanly as a Node module.

### Known caveats / follow-ups

- The Notion "Deal Status" property must include `Assignment Sent`,
  `Assigned with EMD`, and `Closed` as select/status options. These
  are already in the Notion schema (confirmed — `dispobuddy/deal-
  detail.js` references them as stages in the Dispo Buddy JV
  pipeline, and `paperclip-sop.html` documents the full lifecycle).
  If those options ever get renamed in Notion, the matching strings
  in `deals.js:PUBLIC_STATUSES` and the lowercase checks in
  `deals.html` / `deal.html` must be updated to match.
- Closed deals in the "Recently Closed" section are clickable —
  they go to `/deal.html?id=...` which now renders the green
  closed banner + "See Active Deals" sidebar CTA. Good for SEO and
  track record, but means a legacy buyer with the old URL still
  lands on a clean page instead of a 404.
- Map markers for Pending deals use the same color as Active; only
  a small chip in the popup indicates the status. Could be dimmed
  or given a distinct badge if Brooke wants more visual separation
  on the map later.
- The "Total Funded" stat card on the closed section requires
  `Amount Funded` to be populated on the Notion deal rows. If
  that field is left blank across all closed deals, the tile
  auto-hides (no $0K shown).

---

## Completed — April 14 2026 Solar Loan Details on Deal Terms Table

Branch: `claude/add-solar-property-details-atxRM`.

Brooke asked: for deals with solar, pull the existing "Solar" field
from Notion into the deal page's terms section as an **additional
loan** (alongside SubTo Existing Loan and Seller Finance Amount rows).
Previously the Solar field was being fetched by `deals.js` (line 266)
but never rendered on `deal.html` — buyers had no way to see that a
property carried a solar lien / lease until they got the PA.

### Files shipped

- **`termsforsale/deal.html`** — inside `renderDeal()`, after the
  Seller Finance termRows block and before the "Pad to even" line
  (new block around line 818-852). The block:
  - Reads `d.solar` (already populated by `deals.js` from the Notion
    "Solar" text property).
  - Skips display entirely when the field is empty or indicates no
    solar / paid off: matches `/^(no|none|n\/a|0|false)\b/i` on the
    start OR `/paid\s*off/i` anywhere in the string. A paid-off
    solar system has no loan to assume, so there's nothing to add.
  - For everything else, parses four pieces from the free-form text:
    - **Monthly payment** — matches `$X/mo`, `$X per month`,
      `X/month` patterns.
    - **Rate** — `X.XX%` pattern.
    - **Term** — `X yrs` / `X years` pattern.
    - **Balance** — first `$X,XXX` amount that isn't the monthly
      payment (the monthly payment is stripped from the string
      before this match runs so it can't be double-matched). Also
      handles `$18k` shorthand (multiplies by 1000 when the `k`
      suffix is present).
  - Detects lease vs. financed from keywords (`leas(e|ed|ing)` →
    "Lease", `financ(e|ed|ing)|lien|loan` → "Loan") so row labels
    read `Solar Lease Payment` vs `Solar Loan Balance` — matches
    the existing Notion convention of describing solar as either
    a lease or a lien.
  - If nothing structured parses out, falls back to a single
    `Solar: <raw text>` row so buyers still see whatever's on file
    (e.g. "Yes — leased" with no dollar amount yet).

### Parsing verified locally

Exercised 16 realistic Notion values against the parser:

| Input | Rendered rows |
|---|---|
| `""` / `"No"` / `"None"` / `"N/A"` / `"Paid off"` / `"Yes — paid off"` | (skipped — no loan shown) |
| `"Yes"` | `Solar: Yes` |
| `"Yes — leased"` | `Solar Lease: Yes — leased` |
| `"Yes — leased $120/mo"` | `Solar Lease Payment: $120/mo` |
| `"Yes — financed (lien)"` | `Solar Loan: Yes — financed (lien)` |
| `"$15,000 @ 4.99% for 20 yrs, $85/mo"` | Balance $15,000 / Payment $85/mo / Rate 4.99% / Term 20 yrs |
| `"Financed: $22,450 balance, $150/mo, 4.5%, 15 yrs"` | Solar Loan Balance $22,450 / Payment $150/mo / Rate 4.5% / Term 15 yrs |
| `"Solar lien $18k remaining, $95/month"` | Solar Loan Balance $18,000 / Payment $95/mo |

### Deliberately NOT changed

- **`deals.js`** — already pulls `Solar` text correctly (line 266),
  no backend changes needed.
- **Notion schema** — no new properties. We're using the existing
  "Solar" text field.
- **Deal card / marketplace views** — solar details remain in the
  per-deal "Terms" tab only. Not surfaced on the deal list or map
  popup — the existing per-card tag strip already shows HOA but
  adding solar to the tag strip would crowd the card. Could be
  added later if the team wants a "solar lien" pill.
- **Outbound alerts (notify-buyers.js, email templates, SMS)** — not
  touched. The solar text lives on the deal page; no
  marketing-copy changes needed since alerts point buyers to the
  deal page for details.

### Follow-up tightening (same day)

After Brooke saw a live deal where Solar Balance + Solar Rate were
sandwiched between SubTo's `Loan Maturity` and pad-cell rows in the
same grid (visually blending into the existing-loan section), made
two adjustments to the same branch:

- **Visual separation** — solar no longer pushes into `termRows`.
  Instead it builds its own `solarRows` array and renders as a
  separate `.terms-grid` block below the main terms table, with a
  small uppercase heading row (e.g. "SOLAR LIEN" / "SOLAR LEASE")
  and a sun icon. The main loan grid stays clean and the solar
  block is unmistakably its own section. Heading text uses
  `solarKind` ("Lien" for financed/loan/lien text, "Lease" for
  leased text, plain "Solar" otherwise — note: changed "Loan" to
  "Lien" since solar liens are the more common buyer concern).
- **Maturity + monthly payment parsing** — added two new field
  parsers so any solar field that already has those values shows
  them on the deal page:
  - **Maturity date** — matches `MM/DD/YYYY`, `MM-DD-YYYY`,
    `MM/YYYY`, `MM-YYYY`. Also matches keyword-prefixed forms
    `matures? <date>`, `maturity <date>`, `until <date>`,
    `thru <date>`, `through <date>`. Same date format as the
    existing SubTo `Loan Maturity` row so the two lines look
    consistent on the page.
  - **Payment fallback** — added `payment $X` / `pmt $X` /
    `monthly $X` keyword-prefixed match in addition to the
    existing `$X/mo` / `$X per month` / `$X/month` patterns. So
    a Notion value like `"$47,161.88 at 3.49%, payment $215,
    matures 4-2042"` now renders all four fields correctly.

### Known caveats

- Parser is regex-based on free-form text. If Brooke's operators
  enter unusual formats (e.g. `"$15k, twenty years"` — word-form
  numbers), the parser may miss fields. The fallback "show raw
  text" branch ensures buyers always see *something*, so the
  degraded case is still visible-not-hidden.
- The regex for "paid off" is intentionally loose — matches anywhere
  in the string, not just the start. A value like `"Solar loan, not
  paid off yet"` would incorrectly skip display. Unlikely in
  practice but worth noting. If this becomes a real case, tighten to
  word-boundary matching like `\bpaid\s*off\b` excluding the "not
  paid off" negation (regex gets hairy; easier fix is to let
  operators use "Paid in full" or "Owned outright" for the skip
  path).
- Balance detection picks the *first* $ amount after stripping the
  monthly payment. If Notion says `"$50,000 ARV, $15k solar lien,
  $120/mo"`, we'd match $50,000 as the solar balance (wrong). The
  Solar field should only describe the solar itself — if operators
  start mixing deal figures into it, we'd need a stricter "balance"
  keyword lookup instead.
---

## Completed — April 14 2026 Campaign Sender Identity + Opt-In Gate

Branch: `claude/campaign-sender-requirements-pd0jc`.

Locked down two compliance requirements that span every outbound SMS/email path:

1. **All outbound must originate from company channels** — no more `Brooke Froehlich <brooke@mydealpros.com>` and no more carrier default phone. SMS now goes out from `+1 480-637-3117`; email from `Terms For Sale <info@termsforsale.com>`.
2. **Buyer campaigns require an explicit `opt in` tag** — no opt-in tag on the contact, no campaign send. Hard gate, case-insensitive match.

### Files shipped

- **`termsforsale/netlify/functions/_ghl.js`**
  - New constants: `CAMPAIGN_FROM_PHONE` (`+14806373117`), `CAMPAIGN_FROM_EMAIL` (`Terms For Sale <info@termsforsale.com>`), `OPT_IN_TAG` (`opt in`). All overridable via env vars (`CAMPAIGN_FROM_PHONE`, `CAMPAIGN_FROM_EMAIL`) for emergencies.
  - New helper: `hasOptInTag(contactOrTags)` — accepts a contact object or raw tags array, returns true only if any tag (lower-cased, trimmed) equals `opt in`. Verified against 6 cases (`opt in`, `OPT IN`, `  Opt In  `, `buyer`, `{tags:['opt in','x']}`, `null`).
  - `sendSMS()` now sets `fromNumber: CAMPAIGN_FROM_PHONE` on every send.
  - `sendEmail()` now sets `emailFrom: CAMPAIGN_FROM_EMAIL` (was `Brooke Froehlich <brooke@mydealpros.com>`).
  - Commercial-lane `sendSmsToBrooke()` and `sendEmailToContact()` also set `fromNumber` / `emailFrom` so internal alerts to Brooke still come from the company line.
  - All four constants/helpers exported.

- **`termsforsale/netlify/functions/notify-buyers.js`**
  - `fetchAllBuyers()` adds an opt-in tag filter alongside the existing `Contact Role = Buyer` and `alerts-paused` filters. No opt-in → buyer is invisible to the matcher.
  - SMS POST now includes `fromNumber: '+14806373117'`.
  - Email POST `emailFrom` switched from `Brooke Froehlich <brooke@mydealpros.com>` to `Terms For Sale <info@termsforsale.com>`.

- **`termsforsale/netlify/functions/deal-follow-up.js`**
  - Top of the per-contact loop: if no `opt in` tag, skip + bump `stats.skipped`. Applies before any of the D0/D1/D2 send paths.
  - All 3 SMS POSTs (D0/D1/D2) include `fromNumber: '+14806373117'`.
  - Both email POSTs (D0/D2) switched to `Terms For Sale <info@termsforsale.com>`. Sign-off changed from `— Brooke, Terms For Sale` to `— Terms For Sale` so the body matches the from address.

- **`termsforsale/netlify/functions/follow-up-nudge.js`**
  - Computes `hasOptIn` from the lowercased tag list at the top of the contact loop.
  - Stale-tagging (Path A, data-only) still runs regardless — that's not a send.
  - Path B (the actual SMS nudge) gates on `hasOptIn` right after the no-phone check. SMS itself flows through `_ghl.sendSMS()`, which now bakes in `fromNumber` automatically.

- **`termsforsale/netlify/functions/auth-signup.js`** — welcome email `emailFrom` switched to `Terms For Sale <info@termsforsale.com>`.

- **`termsforsale/netlify/functions/auth-reset.js`** — password reset email `emailFrom` switched to `Terms For Sale <info@termsforsale.com>`.

- **`termsforsale/netlify/functions/_lindy.js`** — tool description for `send_email` updated so the LLM knows the from address. (CEO contact reference further down the system prompt left alone — that's metadata about who Brooke IS, not a sender identity.)

- **`CLAUDE.md`** — added two new MANDATORY rule sections at the top: "Campaign Sender Identity (REQUIRED)" and "Buyer Opt-In Requirement (REQUIRED for ALL campaigns)". Both flagged as policy gates that any future campaign function MUST honor.

### Verified locally

- `_ghl.js` exports all 4 new symbols; `hasOptInTag()` correctly handles case/whitespace/null.
- All 6 modified function modules + `_lindy.js` load cleanly via `require()` (no syntax errors, no missing imports).
- Simulated buyer filter: opt-in present → keep; missing → skip; case-variants → match; `alerts-paused` still hard-rejects even with opt-in; non-buyers still skipped.

### Operational follow-up needed in GHL

- Existing buyer contacts do NOT have the `opt in` tag yet. Once this branch ships, **every existing buyer is silenced** until the tag is added. To rectify:
  - Decide which signup paths auto-apply `opt in` going forward (recommend: `auth-signup`, `vip-buyer-submit`, `buy-box-save` — all currently apply `tfs-buyer` / `buyer-signup`; should also apply `opt in` if the user checked an explicit consent box during signup).
  - Run a one-time backfill to apply `opt in` to existing buyers who have a documented consent record (e.g. signed up via the website with the consent checkbox). Don't blanket-apply — that defeats the point of the gate.
- Add the explicit consent checkbox to all signup forms if it isn't already there ("I agree to receive SMS and email about deals matching my buy box. Reply STOP to opt out."). Without that, applying `opt in` is not legally defensible.

### Same-session follow-up — auto-tag signups + backfill (April 14 2026)

Per Brooke: every Terms For Sale website signup IS the consent action, so all three signup paths now auto-apply the `opt in` tag and a one-shot backfill applies it retroactively to every existing TFS website-signup buyer.

**Files updated:**

- **`termsforsale/netlify/functions/auth-signup.js`** — both the contact-create tag list (line 90) and the downstream webhook tag list (line 148) now include `'opt in'`.
- **`termsforsale/netlify/functions/vip-buyer-submit.js`** — both the upsert tag list (line 41) and the explicit `addTags()` follow-up (line 59) now include `'opt in'`.
- **`termsforsale/netlify/functions/buy-box-save.js`** — both the upsert default tag list (line 73) and the `addTags()` reapplication (line 134) now include `'opt in'`.
- **`scripts/backfill-buyer-opt-in.js`** (new) — paginates GHL by each of the website-signup tags (`buyer-signup`, `tfs buyer`, `TFS Buyer`, `Website Signup`, `VIP Buyer List`, `buy box complete`, `use:buyer`), dedups by contact id, and POSTs `tags: ['opt in']` to `/contacts/{id}/tags` on every contact missing the case-insensitive opt-in tag. Skips contacts already opted in. Supports `DRY_RUN=1` and `MAX_CONTACTS=N`. Modeled after `backfill-contact-role.js`.

**Deliberately NOT auto-tagged:**
- `buyer-import.js` — imports buyers from external sources (InvestorLift, InvestorBase). Those contacts have no consent record with us; the tag is left off so they stay silenced until manually opted in per source.
- `commercial-buyer-submit.js` — commercial-lane buyers (the `Commercial / Multifamily` pipeline). Different lane entirely; opt-in is enforced on the residential buyer-alert pipeline only.

**Run the backfill on the Droplet:**

```
cd /root/termsforsale-site
git pull origin claude/campaign-sender-requirements-pd0jc
DRY_RUN=1 node scripts/backfill-buyer-opt-in.js    # preview
node scripts/backfill-buyer-opt-in.js              # apply
```

The backfill is idempotent — re-running it skips anyone already tagged.

### Env vars (no NEW ones required)

- Optional overrides if needed: `CAMPAIGN_FROM_PHONE`, `CAMPAIGN_FROM_EMAIL`. Defaults are baked in.

### Known caveats

- Transactional welcomes / password resets are also affected by the `emailFrom` change (same company inbox), but they intentionally do NOT require `opt in` since they're user-initiated. If we later want to require opt-in even for welcome emails, the gate has to move into `auth-signup` explicitly.
- The opt-in gate filters at the buyer-fetch layer in `notify-buyers`, so deals will simply have fewer matched buyers in the per-deal stats once shipped. Not a regression — the dropped contacts were never legally messageable in the first place.

---

## Completed — April 14 2026 Dispo Buddy Landing Page Single-Page Rebuild

Branch: `claude/improve-logo-favicon-Av2Gm`.

Rebuilt `dispobuddy/index.html` from a stub file into a complete single-page application replacing the previous multi-page structure. The page now consolidates all core messaging, value props, qualifications, and CTAs in a single, scrollable experience with anchor-based navigation and mobile-responsive design.

### Files shipped

- **`dispobuddy/index.html`** (comprehensive single-page rebuild, ~600+ lines)
  - **Navbar** — sticky header with logo, anchor navigation links (How It Works, Fit, Buyers Map, Proof, FAQ), hamburger menu toggle for mobile (<768px), and prominent "Submit a Deal" orange CTA button. Navbar adds `scrolled` class at scroll>50px for visual feedback. Mobile menu auto-closes on link click or Escape key.
  - **Hero Section** — large headline "You lock it up. We sell it.", supporting tagline, dual CTAs (Submit a Deal + Learn More), and 3-stat badge row (47 AZ cities, 320+ deals, $47M+ closed).
  - **Risk-Reversal Benefits Strip** — navy background section with 4 key promises: "No Upfront Fees", "24-48 Hour Review", "Non-Exclusive", "Performance-Based Splits" to immediately address partner concerns.
  - **Mini FAQ** — 3-question quick-answer section (Do I have to be local? → No / Is there a minimum deal size? → No / What happens after I submit? → Immediate triage) with toggle cards on click.
  - **Fit Checklist** — "Is Your Deal a Fit?" section with 6-item qualification criteria (Off-market deal, Clear title, Motivated seller, 30%+ ARV spread, Deal meets market criteria, We can close fast).
  - **How It Works** — 6-step process timeline with numbered steps: Submit Deal → Initial Triage → Market Analysis → Buyer Matching → Cash Offer → Fast Closing. Each step includes a brief description.
  - **Deal Types Grid** — 8 badge tiles showcasing accepted deal types: Cash, SubTo, Seller Finance, Wrap, Hybrid, Commercial, Lease Options, Multi-Unit — helps partners quickly assess fit.
  - **Active Buyers Map** — embedded iframe to `/buyers-map.html` showing real-time buyer demand by metro with CTA "See Our Buyer Network" pointing to map section.
  - **Proof Section** — social proof with testimonial quote ("They genuinely care..."), 4-stat grid (47 days average close, 4.9★ rating from 180+ partners, $47M+ closed, 320+ deals).
  - **Features Section** — 5 card grid highlighting "not your average dispo partner" differentiators: Direct to Buyers, No Retail, Transparent Pricing, Speed, Relationships. Each card has icon emoji + description.
  - **Main CTA Section** — large orange-background banner with "Ready to submit your first deal?" headline, supporting copy, and centered "Submit a Deal" button → `/submit-deal.html`.
  - **FAQ Accordion** — 7 expandable questions covering: deal submission timeline, funding sources, closing costs, payment timing, portfolio requirements, what happens after close, and referral program. Vanilla JS toggle without external dependencies.
  - **Footer** — logo, brief description, grouped navigation links (Product, Company, Legal), and contact info (Brooke's email). All internal links use anchor scrolling (#sections), external CTAs point to `/submit-deal.html`.

### Technical implementation

- **CSS custom properties (variables)** — navy `#0D1F3C`, orange `#F7941D`, blue `#29ABE2`, green `#22c55e` for consistent theming. `@media (max-width: 768px)` breakpoint for responsive mobile adjustments.
- **Responsive grid layouts** — `display: grid` with `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))` for flexible wrapping on smaller screens.
- **Anchor-based navigation** — all internal navigation uses `#section-id` links. Page state persists in URL so back button works intuitively.
- **Mobile hamburger menu** — offscreen `.mobile-menu` (fixed position, 100vw width) slides in/out with `transform: translateX()` on toggle. Backdrop click + Escape key close it.
- **Vanilla JavaScript interactivity** — no frameworks or libraries. Includes: navbar scroll listener, hamburger menu toggle + close-on-link logic, accordion toggle function, mobile menu close on Escape. All handlers use simple `addEventListener` patterns.
- **Scroll behavior** — `html { scroll-behavior: smooth }` for anchor links. Smooth transitions on hover effects (`transition: all 0.3s ease`).
- **SVG / emoji icons** — minimal use of image assets; section badges use Unicode emojis (✓, 🗺️, ⭐) for fast load time.

### Sections and CTAs wired

| Section | Anchor | Primary CTA |
|---|---|---|
| Hero | (top) | "Submit a Deal" → `/submit-deal.html` |
| Risk-Reversal | (auto-scroll on page load) | Implicit value prop → anchors to Proof section |
| Mini FAQ | #fit | "Learn more" links internal → no external CTAs |
| Fit Checklist | #fit | Implicit qualifying tool → flows to How It Works |
| How It Works | #how-it-works | Final step CTA → "Submit a Deal" → `/submit-deal.html` |
| Deal Types | (auto-scroll sequence) | Visual reference only → supporting context |
| Buyers Map | #buyers | "See Our Buyer Network" → embedded `/buyers-map.html` iframe |
| Proof | #proof | Testimonial + stats → implicit social proof → CTA section below |
| Features | (auto-scroll between proof + CTA) | Feature descriptions → build toward final CTA |
| Main CTA | #submit | "Submit a Deal" (prominent button) → `/submit-deal.html` |
| FAQ | #faq | Questions + answers → call Brooke if more needed (email in footer) |
| Footer | (bottom) | Contact email, product/company/legal links |

### Mobile responsiveness

- Navbar: hamburger icon replaces nav links on <768px, menu overlays full viewport with blue background
- Hero: font sizes scale down, stat badges stack vertically on very small screens
- Sections: cards wrap to single column on mobile, padding reduces for narrow viewports
- Map iframe: responsive container uses `padding-bottom: 66.67%` for 3:2 aspect ratio
- Accordion: full width, readable font sizes maintained
- CTA buttons: full-width on mobile, side-by-side on desktop (media query @ 768px)

### Backwards compatibility

- No breaking changes — all internal and external links are new or redirect appropriately
- `/submit-deal.html` remains the authoritative submission form (unchanged)
- Existing `dispobuddy/netlify/` functions unchanged
- `netlify.toml` redirects unchanged

### Known follow-ups

- "Contact" form on footer points to Brooke's email (no custom form handler yet) — consider adding `/api/partner-contact` function if inbound volume warrants
- Deal types badges are 8 hardcoded strings — consider pulling from a Notion "Deal Types" reference DB if the list grows
- Buyers map iframe is embedded statically — consider adding a "dynamic buyer count" stat that refreshes via `/api/buyer-stats` if feasible

### Verification after Netlify auto-deploy

1. Open `https://dispobuddy.netlify.app/` (or `dispobuddy.com` after DNS pointing) → page loads with hero visible, navbar at top
2. Click navbar links → smooth anchor scroll to each section (How It Works → #how-it-works, Fit → #fit, etc.)
3. Resize to <768px → hamburger menu appears, nav links hidden, mobile menu toggles
4. Click "Submit a Deal" buttons throughout page → all route to `/submit-deal.html`
5. Scroll to footer → email link present, legal links work
6. Mobile menu: click a link → menu auto-closes, page scrolls to that section
7. Mobile menu: press Escape → menu closes, page state preserved

---

## Completed — April 11 2026 Blog Page Restructure (Hub, not Marketplace)

Branch: `claude/fix-admin-blog-posts-B4qy3`.

Brooke pasted in a content/UX audit: the `/blog/` page was really just
the homepage with a slim blog hero glued on top. Above-the-fold was
deal hero + signup modal + active deals — the actual blog content was
visually buried, post cards had no excerpt visible, there was no
article search, no JV-partner cross-sell, no in-article CTAs leading
back to the buy box or dispo flows. She wanted the blog to act like a
true content hub that ladders into offers, per the $100M Leads /
$100M Hooks framework.

### Files shipped

- **`termsforsale/blog/index.html`** (1353 → 1536 lines)
  - **Meta:** new `<title>` `Creative Finance Real Estate Blog |
    Subject-To & Seller Finance Guides`. New canonical
    `https://termsforsale.com/blog/` (was pointing at the apex root —
    a copy-paste leftover from when the blog page was forked off
    `index.html`). Description, og:title/description/url, twitter
    fields all rewritten for the blog hub. Full social/SEO refresh.
  - **Single H1 enforced:** the previous file had two `<h1>`s — the
    visible blog hero + a hidden one inside `section.hero` (which is
    `display:none` but still indexed by Google). Hidden one was
    demoted to `<div class="hero-h1">` so the page now has exactly
    one H1 (the new hero title). Verified by static count.
  - **New hero `<header class="blog-hero">`** with H1 `Creative
    Finance Investor Guides & Deal Breakdowns`, the requested
    subhead, a `<input id="blog-search" type="search">` Search
    Articles input, and a 3-card "Start Here" strip linking to:
    1. `what-is-subject-to-real-estate.html` — "New to Creative
       Finance? Start with the Basics"
    2. `how-to-analyze-creative-finance-deal.html` — "How Investors
       Actually Buy Subject-To & Seller Finance"
    3. `what-is-off-market-real-estate.html` — "How We Dispo Creative
       Deals for Wholesalers 50/50"
  - **JV partner CTA `<section class="jv-cta">`** placed
    immediately under the hero, above the article listing. Headline
    `Wholesaler With a Locked-Up Deal You Can't Move?`, body, and
    `Submit a Deal for Review` button → opens
    `https://dispobuddy.com/submit-deal.html` in a new tab.
  - **Article listing `<section class="blog-section">`** —
    rewritten cards: `<h3 class="blog-card-title">` (was a div),
    `Education` / `Deal Spotlight` pill instead of category text,
    1-2 sentence excerpt via a new `shortExcerpt()` helper that
    splits on sentence boundaries and caps at 180 chars. Tabs
    (All / Education / Deal Spotlights) preserved.
  - **Inline CTA banner** auto-injected into the rendered grid as
    item #4 (i.e. after the first 3 cards). Headline `Get First
    Access to Creative Finance Deals Before They Hit Groups`, body,
    `Share My Buy Box` button → `/buying-criteria.html`. Re-injected
    on every filter/search re-render via `INLINE_CTA_HTML` const +
    `cards.splice(insertAt, 0, INLINE_CTA_HTML)`.
  - **Search filter:** debounced 120 ms; matches against
    title/hook/description/category/dealType/city/state. Empty
    state shows the queried string back to the user.
  - **Deal-marketplace cross-sell** (How It Works / Map /
    Testimonials / VIP form / Footer) all preserved verbatim and
    moved below a new `.below-blog-divider` strip labeled
    `Ready to See Live Deals? — Browse the Marketplace ↓`. The
    homepage-clone hero, streamlined section, and explore section
    are still `display:none` (left untouched).
  - **`<noscript>`** fallback inside the empty grid links to the
    three cornerstone posts directly so Google still sees them
    in raw HTML.
  - **Preserved unchanged:** `#main-nav` shell, the auth modal
    (`#auth-overlay` + all 26 form IDs), GA4 (`G-DRV6NWNY06`),
    GHL signup + login webhook constants, `openAuth/closeAuth/
    switchAuthTab/doLogin/doSignup/submitVIP/setHWTab/syncSearch/
    scrollToDeals` JS entry points, the entire `<footer>`. Verified
    via a static check that loops over every required ID + function
    name and confirms presence — 26/26 IDs, 9/9 functions still
    present after the rewrite.

- **`termsforsale/blog/posts/*.html`** (9 files)
  - One Node script (`/tmp/inject-blog-ctas.js`, run twice to
    confirm idempotency, then deleted) injected:
    - `<!-- tfs-blog-cta-top -->` block right after `<div
      class="post-wrap">` (5 hand-written education posts) or
      `<div class="article-body">` (3 generated deal-spotlight
      posts + the deal post template). Currently all 9 are buyer-
      facing so they all got the buyer variant. Script supports a
      JV variant for any future post that has `data-post-audience=
      "jv"` on body or has `jv|wholesaler|dispo-buddy` in its
      filename.
    - `<!-- tfs-blog-cta-bottom -->` two-column footer block right
      before `<div class="disclaimer">` in all 9 posts. Left
      column = navy VIP buyer card linking to
      `/buying-criteria.html`. Right column = orange JV submission
      card linking to `https://dispobuddy.com/submit-deal.html`.
      Uses flexbox + `flex:1 1 280px` so it wraps to a single
      column on narrow screens without needing a media query.
  - Marker comments make re-runs no-op — verified by running the
    script twice; second pass reports `0 injected, 9 already done`.
  - Per-post sanity check: every post still has exactly 1 H1, all
    div tags balanced, all anchor tags balanced.

- **`termsforsale/netlify/functions/create-post.js`** — generator
  template now bakes the same top + bottom CTAs into newly-created
  deal-spotlight posts so future posts ship with them by default.
  Top CTA after `<div class="article-body">`, bottom CTA after the
  existing `.callout-orange` and before `<div class="disclaimer">`.
  Marker comments included for future idempotency. Module load test
  + simulated handler call (with `ADMIN_PASSWORD` set, no
  `GITHUB_TOKEN`) confirms the template renders without throwing —
  expected 500 `Server not configured` from the GitHub PUT call,
  meaning auth + template build succeeded.

- **`termsforsale/netlify/functions/auto-blog.js`** — also gained
  the bottom 2-column CTA in its minimal template. Auto-blog posts
  don't have a `.disclaimer` block to anchor on, so the CTA is
  inserted right after the existing `View Full Deal Details →`
  button and before the small footer line. h3 instead of h2 for
  consistency with the manual post CTAs.

### Component map (where each new piece lives in the file)

| Component | File / Section |
|---|---|
| `BlogHero` (hero + search + Start Here strip) | `blog/index.html` `<header class="blog-hero">` |
| `JvCtaCard` | `blog/index.html` `<section class="jv-cta">` |
| `BlogPostsGrid` (with inline CTA injection) | `blog/index.html` `<section class="blog-section">` + render JS in last `<script>` block |
| `InlineCtaBanner` (mid-grid) | JS const `INLINE_CTA_HTML` in last `<script>` block |
| `PostTopCta` (text band, conditional buyer/JV) | per-post `tfs-cta-top` div, also baked into `create-post.js` template |
| `PostFooterCtas` (2-column VIP + JV) | per-post `tfs-cta-bot` flex container, also in `create-post.js` + `auto-blog.js` templates |

### Routes / forms wired to (no new endpoints required)

- VIP buy-box CTA → `/buying-criteria.html` (existing form, also the
  post-signup landing page per the auth flow)
- JV submission CTA → `https://dispobuddy.com/submit-deal.html`
  (existing JV partner site, separate Netlify deploy)
- Cornerstone Start Here cards → 3 existing slugs in
  `/blog/posts/`

### Deliberately NOT touched

- `termsforsale/index.html` — unchanged. The /blog page was the
  scope.
- `termsforsale/dashboard.html`, `termsforsale/deal.html`, the deal
  detail rendering — unchanged.
- The deal-spotlight sidebar `.cta-card` form on the 3 generated
  posts — kept as-is. The new bottom 2-column CTA is additive, not
  a replacement, since the sidebar is buyer-acquisition and the
  new bottom block adds JV cross-sell that wasn't there before.
- The hidden `section.hero` block at the top of `blog/index.html`
  (`display:none`) — kept on disk for shared CSS reasons but its
  inner H1 was demoted to a div. Could be deleted entirely later
  to slim the file.

### Known follow-ups

- Education-vs-JV conditional on post top CTA is wired in the
  injection script and the create-post.js template, but every
  current post gets the buyer variant because all 8 published posts
  are buyer-facing. To opt a future post into the JV variant, set
  `<body data-post-audience="jv">` or include `jv` /
  `wholesaler` / `dispo-buddy` in the filename.
- The "Start Here" cards' read-time labels are placeholder estimates
  (`~6 min read`, `~7 min read`, `~5 min read`). If the team wants
  real read-time numbers, we could compute word count from each
  post's HTML at build time and patch `posts-index.json` to include
  a `readingMinutes` field.
- The inline CTA banner is currently inserted at index 3
  (after 3 cards). If posts grow much past 9, we might want a
  second inline CTA further down the grid. Trivial to add — just
  splice another item into the `cards` array in `renderBlog()`.

### Follow-up tightening (same day)

Brooke followed up with a tightened section-order spec. Made these
adjustments to the same branch in a second commit:

- **JV CTA card moved BELOW the blog list** (was directly under the
  hero in the first pass). Now the order is: blog hero → blog post
  grid (with inline VIP banner spliced after card #3) → JV CTA card
  → "Explore Live Off-Market Deals" H2 → existing marketplace
  sections.
- **New `<section class="explore-live-deals">` with `<h2>Explore
  Live Off-Market Deals</h2>`** replaces the previous slim
  `.below-blog-divider` strip. Eyebrow + subhead + centered layout
  inside a 1100px container, sitting on top of the existing How It
  Works / Map / Testimonials / VIP form blocks so the marketplace
  has a proper section header.
- **JV CTA heading is `<h2>` (not `<h3>`)** so the heading rank
  flows cleanly: H1 (hero) → H2 (Blog & Investor Guides) → H2 (JV
  CTA) → H2 (Explore Live Off-Market Deals) with no inversion.
- **Blog section H2 changed back to `Blog & Investor Guides`** (was
  "All Articles") to preserve the existing supporting-text copy as
  the spec requested.
- **Stripped `Loading…` text from the decorative mini-cards and
  big-card** in the visible "How It Works" section. Those cards
  were leftover deal placeholders from when the page was a homepage
  clone — they used to get populated by the deals fetch, but the
  blog page skips that fetch, so they were stuck on `Loading…`
  forever. Now they're empty colored visual placeholders with
  `aria-hidden="true"`. The hidden `section.explore` (still
  `display:none`) keeps its `Loading deals…` spinner because it
  never renders.
- **Single-H1 still enforced.** Verified post-reorg: 1 h1 ("Creative
  Finance Investor Guides & Deal Breakdowns"), 8 h2s in the
  document (4 visible: Blog & Investor Guides / Wholesaler... / 
  Explore Live Off-Market Deals / How Does This Work / See Deals
  Near You / Get First-Access; rest hidden inside `display:none`
  sections or auth modal).
- All div/section/script/a tags balanced; both inline scripts still
  parse; all 14 required form IDs still present.

---

## Completed — April 10 2026 Admin Blog Page Rebuild (replaces broken Decap)

Branch: `claude/fix-admin-blog-posts-B4qy3`.

Brooke reported that the "Blog & Posts" section in the admin portal
didn't work — clicking any action from `/admin/blog.html` sent the user
to `/admin/cms.html` (Decap CMS), which hangs because it requires
Netlify Identity + git-gateway, neither of which are configured on this
site. The old blog.html was a stub — 3 cards, all of them linked to
Decap. There was no actual post-creation UI in the admin console.

Meanwhile, `termsforsale/netlify/functions/create-post.js` already
shipped a fully-working "create blog post via GitHub API" endpoint, and
`termsforsale/va-post-builder.html` was a working 4-step form that used
it — but gated behind a separate `VA_PASSWORD` env var, outside the
admin shell, and nobody on the team was actually using it.

### Files shipped

- **`termsforsale/admin/blog.html`** (complete rewrite, 119 → ~470
  lines) — full admin-shelled blog management page:
  - 4 stat tiles pulled from `/blog/posts-index.json`: Total Posts,
    Deal Spotlights, Education, Last Published (with the most recent
    post title as sub-text).
  - "New Post" button in the topbar toggles an inline create-post form
    panel (same panel → same page, no Decap, no modals). Single-scroll
    form (not multi-step) with 6 logical sections: Deal Info, Headline
    & Copy, Deal Numbers, SubTo/Hybrid Fields, Seller Finance Fields,
    Write-Up. All 12 required-field validations ported from
    `va-post-builder.html` + the 155-char SEO meta description guard.
  - Published Posts panel below: search box (title/city/state/dealType
    substring), type filter (all / deal only / education only), and a
    table with title + hook preview, type pill (blue Deal / purple
    Education), location, deal type, status pill, date, and View
    button that opens the live post in a new tab. Table re-renders
    client-side on every search/filter change.
  - On publish: calls `AdminShell.fetch('/api/create-post', …)` which
    auto-attaches the `X-Admin-Password` header. Also passes
    `adminPassword` in the body for belt-and-suspenders (different
    wire paths in case one env strips headers). Shows success/error
    banner, clears the form fields, and reloads the posts list after
    4 s so the new post shows up in the table.
  - Posts index fetched with `?t=` cache-bust so freshly-published
    posts show up immediately on refresh.
  - Zero references to Decap CMS, `cms.html`, git-gateway, or Netlify
    Identity anywhere on the page.

- **`termsforsale/netlify/functions/create-post.js`** — now accepts
  either `VA_PASSWORD` (legacy: `body.password`) or `ADMIN_PASSWORD`
  (new: `X-Admin-Password` header OR `body.adminPassword`). Auth logic
  is fail-closed: if an env var is unset, that path is simply unusable
  — you can't authenticate against an empty string. Legacy
  `va-post-builder.html` still works unchanged (it sends
  `body.password` and expects the old 200 `{success:true,authOnly:true}`
  response for its login screen — verified via local module load
  test).

- **`termsforsale/admin/index.html`** — dashboard "Blog & Content"
  quick-card updated: title is now "Blog & Posts", description changed
  from "Create deal spotlight posts and education articles via Decap
  CMS" to "Publish deal spotlights and manage the blog — commits
  straight to GitHub." Link target is unchanged (`/admin/blog.html`).

### Deliberately NOT touched

- **`termsforsale/admin/cms.html`** — left in place (loads Decap from
  unpkg, shows a broken-auth error page). Nothing in the admin shell
  or dashboard links to it anymore, but keeping the file on disk
  avoids a hard 404 if anyone has it bookmarked. Can be removed later
  if the team decides Decap is fully dead.
- **`termsforsale/admin/config.yml`** — Decap collection schema.
  Unreferenced now, left on disk for future reference in case we want
  to bring a different git-backed CMS online.
- **`termsforsale/va-post-builder.html`** — still functional via its
  own VA_PASSWORD gate. Admin users don't need it anymore but VAs who
  only have `VA_PASSWORD` can keep using it.
- **`termsforsale/netlify/functions/auto-blog.js`** — unchanged. That
  function auto-generates deal-spotlight blog posts when
  `notify-buyers` processes a new deal; it uses the GitHub API
  directly (not `create-post.js`) and has nothing to do with this
  fix.

### Auth math (verified locally)

Tested 5 cases against `create-post.js` with `VA_PASSWORD=va-test` +
`ADMIN_PASSWORD=admin-test`:

| Case | Auth result |
|---|---|
| Admin password via `X-Admin-Password` header | ✅ authorized |
| Admin password via `body.adminPassword` | ✅ authorized |
| VA password via `body.password` (legacy) | ✅ authorized |
| Wrong password in either slot | 401 |
| `authCheck: true` with valid VA password | 200 `{success:true,authOnly:true}` (legacy login screen intact) |

### Env vars (nothing new required)

- `ADMIN_PASSWORD` — already set; gates the admin console. Now also
  authorizes `create-post.js`.
- `VA_PASSWORD` — already set; still works for legacy
  `va-post-builder.html` flow.
- `GITHUB_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME` — already
  set; unchanged.

### Known caveats / follow-ups

- No "Edit existing post" flow yet. `create-post.js` does handle
  updates (it reads the existing file SHA from GitHub and PUTs with
  `sha` set), but the admin UI doesn't expose a Load button to
  pre-populate the form from an existing post's `posts-index.json`
  entry. Next enhancement: add an "Edit" button on each row that
  pulls the existing HTML via GitHub contents API, parses back the
  field values, and hydrates the form.
- No "Delete post" flow. Would require a new endpoint or a new action
  in `create-post.js` that takes `{ slug, delete: true }` and calls
  the GitHub DELETE API on the contents path, plus removes the entry
  from `posts-index.json`. Skipped for v1.
- Education-post creation not exposed (same fields as deal posts
  would be wrong). The form only handles Deal Spotlights because
  that's what `create-post.js` generates. Education posts currently
  come from Decap-era hand-written files in `blog/posts/*.html`. If
  the team wants to manage those from admin too, we'd need a new
  function + a second form mode.
- Posts list takes a beat (~5-10 s) to refresh after publish because
  GitHub's API lags the `posts-index.json` write. Soft mitigated by
  the 4 s delayed reload on success.

---

## Completed — April 10 2026 Holistic AI Buyer Matching + HOA Fix

Branch: `claude/improve-deal-search-zDHrj`.

Brooke noticed that matching was missing obvious fits because it only
looked at a handful of structured custom fields. Example: a buyer whose
buy_box free text said "no HOAs please" was still getting alerted on
HOA deals because the HOA rule only checked a checkbox field. She asked
for (a) HOA matching that factors in the structured HOA field AND the
hoa_tolerance field AND the buy_box large text, and (b) more AI logic
that reads the whole contact (custom fields + notes) to decide fit.

### Root cause found while fixing it

`parseDeal()` in `notify-buyers.js` never read the `HOA` column from
Notion — so `deal.hoa` was always `undefined` and the HOA hard filter
`if (parseHoaDeal(deal.hoa))` never actually ran. Every HOA deal was
silently being blasted to buyers who had said "no HOAs". Fixed.

### Files shipped

- **`termsforsale/netlify/functions/_ai-match.js` (new)** — shared
  helper that does two jobs:
  1. **`textRejectsHoa(text)`** — regex bank that detects "no HOA" /
     "no HOAs" / "avoid HOA" / "won't do HOA" / "hoa = no" / "skip
     hoa fees" etc. in free-form buyer text. 14 cases verified by a
     local harness (9 rejects + 5 false-positive negatives like
     "HOA ok under $100", "prefer HOAs").
  2. **`checkFit({ claudeKey, ghlKey, deal, contact, buyerProfile })`**
     — fetches the contact's last 5 notes from GHL (`GET
     /contacts/{id}/notes`), trims each to 400 chars, builds a compact
     deal + buyer + notes prompt, and asks Claude Haiku
     (`claude-haiku-4-5-20251001`) to return a JSON
     `{ fit: 'strong'|'fair'|'weak'|'reject', score, reasons[], redFlags[] }`.
     Haiku is ~25× cheaper than Sonnet; per-call cost tracked and
     logged. Network / auth / parse failures resolve to
     `{ fit: 'unknown', error }` so the caller can still ship the
     deterministic match without the AI layer.

- **`termsforsale/netlify/functions/_claude.js`** — added optional
  `model` param to `complete()` and cost-per-token logic that
  switches to Haiku rates (~$1/MTok input, $5/MTok output) when a
  Haiku model is passed. Default is still Sonnet 4 so existing
  callers are unaffected.

- **`termsforsale/netlify/functions/notify-buyers.js`** — 4 changes:
  1. `parseDeal()` now reads `hoa: prop(page, 'HOA')` — the HOA
     hard filter finally works.
  2. `buyerRejectsHoa(contact, extraText)` returns
     `{ reject, source }`. Checks (in order): hoa checkbox,
     hoa_tolerance text, buy_box free text via
     `aiMatch.textRejectsHoa()`, optional extra text (for future
     use). Call site in `matchesBuyBox()` uses the source string so
     the match failure reason is auditable.
  3. New `buildBuyerProfile(contact)` + `runAiFitPass()` functions.
     After the deterministic tiering, if `AI_MATCH_LIVE=true` env
     var is set AND `ANTHROPIC_API_KEY` exists, the AI pass runs on
     the deterministic shortlist (capped at `AI_MATCH_MAX_PER_DEAL`
     which defaults to 100) in batches of 5 concurrent Claude calls.
     The AI can: (a) drop a buyer outright if `fit=reject`,
     (b) upgrade tier by 1 if `fit=strong`, (c) downgrade by 1 if
     `fit=weak`, (d) no-op if `fit=fair`. AI reasons are merged into
     the buyer's `matchReasons` array prefixed with `AI:`.
  4. `triggerBuyerAlert()` now posts a GHL note on every alerted
     contact summarizing: deal code + address, deal type + price +
     tier, deterministic match reasons, AI fit/score + reasons +
     red flags (when AI pass ran), and the deal URL. This was
     missing entirely before — tags + custom fields were being
     updated but nothing was auditable from the contact view.
     Note write is wrapped in try/catch so a failure never blocks
     the SMS/email send.

### Env vars

- **`ANTHROPIC_API_KEY`** (or legacy `CLAUDE_API_KEY`) — required
  only if `AI_MATCH_LIVE=true`. Already set on the droplet + Netlify
  for other Claude functions.
- **`AI_MATCH_LIVE`** — set to `"true"` to turn on the AI fit pass.
  Default is off so there's zero cost surprise.
- **`AI_MATCH_MAX_PER_DEAL`** — optional int cap on how many buyers
  per deal get the AI check. Defaults to 100. At Haiku pricing
  (~$0.002/buyer), 100 buyers × 1 deal = ~$0.20/deal.

### Cost math (Haiku)

~1000 input tokens + ~200 output tokens per buyer → ~$0.002/buyer.
100 buyers × 1 deal = ~$0.20/deal. At 5 deals/week = ~$1/week or
**~$4/mo** on top of the existing ~$4/mo Claude budget. Still well
under the $10/mo total spend target.

### To enable (next session)

1. In Netlify dashboard → Environment variables → add
   `AI_MATCH_LIVE = true` (and confirm `ANTHROPIC_API_KEY` is set).
2. On the droplet, add it to `/etc/environment`:
   `echo 'AI_MATCH_LIVE=true' >> /etc/environment` then restart cron.
3. Run `/api/notify-test?deal_id=PHX-001` once and check Netlify
   function logs for `[notify-buyers] AI fit pass: shortlist=…` +
   the `[Claude] cost=$…` lines.
4. Spot-check the GHL contact notes on a few alerted buyers —
   every match should have a "📨 Deal alert sent" note with the
   match reasons + AI fit + red flags.

### Deterministic fixes are live regardless of flag

The HOA `parseDeal` bug and the widened `buyerRejectsHoa` (scanning
buy_box + structured fields) run on every notify-buyers invocation
— they do NOT require `AI_MATCH_LIVE=true`. Those alone should
already improve HOA matching accuracy significantly.

---

## Completed — April 10 2026 Admin Deals Inline Buyer Drawer

Branch: `claude/improve-deal-search-zDHrj`.

Brooke asked to make deal search easier — specifically, click an
actively marketed deal and auto-pull the list of buyers it was sent
to. The old flow required navigating from `/admin/deals.html` to
`/admin/deal-buyers.html?deal=<slug>` (full page reload, lost scroll
position, had to come back and click the next deal). Replaced with a
slide-in right-side drawer that opens on row click and renders the
buyer list inline.

### Files shipped

- **`termsforsale/admin/deals.html`** (+505 / -26)
  - New slide-in `.drawer` + `.drawer-backdrop` panel (width
    `min(720px, 94vw)`, right-anchored, CSS transform slide).
  - Rows in the deals table are now clickable (`cursor:pointer`,
    title hint "Click to see buyers sent this deal"). Clicking the
    "View" link or any inner `<a>`/`<button>` is excluded via a
    `data-stop` guard + tag walk so those actions still work.
  - New `fetchBuyersForSlug(slug)` shared fetch helper that both
    the initial batch load (`loadAllBuyerCounts`) and the drawer
    open flow share. Caches the full contact list in
    `BUYER_DETAILS[slug]` so opening an already-scanned deal is
    instant (no second network hit).
  - `openDrawer(deal)` hydrates the drawer head with
    `dealCode · City, State ZIP · dealType`, marks the active row
    with an `is-open` class, and either renders from cache or
    shows a spinner + fires `fetchBuyersForSlug()`.
  - `renderDrawerBody()` renders 5 stat tiles (Sent / Hot /
    Interested / No reply / Passed), an in-drawer search box
    (name/phone/email), a status filter `<select>` (including a
    synthetic `__none__` option for contacts with no response tag),
    and a compact contact table with status pills + phone/email
    `tel:`/`mailto:` links + tier column.
  - Drawer footer has a "Full page" link to the existing
    `/admin/deal-buyer-list.html?deal=<slug>` view (for CSV export
    and the richer tier breakdown) plus a Refresh button that
    evicts the cache and re-fetches.
  - Close via the X button, backdrop click, or Escape key. Body
    scroll is locked while the drawer is open.

### Backend — no changes

Existing `/api/deal-buyer-list?deal=<slug>` endpoint already returns
everything the drawer needs (contacts, dealStatus, tier, phone,
email, acqTags, mktTags). Standalone `/admin/deal-buyers.html` still
works unchanged — it's linked from the drawer footer for power-user
workflows.

### Known caveats

- Initial page load fires one `/api/deal-buyer-list` call per active
  deal in parallel (same as before). The drawer just reuses that
  cache, so there's no new API cost unless the user hits Refresh.
- The drawer filter input uses `setTimeout(150)` debounce and
  restores cursor position after re-render to keep typing smooth.

---

## Completed — April 10 2026 Sales Tracking Dashboard

Branch: `claude/sales-tracking-dashboard-pkp0N`.

New admin sub-page at `/admin/analytics.html` that pulls deal pipeline
data from Notion and engagement signals from GoHighLevel tag counters
into a single sales-funnel view. Tracks: sent, viewed/clicked,
interested, pipeline counts by status, revenue YTD/MTD/all-time, and
per-deal engagement for the 10 most recently edited active deals.

### Files shipped

- **`termsforsale/netlify/functions/admin-analytics.js` (new)** — GET
  endpoint gated by `X-Admin-Password`. Single-shot aggregator:
  1. Paginates the Notion deals DB (unfiltered, up to 2000 rows),
     buckets by status into active / assigned / closed / funded / dead,
     builds `byStatus` + active-only `byType` breakdowns.
  2. Walks `Date Funded` + `Amount Funded` for YTD, MTD, all-time
     revenue, avg assignment fee, and a 12-month trailing trend
     (`revenue.monthly[]` with zero-fill for quiet months).
  3. Fires 5 cheap `ghlTagCount()` queries in parallel for global
     engagement: `new-deal-alert` (sent), `Active Viewer` (viewed),
     `buyer-interested` (converted), `buyer-pass`, `alerts-paused`.
     Uses GHL `/contacts/search` page=1 limit=1 to read `meta.total`
     — one round trip per tag, no full scans.
  4. For each of the top 10 active deals (sorted by `last_edited_time`
     desc), fires 3 parallel `ghlTagCount()` queries:
     `sent:[slug]` (notify-buyers slug format),
     `viewed-[dealCode]` (deal-view-tracker format, lowercased),
     `alert-[dealCode]` (buyer-alert format, lowercased).
     Returns sent/viewed/interested counts + viewRate + conversionRate.
  5. All engagement lookups run in a single `Promise.all` so the
     whole function stays well under Netlify's 10s timeout even when
     we fire ~35 parallel GHL calls.
  - `slugifyAddress()` is byte-identical to `notify-buyers.js` so the
    `sent:[slug]` tag we query matches exactly what was written.
  - Never throws — downstream errors get pushed to `out.errors[]` and
    the partial result ships anyway.

- **`termsforsale/admin/analytics.html` (new)** — admin sub-page with
  4 revenue stat cards (YTD, MTD, avg deal size, deals funded), a
  5-cell pipeline status strip (active / under contract / closed /
  funded / dead), a 4-stage engagement funnel (sent → viewed →
  interested → passed+paused with view+conversion rates), a 12-month
  revenue bar chart (CSS-only, no chart library), a deal-type mix
  progress-bar panel, and a per-deal engagement table with sent /
  viewed (rate) / interested (rate) columns plus "View buyers"
  deep-link straight into `/admin/deal-buyers.html?deal=[slug]`.
  Rate pills get `good` / `ok` / `low` styling based on thresholds
  (≥40% good, ≥15% ok, else low). Uses the shared admin shell
  (`AdminShell.renderShell('analytics')`) and inherits sidebar, auth
  gate, and toast from `admin.js`.

- **`termsforsale/admin/admin.js`** — added `analytics` nav item to
  the "Overview" group, right below Dashboard. Uses existing
  `activity` icon (lightning bolt / pulse).

- **`termsforsale/admin/index.html`** — added "Sales Tracking" as the
  first quick-action card on the dashboard home so Brooke lands on it
  by default when she opens `/admin/`.

- **`netlify.toml`** — added `/api/admin-analytics` →
  `/.netlify/functions/admin-analytics` redirect (alongside the
  existing admin-stats / admin-buyers routes).

### Data sources + tag shape reference

The dashboard joins three tag families written by existing functions
elsewhere in the codebase — it reads only, no writes:

| Signal | Tag written by | Tag pattern | Queried here |
|---|---|---|---|
| Sent (per deal) | `notify-buyers.js` `triggerBuyerAlert()` | `sent:[city-state-code]` lowercase slug | `ghlTagCount(sent:${slug})` per deal |
| Sent (global) | `notify-buyers.js` | `new-deal-alert` | single global count |
| Viewed (per deal) | `deal-view-tracker.js` POST | `viewed-[PHX-001]` → lowercased by GHL | `ghlTagCount(viewed-${codeLower})` per deal |
| Viewed (global) | `track-view.js` GET/POST | `Active Viewer` | single global count |
| Interested (per deal) | `buyer-alert.js` (INTERESTED reply) | `alert-[PHX-001]` → lowercased | `ghlTagCount(alert-${codeLower})` per deal |
| Interested (global) | `buyer-response-tag.js` | `buyer-interested` | single global count |
| Passed (global) | `buyer-response-tag.js` | `buyer-pass` | single global count |
| Paused (global) | `buyer-response-tag.js` (reply C) | `alerts-paused` | single global count |

Deal counts + revenue come from Notion: `Deal Status`, `Deal Type`,
`Date Assigned`, `Date Funded`, `Amount Funded`, `Started Marketing`.

### Env vars used (no new vars required)

- `ADMIN_PASSWORD` — gates the endpoint
- `NOTION_TOKEN`, `NOTION_DB_ID` (falls back to the hardcoded
  `a3c0a38fd9294d758dedabab2548ff29`)
- `GHL_API_KEY`, `GHL_LOCATION_ID_TERMS` (falls back to
  `GHL_LOCATION_ID`)

### Smoke tests (all pass)

- `admin-analytics.js` loads cleanly as a Node module
- OPTIONS preflight returns 200 with CORS headers
- Missing password returns 401 with `{error: "ADMIN_PASSWORD not configured"}`
- HTML parses balanced (`div` tags 106/106, `script` tags 2/2)
- `slugifyAddress()` byte-match confirmed against `notify-buyers.js`
- All 4 admin functions (admin-stats, admin-buyers, admin-analytics,
  deal-buyer-list) load together without conflicts

### Open caveats

- The "viewed-[dealCode]" per-deal lookup only surfaces engagement for
  deals that have a `Deal ID` field set in Notion. Legacy deals
  without a Deal ID will show 0 viewed / 0 interested even if the
  older `viewed:[dealIdShort]` tag exists on their contacts. Not a
  new limitation — the auto-Deal-ID generator (PR `f786ed6`) backfills
  new submissions; historical deals need a one-time Deal ID assign.
- `new-deal-alert` and `Active Viewer` are cumulative lifetime tags,
  not per-deal. The global funnel numbers are an aggregate across all
  blasts since tag writing began. For per-deal precision, use the
  per-deal engagement table (which queries `sent:[slug]` +
  `viewed-[code]` + `alert-[code]` directly).
- Revenue math leans on `Date Funded` + `Amount Funded` being
  populated correctly in Notion. Deals with status "Closed" but no
  Date Funded will bump the closed count but not the funded count or
  revenue. Accepts partial data — keeps running even if Notion is
  missing fields.

---

## Completed — April 10 2026 Buyer Lookup Fix (Unsent Deals)

Admin deal-buyers lookup was returning 0 results for Philadelphia deals
`PHI-02` (1528 N Sydenham St) and `PHI-03` (1530 N Sydenham St). Root
cause: `notify-buyers.js` `getRecentDeals()` filtered for
`Started Marketing >= today`, so any deal whose Started Marketing date
was set on a day the cron didn't run (or set retroactively to a past
date) became permanently invisible to the scheduled cron. Both Philly
deals had Started Marketing = 2026-04-09, one day in the past — no
`sent:[slug]` tags ever got written to any buyer, so the admin lookup
had nothing to find.

### Files shipped (PR #56, merged to main)

- **`termsforsale/netlify/functions/notify-buyers.js`** — widened
  `getRecentDeals` lookback from `today` to `today − 7 days`. The
  per-buyer dedup tag (`alerted-XXXXXXXX`) + file-based sentLog
  guarantee no buyer receives duplicate alerts across multiple cron
  runs, so a 7-day window is safe. Future deals whose Started Marketing
  is set on a missed cron day will still get picked up for a week.

- **`scripts/retrigger-unsent-deals.js` (new)** — one-shot sweep for
  deals that slipped through. Scans Notion for all `Actively Marketing`
  deals, generates the same `sent:[slug]` tag notify-buyers would
  write, POSTs to GHL `/contacts/search` to count buyers holding that
  tag, and if 0 are found, invokes the notify-buyers handler directly
  via `require()` with `{ queryStringParameters: { deal_id: DEAL_CODE } }`
  — same path `/api/notify-test` uses. Supports `DRY_RUN=1`,
  `MAX_DEALS=N`, and `DEAL_IDS="PHI-02,PHI-03"` filters. Rate-limits
  GHL searches at 200ms and notify-buyers invocations at 2s.

### Droplet commands run (post-merge)

```bash
cd /root/termsforsale-site
git pull origin main
DRY_RUN=1 node scripts/retrigger-unsent-deals.js
DEAL_IDS="PHI-02,PHI-03" node scripts/retrigger-unsent-deals.js
```

### Forward-looking behavior

Future deals with past-dated Started Marketing within 7 days will be
automatically caught by the next cron run. Deals older than 7 days still
need the retrigger script. If this becomes a recurring pattern, consider
(a) widening the lookback further, (b) switching to a
"no `alerted-[id]` tag exists for this deal" check instead of a date
window, or (c) adding a Notion webhook that fires notify-buyers on
status change instead of a scheduled cron.

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

## Completed — April 13 2026 Insurance Quote — Use Highest Rate

Branch: `claude/highest-insurance-rate-z5FG1`.

Brooke noted that Steadily's `/v1/quote/estimate` response contains
**two** annual-premium numbers inside `estimates[0].estimate`:
`lowest` (bare-bones coverage) and `highest` (full coverage). The old
code was always projecting `lowest`, which meant the deal page was
quoting a stripped-down premium the buyer couldn't actually buy at.
Switched the projection to always use `highest`.

### Files shipped

- **`termsforsale/netlify/functions/insurance-quote.js`** — response
  projection now reads `est.estimate.highest` first, falls back to
  `est.estimate.lowest` only if `highest` is missing (older API
  versions / edge cases), and falls through to `available: false`
  when neither is present. The JSON response now also exposes
  `annualHighest`, `annualLowest`, and a `rateTier` field
  (`'highest'` / `'lowest(fallback)'` / `'none'`) so any future
  caller can see both numbers without a re-fetch. The log line now
  prints both rates plus which tier was picked, so Netlify function
  logs show the full picture at a glance.

- **`termsforsale/netlify/functions/_steadily.js`** — header comment
  updated to document the two-rate response shape (previously said
  only `lowest` existed).

### Backwards compatibility

- The `annual`, `monthly`, `available`, `startUrl`, `propertyId`
  response keys are unchanged in name — only the underlying value of
  `annual` / `monthly` changes (now reflects the full-coverage quote
  instead of bare-bones).
- `deal.html:1130` caller continues to read `data.monthly` and
  `data.startUrl` — no frontend changes required.

### Verified locally

Ran a four-case harness with mocked `_steadily.js`:

| Mock response | Annual used | Monthly | rateTier |
|---|---|---|---|
| `{lowest:780, highest:1440}` | $1440 | $120 | `highest` |
| `{highest:1440}` | $1440 | $120 | `highest` |
| `{lowest:780}` | $780 | $65 | `lowest(fallback)` |
| `{}` | $0 | — | `none` (available=false) |

All cases behave as expected. No changes needed to the env vars,
frontend, or `_steadily.js` request path.

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

## Completed — April 11 2026 Deal Map Only Showing Hybrid + Cash (Fix)

Branch: `claude/fix-deal-map-display-UN9wI`.

Brooke reported the deal map was only showing Hybrid (purple) and Cash
(green) markers — every Subject To deal was rendering as a purple
Hybrid pin. Same bug in both the standalone map (`map.html`) and the
split-screen deals page (`deals.html`).

### Root cause

Both map implementations hand-rolled the marker color + label logic
with **exact case-sensitive string matching** on `dealType`:

```js
// BROKEN:
function markerColor(type){
  if(type==='Cash')return'#10B981';
  if(type==='SubTo')return'#29ABE2';
  if(/Seller Finance/i.test(type))return'#F7941D';
  return'#8B5CF6'; // purple Hybrid fallback
}
var label = deal.dealType==='Seller Finance'?'SF'
          : deal.dealType==='SubTo'?'ST'
          : deal.dealType==='Cash'?'$':'HY';
```

But Notion's "Deal Type" select actually holds values like
`"Subject To"` (space), `"Morby Method"`, `"Morby/Stack Method"`,
`"Wrap"`, etc. — NOT `"SubTo"` as the legacy code assumed. Any
non-matching value fell through to purple + `HY` label, which looks
identical to Hybrid. Only `Cash` (exact match) and `Hybrid` (exact match
on the purple fallback) were rendering "correctly" — everything else
was silently mislabeled.

Per CLAUDE.md: *"Deal type matching — case-insensitive (Subject To =
SubTo = sub-to)"*. The deals.html card list already used a `normType()`
helper correctly (line 1194), but the map marker code at line 1671 was
never updated to match.

### Files shipped

- **`termsforsale/deals.html`** — replaced `markerColor()` at line 1674
  with a version that calls the existing `normType()` helper. Added a
  new `markerLabel()` helper that also uses `normType()` so Wrap →
  `WR`, Lease Option → `LO`, Novation → `NV` instead of all collapsing
  to `HY`. `makeMarkerIcon()` now calls `markerLabel(deal.dealType)`.
  Popup header at line 1706 left alone — the CSS `text-transform:
  uppercase` + the raw Notion value ("SUBJECT TO", "MORBY METHOD")
  renders fine.

- **`termsforsale/map.html`** — added a `normType()` helper (byte
  identical to the one in deals.html, since map.html didn't have one).
  Replaced `markerColor()` and inlined label ternary at lines 330/340
  with the normType-based versions. Rewrote `typeClass()` at line 375
  to use normType. Added a new `typeLabel()` helper for the list item
  badge text so Subject To deals show "Subject To" instead of whatever
  raw Notion value was stored. Also fixed `applyFilters()` at line 433
  — was doing `d.dealType !== type` exact match, so filtering by
  "SubTo" would miss "Subject To" deals. Now uses
  `normType(d.dealType) !== normType(type)`.

### Correct mappings now

| Notion value | Old marker | New marker |
|---|---|---|
| Cash | GREEN $ ✓ | GREEN $ |
| Subject To | **PURPLE HY** (wrong!) | BLUE ST |
| SubTo | BLUE ST ✓ | BLUE ST |
| Sub-To | **PURPLE HY** (wrong!) | BLUE ST |
| Seller Finance | ORANGE SF ✓ | ORANGE SF |
| Hybrid | PURPLE HY ✓ | PURPLE HY |
| Morby Method | PURPLE HY ✓ | PURPLE HY |
| Wrap | **PURPLE HY** | PURPLE WR |
| Lease Option | **PURPLE HY** | PURPLE LO |
| Novation | **PURPLE HY** | PURPLE NV |

### Verified

- Node harness exercised the new `normType` + `markerColor` +
  `markerLabel` against 18 Notion-format inputs (all variants:
  "Cash", "Subject To", "SubTo", "Sub-To", "sub to", "subto", "Seller
  Finance", "seller finance", "SF", "Hybrid", "Morby Method",
  "Morby/Stack Method", "Wrap", "Lease Option", "Novation", empty,
  null, undefined). All 18 map correctly.
- `<script>` tag balance checked on both files (13/13 + 4/4).
- All 13 JS script blocks in deals.html + 4 in map.html parse cleanly
  via `new Function(body)` (the only "error" is the JSON-LD structured
  data block, which isn't JavaScript — expected).
- `normType()` is defined at line 1194 in deals.html and before
  `markerColor` in map.html, so it's in scope when the marker
  functions run.

No backend changes — this is a pure frontend color/label fix. No Notion
schema updates needed, no API changes, no new env vars.

## Completed — April 10 2026 Admin Blog & Posts Page Fix (PR #60)

Branch: `claude/fix-admin-blog-posts-GJY2s`. Shipped and merged.

Brooke reported that the "Blog & Posts" section in the admin portal
didn't work — clicking it sent her to the Decap CMS page. Root cause:
the admin Blog landing page (`/admin/blog.html`) only had two CTAs and
both pointed at `/admin/cms.html`, which is a fundamentally broken
Decap CMS integration:

1. `config.yml` uses `folder: "_posts/deals"` and `folder: "_posts/education"`
   — but those directories don't exist. Real blog posts live at
   `termsforsale/blog/posts/*.html` (as HTML, not Markdown).
2. The `git-gateway` backend requires Netlify Identity, which isn't
   set up on this site.
3. The `media_folder` points at `blog/images` instead of
   `termsforsale/blog/images`.

Every path through the admin Blog section dead-ended on an empty/broken
Decap screen.

### Fix shipped

**`termsforsale/admin/blog.html`** — rewrote from a Decap landing page
into a real post management view. Key changes:
- Fetches `/blog/posts-index.json` directly on load (publicly served,
  no auth needed for the static file read) and renders the full list
  sorted newest first
- 4 stat cards: Total Posts, Deal Spotlights, Education & Guides,
  Latest Post (with relative date like "3 days ago")
- Filter tabs: All / Deal Spotlights / Education, with live counts
- Debounced search box — searches title, slug, city, state, category,
  deal type, and hook
- Table with post title + hook + slug column, type badge, category,
  location, published date, plus per-row **View** (opens live post in
  new tab) and **Copy** (copies full URL via `AdminShell.copy()`)
- Topbar has **View blog** (external link), **Refresh** (reloads the
  index), and primary **New Post** button that opens
  `/va-post-builder.html` in a new tab — the existing, working wizard
  that commits HTML via `create-post.js` and the GitHub API
- Inline info box tells operators: "Posts are HTML files stored at
  `termsforsale/blog/posts/` and committed directly to main via the
  GitHub API... The builder uses its own `VA_PASSWORD` (separate from
  this admin password)."

**`termsforsale/admin/index.html`** — updated the Blog & Posts quick
card on the dashboard so the description no longer says "via Decap CMS"
— now reads "Browse published posts and launch the Deal Post Builder to
write new ones."

### Orphaned files (intentionally left in place)

- `termsforsale/admin/cms.html` — still loads the Decap CMS script but
  nothing in the portal links to it anymore
- `termsforsale/admin/config.yml` — still has the broken Decap config

These are no longer reachable from the UI. If we want to ditch them
entirely, that's a separate cleanup commit — not blocking.

### Env vars required for end-to-end publishing (already set, confirm)

- `VA_PASSWORD` — gates the post builder login
- `GITHUB_TOKEN` — commits the new HTML file via GitHub API
- `GITHUB_REPO_OWNER` — e.g. `brooke-wq`
- `GITHUB_REPO_NAME` — e.g. `termsforsale-site`

If any are missing, the builder will log in but hitting Publish returns
"Server not configured. Contact your admin."

### Verification after Netlify auto-deploy

1. Open `/admin/` → click **Blog & Posts** in the sidebar. Should show
   8 posts from `/blog/posts-index.json` — no Decap screen anywhere.
2. Filter tabs (All / Deal Spotlights / Education) show the correct
   counts (3 deal + 5 education = 8 total at time of writing).
3. Search box filters live.
4. Per-row **View** opens the live post in a new tab; **Copy** shows
   the "Copied: …" toast with the full URL.
5. Topbar **New Post** opens `/va-post-builder.html` and the VA
   password login works.

---

## Completed — April 11 2026 Blog Post Edit Flow (PR #61)

Branch: `claude/fix-admin-blog-posts-GJY2s`. Shipped and merged.

Follow-up to PR #60. Brooke asked how operators were supposed to edit
existing blog posts — and the honest answer was "you can't, you'd have
to hand-edit HTML on GitHub or re-enter every field from memory."
Built a proper edit flow end-to-end.

### Files shipped

- **`termsforsale/netlify/functions/create-post.js`** — on every publish,
  now writes a `<slug>.json` sidecar alongside the `<slug>.html` at
  `termsforsale/blog/posts/`. Uses the same SHA-based update path as the
  HTML write, so republishing overwrites both atomically. Sidecar is a
  version-tagged JSON object with all 31 form fields from the VA Post
  Builder (dealId, status, dealType, city, state, zip, headline, hook,
  metaDesc, access, occupancy, askingPrice, entryFee, arv, estRent, coe,
  yearBuilt, bedsBaths, sqft, hoa, loanBalance, interestRate, piti,
  sfTerms, whyExists, strategies, buyerFitYes, propertyType, plus
  slug+updatedAt+version). Newlines in the write-up fields are preserved.
  The sidecar write is wrapped in try/catch — a sidecar failure never
  blocks the HTML publish; at worst the post just can't be edited via
  the builder until next save.

- **`termsforsale/va-post-builder.html`** — supports `?edit=<slug>` URL
  param:
  - On page load, `tryEnterEditMode()` parses the param (regex-validated
    to `[a-z0-9-]+`), fetches `/blog/posts/<slug>.json?t=<now>` with
    `cache: 'no-store'`, and calls `applySidecarToForm()` which iterates
    a shared `EDIT_FIELDS` list and writes every field's `.value`. The
    meta char counter is re-triggered so the "x / 155" hint updates.
  - UI labels switch on edit mode: title → "Edit Deal Post", subtitle →
    "Update the fields below and click Update Post", nav tag → "Editing:
    <slug>", publish button → "💾 Update Post", spinner text →
    "Updating…", error fallback text → "💾 Update Post", success
    heading → "Post Updated!".
  - Blue info banner explains that changing Deal Type / City / State
    will publish a new post at a different URL (since the slug is
    recomputed from those three fields in `create-post.js`). Keeping
    them the same overwrites the existing post.
  - If the sidecar fetch 404s or errors, the banner flips red and
    shows a direct GitHub edit link for that post
    (`https://github.com/brooke-wq/termsforsale-site/edit/main/termsforsale/blog/posts/<slug>.html`).
    Graceful degradation for legacy posts with no sidecar.
  - "Create Another Post" button (on the success card) resets
    `EDIT_MODE`, restores every label back to "new post" copy, and
    strips `?edit=` from the URL via `history.replaceState()` so a
    refresh doesn't re-enter edit mode.

- **`termsforsale/admin/blog.html`** — primary **Edit** button (navy,
  leftmost) on every row's action column, ahead of View and Copy:
  - Deal spotlight rows → `/va-post-builder.html?edit=<slug>` in a new
    tab. The builder's internal fallback handles the missing-sidecar
    case so the row button can be uniform.
  - Education post rows → GitHub web editor URL directly
    (`https://github.com/brooke-wq/termsforsale-site/edit/main/termsforsale/blog/posts/<slug>.html`)
    in a new tab. There's no builder form for education posts yet, so
    skipping the builder is the right call.
  - Info box updated with an "Editing:" paragraph explaining the split
    between sidecar-backed edits and the GitHub fallback.

### Backward compatibility

The 8 existing posts in the repo (3 deal spotlights + 5 education) have
no `.json` sidecars — they were all created before this flow shipped.
Clicking Edit on any of them produces:
- **Education posts**: opens the GitHub web editor directly (expected).
- **Legacy deal posts**: opens the builder, shows a red "no source data
  found" banner with a direct GitHub link. Not broken — just the graceful
  fallback.

Sidecars are created lazily on next republish of each post.

### Verified locally with mocked fetch

A throwaway node harness exercised the full create-post.js happy path
with a mocked `global.fetch`. Six API calls fire in the right order:
HEAD+PUT on the HTML file, HEAD+PUT on the sidecar, HEAD+PUT on
posts-index.json. The decoded sidecar payload contained all 31 expected
fields with newlines preserved in `whyExists` / `strategies` /
`buyerFitYes`. Both modified HTML files pass tag-balance checks
(div 88/88, script 1/1 for builder; div 42/42, script 2/2 for admin
blog page).

### Env vars (no change from PR #60)

- `VA_PASSWORD`, `GITHUB_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`
  all still required by `create-post.js`. No new vars.

### Verification after Netlify auto-deploy

1. Open `/admin/` → **Blog & Posts** → confirm the **Edit** button
   appears in every row's actions column (primary navy button, leftmost).
2. **Education post** — click Edit on any of the 5 education posts
   (e.g. "What Is Subject-To Real Estate") → should open the GitHub web
   editor in a new tab.
3. **Legacy deal post** — click Edit on one of the 3 existing deal
   spotlights (e.g. "Hybrid Deal Tucson") → builder opens with a red
   banner saying "No source data found" + a working GitHub link.
4. **Fresh deal post round-trip**:
   a. Click **New Post** → publish a throwaway test (e.g. dealType=Cash,
      city=TestCity, state=TS).
   b. Return to `/admin/blog.html` → click Edit on the test post.
   c. Builder should open with title "Edit Deal Post", every field
      prefilled from the sidecar, publish button showing "💾 Update Post".
   d. Change one field (e.g. bump askingPrice), click Update Post.
   e. Success card should say "Post Updated!" — verify by reloading the
      live post URL.
   f. Delete the test post's HTML + JSON + posts-index entry directly
      on GitHub to clean up.

### Open caveats

- Education posts still have no builder form. If someone wants to add
  a proper education-post editor in the future, they'd need a second
  form track in `va-post-builder.html` + a new collection branch in
  `create-post.js` that emits the education HTML template + sidecar.
  Scope creep — not needed right now.
- The sidecar is deliberately public (served from the static site) —
  nothing in it is sensitive (it's just the form data that's already
  rendered in the public HTML), but if we ever add private fields
  (e.g. internal dispo notes) they should NOT go in the sidecar.
- Concurrent edit isn't handled — if two people open the same post's
  edit page and click Update Post, the second save wins and silently
  overwrites the first. Acceptable for a small team.

---

## TODO — Next Session

0a. **🔥 Ping the JV partner who called about the Dispo Buddy submission failure** — the `GHL_API_KEY` rotation is done and submissions work again, but their earlier attempts never wrote anything to GHL or Notion. They need to re-submit. See "Dispo Buddy Submission Triage (PR #103)" session log above for context.

0b. **Cross-site env var sync audit.** The Dispo Buddy Netlify site and the Terms For Sale Netlify site each maintain separate copies of `GHL_API_KEY`. When we rotated the Dispo Buddy side on April 21, the Terms For Sale side was untouched — but nothing guarantees both stay in sync going forward. Consider either (a) a recurring ops-audit check that hits a cheap GHL auth endpoint from each deployed function to catch 401s proactively, or (b) a shared env-var store (Netlify Team Environment Variables) so a single rotation pushes to both sites. Same concern applies to any other secret duplicated across sites (`NOTION_TOKEN`, `ANTHROPIC_API_KEY`, etc.).

0. **🔥 FIRST — verify SMS + email landed after `69803b0` contact-ID fix.** Quick one:
   ```bash
   curl -sS --max-time 60 -X POST https://termsforsale.com/api/auto-enrich \
     -H "Authorization: Bearer $AUTOENRICH_AUTH_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"pageId":"337090d675e7815b88d4f82b2d5e5d01"}' | jq '.notionPatched, .driveLink'
   ```
   Verify Brooke's phone got SMS + Brooke's GHL inbox got email. If still failing, check Netlify function logs for `[auto-enrich] SMS failed` / `Email failed`.

0b. **Option B — full 9-page institutional investment report** (multi-session project):

   **Reference template:** https://drive.google.com/file/d/1CCri6NE7jWSN41Gaa1bhKkNx3119N6ZN/view (Brooke's original 120 SW Monroe Cir N analysis — 9 pages, branded header/footer, tax-reset math, 3-scenario rehab, 4-scenario returns, PASS recommendation).

   **Branding decided:**
   - Navy `#0D1F3C` (headings, borders)
   - Blue `#29ABE2` (accents, links)
   - Orange `#F7941D` (callouts, PASS/PROCEED badge)
   - Poppins-like sans-serif (Calibri fallback in .docx)
   - Footer every page: `Prepared for Terms for Sale | termsforsale.com | [Month] [Year] Page X`

   **Phase 1 — Data pipeline expansion** (start next session):
   - **FEMA flood zone** (free) — National Flood Hazard Layer REST API (`services.arcgis.com`) → zone (AE/X/etc), base flood elevation
   - **FEMA disaster history** (free) — `www.fema.gov/api/open/v2/DisasterDeclarationsSummaries` → hurricane/flood events by county
   - **ATTOM tax records** (~$0.15/lookup, paid) — Brooke needs to get API key from https://api.developer.attomdata.com → add to Netlify as `ATTOM_API_KEY`. Pulls assessed value, tax history, homestead status, last sold, parcel, lot dimensions.
   - **RentCast listing history** (free, existing key) — `/listings/sale` endpoint for DOM + price reductions
   - Wire all 4 into `auto-enrich.js` alongside existing RentCast + HUD calls via `Promise.allSettled` with 8s timeout

   **Phase 2 — Compute layer** (new helper `auto-underwrite/compute.js`):
   - Tax reset math: `newTaxEst = (marketValue - homesteadExemption) × millageRate` (millage by county; Pinellas FL = ~1.3%)
   - 3-scenario rehab budget — Claude generates with strict JSON schema `{ light: {...line items...}, moderate: {...}, substantial: {...} }`
   - 4-scenario financial returns — compute `cap rate`, `P&I @ 7.25%/30yr`, `monthly CF`, `COC` for: Light / Moderate / Negotiated / All-Cash
   - Flood risk classifier: zone + disaster history → severity tier
   - PASS/PROCEED logic: thresholds on spread, COC, flood severity, tax shock

   **Phase 3 — Document generator rewrite** (`auto-underwrite/generate_pdf.js`):
   - 9-section layout matching the reference template verbatim in structure
   - Cover: navy banner, address, 5-stat grid (asking / ARV / DOM / flood zone / recommendation)
   - Properly-styled tables (navy header row, alternating row shading)
   - Multi-column scenario tables (3-col rehab, 4-col returns)
   - Orange verdict box for PASS/PROCEED with bullet rationale
   - Branded footer via `docx` section footer (auto-paginates)
   - Deploy to paperclip via `/auto-underwrite/deploy.sh`

   **Phase 4 — Test + iterate**: Run against 3-5 real deals (spanning Cash/SubTo/SF dealTypes), compare to reference template side-by-side, fix data gaps or styling regressions.

   **Prereq before starting Phase 1:** Brooke needs to get ATTOM API key and add to Netlify. If she prefers Estated instead (~$0.08/lookup, less data), that works too — helper can be provider-agnostic.

1. **Auto-Underwrite — security follow-ups + n8n wiring** (carry-over from April 18):
   - **Rotate the OAuth refresh token** (it was visible in chat during setup):
     1. Go to https://myaccount.google.com/permissions
     2. Find "Deal Pros Auto-Underwrite" → Remove access
     3. On Mac: `cd ~/termsforsale-site/auto-underwrite && node get-refresh-token.js`
     4. Approve in browser, copy new `GOOGLE_REFRESH_TOKEN=...` line
     5. `open -e ~/termsforsale-site/auto-underwrite/.env` → replace the old token, save
     6. `scp ~/termsforsale-site/auto-underwrite/.env root@64.23.204.220:/home/brooke/pdf-render-service/.env`
     7. `ssh root@64.23.204.220 "pm2 reload pdf-render-service"`
     8. Smoke test: `curl http://64.23.204.220:3001/health` — should still return `oauthConfigured: true`
   - **Decide on firewall posture.** ufw is currently inactive on paperclip, so port 3001 is open to the internet. The `AUTH_TOKEN` is the gate. Options:
     - (a) Leave as-is — AUTH_TOKEN is 32 random bytes, brute-force isn't realistic.
     - (b) Enable ufw and lock 3001 to known caller IPs (n8n Cloud's egress range, or a Cloudflare tunnel).
     - (b) is more secure but breaks ad-hoc testing from your laptop. Pick when n8n is wired up.
   - **Build the n8n Cloud workflow** that calls `/render`. The chat session that designed the underwriting prompt + workflow JSON has the source-of-truth doc — port that into n8n Cloud and point its HTTP Request node at `http://64.23.204.220:3001/render` with `X-Auth-Token` header and the deal JSON in the body. (The auto-enrichment n8n workflow at `auto-underwrite/n8n/auto-enrichment.workflow.json` is a separate pipeline — it calls `/api/auto-enrich`, not `/render` directly.)
   - **Test the round-trip** with a real Notion deal once n8n is live: trigger the workflow, confirm the `.docx` lands in `/Deal Analyses/`, eyeball the formatting, iterate on `generate_pdf.js` if section ordering or labels need tweaking.
   - **Optional polish:** add a `puppeteer`-based "real PDF" output mode behind a `?format=pdf` flag if the team wants true PDFs instead of `.docx`. Not needed right now — Drive renders `.docx` natively.

- **Test auto-enrich end-to-end**: Set the 4 Netlify env vars (`AUTOENRICH_AUTH_TOKEN`, `RENTCAST_API_KEY`, `RENDER_SERVICE_URL`, `RENDER_SERVICE_TOKEN`), set a deal's status to "Intake" in Notion, then run: `curl -sS -X POST https://termsforsale.com/api/auto-enrich -H "Authorization: Bearer $AUTOENRICH_AUTH_TOKEN" -H "Content-Type: application/json" -d '{"pageId":"<notion-page-id>"}'`. Check Netlify function logs, verify Notion fields updated (`LTR Market Rent`, `Enriched At`), check Google Drive `/Deal Analyses/` for `.docx`, check Brooke's GHL contact for note + SMS.
- **Import n8n workflow**: In n8n Cloud, Workflows → Import → paste `auto-underwrite/n8n/auto-enrichment.workflow.json`. Set Variables `NOTION_TOKEN` and `AUTOENRICH_AUTH_TOKEN`. Activate. See `auto-underwrite/n8n/README.md` for full setup.

1. **Test 3 Terms For Sale GHL workflows are firing live** (Brooke's request — PRIORITY for tomorrow):
   - **Customer Reply workflow** → POSTs to `/api/buyer-response-tag`
     - Test: text `1` (or `IN`/`INTERESTED`) to the TFS GHL number from a buyer contact → confirm the contact gets `buyer-interested` + `deal-hot` tags + a "BUYER RESPONSE" note appears in GHL
     - Test: text `A`/`B`/`C` → confirm `pref-keep-all` / `pref-market-only` / `alerts-paused` tags applied, plus an "ALERT PREF" note
   - **Calendar Booking workflow** → POSTs to `/api/booking-notify`
     - Test: book a fake appointment on Brooke's TFS calendar from a buyer contact → confirm Brooke's phone gets the SMS alert
   - **Buyer Interest workflow** (engagement-tag system) → POSTs to `/api/buyer-alert`
     - Test: from a contact who already has a `sent-PHX-001` (or any `sent-XXX`) tag, text `INTERESTED` → confirm tag gets promoted to `alert-PHX-001`, GHL note appears, Brooke's phone gets SMS with deal list
   - For each: if the workflow doesn't fire, check Automation → Workflows in GHL, find the workflow, confirm status pill is **Published** (green) not Draft, and confirm the webhook URL points at `https://termsforsale.com/.netlify/functions/<name>`

2. **Dispo Buddy — fix 3 Notion fields not syncing** (carried over from go-live):
   - **Occupancy** — code currently writes as `multi_select`; need to confirm exact Notion property type and adjust helper call (`msel` vs `sel` vs `text`)
   - **Access** — code writes to property name `Access`; confirm exact Notion property name (might be `Property Access`)
   - **Internal Notes** — `additional_notes` form input currently gets pushed into the combined `Details ` block. If a separate Notion property exists, need exact name to write directly
   - Quickest path: have Brooke send a Netlify function log line containing `Removed N props [...]` from a recent submission — that lists exactly which property names smart-retry is dropping

3. **Dispo Buddy — add County + HOA to the form** (Brooke confirmed both Notion properties exist):
   - Add 2 input fields to `dispobuddy/submit-deal.html` (text inputs near ZIP / lot size)
   - Add to `gatherData()` payload + `SAVEABLE_FIELDS` array
   - Wire to Notion in `dispo-buddy-submit.js` — likely `text('County', d.county)` + `text('HOA', d.hoa)` (or `num` for HOA if Notion column is number)
   - Also extend `?test` autofill to populate them

4. **Dispo Buddy — re-enable AI triage** (optional, currently DEFERRED):
   - Re-enable `dispo-buddy-triage` PM2 cron on the Droplet: `pm2 restart dispo-buddy-triage`
   - Build GHL workflow: Trigger = Tag Added `jv-submitted`, Action = Webhook POST to `https://dispobuddy.com/.netlify/functions/dispo-buddy-triage` with body `{contactId}`. Don't enable until the cron is back on first.

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
