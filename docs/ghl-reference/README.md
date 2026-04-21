# GoHighLevel Reference — Deal Pros

Complete inventory of every GHL contact custom field, opportunity field, and tag
used across the two public brands. Generated from a full code audit on
**April 21, 2026**.

## Folder structure

```
docs/ghl-reference/
├── README.md                 (this file)
├── tfs/
│   ├── fields.csv           (45 contact custom fields)
│   ├── tags.csv             (65+ tags by category)
│   └── opportunities.csv     (2 pipelines: Buyer Inquiries + Commercial)
└── dispobuddy/
    ├── fields.csv           (37 partner submission fields)
    ├── tags.csv             (16 deal type + relationship tags)
    └── opportunities.csv     (JV Deals pipeline with 9 stages)
```

All CSVs open cleanly in Excel, Google Sheets, or Airtable for easy reference
and team sharing.

## Quick map — where each brand lives

| Brand | Public site | GHL Location ID | Netlify functions |
|---|---|---|---|
| Terms For Sale | termsforsale.com | `7IyUgu1zpi38MDYpSDTs` | `termsforsale/netlify/functions/*.js` |
| Dispo Buddy | dispobuddy.com | `7IyUgu1zpi38MDYpSDTs` (shared sub-account) | `dispobuddy/netlify/functions/*.js` |

Both brands live in the same GHL sub-account — tags and fields from one brand
are visible to the other. The `dispo-buddy` / `jv-partner` tags segment Dispo
Buddy contacts from TFS buyers so the two audiences don't cross-contaminate in
campaigns.

## Critical gates to remember

1. **`opt in` tag** is REQUIRED before any outbound buyer SMS/email on TFS.
   Helper `hasOptInTag()` in `termsforsale/netlify/functions/_ghl.js:44` is
   checked by every campaign send.
2. **`Contact Role = ['Buyer']`** custom field (ID `agG4HMPB5wzsZXiRxfmR`) is
   REQUIRED on TFS contacts for `notify-buyers.js` to see them. Missing =
   invisible to every deal blast.
3. **`NOTIFICATIONS_LIVE=true`** env var is REQUIRED on Dispo Buddy to send
   any SMS/email. Default OFF. CRM writes still work.
4. **Campaign sender identity**: SMS from `+1 480-637-3117`, email from
   `Terms For Sale <info@termsforsale.com>`. Never use a personal sender.

## Verifying anything in these docs

Every field/tag entry includes file paths and, where possible, line numbers
(e.g. `auth-signup.js:93`). Open the file, confirm the line, done.
