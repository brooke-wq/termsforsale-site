# Smarter Buyer Matching — Team Brief

**Shipped:** April 21, 2026
**What changed:** The system now "reads between the lines" of what buyers tell us — not just the checkbox fields.

---

## What this means for you

### Before (the old way)

When we got a new deal, our matching system only looked at a few structured fields:
- Max Price
- Min Beds
- Target States
- HOA checkbox

It **completely ignored** everything a buyer wrote in their buy box notes or in the call notes we took.

**Example:** Sarah's buy box said *"Phoenix only, no HOA, must have pool, won't touch anything pre-1980."* The old system saw "Phoenix" and "HOA" but missed the pool requirement and the year-built filter. She'd get alerted on a 1970s Mesa property with no pool — irrelevant to her.

### After (what's live now)

AI reads every buyer's notes, buy box, and tags **once**, then extracts structured preferences:
- Cities they ONLY want (or avoid)
- Specific deal killers ("flood zone", "septic only", "cash only")
- Must-haves ("pool", "ADU potential", "garage")
- Min sqft, min year built, min baths — even if not on the form
- Buyer persona (fix-and-flip, PadSplit operator, buy-and-hold, etc.)

These extracted preferences are stored on the contact in a field called **`Parsed Preferences (AI)`**. Matching now uses that field in addition to the checkboxes.

---

## What YOU need to know

### 1. Add a note → prefs auto-update (overnight)

When you add a note to a buyer like *"Talked 4/21 — only wants Phoenix now, not Mesa"*, that new info will be incorporated into their matching profile **within 24 hours**. Next deal blast respects it.

Same thing if a buyer:
- Texts us with updated preferences (we tag the response, AI re-parses)
- Updates their buy box on the website
- Gets tagged with something new (`buy:padsplit`, `strategy:fix-flip`)

### 2. You can SEE what the AI extracted

Open any buyer's contact in GHL. Look for the **`Parsed Preferences (AI)`** custom field. It shows a JSON snapshot like:

```json
{
  "cities_only": ["Phoenix, AZ"],
  "cities_avoid": ["Mesa, AZ"],
  "min_year_built": 1980,
  "requires_pool": true,
  "deal_killers": ["hoa", "septic"],
  "deal_delights": ["pool", "adu"],
  "persona_notes": "Phoenix-focused rental operator, prefers newer homes",
  "confidence": 0.85
}
```

**Confidence score (0.0-1.0)** tells you how sure the AI was:
- 0.8+ → clear, confident parse
- 0.5-0.8 → reasonable, some inference
- Below 0.5 → limited source info (buyer has little/no buy-box text)

### 3. Wrong info? Easy fix.

If you see the AI got something wrong, just **add or update a note** on the contact. The AI re-parses on the nightly refresh and corrects itself.

Example:
- AI extracts `cities_only: ["Phoenix"]` but you know the buyer also wants Tucson
- Add note: *"4/22 — buyer wants Phoenix AND Tucson, confirmed on call"*
- Next night, prefs update to `cities_only: ["Phoenix, AZ", "Tucson, AZ"]`

### 4. Low-confidence buyers = call opportunities

Buyers with `confidence` below 0.5 usually have near-empty buy-boxes and no call notes. That's a **signal** — those are buyers you haven't had a conversation with yet. Call them, add notes, watch the system get smarter.

---

## Why it matters (the business case)

- **More relevant alerts** — buyers get deals matching what they actually want
- **Fewer "stop sending me these" replies** — alerts respect specific preferences
- **Better conversion** — interested-to-closed rates improve when match quality is higher
- **No manual data entry** — AI reads your call notes, no need to re-enter in form fields
- **Deal-specific features matter** — "pool", "ADU", "waterfront" now trigger tier upgrades for buyers who wanted those

---

## Cost (so you know we're being smart about it)

- One-time setup: ~$27 (parse every existing buyer)
- Ongoing: ~$2/month
- Matching itself: $0 (no AI calls when we match deals — it's already pre-parsed)

---

## TL;DR for the team

1. **Keep adding notes** to buyer contacts — good notes = smarter matching
2. **Check the `Parsed Preferences (AI)` field** on any buyer to see what the system understands about them
3. **If it's wrong, add a clarifying note** — the nightly refresh fixes it
4. **Low confidence scores = buyers to call** for more details

Questions? Ping Brooke.
