# Adding a new asset class (v2 expansion)

The system was deliberately built modular so office, industrial,
retail, and storage can be added in v2 with config changes only.
Here's the playbook.

---

## What's hardcoded vs configurable

Per the brief, v1 ships **MF + MHP only**. The infrastructure that's
asset-class-agnostic:

- DB schema (`asset_class` column accepts any string)
- Scraper service framework (each scraper declares its own asset class)
- Enrichment pipeline (county records are property-agnostic)
- Stack scoring engine (rubric is parameterized by `asset_class`)
- GHL push (tags include `asset:<class>`)

What's **hardcoded for MF + MHP** that needs unhardcoding:

- Asset quality scoring rubric (in `prompts/stack-scoring-prompt.md`,
  the section under "ASSET QUALITY SCORE")
- Asset class CHECK constraint in `db/schema.sql` (only allows
  `'mf'` and `'mhp'`)
- Scraper search URL filters (e.g. Crexi `types[0]=multifamily`)

---

## Adding "office" as an example

### 1. DB migration

Update the CHECK constraint:

```sql
-- db/migrations/20260601_add_office_asset_class.sql
ALTER TABLE listings DROP CONSTRAINT listings_asset_class_check;
ALTER TABLE listings ADD CONSTRAINT listings_asset_class_check
  CHECK (asset_class IN ('mf','mhp','office','industrial','retail','storage'));
```

### 2. Update `lib/normalize.js`

Add the new class to the allowed list:

```js
out.asset_class = ['mhp','office','industrial','retail','storage'].includes(rec.asset_class)
  ? rec.asset_class
  : 'mf';
```

### 3. Update each scraper

Each scraper's search URL needs an `office` variant. For Crexi:

```js
const CREXI_SEARCH = {
  mf:        'https://api.crexi.com/...types%5B0%5D=multifamily...',
  mhp:       'https://api.crexi.com/...types%5B0%5D=specialPurpose...',
  office:    'https://api.crexi.com/...types%5B0%5D=office...',
  industrial:'https://api.crexi.com/...types%5B0%5D=industrial...',
  retail:    'https://api.crexi.com/...types%5B0%5D=retail...',
  storage:   'https://api.crexi.com/...types%5B0%5D=specialPurpose&query=self+storage...'
};
```

Filter logic in `lib/normalize.js → passesAssetFilters` — add the
new class's size constraints (e.g. office: prefer 5,000-50,000 sqft;
self-storage: prefer 200+ units).

### 4. Update `prompts/stack-scoring-prompt.md`

Add the asset quality rubric section for office:

```
Office (asset_class='office'):
  base by sqft + tenancy:
    5,000-50,000 sqft, multi-tenant   → 25
    multi-tenant outside that range   → 18
    single-tenant                     → 14 (riskier, vacancy = 100%)
  Adjustments:
    suburban garden office            → +0
    Class A downtown                  → -3 (institutional competition)
    Class C / converted house         → -3 (financing harder)
```

Same pattern for industrial / retail / storage. Each gets its own 4-7
line rubric block.

### 5. Update Stack Fit per asset class

For most non-MF asset classes, owner-financing is RARER (commercial
real estate buyers expect bank financing more often than residential).
The Stack Fit rubric should slightly penalize non-MF classes:

```
Add to the stack_fit_score block:
  if (asset_class != 'mf' && asset_class != 'mhp')
    stack_fit_score -= 2  // owner-financing less culturally accepted
```

### 6. Update GHL pipeline

Either:
- (A) reuse the same `Commercial Stack` pipeline with tag-based
  filtering (`asset:office`, `asset:industrial`, etc.) — simplest
- (B) create per-class pipelines if Brooke wants separate funnels

Default to (A) until volume justifies (B).

### 7. Update Daily Digest grouping

In `n8n-workflows/06-daily-digest.json`, group hot-lead summary by
asset class so Brooke sees:

```
🔥 HOT leads (24h): 8
  - 4 MF (avg score 84)
  - 2 MHP (avg score 79)
  - 2 office (avg score 81)
```

### 8. Test before live

1. Run scraper with `--dry-run` for the new class
2. Force-score 5 fake office properties via the test-pipeline script
3. Verify the rubric makes sense — bad fits should COLD, good ones HOT
4. Spot-check 3 HOT scores manually (does the recommended_structure
   make sense for office? Are red_flags relevant?)

---

## Storage (self-storage facilities) — asset class specifics

If/when adding self-storage:

- Unit count is "number of storage units" (typically 200-1500)
- Sweet spot: 200-500 units (mom-and-pop sized)
- Year built less critical; storage doesn't suffer obsolescence like office
- Climate-controlled vs non- is a meaningful subcategory
- Cap rates trend lower than MF (4-6% vs 5-8%) but cash flow is steadier

---

## Industrial (warehouse, flex space) — asset class specifics

- Sqft, not unit count. Sweet spot: 10,000-100,000 sqft
- Tenant mix matters more than for MF — single-tenant industrial
  flips on lease quality
- Triple-net leases are common (great for buyer)
- Class C industrial is often a TEAR-DOWN play, not a hold — adjust
  Stack Fit accordingly

---

## When to skip an asset class

Some asset classes don't fit the Stack Method well at all:

- **Hotels**: highly operational, debt service is crucial, sellers
  almost never carry. SKIP.
- **Single-family rentals**: residential pipeline already handles
  these (Terms For Sale's main system). Don't duplicate.
- **Special purpose** (gas stations, car washes, churches): too
  niche, too hard to comp, illiquid resale. SKIP unless Brooke
  specifically wants them.
- **Land** (raw, infill): Stack Method needs cash-flowing income to
  pay seller's note. Land doesn't cash-flow. SKIP.

---

## Summary

Adding a new asset class is a ~4 hour task:
- 30 min: DB migration + normalize update
- 1 hr: scraper search URL updates + filter logic
- 1 hr: prompt rubric additions
- 1 hr: testing + verification on 5 fixture properties
- 30 min: deploy + monitor first 24h of digest

If you find yourself wanting to add MORE THAN config changes (e.g. a
new DB column for a class-specific field), that's a sign the
abstraction is leaking. Push back to config-only changes if at all
possible.
