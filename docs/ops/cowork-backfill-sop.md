# Cowork SOP: Buyer Tagging + Notion Deal Backfill

**Date:** April 24, 2026
**Estimated time:** 1–1.5 hours total
**Access needed:** GHL (Terms For Sale sub-account) + Notion (Deal Pipeline DB)

---

## Task 1: Verify Buyer `opt in` Tags in GHL (~15 min)

The deal alert system **only sends to buyers who have all 3 of these**:
1. Custom field "Contact Role" = `Buyer`
2. Tag `opt in` (case-insensitive)
3. NOT tagged `alerts-paused`

A backfill script already ran for `opt in`, but some buyers may have been
added since. Here's how to check:

### Steps

1. Go to **GHL → Contacts → Smart Lists**
2. Create a filter:
   - Contact Role **contains** `Buyer`
   - Tags **does not contain** `opt in`
3. Review the results — these are buyers who **won't receive deal alerts**
4. For each buyer who signed up through the TFS website (check their
   source tags — `Website Signup`, `TFS Buyer`, `VIP Buyer List`, or
   `buy box complete`), add the `opt in` tag
5. Do **NOT** add `opt in` to contacts imported from external sources
   (InvestorLift, InvestorBase, etc.) unless they've explicitly opted in

### What NOT to do

- Do NOT use `buyer:active`, `buyer-active`, or `active buyer` tags —
  all three are **RETIRED** and no longer used by any system
- Do NOT remove the `alerts-paused` tag from anyone — they opted out

---

## Task 2: Backfill Notion Deal Properties (~45 min)

The Notion Bridge workflow (auto-sends new deals to the match engine)
is paused because ~25 deals are missing required fields. Once filled in,
Brooke can reactivate the bridge.

### Where

Notion → Deal Pipeline database
(DB ID: `a3c0a38fd9294d758dedabab2548ff29`)

### Filter

- `Deal Status` = **Actively Marketing**
- Any of these columns is empty: `Asset Class`, `Market`, `Summary URL`

### What to fill in

| Column | What it should contain | Example |
|---|---|---|
| **Asset Class** | Property type(s) from the multi-select | `Single Family`, `Multi-Family`, `Townhouse` |
| **Market** | City + State as text | `Phoenix, AZ` |
| **Summary URL** | The short deal link from the `Website Link` column | Copy the value from `Website Link` — it should look like `https://termsforsale.com/d/phoenix-85016-phx001` |

### How to find the right values

- **Asset Class**: Check the `Property Type` column on the same row. If
  empty, look at the Google Drive photos or street address to determine
  SFR vs MFR vs Townhouse.
- **Market**: Use the `City` and `State` columns already on the row.
  Format as `City, ST` (e.g., `Mesa, AZ`).
- **Summary URL**: Should already be in the `Website Link` column. If
  that's empty, construct it from the city, zip, and Deal ID:
  `https://termsforsale.com/d/{city}-{zip}-{dealcode}`
  where city is lowercase, zip as-is, and dealcode is the Deal ID
  without dashes (e.g., `PHX-001` → `phx001`).

### When done

Let Brooke know all 25 deals are backfilled. She (or Claude) will
reactivate the Notion Bridge workflow:
```
POST https://n8n.dealpros.io/api/v1/workflows/Dj7d90y3ZhuyRtjy/activate
```

---

## Task 3: Smoke Test (after Tasks 1+2 are done, ~15 min)

Verify 3 test contacts receive deal alerts with correct tiering:

| Contact | Proof of Funds | Deals in 12mo | Decision Maker | Expected Tier |
|---|---|---|---|---|
| Test A | Yes | 5 | Yes | A (immediate) |
| Test B | Yes | 1 | Yes | B (1hr delay) |
| Test C | No | 0 | No | C (4hr delay) |

### Steps

1. Create 3 test contacts in GHL with the names above
2. Set their Contact Role = `Buyer`, add `opt in` tag
3. Fill in their buy box (Target States = `AZ`, Deal Structures = `Cash`)
4. Ask Brooke or Claude to run the test:
   ```
   node scripts/dry-run-match-engine.js
   ```
5. **Expected**: Test A gets SMS immediately, Test B gets SMS ~1hr later,
   Test C gets SMS ~4hr later
6. After verifying, delete or archive the test contacts

---

## Questions?

- Slack Brooke or open a Claude Code session on the `termsforsale-site` repo
- The full tag reference is at: `docs/ghl-reference/tfs/tfs-tags.csv`
- The full field reference is at: `docs/ghl-reference/tfs/tfs-fields.csv`
