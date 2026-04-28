# Tests

Test fixtures + harness for the Commercial Stack Engine.

## Status: TODO (next session)

The brief calls for these tests before declaring done. None are
implemented yet — this is a placeholder + spec.

## What needs to be built

### 1. Scraper fixture tests (`tests/scrapers/<source>.test.js`)

For each scraper:
- 3-5 captured HTML/JSON fixtures saved under `tests/fixtures/<source>/`
- Test that the scraper correctly parses each fixture into a
  normalized listing
- Edge cases: missing price, missing units, multi-page result, etc.

```js
// tests/scrapers/crexi.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('crexi parses MF API response', () => {
  const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../fixtures/crexi/mf-page1.json'), 'utf8'
  ));
  // Inject fixture into the api fetcher, run scrape, assert shape
});
```

### 2. Equity calc tests (`tests/equity-calc.test.js`)

Hand-computed expected values for:
- Free-and-clear property: equity_estimate_percent = 100%
- Recent purchase with 75% LTV mortgage: equity = 25%
- 10-year-old purchase with 75% LTV mortgage: equity = ~50% (after
  amortization + appreciation)
- Property with no last_sale_date but with assessed value: equity
  inferred from assessed only

### 3. Scoring fixture tests (`tests/scoring.test.js`)

10 hand-labeled fixture properties — 5 should score HOT (≥80), 3 WARM
(65-79), 2 COLD (<65). Assert the actual score is within ±10 points
of the expected. Run against a real Claude API call (Haiku) — keeps
the rubric calibrated as Anthropic ships model updates.

### 4. End-to-end pipeline test (`tests/e2e.test.js`)

- Insert fake listing into DB
- Insert fake enrichment with 75% equity
- Trigger workflow 03 manually via webhook
- Verify a `scores` row appears within 30s
- Verify a `leads` row appears (if tier=HOT)
- Verify GHL contact was created in TEST sub-account
- Cleanup

### 5. Cost guardrail test (`tests/cost-guardrail.test.js`)

- Process 100 fake listings through scoring
- Verify total Claude cost from `claude_cost_log` < $0.30
- Verify <60% equity properties NEVER hit the API

## Running

Once tests are built:

```bash
docker-compose exec scraper npm test
```

Or in CI: GitHub Actions on every push to `claude/setup-acquisition-system-*`.
