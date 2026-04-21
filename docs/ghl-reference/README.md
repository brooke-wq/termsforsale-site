# GoHighLevel Reference — Deal Pros

Complete inventory of every GHL contact custom field, opportunity field, and tag
used across the two public brands. Generated from a full code audit on
**April 21, 2026**, cross-referenced and merged with the 2026-04-20 GHL tag cleanup audit.

## Folder structure

```
docs/ghl-reference/
├── README.md                 (this file)
├── tfs/
│   ├── tfs-fields.csv       (65+ contact custom fields, categorized)
│   ├── tfs-tags.csv         (70+ tags including RETIRED markers)
│   └── tfs-opportunities.csv (2 pipelines: Buyer Inquiries + Commercial)
└── dispobuddy/
    ├── dispobuddy-fields.csv (37 partner submission fields)
    ├── dispobuddy-tags.csv   (16 deal type + relationship tags)
    └── dispobuddy-opportunities.csv (JV Deals pipeline with 9 stages)
```

All CSVs open cleanly in Excel, Google Sheets, or Airtable for easy reference
and team sharing.

## TFS Fields — Category breakdown

The `tfs-fields.csv` is organized by these categories (column 1):

| Category | Purpose |
|---|---|
| **Buyer Profile (Match Engine Core)** | Hardcoded IDs in `_ghl.js` `CF_IDS`. Hot path — read by `notify-buyers.js` for every match (12 fields) |
| **Buyer Profile (Extended Criteria)** | fieldKey-resolved at runtime (no hardcoded ID). Written by `buy-box-save.js` form (16 fields) |
| **PHANTOM (do not use)** | fieldKeys the form used to write that DON'T EXIST in GHL (fixed PR #97) (2 fields) |
| **Lifecycle Timestamps** | Workflow-written dates (WF02/WF03/WF04) (4 fields) |
| **Deal Alert Fields** | Written by `notify-buyers.js` on each alert — GHL email templates read these (16 fields) |
| **DEPRECATED (pending deletion)** | Legacy n8n "(latest)" fields pending deletion (5 fields) |
| **Transaction Fields (post-close)** | Post-close buyer data (EMD, offer price, etc.) (6 fields) |
| **Total Deals Closed** | Two intentional duplicates — separate for buyers vs JV partners |
| **System/Auth** | Password hash + reset code (2 fields) |

## Production stats (as of 2026-04-20 audit)

- **193** total custom fields in GHL sub-account `7IyUgu1zpi38MDYpSDTs`
- **17,377** total contacts
- **9,084** contacts tagged `opt in`
- **10,370** contacts tagged `tfs buyer`
- **8,964** addressable buyers (have both `opt in` AND `tfs buyer`)

## Quick map — where each brand lives

| Brand | Public site | GHL Location ID | Netlify functions |
|---|---|---|---|
| Terms For Sale | termsforsale.com | `7IyUgu1zpi38MDYpSDTs` | `termsforsale/netlify/functions/*.js` |
| Dispo Buddy | dispobuddy.com | `7IyUgu1zpi38MDYpSDTs` (shared sub-account) | `dispobuddy/netlify/functions/*.js` |

Both brands live in the same GHL sub-account — tags and fields from one brand
are visible to the other. The `dispo-buddy` / `jv-partner` tags segment Dispo
Buddy contacts from TFS buyers so the two audiences don't cross-contaminate in
campaigns.

## Match engine gate — what decides if a buyer receives an alert

Per `fetchAllBuyers` in `notify-buyers.js`, a buyer must pass ALL of these:

1. **Contact Role custom field = 'Buyer'** (id `agG4HMPB5wzsZXiRxfmR`, fieldKey `contact.buyer_type`)
2. **Has `opt in` tag** (case-insensitive)
3. **Does NOT have `alerts-paused` tag**
4. **Does NOT have any `opt-out:*` or `unsubscribe*` tag** (PR #95 compliance)
5. **Does NOT have `contact.dnd = true`** (PR #95)
6. **Buy-box matches the deal** (asset class, market, price, HOA, structure, property type)

## Critical gates to remember

1. **`opt in` tag** is REQUIRED before any outbound buyer SMS/email on TFS.
   Helper `hasOptInTag()` in `termsforsale/netlify/functions/_ghl.js:44` is
   checked by every campaign send.
2. **`Contact Role = ['Buyer']`** custom field (ID `agG4HMPB5wzsZXiRxfmR`, fieldKey
   `contact.buyer_type`) is REQUIRED on TFS contacts for `notify-buyers.js` to
   see them. Missing = invisible to every deal blast.
3. **`opt-out:*` / `unsubscribe*` tags + `dnd=true`** — PR #95 compliance gates.
   Any match = buyer silently excluded from alert flow.
4. **`NOTIFICATIONS_LIVE=true`** env var is REQUIRED on Dispo Buddy to send
   any SMS/email. Default OFF. CRM writes still work.
5. **Campaign sender identity**: SMS from `+1 480-637-3117`, email from
   `Terms For Sale <info@termsforsale.com>`. Never use a personal sender.

## Retired tags (2026-04-20 cleanup)

6 tags were removed from all contacts and await pool-level deletion in GHL UI.
See rows marked `RETIRED 2026-04-20` in `tfs-tags.csv`.

## Verifying anything in these docs

Every field/tag entry includes file paths and, where possible, line numbers
(e.g. `auth-signup.js:98`). Open the file, confirm the line, done.

Fields marked `(verify)` in the fieldKey column need confirmation via GHL's
`/locations/{id}/customFields` API — the ID is correct but the exact fieldKey
wasn't captured in code reads.
