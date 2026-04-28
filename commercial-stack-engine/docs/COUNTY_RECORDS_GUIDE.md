# County Records Guide

How the enrichment pipeline pulls parcel + owner + sale + mortgage
data from county assessor and recorder websites — for free.

---

## The strategy

Commercial property data comes in two tiers:

1. **Paid providers** (DataTree, PropMix, Reonomy, REIPro): $0.10-$2.00/lookup,
   covers 95%+ of US counties uniformly. Out of budget at our $50/mo ceiling.
2. **Free direct-to-county scraping**: $0/lookup, covers the counties we
   bother to wire up. Each county is its own assessor website, each with
   its own search form / JSON API / quirks.

We pick option 2 and accept that we cover a subset of counties. The
top 25 counties cover ~60% of national MF inventory — that's our
ceiling for v1.

---

## How the dispatcher works

`scraper-service/lib/county-records-mapper.js` is the dispatcher.
Given `(state, county)` it:

1. Looks up the row in `county_configs` (loaded from
   `lib/county-configs.js` via `seed-counties.js`)
2. If `is_active=false` or `scrape_strategy='manual'` → returns `null`
   (caller marks listing `enrichment_skipped=true`)
3. If a per-county scraper module exists at
   `county-scrapers/<state>-<county>.js` → calls its `fetch()` method
4. Otherwise dispatches generically based on `scrape_strategy`
   (`json_api`, `html_form`, `html_search`)

Per-county modules ALWAYS take precedence over the generic dispatcher.
For Tier 1 counties, build per-county modules. The generic dispatcher
is a safety net for counties where the assessor URL pattern is
already in `county-configs.js` but no custom logic is needed yet.

---

## Per-county module contract

Each `county-scrapers/<state>-<county>.js` file exports:

```js
module.exports = {
  /**
   * @param {Object} arg
   * @param {string} arg.address  - e.g. '123 Main St'
   * @param {string} arg.city
   * @param {string} arg.zip
   * @param {Object} arg.config   - the county_configs row
   * @returns {Promise<Object|null>}  - canonical enrichment object, or null
   */
  async fetch({ address, city, zip, config }) {
    // 1. Search the assessor by address
    // 2. Open the parcel detail page
    // 3. Parse + return the canonical fields below
  }
};
```

The canonical return object:

```js
{
  parcel_number: 'string',
  owner_name: 'string',
  owner_mailing_address: 'single-line string',
  owner_state: 'XX' (2-letter, best-effort),
  is_llc: boolean,
  llc_status: 'active' | 'dissolved' | 'delinquent' | 'unknown',
  last_sale_date: 'YYYY-MM-DD',
  last_sale_price: number,
  current_assessed_value: number,
  // ↓ from recorder (deeds + mortgages), often a separate page:
  mortgage_count: number,
  has_active_mortgage: boolean,
  lender_name: 'string',
  mortgage_origination_date: 'YYYY-MM-DD',
  mortgage_estimated_balance: number,  // computed via lib/equity-calc
  // ↓ optional, from city/county code enforcement:
  code_violations_count: number,
  tax_delinquent: boolean,
  // ↓ raw source for audit/replay:
  raw_county_json: { /* whatever you parsed */ }
}
```

If the address can't be matched, return `null`. If you find the parcel
but some fields aren't available, return what you have and leave the
rest as `null`.

---

## Tier 1 priority counties

Build these in this order. Each one takes 1-2 hours for a careful
implementation + 5-parcel smoke test.

### 1. Maricopa, AZ — Phoenix metro (~4.5%)

- Assessor: https://mcassessor.maricopa.gov/
- Search URL: https://mcassessor.maricopa.gov/mcs/?q=<address>
- Type: HTML form, GET request with `q` param
- Free, no rate limit observed up to ~10 req/min
- Recorder: https://recorder.maricopa.gov/recdocdata/ (separate site
  for deeds + mortgages — must do a second lookup by parcel number)
- Notes: HTML structure is reasonably stable. Owner mailing address
  on parcel detail page in `.owner-mailing` div.

### 2. Harris, TX — Houston metro (~3.8%)

- HCAD: https://hcad.org/quick-search/
- Type: HTML search, multi-step (search → results → detail)
- HCAD has CAPTCHA fallback for high-volume IPs. Throttle to 1 req
  per 8 seconds.
- Owner data on the iSettlement page; sale history on a separate
  "Property Profile" page.

### 3. Dallas, TX — Dallas metro (~3.2%)

- DCAD: https://www.dallascad.org/SearchAddr.aspx
- ASP.NET form post (need to handle viewstate). Selenium/Playwright
  preferred over raw cURL.
- No CAPTCHA but does rate-limit. 6s between requests.

### 4. Hillsborough, FL — Tampa metro (~2.0%)

- HCPA: https://gis.hcpafl.org/propertysearch/
- Type: HTML search with hash routing (Angular SPA). Use Playwright.
- Florida is friendly to public records — full deed + mortgage history
  visible.

### 5. Fulton, GA — Atlanta metro (~2.4%)

- qPublic (Schneider Corp): https://qpublic.schneidercorp.com/Application.aspx?AppID=936&LayerID=18261
- Many Georgia counties use the same qPublic backend. Once Fulton works,
  Cobb, Gwinnett, DeKalb get easy follow-ons.
- ASP.NET form post + viewstate handling.

---

## Tier 2 counties (deferred)

The remaining 20 counties in `county-configs.js` are seeded with
`is_active=false` and `scrape_strategy='manual'`. Each requires its
own pass — see the file for the full list (LA County, Cook County,
NYC ACRIS/PTS, etc.).

LA County is the biggest gap (~5.5% of national inventory). It has
CAPTCHA on parcel search — likely needs a paid provider for that one
county to keep budget under $50/mo. Worth revisiting in Q3.

---

## Mortgage balance estimation

The recorder data gives us mortgage origination date + amount. We
estimate the current balance via standard amortization in
`scraper-service/lib/equity-calc.js`:

```
remaining = P*(1+r)^k - M*((1+r)^k - 1)/r
where:
  P = principal at origination
  r = monthly rate (annual/12)
  M = monthly P&I = P*r*(1+r)^n / ((1+r)^n - 1)
  n = total payments (term_years * 12)
  k = payments made (months elapsed since origination)
```

If the rate isn't on the recording, we look it up in
`scraper-service/lib/historical-rates.js` (Freddie Mac PMMS table by
month). If that's missing, we fall back to 6.5%.

This is approximate — the real balance depends on whether the loan
was an ARM, had pre-payments, was refinanced, etc. We accept ±10%
error here because:

- The 60% equity gate is the only consequential check
- A property at 75% estimated equity could be 65% or 85% real — both
  pass the gate
- The score will adjust automatically once we get the real terms in
  underwriting

---

## Adding a new Tier 2 county

1. Open `lib/county-configs.js`. Find the row for the county.
2. Set `is_active=true`. Set `scrape_strategy` to the right value.
3. Fill in `scrape_config`.
4. Run `npm run seed:counties` to update the DB row.
5. Build `county-scrapers/<state>-<county>.js` per the contract above.
6. Test against 5 known parcels:
   ```bash
   docker-compose exec scraper node -e "
     const m = require('./county-scrapers/<state>-<county>');
     m.fetch({ address: '123 Main St', city: 'Foo', zip: '12345', config: {} })
       .then(r => console.log(JSON.stringify(r, null, 2)));
   "
   ```
7. Verify equity calc within ±5% of expected.
8. Commit + deploy.

---

## When all else fails

If a county is too painful to scrape (CAPTCHA, login required,
session cookies, etc.), keep `scrape_strategy='manual'` and do one of:

1. **Skip it** — listings in that county get `enrichment_skipped=true`
   and never score. Acceptable if it's a small market.
2. **Pay a provider** — DataTree or Estated for that one county.
   Set up a per-county budget kill-switch so one expensive county
   doesn't blow the $50/mo ceiling.
3. **Manual triage** — Brooke pulls equity manually for promising
   listings via her existing tools (Reonomy, etc.) and inserts the
   row into `enriched_properties` by hand.

---

## Future: PostgreSQL FDW for shared county data

If multiple Deal Pros systems (residential acquisition, commercial
acquisition, etc.) all need county records, consider standing up a
shared `dealpros_county_records` Postgres database that all three
systems read from. The scrapers run once, cache 30 days, all consumers
benefit. Deferred until v2.
