# Per-county scrapers

Each file in this directory implements assessor/recorder scraping for one county.
Filename format: `<state-lower>-<county-lower-with-underscores>.js`

Examples:
- `az-maricopa.js`
- `tx-harris.js`
- `tx-dallas.js`
- `fl-hillsborough.js`
- `ga-fulton.js`

## Module contract

```js
module.exports = {
  // Returns the canonical enrichment object, or null if not findable.
  async fetch({ address, city, zip, config }) {
    // 1. Search the assessor by address
    // 2. Open the parcel detail page
    // 3. Parse:
    //    - parcel_number
    //    - owner_name (full name as recorded)
    //    - owner_mailing_address (full single-line)
    //    - owner_state (best-effort 2-letter, used to detect out-of-state)
    //    - last_sale_date (YYYY-MM-DD)
    //    - last_sale_price (number, USD)
    //    - current_assessed_value (number)
    //    - mortgage_count (integer; 0 = free-and-clear)
    //    - has_active_mortgage (boolean)
    //    - lender_name (string)
    //    - mortgage_origination_date (YYYY-MM-DD)
    //    - mortgage_estimated_balance (number; estimate via standard 30yr amort)
    //    - raw_county_json (full parsed source data for audit)
    return { ... };
  }
};
```

## TODO

Tier 1 counties to ship working modules for (next session):
- `az-maricopa.js` — html_form
- `tx-harris.js` — html_search (HCAD has CAPTCHA fallback risk)
- `tx-dallas.js` — html_search
- `fl-hillsborough.js` — html_search
- `ga-fulton.js` — html_search (qPublic / Schneider Corp)

Each one is its own ~150-200 line module. Plan ~1 hour per county for
the first pass + smoke test against 5 known parcels.

## Mortgage balance estimation

Helper lives in `../lib/equity-calc.js`. Given `(origination_date,
origination_amount, term_years, rate)`, computes the current outstanding
balance via standard amortization. If rate is not in the recording,
default to the median 30-year fixed for the origination month (lookup
table in `../lib/historical-rates.js` — to be built).
