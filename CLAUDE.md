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
