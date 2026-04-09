# Terms For Sale — Master Reference

> **Owner:** Deal Pros LLC
> **Domain:** termsforsale.com
> **Portal:** termsforsale.app.clientclub.net
> **Stack:** Static HTML + Netlify Functions + Notion + GoHighLevel
> **Last updated:** 2026-03-25

---

## Table of Contents

1. [Site Architecture](#1-site-architecture)
2. [Page Directory](#2-page-directory)
3. [Netlify Functions (API Endpoints)](#3-netlify-functions-api-endpoints)
4. [GoHighLevel — Full Field Reference](#4-gohighlevel--full-field-reference)
5. [GHL Webhooks](#5-ghl-webhooks)
6. [GHL Tags](#6-ghl-tags)
7. [GHL Pipelines & Stages](#7-ghl-pipelines--stages)
8. [GHL Automations / Workflows Needed](#8-ghl-automations--workflows-needed)
9. [AI Agent Studio Prompts & Use Cases](#9-ai-agent-studio-prompts--use-cases)
10. [Notion Database Schema](#10-notion-database-schema)
11. [Environment Variables](#11-environment-variables)
12. [Third-Party Integrations](#12-third-party-integrations)
13. [Auth System](#13-auth-system)
14. [Email Templates](#14-email-templates)
15. [SOPs — Standard Operating Procedures](#15-sops--standard-operating-procedures)
16. [Change Log](#16-change-log)

---

## 1. Site Architecture

```
termsforsale.com (Netlify)
├── / ................................. Homepage — deal listings, signup, buying criteria
├── /deal.html?id=XX ................. Deal detail page — photos, terms, offers
├── /dashboard.html .................. Buyer dashboard — saved deals, offers, activity
├── /buy-box.html .................... Buy box builder — criteria saved to GHL
├── /buying-criteria.html ............ Multi-step buying criteria form
├── /buyingcriteria-standalone.html .. Embeddable version for buyingcriteria.com
├── /acquisition-assist.html ......... Deal submission form (wholesalers/JV)
├── /dispo-submit.html ............... Dispo Buddy JV deal submission
├── /map.html ........................ Interactive Leaflet map of active deals
├── /va-post-builder.html ............ VA tool — creates blog posts via GitHub API
├── /webhook-test.html ............... Dev tool — test GHL webhook payloads
├── /blog/ ........................... Blog index + individual posts
├── /admin/ .......................... Decap CMS (Netlify Identity)
├── /privacy.html .................... Privacy policy
├── /terms.html ...................... Terms of service
├── /404.html ........................ Custom 404 page
├── /emails/ ......................... Email HTML templates (for GHL workflows)
│
├── /api/deals ....................... Notion → JSON deal feed
├── /api/notify-buyers ............... Scheduled buyer matching + alert trigger
├── /api/notify-test?deal_id=XX ..... Manual test for buyer alerts
├── /api/create-post ................. VA blog post creation (GitHub API)
├── /api/acquisition-assist .......... Acquisition form → GHL contact + opportunity
├── /api/dispo-buddy-submit .......... Dispo form → GHL contact + opportunity
├── /api/drive-image?id=XX ........... Google Drive image proxy (for emails)
├── /api/drive-thumb?id=XX&sz=800 ... Google Drive thumbnail redirect
├── /api/drive-photos?folderId=XX ... List images in Drive folder
├── /api/hud-fmr?state=AZ&city=XX .. HUD Fair Market Rent lookup
└── /sitemap.xml ..................... Dynamic XML sitemap
```

**Hosting:** Netlify (publish dir: `termsforsale/`, functions dir: `termsforsale/netlify/functions/`)

**CMS:** Decap CMS via git-gateway on `main` branch

---

## 2. Page Directory

| Page | URL | Purpose | Auth Required | Forms |
|------|-----|---------|:---:|-------|
| Homepage | `/` | Deal listings, filtering, signup/login, VIP criteria | Yes (optional) | Signup, Login, VIP Criteria |
| Deal Page | `/deal.html?id=XX` | Property detail — photos, terms, calculators, inquiry/offer | Yes (optional) | Inquiry, Offer, Signup, Login |
| Dashboard | `/dashboard.html` | Saved deals, submitted offers, activity log, preferences | Yes | Preference toggles |
| Buy Box | `/buy-box.html` | Interactive buy box builder — Cash / Creative / Lender | Yes | Profile-based criteria form |
| Buying Criteria | `/buying-criteria.html` | 6-step criteria wizard | No | Multi-step form |
| Buying Criteria (embed) | `/buyingcriteria-standalone.html` | Same as above, for buyingcriteria.com | No | Multi-step form |
| Acquisition Assist | `/acquisition-assist.html` | 5-step deal submission for wholesalers/JV | No | 65+ fields |
| Dispo Submit | `/dispo-submit.html` | 4-step JV deal submission | No | 40+ fields |
| Deal Map | `/map.html` | Leaflet map of active deals with filters | No | Type/state filters |
| VA Post Builder | `/va-post-builder.html` | Blog post creator (password-protected) | Yes (password) | 4-step post builder |
| Webhook Test | `/webhook-test.html` | Dev tool for testing GHL webhook payloads | No | Test payload forms |
| Blog | `/blog/` | Blog listing + individual posts | Optional | Signup/Login |
| Admin | `/admin/` | Decap CMS dashboard | Yes (Netlify Identity) | CMS editor |
| Privacy | `/privacy.html` | Privacy policy | No | — |
| Terms | `/terms.html` | Terms of service | No | — |
| 404 | `/404.html` | Custom not-found page | No | — |

---

## 3. Netlify Functions (API Endpoints)

### 3.1 `/api/deals` — deals.js

Fetches active deals from Notion, returns JSON.

- **Method:** GET
- **Env:** `NOTION_TOKEN`, `NOTION_DB_ID`, `GOOGLE_API_KEY`
- **Filter:** Deal Status = "Actively Marketing"
- **Auto:** Populates cover photo from first Drive image if missing
- **Cache:** 60s
- **Returns:** `{ deals: [...], count, source: "notion" }`

### 3.2 `/api/notify-buyers` — notify-buyers.js

Matches newly-published deals against buyer criteria and triggers GHL alerts.

- **Method:** GET
- **Env:** `NOTION_TOKEN`, `NOTION_DB_ID`, `GHL_API_KEY`, `GHL_LOCATION_ID`, `DEAL_ALERTS_LIVE`
- **Schedule:** Every 30 minutes (Netlify scheduled function)
- **Manual test:** `/api/notify-test?deal_id=XX`
- **Matching tiers:**
  - Tier 1 (strict): 2+ buy box criteria match
  - Tier 2 (relaxed): 1+ criteria match (if tier 1 < 50 buyers)
  - Tier 3 (state fallback): same state (if tier 1+2 < 50)
- **Actions:** Adds `new-deal-alert` tag + updates 15+ custom fields on each matched contact
- **Target:** 50+ matched buyers per deal

### 3.3 `/api/acquisition-assist` — acquisition-assist.js

Processes deal submissions from the Acquisition Assist form.

- **Method:** POST
- **Env:** `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_PIPELINE_ID`, `GHL_STAGE_NEW_SUBMISSION`
- **Actions:**
  1. Upserts GHL contact (by phone)
  2. Populates 50+ custom fields
  3. Applies deal-type + asset-type tags
  4. Creates opportunity in Acquisition Assist pipeline

### 3.4 `/api/dispo-buddy-submit` — dispo-buddy-submit.js

Processes JV deal submissions from the Dispo Buddy form.

- **Method:** POST
- **Env:** `GHL_API_KEY`, `GHL_LOCATION_ID`
- **Pipeline:** "3. JV Deals" (`XbZojO2rHmYtYa8C0yUP`)
- **Stage:** "New JV Lead" (`cf2388f0-fdbf-4fb1-b633-86569034fcce`)
- **Actions:**
  1. Upserts GHL contact (by phone)
  2. Populates 30+ custom fields
  3. Applies dispo-buddy + deal-type tags
  4. Creates opportunity

### 3.5 `/api/create-post` — create-post.js

VA tool that creates blog post HTML via GitHub API.

- **Method:** POST
- **Env:** `VA_PASSWORD`, `GITHUB_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`
- **Actions:**
  1. Verifies VA password
  2. Generates slug from deal type + city + state
  3. Creates HTML file at `termsforsale/blog/posts/{slug}.html`
  4. Updates `posts-index.json`

### 3.6 `/api/drive-image` — drive-image.js

Returns actual image bytes from Google Drive (for email clients).

- **Method:** GET
- **Env:** `GOOGLE_API_KEY`
- **Params:** `id` (required), `sz` (optional, default 800)
- **Cache:** 24h
- **Fallback chain:** thumbnail → webContentLink → direct download

### 3.7 `/api/drive-thumb` — drive-thumb.js

302 redirect to Google Drive thumbnail URL.

- **Method:** GET
- **Env:** `GOOGLE_API_KEY`
- **Params:** `id` (required), `sz` (optional, default 800)
- **Cache:** 24h

### 3.8 `/api/drive-photos` — drive-photos.js

Lists all image files in a Google Drive folder.

- **Method:** GET
- **Env:** `GOOGLE_API_KEY`
- **Params:** `folderId` (required)
- **Cache:** 5 min
- **Returns:** `{ fileIds: [...] }`

### 3.9 `/api/hud-fmr` — hud-fmr.js

HUD Fair Market Rent lookup with market-tier multipliers.

- **Method:** GET
- **Params:** `state` (required), `city` (optional), `beds` (optional, default 2)
- **Data:** Hardcoded FY2025 FMR for 11 states, 50+ cities
- **Market tiers:** High (MTR ×1.6, STR ×2.8), Medium (×1.4, ×2.3), Low (×1.25, ×1.9)
- **Cache:** 24h

### 3.10 `/sitemap.xml` — sitemap.js

Dynamic XML sitemap combining static pages + active deals + blog posts.

- **Data sources:** Google Sheets (active deals) + `posts-index.json`

---

## 4. GoHighLevel — Full Field Reference

### 4.1 Buyer Alert Custom Fields (notify-buyers.js)

These fields are populated when a deal alert is sent to a buyer:

| GHL Field ID | Purpose | Source |
|---|---|---|
| `TerjqctukTW67rB21ugC` | Full address | Notion: Street + City + State + ZIP |
| `KuaUFXhbQB6kKvBSKfoI` | City | Notion: City |
| `ltmVcWUpbwZ0S3dBid3U` | State | Notion: State |
| `UqJl4Dq6T8wfNb70EMrL` | ZIP | Notion: ZIP |
| `0thrOdoETTLlFA45oN8U` | Deal type | Notion: Deal Type |
| `5eEVPcp8nERlR6GpjZUn` | Deal URL | Generated: `termsforsale.com/deal.html?id=XX` |
| `YjoPoDPv7Joo1izePpDx` | Summary line | Generated: "SubTo — Phoenix, AZ — $155K" |
| `iur6TZsfKotwO3gZb8yk` | Alert asking price | Notion: Asking Price |
| `DH4Ekmyw2dvzrE74JSzs` | Alert entry fee | Notion: Entry Fee |
| `DJFMav5mPvWBzsPdhAqy` | Alert property type | Notion: Property Type |
| `2iVO7pRpi0f0ABb6nYka` | Alert beds | Notion: Beds |
| `rkzCcjHJMFJP3GcwnNx6` | Alert baths | Notion: Baths |
| `nNMHvkPbjGYRbOB1v7vQ` | Alert year built | Notion: Year Built |
| `MgNeVZgMdTcdatcTTHue` | Alert sqft | Notion: Living Area / Sqft |
| `eke6ZGnex77y5aUCNgly` | Alert highlights | Notion: Highlight 1 + 2 + 3 |
| `FXp9oPT4T4xqA1HIJuSC` | Alert cover photo URL | Generated: `/api/drive-image?id=XX` |

### 4.2 Buy Box Matching Fields (buyer preferences — read by notify-buyers.js)

| GHL Field ID | Field Name | Type | Used For |
|---|---|---|---|
| `aewzY7iEvZh12JhMVi7E` | TARGET_STATES | Multi-select | State matching |
| `DbY7dHIXk8YowpaWrxYj` | TARGET_CITIES | Multi-select | City matching |
| `0L0ycmmsEjy6OPDL0rgq` | DEAL_STRUCTURES | Multi-select | Deal type matching |
| `HGC6xWLpSqoAQPZr0uwY` | PROPERTY_TYPE | Multi-select | Property type matching |
| `BcxuopmSK4wA3Z3NyanD` | MAX_PRICE | Monetary | Price ceiling |
| `SZmNHA3BQva2AZg00ZNP` | MAX_ENTRY | Monetary | Entry fee ceiling |
| `KKGEfgdaqu98yrZYkmoO` | MIN_ARV | Monetary | ARV floor |
| `RRuCraVtRUlEMvdFXngv` | MIN_BEDS | Number | Bedroom minimum |
| `98i8EKc3OWYSqS4Qb1nP` | EXIT_STRATEGIES | Multi-select | Strategy matching |
| `XjXqGv6Y82iTP659pO4t` | TARGET_MARKETS | Large text | Metro area matching |
| `95PgdlIYfXYcMymnjsIv` | BUYER_TYPE | Single select | Buyer classification |
| `agG4HMPB5wzsZXiRxfmR` | CONTACT_ROLE | Multi-select | Must include "Buyer" |

### 4.3 Acquisition Assist Custom Fields (acquisition-assist.js)

Submitted via `contacts/upsert` using custom field **keys** (not IDs):

**Property:**
`property_address`, `property_city`, `property_state`, `property_zip`, `asset_type`, `property_beds`, `property_baths`, `property_sqft`, `property_year_built`, `property_condition`, `property_occupancy`, `current_rent`, `has_solar`, `has_hoa`, `hoa_monthly`

**Deal Structure:**
`deal_structure`, `under_contract`, `contract_exp_date`

**Cash Deal:**
`seller_asking_price`, `estimated_arv`, `estimated_repairs`, `assignment_fee`, `emd_amount`

**Subject-To Deal:**
`subto_loan_balance`, `subto_rate`, `subto_piti`, `subto_loan_status`, `subto_payments_behind`, `subto_lender_name`, `subto_maturity_date`, `subto_cash_to_seller`, `subto_lender_contact`, `subto_has_balloon`, `subto_balloon_detail`

**Seller Finance Deal:**
`is_free_and_clear`, `sf_underlying_balance`, `sf_down_payment`, `sf_rate`, `sf_term`, `sf_monthly_payment`, `sf_has_balloon`, `sf_balloon_detail`, `estimated_rent`

**Details:**
`seller_motivation`, `seller_timeline`, `access_type`, `seller_verified`, `known_repairs`, `prop_description`, `photo_link`, `listing_link`, `comp_report_link`

**JV:**
`jv_compensation_type`, `jv_fee_desired`, `open_to_jv_split`, `fast_close_needed`, `jv_notes`, `deal_confidence`, `additional_notes`, `is_licensed_agent`, `wholesaler_markets`, `referral_source`

### 4.4 Dispo Buddy Custom Fields (dispo-buddy-submit.js)

Submitted via `contacts/upsert` using custom field **keys**:

`jv_partner_name`, `jv_phone_number`, `jv_partner_email`, `do_you_have_the_property_under_contract`, `is_this_your_first_deal_with_dispo_buddy`, `how_did_you_hear_about_us`, `property_address`, `property_city`, `property_state`, `property_zip`, `coe`, `property_occupancy`, `how_can_we_access_the_property`, `link_to_photos`, `link_to_supporting_documents`, `deal_type`, `contracted_price`, `desired_asking_price`, `arv_estimate`, `what_is_the_buyer_entry_fee`, `contracted_entry_fee`, `est_taxes__insurance`, `subto_loan_balance`, `interest_rate`, `monthly_payment`, `loan_maturity`, `subto_balloon`, `seller_finance_loan_amount`, `sf_loan_payment`, `interest_rate_seller_finance`, `loan_term`, `sf_balloon`, `dscr_loan_amount`, `important_details`, `additional_notes`

### 4.5 Buy Box Custom Fields (buy-box.html → webhook)

Submitted via webhook with field **keys**:

`deal_structure`, `exits`, `target_zips`, `buyer_profile_type`, `notes`, `source`, `buy_box_updated`, `buy_box_complete`, `lender_loan_types`, `lender_max_ltv`, `lender_rate_range`, `creative_max_entry`, `creative_max_pmt`, `creative_min_cf`, `creative_max_rate`, `creative_rate_pref`, `cash_max_price`, `cash_max_repair`, `cash_min_arv`, `property_types`

### 4.6 Signup / Login Fields (homepage + deal page)

Submitted via webhook:

**Signup:** `firstName`, `lastName`, `email`, `phone`, `password`, `deal_structure`, `source`, `pipeline_name`, `pipeline_stage`, `tags`

**Login:** `email`, `password`, `source`

**VIP Criteria:** `firstName`, `lastName`, `email`, `phone`, `target_zips`, `deal_structure`, `exits`, `source`, `pipeline_name`, `pipeline_stage`, `tags` + UTMs

### 4.7 Inquiry / Offer Fields (deal.html → webhook)

**Inquiry:** `firstName`, `lastName`, `phone`, `email`, `dealId`, `requestType`, `buyingMethod`, `notes`, `current_deal_interest`, `purchase_timeline`, `buy_box_notes`, `lead_source_detail`, `deal_structure`

**Offer:** `firstName`, `lastName`, `phone`, `email`, `dealId`, `offerAmount`, `requestedCoe`, `paymentMethod`, `notes`

---

## 5. GHL Webhooks

All webhooks are under GHL Location ID: `7IyUgu1zpi38MDYpSDTs`

| Name | Trigger ID | Used By | Fires When |
|------|-----------|---------|------------|
| **Signup** | `88c6d9de-eb76-45ef-ac83-db284b7da5ac` | Homepage, Deal page, Buying Criteria, Blog | User creates account or submits criteria |
| **Login** | `caa1f812-8957-48af-ae00-45322992102b` | Homepage, Deal page, Blog | User logs in |
| **Inquiry / Access** | `1fd6be66-9022-4375-b17a-d7ec2cabe593` | Deal page, Buy Box, Buying Criteria, Blog posts | User submits inquiry, saves buy box, or submits criteria |
| **Offer** | `933e8621-3b0c-4b36-9248-197bddc2e4c1` | Deal page | User submits an offer on a deal |

**Full URL pattern:** `https://services.leadconnectorhq.com/hooks/7IyUgu1zpi38MDYpSDTs/webhook-trigger/{TRIGGER_ID}`

---

## 6. GHL Tags

### Applied by notify-buyers.js
| Tag | Purpose |
|-----|---------|
| `new-deal-alert` | Triggers the deal alert workflow (SMS + email to buyer) |

### Applied by acquisition-assist.js
| Tag | Purpose |
|-----|---------|
| `acquisition-assist` | Marks contact as acquisition submitter |
| `jv-partner` | Marks as JV partner |
| `acq-cash` | Cash deal submission |
| `acq-subto` | Subject-To deal submission |
| `acq-seller-finance` | Seller Finance deal submission |
| `acq-hybrid` | Hybrid deal submission |
| `acq-morby` | Morby Method deal submission |
| `acq-wrap` | Wrap deal submission |
| `acq-novation` | Novation deal submission |
| `acq-lease-option` | Lease Option deal submission |
| `acq-unknown-structure` | Unknown deal type |
| `asset-sfr`, `asset-duplex`, `asset-triplex`, `asset-quadplex` | Asset type tags |
| `asset-small-mfr`, `asset-large-mfr`, `asset-commercial` | Asset type tags |
| `asset-mobile-home`, `asset-mhp`, `asset-rv-park`, `asset-land`, `asset-mixed-use` | Asset type tags |
| `acq-fast-close` | Fast close needed |
| `acq-agent` | Licensed real estate agent |

### Applied by dispo-buddy-submit.js
| Tag | Purpose |
|-----|---------|
| `dispo-buddy` | Marks as Dispo Buddy submission |
| `jv-partner` | Marks as JV partner |
| `db-cash` | Cash deal via Dispo |
| `db-subto` | SubTo deal via Dispo |
| `db-seller-finance` | Seller Finance via Dispo |
| `db-hybrid` | Hybrid via Dispo |
| `db-morby` | Morby Method via Dispo |
| `db-first-deal` | First deal with Dispo Buddy |
| `db-direct-to-seller` | Direct to seller (under contract) |
| `db-jv-with-wholesaler` | JV with wholesaler |

### Applied by Signup/Criteria forms
| Tag | Purpose |
|-----|---------|
| `TFS Buyer` | Website signup |
| `Website Signup` | Signed up on website |
| `Buying Criteria Form Submitted` | Submitted criteria form |
| `tfs buyer` | Buy box save |
| `buy box complete` | Buy box fully saved |
| `cash-buyer` / `creative-buyer` / `lender-capital` | Buy box profile type |
| `buyingcriteria.com` | Came from standalone criteria form |

---

## 7. GHL Pipelines & Stages

### Pipeline 1: Buyer Inquiries
- **Stage:** New Lead (created by signup/criteria forms)
- **Source fields:** `pipeline_name: 'Buyer Inquiries'`, `pipeline_stage: 'New Lead'`

### Pipeline 2: Acquisition Assist
- **Pipeline ID:** From env `GHL_PIPELINE_ID`
- **Stage ID:** From env `GHL_STAGE_NEW_SUBMISSION`
- **Opp name format:** `{dealType} — {city} {state} — {lastName}`
- **Monetary value:** Asking price from deal

### Pipeline 3: JV Deals
- **Pipeline ID:** `XbZojO2rHmYtYa8C0yUP`
- **Stage:** New JV Lead (`cf2388f0-fdbf-4fb1-b633-86569034fcce`)
- **Opp name format:** `{dealType} — {city} {state} — {lastName}`
- **Monetary value:** Desired asking price or contracted price

---

## 8. GHL Automations / Workflows Needed

### 8.1 New Buyer Signup (Webhook Trigger: Signup)

**Trigger:** Signup webhook fires
**Actions:**
1. Create/update contact with submitted fields
2. Set Contact Role = "Buyer"
3. Add to "Buyer Inquiries" pipeline → New Lead stage
4. Send **Welcome Email** (plain text or branded)
5. Wait 2 min → Send SMS: "Hey {first_name}, welcome to Terms For Sale! Browse deals at termsforsale.com"
6. Internal notification to team (Slack or email)

### 8.2 Portal Access Granted

**Trigger:** Manual or tag-based (e.g., tag `portal-access-granted` added)
**Actions:**
1. Send **Portal Access Granted Email** (use template at `emails/portal-access-granted.html`)
2. SMS: "Hey {first_name}! Your buyer portal is live. Log in here: termsforsale.app.clientclub.net"
3. Update custom field: `portal_access = true`
4. Wait 24h → Send follow-up: "Have you logged into your portal yet?"

### 8.3 New Deal Alert (Tag Trigger: `new-deal-alert`)

**Trigger:** `new-deal-alert` tag added by notify-buyers.js
**Actions:**
1. Send **Deal Alert Email** using custom field data:
   - Subject: "New {alert_deal_type} Deal in {alert_city}, {alert_state}"
   - Body: Use fields `alert_address`, `alert_asking_price`, `alert_entry_fee`, `alert_highlights`, `alert_cover_photo`, `alert_deal_url`
2. Send Deal Alert SMS: "New {deal_type} in {city}, {state} — {asking_price}. Entry: {entry_fee}. View: {deal_url}"
3. Remove `new-deal-alert` tag (so it can be re-added for next deal)
4. Log activity

### 8.4 Inquiry Submitted (Webhook Trigger: Inquiry)

**Trigger:** Inquiry webhook fires from deal page
**Actions:**
1. Create/update contact
2. Internal notification: "{first_name} requested {request_type} on Deal {dealId}"
3. Send confirmation email: "We received your inquiry for {address}. Our team will follow up within 24 hours."
4. Assign task to acquisitions team member
5. Wait 24h → If no response from team, escalation notification

### 8.5 Offer Submitted (Webhook Trigger: Offer)

**Trigger:** Offer webhook fires from deal page
**Actions:**
1. Create/update contact
2. Internal notification (high priority): "OFFER: {first_name} offered {offer_amount} on Deal {dealId}"
3. Send confirmation email: "Your offer of {offer_amount} has been received. We'll review and respond within 24 hours."
4. Create task for deal manager
5. Add tag: `active-offer`

### 8.6 Acquisition Assist Submission

**Trigger:** Contact tagged with `acquisition-assist`
**Actions:**
1. Internal notification with deal summary
2. Send confirmation email to submitter: "Your deal at {property_address} has been received."
3. Assign to acquisitions team for underwriting
4. Wait 48h → Follow-up if no action taken

### 8.7 Dispo Buddy Submission

**Trigger:** Contact tagged with `dispo-buddy`
**Actions:**
1. Internal notification: "New JV deal from {jv_partner_name}"
2. Send confirmation email: "Your deal has been submitted to our dispo team."
3. Move opportunity to review stage
4. Assign to dispo team member

### 8.8 Buy Box Complete

**Trigger:** Contact tagged with `buy box complete`
**Actions:**
1. Update Contact Role = "Buyer" (if not already)
2. Send confirmation: "Your buy box is saved! We'll match you with deals that fit your criteria."
3. If buyer matches any active deals → trigger deal alert immediately

### 8.9 Stale Lead Re-engagement

**Trigger:** Time-based — contact inactive for 14 days
**Conditions:** Has tag `TFS Buyer`, no activity in 14 days
**Actions:**
1. Send re-engagement email: "We have {X} new deals this week. Have you checked the portal lately?"
2. Wait 7 days → If still inactive, send "We miss you" SMS
3. Wait 14 more days → Move to cold pipeline stage

### 8.10 Login Activity Tracking

**Trigger:** Login webhook fires
**Actions:**
1. Update custom field: `last_login = {{current_date}}`
2. Increment login count
3. If first login in 7+ days → internal note "Re-engaged buyer"

---

## 9. AI Agent Studio Prompts & Use Cases

### 9.1 Deal Qualifier Agent

**Name:** Deal Qualifier
**Trigger:** New Acquisition Assist submission (tag: `acquisition-assist`)
**System prompt:**
```
You are a deal underwriting assistant for Terms For Sale (Deal Pros LLC), a creative finance real estate company. Your job is to quickly qualify incoming deal submissions.

Review the contact's custom fields for the submitted deal and provide:
1. Deal Grade (A/B/C/D) based on: equity spread, entry fee, cash flow potential, deal structure viability
2. Red flags (balloon payments, delinquent loans, high HOA, solar liens, etc.)
3. Recommended next steps (request comps, schedule walkthrough, pass on deal)
4. Comparable deal summary if similar deals exist

For Subject-To deals, flag if: rate > 6%, payments behind > 2, balloon within 5 years, loan maturity < 10 years.
For Seller Finance, flag if: rate > 7%, term < 15 years, no equity cushion.
For Cash deals, calculate MAO at 70% ARV minus repairs and compare to asking.

Be concise. Use bullet points. Always include the deal address and type in your response.
```

### 9.2 Buyer Matching Agent

**Name:** Buyer Matcher
**Trigger:** New deal published (tag: `new-deal-alert` process)
**System prompt:**
```
You are a buyer-matching assistant for Terms For Sale. When a new deal is published, analyze the deal details and suggest which buyer profiles would be the best fit.

Consider:
- Deal type alignment (SubTo buyers for SubTo deals, etc.)
- Entry fee vs. buyer's max entry
- Location match (state, metro area)
- Property type match
- Cash flow potential vs. buyer goals
- Experience level requirements (complex deals need experienced buyers)

Provide a prioritized list of buyer segments and a suggested personalized message for each segment. Keep messages under 160 characters for SMS compatibility.
```

### 9.3 Inquiry Response Agent

**Name:** Inquiry Responder
**Trigger:** New inquiry submission (tag: `Website Inquiry`)
**System prompt:**
```
You are a helpful assistant for Terms For Sale, a creative finance real estate marketplace. A buyer has submitted an inquiry about a specific deal.

Based on the inquiry details (request type, buying method, notes) and the deal information in the contact's custom fields, draft a personalized follow-up message.

Rules:
- Be warm, professional, and concise
- Reference the specific property and their stated interest
- If they requested a walkthrough, confirm availability and ask for preferred times
- If they asked about financing, provide a brief overview of the deal structure
- Always include a CTA (schedule a call, visit portal, or reply with questions)
- Never make promises about deal availability or terms
- Sign off as "The Terms For Sale Team"
```

### 9.4 Deal Description Writer

**Name:** Deal Copywriter
**Trigger:** Manual — when creating deal marketing content
**System prompt:**
```
You are a real estate copywriter for Terms For Sale. Write compelling, accurate deal descriptions for off-market properties.

Given property details (address, price, structure, beds/baths, sqft, highlights), create:
1. Three highlight bullets (max 80 chars each) — lead with the strongest value proposition
2. A 2-3 sentence deal summary for the listing page
3. A 160-char SMS alert message
4. A subject line for the deal alert email

Tone: Direct, confident, investor-focused. Use numbers prominently. Avoid hype words like "amazing" or "incredible." Focus on ROI, cash flow, equity, and terms.

Deal types to know:
- SubTo: Buyer takes over existing mortgage. Highlight rate, equity, PITI vs rent.
- Seller Finance: Seller carries the note. Highlight terms, down payment, cash flow.
- Cash: Wholesale or flip. Highlight spread (ARV - price), repair estimate, ROI.
- Hybrid: Combination of SubTo + Seller Finance. Highlight blended terms.
```

### 9.5 Objection Handler Agent

**Name:** Objection Handler
**Trigger:** Manual or conversation-based
**System prompt:**
```
You are a creative finance expert helping the Terms For Sale team respond to common buyer objections. Provide concise, honest responses.

Common objections and response frameworks:
- "The entry fee is too high" → Compare to traditional down payment, show cash-on-cash return
- "I'm worried about the due-on-sale clause" → Explain actual enforcement statistics, insurance options
- "The rate seems high for seller finance" → Compare to hard money rates, show total cost of capital
- "I don't understand subject-to" → Explain simply, reference the blog at termsforsale.com/blog
- "Is this deal still available?" → Check status, offer alternatives if sold
- "Can I negotiate the price?" → Explain offer process, encourage portal submission

Always be transparent about risks. Never guarantee returns. Direct complex legal questions to their attorney.
```

### 9.6 Follow-Up Sequence Agent

**Name:** Follow-Up Agent
**Trigger:** Scheduled — runs against contacts needing follow-up
**System prompt:**
```
You are a follow-up assistant for Terms For Sale. Your job is to draft personalized follow-up messages for buyers at different stages.

Stages:
1. New signup (no activity in 3 days) → Encourage portal login, mention active deal count
2. Viewed deals but no inquiry (5 days) → Highlight a matching deal, ask about criteria
3. Submitted inquiry but no offer (7 days) → Check if they have questions, offer to schedule a call
4. Submitted offer awaiting response (2 days) → Status update, set expectations
5. Portal access granted but never logged in (3 days) → Remind about portal, offer help

Keep messages under 300 characters for SMS. Be conversational, not salesy. Use their first name.
```

---

## 10. Notion Database Schema

**Database ID:** `a3c0a38fd9294d758dedabab2548ff29`

| Property | Type | Used In |
|----------|------|---------|
| Deal Type | Select | deals.js, notify-buyers.js |
| Deal Status | Status/Select | deals.js (filter: "Actively Marketing") |
| Street Address | Text | deals.js, notify-buyers.js |
| City | Text | deals.js, notify-buyers.js |
| State | Select | deals.js, notify-buyers.js |
| ZIP | Text | deals.js, notify-buyers.js |
| Nearest Metro / Nearest Metro Area | Text | deals.js, notify-buyers.js |
| Property Type | Select | deals.js, notify-buyers.js |
| Asking Price | Number | deals.js, notify-buyers.js |
| Entry Fee | Number | deals.js, notify-buyers.js |
| ARV / Comps ARV | Number | deals.js, notify-buyers.js |
| Loan Type | Select | deals.js |
| SubTo Loan Balance | Number | deals.js |
| SubTo Rate (%) | Number | deals.js |
| PITI | Number | deals.js |
| SubTo Loan Maturity | Text | deals.js |
| SubTo Balloon | Text | deals.js |
| SF Loan Amount | Number | deals.js |
| SF Rate | Text | deals.js |
| SF Term | Text | deals.js |
| SF Payment | Number | deals.js |
| SF Balloon | Text | deals.js |
| LTR Market Rent | Number | deals.js, notify-buyers.js |
| Occupancy | Select | deals.js |
| HOA | Text | deals.js |
| Solar | Text | deals.js |
| Beds | Number | deals.js, notify-buyers.js |
| Baths | Number | deals.js, notify-buyers.js |
| Living Area / Sqft | Number | deals.js, notify-buyers.js |
| Year Built / Year Build | Number | deals.js, notify-buyers.js |
| Access | Select | deals.js |
| COE | Date/Text | deals.js |
| Photos | URL (Drive folder) | deals.js |
| Cover photo / Cover Photo | URL | deals.js |
| Highlight 1 | Text | deals.js, notify-buyers.js |
| Highlight 2 | Text | deals.js, notify-buyers.js |
| Highlight 3 | Text | deals.js, notify-buyers.js |
| Details | Text | deals.js |
| Entry Breakdown | Text | deals.js |
| Parking | Text | deals.js |

---

## 11. Environment Variables

All configured in Netlify Dashboard → Site settings → Environment variables.

| Variable | Used By | Purpose |
|----------|---------|---------|
| `NOTION_TOKEN` | deals.js, notify-buyers.js | Notion API integration token |
| `NOTION_DB_ID` | deals.js, notify-buyers.js | Notion database ID (default: `a3c0a38fd9294d758dedabab2548ff29`) |
| `GHL_API_KEY` | notify-buyers.js, acquisition-assist.js, dispo-buddy-submit.js | GoHighLevel API key (v2) |
| `GHL_LOCATION_ID` | notify-buyers.js, acquisition-assist.js, dispo-buddy-submit.js | GHL sub-account ID |
| `GHL_PIPELINE_ID` | acquisition-assist.js | Acquisition Assist pipeline ID |
| `GHL_STAGE_NEW_SUBMISSION` | acquisition-assist.js | New Submission stage ID |
| `GOOGLE_API_KEY` | drive-image.js, drive-thumb.js, drive-photos.js, deals.js | Google Drive API |
| `GITHUB_TOKEN` | create-post.js | GitHub API for blog post creation |
| `GITHUB_REPO_OWNER` | create-post.js | GitHub repo owner (e.g., `brooke-wq`) |
| `GITHUB_REPO_NAME` | create-post.js | GitHub repo name (e.g., `termsforsale-site`) |
| `VA_PASSWORD` | create-post.js | Password for VA Post Builder tool |
| `DEAL_ALERTS_LIVE` | notify-buyers.js | Set to `"true"` to send live alerts (default: test mode) |

---

## 12. Third-Party Integrations

| Service | Purpose | Auth Method |
|---------|---------|-------------|
| **GoHighLevel** | CRM, contacts, pipelines, workflows, SMS, email | API key (v2), webhooks |
| **Notion** | Deal database (source of truth for active deals) | Integration token |
| **Google Drive** | Property photo storage (folders per deal) | API key |
| **Google Sheets** | Legacy deal list (`1WOB61XBR...`) — used by map, sitemap | Public gviz endpoint |
| **Google Analytics** | Website analytics (GA4: `G-DRV6NWNY06`) | Tag Manager |
| **GitHub** | Blog post storage + deployment trigger | Personal access token |
| **Netlify** | Hosting, serverless functions, identity, DNS | Native |
| **Decap CMS** | Blog/content admin interface | Netlify Identity + git-gateway |
| **ClientClub** | Buyer portal (GHL white-label) | Portal at `termsforsale.app.clientclub.net` |
| **OpenStreetMap Nominatim** | Geocoding for deal map markers | Free API (rate-limited) |
| **Leaflet.js** | Interactive map rendering | Client-side library |

---

## 13. Auth System

**Type:** Custom localStorage-based auth (not server-validated)

**localStorage keys:**
| Key | Purpose |
|-----|---------|
| `tfs_buyer` | User object: `{ name, email, phone, initials }` |
| `tfs_saved` | Array of saved deal IDs |
| `tfs_activity` | Activity log (max 20 entries) |
| `tfs_offers` | Submitted offers with status |

**sessionStorage keys:**
| Key | Purpose |
|-----|---------|
| `deal` | Cached deal object (passed from listing to detail page) |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | UTM tracking |
| `tfs_builder_pw` | VA Post Builder session password |

**Auth flow:**
1. User enters email + password in modal
2. Payload sent to GHL webhook (signup or login)
3. User object stored in `localStorage` under `tfs_buyer`
4. Nav updates: shows avatar, My Buy Box button, dropdown menu
5. Logged-in users see: full addresses, all photos, save/offer buttons
6. Logout clears `tfs_buyer` from localStorage and reloads page

**Portal auth:** Separate system managed by ClientClub (GHL). Users log in at `termsforsale.app.clientclub.net` with credentials created during signup.

---

## 14. Email Templates

### 14.1 Portal Access Granted

**File:** `emails/portal-access-granted.html`
**GHL merge fields:** `{{contact.first_name}}`, `{{contact.email}}`, `{{unsubscribe_link}}`
**CTA:** Orange button → `termsforsale.app.clientclub.net`
**Content:** Welcome message, portal login link, feature checklist, credentials reminder

### 14.2 Emails to Build in GHL

| Email | Trigger | Subject Line | Key Content |
|-------|---------|-------------|-------------|
| Welcome / Signup Confirmation | Signup webhook | Welcome to Terms For Sale, {{first_name}} | Portal link, what to expect, browse deals CTA |
| Deal Alert | `new-deal-alert` tag | New {{alert_deal_type}} Deal in {{alert_city}}, {{alert_state}} | Cover photo, price, entry fee, highlights, view deal CTA |
| Inquiry Confirmation | Inquiry webhook | We received your inquiry | Property reference, next steps, timeline |
| Offer Confirmation | Offer webhook | Your offer has been received | Offer amount, deal reference, review timeline |
| Acquisition Assist Confirmation | `acquisition-assist` tag | Deal received — we'll review it | Property address, deal type, next steps |
| Dispo Buddy Confirmation | `dispo-buddy` tag | JV deal submitted | Partner name, property, review timeline |
| Buy Box Saved | `buy box complete` tag | Your buy box is locked in | Criteria summary, matching deals CTA |
| Re-engagement (14 days) | Time trigger | {{first_name}}, we have {{X}} new deals | Deal count, featured deal, portal CTA |
| Portal Reminder (3 days) | Portal access + no login | Your portal is waiting | Login link, feature highlights |

---

## 15. SOPs — Standard Operating Procedures

### SOP 1: Publishing a New Deal

1. **Add deal to Notion** — Fill all required fields (Deal Type, Address, City, State, ZIP, Asking Price, Entry Fee, ARV, Rent, Beds, Baths, Sqft, Year Built, Highlights 1-3)
2. **Upload photos** — Create Google Drive folder, upload property photos, paste folder URL into Notion "Photos" field
3. **Set status** — Change Deal Status to "Actively Marketing"
4. **Verify on site** — Visit `termsforsale.com` and confirm deal appears (may take ~60s for cache)
5. **Verify deal page** — Click into deal, confirm photos load, terms display correctly
6. **Buyer alerts fire automatically** — notify-buyers.js runs every 30 min, matches deal to buyers, triggers `new-deal-alert` tag
7. **Optional: Manual test** — Hit `/api/notify-test?deal_id={NOTION_PAGE_ID}` to test matching without sending live alerts (unless `DEAL_ALERTS_LIVE=true`)
8. **Optional: Blog post** — Use VA Post Builder or Decap CMS to create a blog post for SEO

### SOP 2: Processing an Inquiry

1. **GHL notification arrives** — Email/SMS internal alert with buyer name, deal ID, request type
2. **Review contact in GHL** — Check buyer's profile, buy box, previous activity
3. **Respond within 24 hours:**
   - Walkthrough request → Confirm access details, schedule time
   - Financing info → Send deal deck or term sheet
   - General inquiry → Answer questions, offer to schedule call
4. **Update opportunity stage** in GHL pipeline
5. **Log notes** on GHL contact record

### SOP 3: Processing an Offer

1. **GHL high-priority notification** — Offer amount, buyer info, deal reference
2. **Review offer details** — Check offer amount vs. asking, buyer qualifications, timeline
3. **Respond within 24 hours:**
   - Accept → Send acceptance confirmation, begin closing process
   - Counter → Send counter with reasoning
   - Decline → Politely decline, suggest alternative deals
4. **Update deal status** in Notion if under contract
5. **Notify other interested buyers** if deal goes under contract

### SOP 4: Adding a JV Deal (Dispo Buddy)

1. Wholesaler/JV partner submits via `dispo-submit.html`
2. Submission creates GHL contact + opportunity in "3. JV Deals" pipeline
3. Review deal details — check comps, structure viability, photos
4. If approved:
   - Add to Notion database
   - Upload photos to Drive
   - Set status to "Actively Marketing"
   - SOP 1 takes over
5. If declined:
   - Contact JV partner with feedback
   - Move opportunity to "Passed" stage

### SOP 5: VA Blog Post Creation

1. Log into VA Post Builder at `/va-post-builder.html`
2. Enter session password
3. Fill in all 4 steps:
   - Step 1: Deal info + SEO copy (headline, hook, meta description)
   - Step 2: Financial details (price, entry, ARV, rent, etc.)
   - Step 3: Deal narrative (why it exists, strategies, buyer fit)
   - Step 4: Review and publish
4. Post is created on GitHub → auto-deploys to Netlify
5. Verify post at `termsforsale.com/blog/posts/{slug}.html`
6. Share link on social media / email

### SOP 6: Granting Portal Access

1. Verify buyer has completed signup (has `TFS Buyer` tag in GHL)
2. In GHL ClientClub settings, grant portal access to contact
3. Add tag `portal-access-granted` (triggers workflow)
4. Workflow sends Portal Access Granted email (template in `emails/portal-access-granted.html`)
5. Follow-up SMS sent automatically
6. If buyer hasn't logged in after 3 days, reminder fires

### SOP 7: Updating Buyer Criteria / Buy Box

1. Buyer updates their buy box at `/buy-box.html`
2. Data saves to localStorage AND fires to GHL webhook
3. GHL custom fields update (deal_structure, exits, target_zips, price limits, etc.)
4. Next time notify-buyers.js runs, buyer's updated criteria are used for matching
5. No manual intervention needed — fully automated

---

## 16. Change Log

| Commit | Description |
|--------|-------------|
| `e6f8277` | Fix drive-image with fallback chain, fix sqft parsing |
| `630e4ac` | Widen deal page: 900→980px for less cluttered content |
| `6cf06c8` | New `/api/drive-image` endpoint for email-safe property photos |
| `cdfce73` | Tighten deal page: 900px max, 240px photo grid, 5:2 ratio |
| `8e4919a` | Fix email fields: add labels to numbers, fix cover photo for email clients |
| `87f38d3` | Rebuild calculators: add Co-Living/PadSplit, no assumed values |
| `e9af65b` | Rebuild photo grid Zillow-style with fixed 280px height |
| `86b76bc` | Fix GHL field update format: use 'value' not 'field_value' |
| `12559d3` | Tighten deal page layout and fix photo grid ratio |
| `ca474c2` | Add Alert Cover Photo field for email template images |
| `9879ec2` | Tighten deal page layout — reduce max-width and padding |
| `8412da3` | Wire all deal fields to GHL alert custom fields for email template |
| `d32f3c3` | Use existing GHL custom fields for deal alert data |
| `763d38e` | Add tiered fallback when fewer than 50 buyers match |
| `c692291` | Strict buy box matching: Contact Role=Buyer, min 2 criteria required |
| `55e16e4` | Rebuild buyer matching to use GHL custom field buy box data |
| `7913f7f` | Add automated deal-to-buyer matching and alert system |
| `0dacf08` | Add exit strategy calculators to Analysis tab |
| `2d7e163` | Fix urgency badge overlap, dynamic deal count, reduce photo grid |
| `b90a583` | Fix similar deals stale data, fix email-protected in footer |
| `7f36efa` | Auto-populate cover photo from first image in Drive folder |
| `18906e7` | Fix Notion property name mappings — match exact DB schema |
| `1d478fb` | Fix broken ternary in urgency badge that crashed deal page |
| `b80c2dc` | Add urgency badges, mobile CTA, retargeting pixels, GA4 on deal page |
| `458d092` | Fix home page deal card photos via Drive thumb API |
| `9cbd60c` | Add SEO meta tags, JSON-LD structured data, urgency badges |
| `4c55096` | Add direct Notion integration — bypass Zapier/Google Sheets sync |
| `bdc56ac` | Fix profile dropdown hover gap on blog page |
| `b7a8171` | Fix similar deals: only active, working scroll, better photos |
| `249cb13` | Fix HOA tag showing $NaN/mo for non-numeric values |
| `f87ed6e` | Move blog to top, enhance home page marketing |
| `3065d26` | Switch auth to email+password, add GHL Buyer Portal access |
| `854cc02` | Fix broken links, add legal pages, 404, submit button reset |
| `fe1a5f7` | Remove entry breakdown, add working Google Maps embed |
| `2b2ec91` | Remove Schedule a Call section from deal sidebar |
| `c464fe5` | Fix similar deals photos, remove broken refinance link |
| `260ad83` | Add Zillow-style photo gallery with Drive integration and lightbox |
| `6577450` | Switch font to DM Sans, fix HOA formatting, remove deal ID |
| `dd77a40` | Make deal page auth-aware: fix sidebar, photos, address display |
| `1cb0008` | Fix deal filters, restore SHEET_ID, add sticky nav bar |
| `1c2c047` | Add blog post listing to blog index page |
| `d1d995f` | Fix profile dropdown disappearing before click |
| `00c4cb6` | Add auth system to deal.html (login/signup modal, nav, photo unlock) |
| `b69daf0` | Add init() call and fix truncated end of deal.html |
| `f935eac` | Clear SHEET_ID to use sample deals |
| `0981e39` | Refactor payload and tag construction in deal.html |
| `ebcca90` | Update script section in deal.html |
| `c80b05d` | Update SHEET_ID with new Google Sheets ID |
| `5e23b00` | Initial file upload |
| `7ec929f` | Initial file upload |

---

## Appendix A: Deal Structure Matching Map

Used by `notify-buyers.js` to match deal types to buyer preferences:

| Deal Type (Notion) | Matches Buyer Preferences |
|---|---|
| Cash | Cash |
| SubTo | Subject To, Sub-To, SubTo |
| Seller Finance | Seller Finance, Seller Financing, Owner Finance |
| Hybrid | Hybrid, Subject To, Seller Finance |
| Wrap | Wrap, Wrap Around |
| Morby Method | Morby Method, Subject To |
| Lease Option | Lease Option |
| Novation | Novation |

## Appendix B: HUD FMR States Covered

Arizona, Texas, Florida, Georgia, Tennessee, Kentucky, Ohio, Indiana, North Carolina, Alabama, Mississippi, South Carolina, Michigan, California

## Appendix C: Google Sheets Reference

**Sheet ID:** `1WOB61XBRGlypbtYZYogSRo1sVS3XUagppsTitTwyJsg`
**Used by:** map.html, sitemap.js, dashboard.html (legacy)
**Note:** Primary deal source has been migrated to Notion. Google Sheets is still used as a fallback and by the map page.

## Appendix D: Branding

| Element | Value |
|---------|-------|
| **Font** | Poppins (Google Fonts, weights 300–900) |
| **Navy** | `#0D1F3C` (primary) |
| **Navy Card** | `#043e5c` |
| **Blue** | `#29ABE2` (accent) |
| **Blue Dark** | `#1a8bbf` |
| **Blue Light** | `#EBF8FF` |
| **Orange** | `#F7941D` (CTAs) |
| **Orange Dark** | `#d97c0e` |
| **Teal** | `#7296aa` (labels) |
| **Background** | `#F4F6F9` |
| **Logo SVG** | `https://assets.cdn.filesafe.space/7IyUgu1zpi38MDYpSDTs/media/697a3aee1fd827ffd863448d.svg` |
| **OG Image** | `https://termsforsale.com/og-default.png` |
| **GA4 ID** | `G-DRV6NWNY06` |
| **Company** | Deal Pros LLC |
| **Email** | info@termsforsale.com |
| **Phone** | (480) 637-3117 |
