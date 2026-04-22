# Pitch Deck Token Map — Phase 1

Maps every `{{TOKEN}}` in `tfs-build/pitch-deck-template.html` to its Notion
source field (or computed value). The Netlify function `/api/generate-pitch-deck`
reads this mapping to substitute real deal data into the template.

**Phase 1 scope:** 34 tokens covering cover, property specs, photos, top-line
stats, location header, and contact section. Exit strategies, comps, rent
comps, loan details, rehab, and risks remain as Juniper Creek example content
until Phase 2.

## Direct Notion fields (no computation)

| Token | Notion property | Notes / example |
|---|---|---|
| `{{DEAL_ADDRESS}}` | `Street Address` | e.g. `4218 S Juniper Creek Dr.` |
| `{{DEAL_ADDRESS_PLAIN}}` | `Street Address` | Same value as above, different slide context |
| `{{CITY_STATE_ZIP}}` | `City`, `State`, `ZIP` | Formatted `"{city}, {state} {zip}"` |
| `{{SUBMARKET_NAME}}` | `Nearest Metro Area` OR `City` + `ZIP` | Fallback: `"{City} · {ZIP}"` |
| `{{DEAL_ID}}` | `Deal ID` | Formatted `"TFS — {dealCode}"` (uses em-dash and non-breaking spaces) |
| `{{DEAL_ID_SHORT}}` | `Deal ID` | Raw e.g. `TFS-1042` (used in every slide header) |
| `{{DEAL_URL}}` | computed | `termsforsale.com/deals/{dealCode}` |
| `{{PROPERTY_TYPE}}` | `Property Type` | e.g. `Single Family` |
| `{{PROPERTY_TYPE_BEDS_BATHS}}` | `Property Type` + `Beds` + `Baths` | `"{propType} · {beds}/{baths}"` |
| `{{BEDROOMS}}` | `Beds` | Integer |
| `{{BATHROOMS}}` | `Baths` | May be decimal (e.g. `2.5`) |
| `{{LIVING_SQFT}}` | `Living Area` | Comma-formatted number |
| `{{LOT_SQFT}}` | `Lot Size` | Comma-formatted number |
| `{{YEAR_BUILT}}` | `Year Built` | 4-digit year |
| `{{YEAR_BUILT_2}}` | `Year Built` | Same value, appears on both slide 3 + slide 4 |
| `{{GARAGE}}` | `Garage` / `Parking` | e.g. `2-car` — use non-breaking hyphen `&#8209;` |
| `{{OCCUPANCY}}` | `Occupancy` | e.g. `Vacant`, `Tenant-occupied` |
| `{{CONDITION}}` | `Condition` or `Highlight 1` | e.g. `Turn-Key` — Notion may not have a dedicated field; can derive from Deal Type or fall back to `"—"` |
| `{{DEAL_STRUCTURE}}` | `Deal Type` | e.g. `Subject-To + Seller Finance`, `Cash`, `Hybrid` |
| `{{VIABLE_EXITS}}` | static for Phase 1 | `"7 Viable Exits"` (fixed until per-deal exit-scope AI runs in Phase 2) |
| `{{PREPARED_FOR}}` | static for Phase 1 | `"Private Buyer List"` |
| `{{MEMO_DATE}}` | computed | Current date, formatted `"Month DD, YYYY"` |
| `{{COORDINATOR_NAME}}` | static | `"Brooke Froehlich"` (or env var override) |
| `{{COORDINATOR_TITLE}}` | static | `"Senior Acquisitions · Terms For Sale"` |
| `{{COORDINATOR_EMAIL}}` | static | `"deals@termsforsale.com"` (matches CAMPAIGN_FROM_EMAIL) |
| `{{COORDINATOR_PHONE}}` | static | `"(480) 637-3117"` (matches CAMPAIGN_FROM_PHONE) |
| `{{ACTIVE_DEAL_COUNT}}` | computed | Count of active deals from Notion (status = Actively Marketing) |

## Computed / formatted values

| Token | Computation | Notes |
|---|---|---|
| `{{PURCHASE_PRICE}}` | `Asking Price` | Format `"${num}"` with commas |
| `{{EXISTING_RATE}}` | `SubTo Rate (%)` | Format `"{rate}%"` (e.g. `2.875%`) |
| `{{PITI}}` | `PITI` | Format `"${num}"` with commas |
| `{{CASH_TO_CLOSE_SHORT}}` | `Entry Fee` | Short-form: `"$42K"` — round to nearest thousand + append `K` |
| `{{DAY1_EQUITY_SHORT}}` | computed | `(ARV − Asking Price)` → short-form `"$78K"` |

## AI-generated / narrative (Phase 1 fills with empty or minimal defaults)

| Token | Current fallback | Phase |
|---|---|---|
| `{{EXEC_HEADLINE}}` | Static copy pending AI: `"Assumable {rate} loan, in-place cashflow, multiple viable exits."` | Phase 2 |
| `{{LOCATION_NARRATIVE}}` | Static per-city lookup or `"—"` | Phase 2 (city-level narrative from AI) |

## Not yet tokenized (still Juniper Creek example)

These sections remain as example content for Phase 1. Buyers will see them as
a worked sample memo with the Juniper numbers. They will be tokenized in
Phase 2 when the AI-computed underwriting layer comes online:

- Executive Summary 3-column narrative (Below-Market Debt, In-Place Cashflow, Stress-Tested Exits)
- Executive Summary bottom stat strip (18.4% CoC, $2,140 CF, $78K equity, 7-21d)
- Sales Comps table (3 comps + ARV line)
- Rent Comps table (4 rent comps + STR pro forma)
- Deal Structure 3-layer cards (SubTo $309K, Seller 2nd $36K, Buyer Cash $42K)
- Existing Loan detail (Rocket Mortgage / $309,140 balance / 2.875% / etc.)
- Sources & Uses tables + pie chart
- Rehab budget line items
- All 7 Exit Strategy slides (Fix & Flip through ADU)
- Strategy Comparison table
- Returns Summary 4-tile grid (93.4% CoC, $2,140 CF, $38.8K NOI, $78K equity)
- Risks & Assumptions 6-tile grid
- Next Steps 4-step timeline (hard-coded: offer accepted / diligence / docs / close)

## Notes on the design

1. **Non-breaking hyphens (`&#8209;`)** — the template uses `&#8209;` liberally
   to prevent compound phrases like "Turn-Key", "Subject-To", "2-car" from
   breaking across lines. When substituting values that contain hyphens,
   consider replacing with `&#8209;` for visual consistency.

2. **Currency short-form** — `$42K` and `$78K` are "display-rounded" to the
   nearest thousand with a `K` suffix. The compute function should round like:
   ```js
   function shortMoney(n) {
     if (n == null || !isFinite(n)) return '—';
     if (Math.abs(n) >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`;
     if (Math.abs(n) >= 1_000)     return `$${Math.round(n/1_000)}K`;
     return `$${Math.round(n)}`;
   }
   ```

3. **PITI vs. CASH_TO_CLOSE_SHORT vs. PURCHASE_PRICE** — these are three
   different currency formats in the template:
   - `{{PURCHASE_PRICE}}` uses full comma formatting: `$387,000`
   - `{{PITI}}` uses full comma formatting: `$1,890`
   - `{{CASH_TO_CLOSE_SHORT}}` uses K-short form: `$42K`
   - `{{DAY1_EQUITY_SHORT}}` uses K-short form: `$78K`

4. **Missing data** — if a Notion field is blank, substitute em-dash (`—`) so
   the slide still renders cleanly. Don't leave the `{{TOKEN}}` in place.

5. **Regenerating the template** — if Brooke reworks the source HTML on her
   Mac and re-pushes, run `node scripts/tokenize-pitch-deck.js` on the new
   file. The script is idempotent: strings already replaced are skipped,
   and any strings that no longer match trigger a `[WARN]` log but don't
   crash. Add new entries to the `REPLACEMENTS` array in the script as new
   hard-coded values are identified.
