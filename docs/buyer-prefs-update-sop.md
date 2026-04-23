# SOP — Updating Buyer Preferences in GHL

**Owner:** Brooke Froehlich
**Effective:** April 23, 2026
**Audience:** Eddie, Mishawn, VAs, anyone updating buyer records in GHL
**Goal:** Make sure every change you make to a buyer's prefs actually reaches the matching engine.

---

## TL;DR — The one rule

> **Whenever you change a buyer's preferences, add a dated note explaining what changed.**

That's it. The system reads the note overnight and updates matching automatically.

---

## The 4 ways buyer prefs get updated

| # | How | Latency | What you do |
|---|---|---|---|
| 1 | **Buyer fills out the online form** | ~3 sec | Nothing — auto-parses on save |
| 2 | **You add a note in GHL** | Up to 24 hr | Just add the note |
| 3 | **You edit a structured field** (Max Price, Beds, Cities, etc.) | Up to 24 hr | **ALSO add a note** |
| 4 | **You add/remove a tag** | Up to 24 hr | Just change the tag |

**Path #3 is the one that used to silently fail.** It no longer does — but a dated note is still best practice for audit trail.

---

## How to update a buyer (the right way)

### Example 1: Buyer calls, bumps their max price

1. Open the buyer's contact in GHL
2. Update **Max Price** field: `$400,000` → `$500,000`
3. Click **Notes** tab → **Add Note**:
   > `4/23 call — buyer bumped max price to $500k. Still Phoenix only. No HOA.`
4. Save. Done.

By tomorrow at 3am AZ, the **Parsed Preferences (AI)** field will refresh with `max_price: 500000` + any extra context from the note.

### Example 2: Buyer texts "I only want Tempe and Mesa now"

1. The SMS auto-logs as an incoming message — no action needed
2. Verify the `buyer-responded` tag was applied automatically
3. (Optional) Add a summary note: `4/23 — confirmed via text: Tempe + Mesa only, no more Phoenix.`
4. Next night's parse will update `cities_only: ["Tempe, AZ", "Mesa, AZ"]` and drop Phoenix.

### Example 3: Buyer emails a detailed new buy box

1. Paste key points into a note: `4/23 email — max $600k, min 3 bed 2 bath, min 1500 sqft, no flood zones, prefers pool.`
2. If structured fields exist (Max Price, Min Beds, etc.), also update those directly.
3. Save. Overnight cron handles the rest.

---

## What NOT to do

### ❌ Do NOT edit structured fields silently

Editing Max Price from $400k to $500k with no note works (the new checksum detects the change), but leaves **zero audit trail**. In 3 months when you're checking why a buyer got an irrelevant alert, you'll have nothing to reference.

### ❌ Do NOT delete the free-text buy-box

The **Buy Box** large-text field holds the buyer's original words (form submission, call notes, etc.). The AI uses it as the authoritative source. If you clear it, confidence drops dramatically on the next parse.

### ❌ Do NOT manually edit the Parsed Preferences (AI) JSON field

That field is machine-generated. If you see something wrong:
1. Add a note correcting it (e.g. *"4/23 — AI extracted 'Mesa' but buyer confirmed only wants Phoenix"*)
2. Wait for overnight refresh
3. Check again — it should be corrected

Direct JSON edits will be clobbered on the next parse.

### ❌ Do NOT skip the `opt in` tag on new signups

Every outbound message (SMS + email) requires the `opt in` tag on the buyer. The auth-signup flow auto-applies it when a buyer signs up on the website. If you create a buyer manually in GHL UI and forget the tag, they'll be invisible to matching.

---

## Confidence scores — what they mean

Open any buyer → **Parsed Preferences (AI)** field → look at the `confidence` value:

| Score | What it means | What you should do |
|---|---|---|
| **0.8 – 1.0** | Clear, detailed source material. AI is confident. | Nothing — they're dialed in. |
| **0.5 – 0.8** | Reasonable inference. Some gaps. | Optional: add a call note if you learn more. |
| **Below 0.5** | Near-empty buy box, few notes. | **Call opportunity** — talk to the buyer, capture preferences in a note. Next night's parse will lock in a real profile. |

**Low confidence buyers are your best outbound list.** They've signed up but haven't given us enough to match them well. A 5-minute call → good note → next-night parse bumps them to 0.7+ confidence.

---

## Quick reference — the 23 prefs the AI extracts

| Category | Field | Example |
|---|---|---|
| Location | `cities_only` | `["Phoenix, AZ"]` |
| Location | `cities_avoid` | `["Mesa, AZ"]` |
| Location | `states_only` | `["AZ", "TX"]` |
| Property | `min_beds / min_baths / min_sqft` | `3 / 2 / 1200` |
| Property | `min_year_built` | `1980` (rejects 1970s deals) |
| Property | `property_types` | `["SFR", "Townhome"]` |
| Property | `hoa_acceptable` | `true / false / null` |
| Property | `requires_pool` | `true / false / null` |
| Property | `occupancy_pref` | `"vacant" / "tenant-occupied"` |
| Financials | `max_price / max_entry_fee` | `400000 / 20000` |
| Financials | `min_arv` | `500000` |
| Financials | `max_monthly_piti / min_cashflow` | `2500 / 300` |
| Financials | `max_interest_rate` | `8.5` |
| Financials | `max_repair_budget` | `30000` |
| Deal | `structure_pref` | `["Subject To"]` |
| Deal | `structure_open_to` | `["Seller Finance", "Hybrid"]` |
| Deal | `remodel_tolerance` | `"light" / "moderate" / "heavy"` |
| Filters | `deal_killers` | `["flood zone", "septic only"]` |
| Filters | `deal_delights` | `["pool", "ADU potential"]` |
| Context | `persona_notes` | `"Phoenix rental investor, SubTo preference"` |
| Meta | `confidence` | `0.0 – 1.0` |

---

## Troubleshooting

### "I changed Max Price yesterday but the Parsed Preferences (AI) field still shows the old number"

- Check the `last_parsed` timestamp inside the JSON. If it's older than this morning, the nightly cron may have failed. Ping Brooke.
- Verify the field actually saved in GHL (sometimes clicks don't register — refresh the page and confirm).
- If urgent, run a force reparse on the Droplet: `FORCE_REPARSE=1 node scripts/backfill-parsed-prefs.js` (tech team only, ~$25).

### "This buyer's confidence dropped from 0.8 to 0.4"

Probably means someone cleared or shortened the **Buy Box** text field. Check the GHL activity log for that contact. If so, restore the text or add a detailed note capturing the prefs.

### "The AI extracted the wrong cities"

Add a correction note: `4/23 — AI extracted Mesa but buyer only wants Phoenix, confirmed on call.` Overnight parse will re-read the note and correct itself. Notes beat buy-box text when they contradict.

### "Buyer says they're not getting alerts they should"

Run through the 6 compliance gates in order:
1. Contact Role = Buyer? (custom field must contain "Buyer")
2. Has `opt in` tag?
3. No `alerts-paused` tag?
4. No `opt-out:*` / `unsubscribe*` tag?
5. `contact.dnd !== true`?
6. If all pass, check the **Parsed Preferences (AI)** — is `cities_only` or `states_only` too restrictive?

See `docs/marketing-sop.md` for the full troubleshooting matrix.

---

## The nightly cron (for reference)

- Runs every night at **3:00 AM Arizona time** (10:00 UTC)
- Scans every buyer-tagged contact (~10,000 of them)
- Only re-parses buyers whose **buy-box text, notes, tags, OR structured fields** changed since their last parse
- Typical cost per night: **$0 – $3** depending on volume
- Logs: `ssh root@paperclip` → `pm2 logs parsed-prefs-nightly`

---

## Questions? Ping Brooke.
