# Auto-Enrichment Workflow — Setup Guide

Automatically enriches deals in the "Intake" status in Notion with RentCast market data, HUD FMR rents, and a Claude Haiku narrative. Runs every 5 minutes via n8n Cloud.

---

## What It Does

1. n8n polls Notion every 5 min for deals with `Deal Status = Intake`.
2. For each deal, POSTs the Notion page ID to `/api/auto-enrich` on the Terms For Sale Netlify site.
3. The function enriches the deal with:
   - RentCast property record (beds/baths/sqft/year built)
   - RentCast AVM value + comparables
   - RentCast AVM long-term rent estimate
   - HUD Fair Market Rents for the market
4. Claude Haiku generates a 6-key narrative JSON (hook, whyExists, strategies, buyerFitYes, redFlags, confidence).
5. Notion is patched back with: `LTR Market Rent`, `Enriched At`, and optionally `ARV`, `Beds`, `Baths`, `Living Area`, `Year Built`, `Deal Narrative` (if the property exists on the DB).
6. Paperclip render service produces a `.docx` in the `/Deal Analyses/` Google Drive folder.
7. Brooke receives a GHL note + SMS + email summary.

---

## Prerequisites

### Netlify Environment Variables (Terms For Sale site)

Set these in the Netlify dashboard under Site configuration → Environment variables:

| Variable | How to get it |
|---|---|
| `AUTOENRICH_AUTH_TOKEN` | `openssl rand -hex 32` — generate once, store it |
| `RENTCAST_API_KEY` | Copy from RentCast dashboard (same key used for Dispo Buddy) |
| `RENDER_SERVICE_URL` | `http://64.23.204.220:3001/render` |
| `RENDER_SERVICE_TOKEN` | From `/home/brooke/pdf-render-service/.env` → `AUTH_TOKEN` value on paperclip |

`NOTION_TOKEN`, `GHL_API_KEY`, `CLAUDE_API_KEY` (or `ANTHROPIC_API_KEY`) are already set from prior sessions.

### n8n Cloud Variables

In n8n Cloud → Settings → Variables, create:

| Variable | Value |
|---|---|
| `NOTION_TOKEN` | Your Notion integration secret (same as Netlify `NOTION_TOKEN`) |
| `AUTOENRICH_AUTH_TOKEN` | Same value as the Netlify env var above |

---

## Notion Schema Requirements

The following properties must exist on the deals database (`a3c0a38fd9294d758dedabab2548ff29`):

| Property | Type | Notes |
|---|---|---|
| `Deal Status` | Status | Must include `Intake` as an option |
| `Deal ID` | Rich Text or Title | e.g. `PHX-001` |
| `Street Address` | Rich Text | Full street address |
| `City` | Rich Text | |
| `State` | Rich Text | 2-letter code |
| `ZIP` | Rich Text | |
| `Asking Price` | Number | |
| `ARV` | Number | Filled in if blank |
| `Beds` | Number | Filled in if blank |
| `Baths` | Number | Filled in if blank |
| `Living Area` | Number | sqft — filled in if blank |
| `Year Built` | Number | Filled in if blank |
| `LTR Market Rent` | Number | Written by enrichment |
| `Enriched At` | Date | Written by enrichment |
| `Deal Narrative` | Rich Text | Written speculatively — dropped silently if absent |

`Entry Fee`, `Loan Balance`, `Interest Rate`, `PITI` are read but not written back (they're included in the render doc).

---

## Import the Workflow into n8n Cloud

1. In n8n Cloud, go to **Workflows** → **Import**.
2. Paste the contents of `auto-enrichment.workflow.json` or upload the file.
3. The workflow imports as inactive.
4. Set the two n8n Variables (`NOTION_TOKEN`, `AUTOENRICH_AUTH_TOKEN`) if not already done.
5. Click **Activate** to turn it on.

The workflow polls on a 5-minute schedule and processes all Intake deals it finds each run. Deals already processed will still be re-enriched until you change their status out of Intake — so move enriched deals to the next status (e.g. `Actively Marketing` or `Ready to Market`) once reviewed.

---

## Manual Test (curl)

```bash
export AUTOENRICH_AUTH_TOKEN="your-token-here"
export NOTION_PAGE_ID="your-notion-page-id-here"

curl -sS -X POST https://termsforsale.com/api/auto-enrich \
  -H "Authorization: Bearer $AUTOENRICH_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"pageId\":\"$NOTION_PAGE_ID\"}" | jq .
```

Add `"dryRun": true` to the body to skip all writes (Notion patch, Drive render, GHL note/SMS/email) and just see what the enrichment would produce:

```bash
curl -sS -X POST https://termsforsale.com/api/auto-enrich \
  -H "Authorization: Bearer $AUTOENRICH_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"pageId\":\"$NOTION_PAGE_ID\", \"dryRun\": true}" | jq .
```

---

## Monitoring

- **Netlify function logs**: Netlify dashboard → Functions → `auto-enrich` → Logs. Every run logs each enrichment step and any failures.
- **GHL note on Brooke's contact** (`qO4YuZHrhGTTBaFKPDYD`): a note is posted after every successful enrichment with AVM, rent, narrative confidence, and Drive link.
- **n8n execution log**: n8n Cloud → Executions shows every workflow run with per-node output.

---

## Cost Per Deal

- **RentCast**: 3 API calls per deal (property record + AVM value + AVM rent). Counts against monthly quota.
- **Claude Haiku**: ~1200 input tokens + ~400 output tokens ≈ **$0.003/deal**.
- **Paperclip render**: compute only, no additional cost.

At 20 deals/month: ~$0.06 Claude + RentCast quota cost. Well within budget.
