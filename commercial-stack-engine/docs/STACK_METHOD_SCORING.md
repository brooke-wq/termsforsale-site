# Stack Method Scoring — Detailed Rubric

This document is the authoritative spec for how the system scores a
commercial property's fit for the Stack Method. The Claude Haiku
prompt at `prompts/stack-scoring-prompt.md` is the operational
implementation; this doc explains the WHY behind each weight.

---

## What is the Stack Method?

The Stack Method (Pace Morby framework) is a creative-finance
acquisition strategy for income property. It layers:

1. **Seller financing** — seller carries paper at agreed terms
2. **Sub-to** — buyer assumes the existing mortgage in title
3. **Private money** — short-term cash to close gaps

The killer combo: **seller-financing + sub-to**, which lets us
acquire a property with little or no buyer cash down, no bank loan,
and a fast close. This works because the seller carries most/all of
the financing themselves — they get monthly cash flow + tax
spread instead of a lump sum.

---

## Why 60% equity is the magic floor

| Equity % | What's possible | Stack viability |
|---|---|---|
| 90%+ | Full seller finance — NO bank, NO sub-to needed | ⭐⭐⭐ Holy grail |
| 75-89% | Sub-to existing small loan + seller carry second | ⭐⭐⭐ Easy |
| 60-74% | Wrap (seller wraps existing loan) | ⭐⭐ Workable |
| 40-59% | Need private money rescue + complex structure | ⭐ Hard |
| <40% | Conventional financing required → lose the edge | ❌ Skip |

Below 60% equity, the seller can't carry enough paper to make the
deal cash-flow without bank financing. The whole point of the Stack
is to avoid banks (faster close, no qualifications, off-market terms)
— if we have to bring a bank, we're competing with retail buyers and
losing the structural advantage.

**This is why the 60% gate is the cost guardrail.** Properties below
60% never see Claude. Hard NO before any AI spend.

---

## Scoring rubric (100 points total)

### 1. Equity Score (0-30 points)

| `equity_estimate_percent` | Score |
|---|---|
| 90%+ | 30 |
| 80-89% | 27 |
| 70-79% | 22 |
| 60-69% | 15 |
| <60% | (rejected pre-Claude) |

Equity is the strongest single signal. Higher equity means more
financing flexibility AND typically signals a longer hold period
(itself a motivation signal — depreciation exhausted, owner ready to
exit).

### 2. Motivation Score (0-25 points, capped)

Sum these signals; cap the total at 25.

| Signal | Points | Source |
|---|---|---|
| Out-of-state owner | 8 | County mailing address ≠ property state |
| LLC inactive (dissolved/delinquent) | 6 | Secretary of State free lookup |
| Long hold period (10+ years) | 5 | Last sale date |
| Tax delinquent | 6 | County treasurer site |
| Code violations (1+) | 6 | City code enforcement records |
| Days on market 90+ | 4 | Listing first-seen-at |
| Price reduced | 3 | Listing price history |
| Estate / probate indicators | 8 | Owner deceased, estate transfer in deed history |
| Owner age 65+ | 4 | Where inferable from public records |

Motivation is what turns "willing to consider creative" into "actively
looking for a fast exit." Out-of-state owners alone close ~3x faster
than in-state owners on creative-finance terms because they don't have
emotional attachment to the property.

### 3. Asset Quality Score (0-25 points)

#### Multifamily (`asset_class = 'mf'`)

| Unit count | Base score |
|---|---|
| 10-25 units | 25 (sweet spot) |
| 5-9 or 26-50 units | 18 |

10-25 unit MF is the sweet spot because:
- Big enough to professionally manage (vs duplex/4-plex)
- Small enough that institutional buyers ignore it (we win bids)
- Cap rates are higher than 50+ unit (more spread on resale)

#### Mobile Home / RV Parks (`asset_class = 'mhp'`)

| Pad count | Base score |
|---|---|
| 30-100 pads | 25 |
| <30 or >100 | 18 |

30-100 pads is the institutional-deal sweet spot. Below 30 is too
small for a professional buyer to acquire as an exit; above 100 has
too few buyers (most institutional MHP funds want 100+ but the
universe is small).

#### Adjustments (subtract from base, floor 0)

| Adjustment | Penalty |
|---|---|
| Year built < 1980 | -5 |
| Rural location (MSA size <250k) | -3 |
| Cap rate >1% off market average | -3 |

### 4. Stack Fit Score (0-20 points)

Based on existing financing on the property:

| Situation | Points |
|---|---|
| Free-and-clear (no mortgage) | 20 |
| Mortgage <50% LTV | 12 |
| Mortgage 50-70% LTV | 6 |
| Mortgage >70% LTV | 0 |
| Bonus: assumable mortgage detected | +3 |

Free-and-clear is the holy grail because the seller can carry the
ENTIRE purchase price as a single first lien. No second mortgages, no
sub-to mechanics, no private money needed. This is the cleanest
possible Stack deal.

---

## Tier assignment

| `overall_score` | Tier | Action |
|---|---|---|
| ≥80 | HOT | Push to GHL + SMS Brooke immediately |
| 65-79 | WARM | Daily digest only |
| <65 | COLD | Log only |

> **Why 80 for HOT?** A property with 75%+ equity, out-of-state
> owner, 10-year hold, sweet-spot unit count, and free-and-clear
> scores about 22+13+25+20 = 80. That's our floor for "drop
> everything and call this seller today."
>
> 65 for WARM is roughly: 60-70% equity + 1-2 motivation signals +
> sweet-spot quality + small mortgage. Worth a follow-up but not a
> red-alert.

---

## Recommended structure logic

The prompt picks ONE of four structures based on equity + mortgage:

| Property situation | Structure |
|---|---|
| Free-and-clear (90%+ equity) | `full_seller_finance` |
| Mortgage <50% LTV | `wrap` |
| Mortgage 50-70% LTV | `sub_to_plus_seller_carry` |
| Other | `cash_with_seller_carry_2nd` |

The output includes:

- `down_payment_percent`: 0-20% (lower is better; full seller-finance
  often allows 0-5%)
- `seller_carry_percent`: 60-100%
- `suggested_interest_rate`: 4.0-8.0% (we want below market — sellers
  who don't pay attention to rates accept this; sophisticated sellers
  push back)
- `suggested_term_years`: 5-30 (shorter for sub-to wraps so the
  underlying loan can be refi'd; longer for free-and-clear seller
  finance)
- `balloon_years`: 3-10 (we want 7+ to give us time to refi/sell)
- `rationale`: 1-2 sentence explanation

---

## Red flags

The prompt outputs a string array of caveats. Examples:

- `"vintage 1960s, possible deferred maintenance"`
- `"rural location, thin buyer pool for resale"`
- `"owner is institutional REIT, unlikely to seller-finance"`
- `"mortgage origination 2022 — high rate, balloon risk if not assumable"`
- `"pad count <20 — too small for institutional exit"`
- `"code violations indicate poor management — verify in inspection"`

These don't reduce the score (they're already baked into the rubric)
but they're operational guidance for the call brief. Brooke uses
them to know what to ask on the seller call.

---

## Cost guardrails

The 60% equity gate is THE cost guardrail. It's enforced at the
enrichment pipeline (workflow 02), BEFORE any Claude call. Every
listing that fails the gate is cheap (DB write only).

Per-property Claude cost:
- ~1500 input tokens × $1/M = $0.0015
- ~250 output tokens × $5/M = $0.00125
- Total: ~$0.003/property

Batched 10/call:
- ~5000 input tokens (one prompt + 10 properties' JSON) × $1/M = $0.005
- ~2500 output tokens × $5/M = $0.0125
- Total: ~$0.018/batch = $0.0018/property

Batching cuts cost ~40%. The system batches by default.

---

## Tuning the rubric

If after running for 30 days the lead quality looks off (too many
HOTs that turn out cold on the call, or too few HOTs slipping through),
tune the rubric in `prompts/stack-scoring-prompt.md`:

- Tighten HOT threshold from 80 → 85 if too many false positives
- Loosen from 80 → 75 if Brooke wants more inbound to triage
- Bump motivation weight on a specific signal if it's predicting better
  than the rubric assumes (e.g. tax_delinquent has been more
  predictive than expected — try 8 instead of 6)

After every prompt change, re-score 20 fixture properties and verify
the tier distribution still makes sense. Don't change weights and
ship without re-validating.
