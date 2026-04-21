# Marketing & Deal Alert SOP

**Owner:** Brooke Froehlich
**Effective:** April 21, 2026
**Scope:** All outbound deal alerts sent from Terms For Sale to buyer contacts
**Stack:** GHL (CRM) + Notion (inventory) + Netlify functions + Claude Haiku (AI parse)

---

## 1. What marketing is built on now

Every deal alert (SMS + email) sent to a buyer is the result of this decision chain:

```
NEW DEAL hits Notion (Status=Actively Marketing)
        ↓
   notify-buyers.js cron runs (every 30 min)
        ↓
For each of ~10,000 buyer contacts in GHL:
        ↓
COMPLIANCE GATES (6 checks) — any fail = skip buyer, no alert
        ↓
PARSED_PREFS FILTERS (9 checks) — any fail = skip buyer, no alert
        ↓
LEGACY FILTERS (fallback for buyers without parsed_prefs)
        ↓
MARKET MATCH (city or state overlap)
        ↓
TIER SCORING (1=best, 2=good, 3=state-only fallback)
        ↓
SEND ALERT: SMS + email, stagger by tier via Hybrid Router (PR #99)
        ↓
WRITE AUDIT TRAIL (tags + GHL note on contact)
```

**The key change as of April 21, 2026:** We now read `contact.parsed_prefs` — an AI-parsed JSON snapshot of each buyer's preferences — BEFORE running legacy field checks. This makes marketing far smarter because it considers free-text notes and buy-box that the old system ignored.

---

## 2. The 6 Compliance Gates (NEVER bypass these)

Every buyer-facing SMS or email must pass ALL of these before send. These are legal/reputational obligations, not preferences.

| # | Gate | Where enforced | What happens if failed |
|---|---|---|---|
| 1 | **Contact Role = 'Buyer'** | `notify-buyers.js:583-592` (hardcoded field ID `agG4HMPB5wzsZXiRxfmR`) | Contact invisible to matcher |
| 2 | **Has `opt in` tag** (case-insensitive) | `_ghl.js:44 hasOptInTag()` | Contact skipped |
| 3 | **No `alerts-paused` tag** | `notify-buyers.js:596` | Contact skipped |
| 4 | **No `opt-out:*` / `unsubscribe*` tag** | PR #95 | Contact skipped |
| 5 | **`contact.dnd !== true`** | PR #95 | Contact skipped |
| 6 | **Campaign sender identity** | `_ghl.js: CAMPAIGN_FROM_PHONE / CAMPAIGN_FROM_EMAIL` | Enforced by every send helper |

**Campaign sender identity:**
- SMS: `+1 480-637-3117`
- Email: `Terms For Sale <info@termsforsale.com>`

Never send from a personal number or personal inbox. This is a CLAUDE.md rule — do not override.

---

## 3. Parsed Preferences — the 9 smart filters (NEW, April 21, 2026)

If a buyer has `contact.parsed_prefs` populated (AI has parsed their notes + buy-box), the matcher applies these hard filters BEFORE the legacy structured-field checks:

| # | Filter | What it does | Example |
|---|---|---|---|
| 1 | **cities_only** | Hard whitelist. Deal city MUST match. | `["Phoenix, AZ"]` → rejects all Mesa deals |
| 2 | **cities_avoid** | Hard blacklist. Deal city MUST NOT match. | `["Bakersfield, CA"]` → rejects Bakersfield |
| 3 | **states_only** | Hard state whitelist | `["AZ"]` → rejects non-AZ |
| 4 | **hoa_acceptable: false** | Rejects HOA deals | Catches "no HOAs please" from buy-box free text |
| 5 | **requires_pool: true** | Deal must mention "pool" | Catches "must have pool" from notes |
| 6 | **min_year_built** | Rejects older deals | `1980` rejects 1970s deals |
| 7 | **min_sqft** | Rejects smaller deals | `1200` rejects 1000 sqft |
| 8 | **min_baths** | Rejects deals with too few baths | `2` rejects 1-bath deals |
| 9 | **deal_killers** | Rejects deals containing any listed phrase | `["flood zone", "septic"]` scans deal features |

If parsed_prefs exists and none reject the deal → buyer proceeds to market match + tier scoring.

**If parsed_prefs does NOT exist yet** (buyer hasn't been backfilled or parser failed) → matcher falls back to the legacy structured field checks. Zero disruption for buyers not yet parsed.

---

## 4. The Parsed Preferences JSON schema

Every parsed buyer has a `Parsed Preferences (AI)` custom field containing JSON like this:

```json
{
  "version": 1,
  "cities_only": ["Phoenix, AZ", "Mesa, AZ"],
  "cities_avoid": [],
  "states_only": ["AZ"],
  "min_beds": 3,
  "min_baths": 2,
  "min_sqft": 1200,
  "min_year_built": 1980,
  "max_price": 400000,
  "max_entry_fee": 20000,
  "min_arv": 500000,
  "max_monthly_piti": null,
  "min_cashflow": null,
  "max_interest_rate": null,
  "max_repair_budget": 30000,
  "property_types": ["SFR"],
  "structure_pref": ["Subject To"],
  "structure_open_to": ["Seller Finance"],
  "hoa_acceptable": false,
  "requires_pool": false,
  "occupancy_pref": "vacant",
  "remodel_tolerance": "light",
  "deal_killers": ["flood zone", "septic"],
  "deal_delights": ["pool", "ADU potential"],
  "persona_notes": "Buy-and-hold rental investor, Phoenix metro focus, prefers SubTo with assumable loans",
  "confidence": 0.85,
  "source_checksum": "a3f2c9e7b1d4f8e2",
  "last_parsed": "2026-04-21T22:30:00Z",
  "model_used": "claude-haiku-4-5-20251001"
}
```

**Confidence score (0.0–1.0):**
- **0.8+** → AI had clear, consistent source material
- **0.5–0.8** → Some inference, reasonable extraction
- **Below 0.5** → Buyer has near-empty buy-box + few notes. **Call opportunity.**

---

## 5. Tier assignment (how buyers get ranked)

Once a buyer passes all compliance gates + parsed_prefs filters + market match, they get assigned a tier:

| Tier | Meaning | Conditions |
|---|---|---|
| **Tier 1** (best) | City match + all numeric extras pass (price, beds, ARV) | Buyer's Max Price ≥ deal asking, min beds ≤ deal beds, etc. |
| **Tier 2** (good) | City match but some numeric extras fail | Deal over budget but buyer's city matched |
| **Tier 3** (fallback) | State-only match, no city overlap | Buyer has AZ state set but city prefs don't overlap deal city |

**Soft bumps from parsed_prefs (as of April 21):**
- **deal_delights match** (e.g., buyer wants pool + ADU, deal has both) → tier bumps UP one level
- **structure_pref exact match** (buyer wants SubTo, deal is SubTo) → tier bumps UP one level
- Final tier is capped at 1 (can't go better) and 3 (can't go worse)

**Hybrid Tier Router** (PR #99) staggers the sends:
- Tier 1: sent immediately
- Tier 2: waits X min in n8n before send
- Tier 3: waits longer

This gives Tier 1 buyers first dibs on the deal while Tier 3 still gets notified.

---

## 6. Post-send audit trail

After a buyer gets alerted, the system writes:

1. **Tags** applied to contact:
   - `new-deal-alert` (lifetime)
   - `sent:[slug]` (e.g., `sent:1234-main-st-phx-az`) — admin lookup
   - `alerted-[shortId]` — dedup (prevents duplicate alerts for same deal)
   - `tier1:[slug]` / `tier2:[slug]` / `tier3:[slug]` — tier marker
2. **Deal Alert Fields** written to contact custom fields (16 fields — deal address, price, entry fee, beds, baths, etc.)
3. **GHL Note** posted to contact summarizing: deal code, match reasons, tier, AI fit (if enabled), red flags

---

## 7. Daily operations — who does what

### Ops team (Eddie, Mishawn, VAs)

**When on a buyer call:**
- Take detailed call notes in GHL. AI reads these nightly.
- Always capture: cities they want/avoid, price ceiling, deal structure preference, any hard "no's" (e.g., "no HOA", "not interested in pre-1980 homes")
- Example good note: *"4/22 call — buyer only wants Phoenix and Tempe now. Cap is $450k. Must have garage. Will consider SubTo but prefers Cash. No HOAs."*

**Why it matters:** Next night, AI parses these notes and updates `parsed_prefs`. The buyer's next deal alerts reflect the new info.

### CEO (Brooke)

**Daily:**
- Review CEO briefing SMS (sent 7am AZ daily)
- Spot-check any buyers with `confidence < 0.5` in `Parsed Preferences (AI)` — call them to enrich data

**Weekly:**
- Monday weekly synthesis (sent 8am AZ)
- Check Paperclip `parsed-prefs-nightly` cron ran successfully each night (`pm2 logs parsed-prefs-nightly`)

### Technical (solo / delegated)

**Monthly:**
- Run `scripts/ops-audit.js` to verify all systems healthy
- Review Claude API spend on Anthropic console
- Verify GHL API key rotation status (both TFS and Dispo Buddy Netlify sites)

---

## 8. Adding / updating buyer preferences

There are 5 ways parsed_prefs get updated. From fastest to slowest:

| Trigger | Latency | How |
|---|---|---|
| **Buyer saves buy-box form online** | ~3 sec | Parser fires in `buy-box-save.js` |
| **Nightly cron** | up to 24 hrs | `jobs/parsed-prefs-nightly.js` runs at 3am AZ, re-parses any buyer whose inputs changed (via SHA256 checksum) |
| **Manual note addition by ops team** | up to 24 hrs | Picked up on next nightly cron |
| **Tag added/removed** | up to 24 hrs | Picked up on next nightly cron |
| **Buyer replies via SMS with new prefs** | up to 24 hrs | Picked up on next nightly cron |

**Note:** Real-time note→parse webhook is NOT currently wired. If this becomes a problem (buyers getting stale matches), we'll add it.

---

## 9. What to do when…

### A buyer says "I'm not getting alerts"

Check in order:
1. **Contact Role = Buyer?** Open contact → look at `Contact Role` custom field. Must contain "Buyer".
2. **Has `opt in` tag?** Required. If missing, don't just add it — verify consent first (legal).
3. **Has `alerts-paused` tag?** If yes, the buyer previously replied "C" to pause. Remove tag to resume.
4. **Any `opt-out:*` / `unsubscribe*` tag?** If yes, the buyer opted out. Don't remove without fresh consent.
5. **`contact.dnd === true`?** Native GHL flag. Disable if appropriate.
6. **`Parsed Preferences (AI)` too restrictive?** If buyer has `cities_only: ["Phoenix"]` but no Phoenix deals shipped this week, they'll be quiet. That's correct behavior.

### A buyer gets alerts they don't want

1. Check the GHL note posted by notify-buyers — what was the match reason?
2. Open the `Parsed Preferences (AI)` field — does the AI extract match what the buyer actually wants?
3. If AI got it wrong, **add a clarifying note** to the contact: e.g., *"4/22 — buyer clarified they do NOT want Mesa, only Phoenix."*
4. Next night, nightly cron re-parses and corrects.

### A deal didn't match enough buyers

1. Check notify-buyers Netlify function logs for the deal's run
2. Look for frequent skip reasons (e.g., "parsed_prefs cities_only: deal city not in buyer list")
3. If the deal is in a city NO buyer wants, that's expected — no action needed
4. If the deal should match more buyers, investigate via `/admin/deal-buyers.html?deal=[slug]`

### A buyer's `Parsed Preferences (AI)` field looks blank

1. Either the backfill hasn't reached them yet (check: is `source_checksum` set?)
2. Or the parser failed (check Netlify or Droplet logs)
3. Or they have genuinely no usable input (empty buy-box + no notes + no meaningful tags)

**Fix:** Add a detailed note to the contact with whatever you know about them. Nightly cron will parse it.

### The nightly cron didn't run

```bash
ssh root@paperclip
pm2 logs parsed-prefs-nightly --lines 50
pm2 describe parsed-prefs-nightly
```

If missing or errored:
```bash
cd /root/termsforsale-site/jobs
pm2 startOrReload ecosystem.config.js
pm2 save
```

Then check `/etc/environment` for `ANTHROPIC_API_KEY`.

---

## 10. Cost & monitoring

### Current costs

| Component | Cost | Frequency |
|---|---|---|
| Initial backfill | ~$27 | One-time |
| Nightly cron (quiet night) | ~$0 | Every night (idempotent) |
| Nightly cron (busy night, ~100 changes) | ~$0.30 | Every night |
| Per buy-box form save | ~$0.003 | Per form submit |
| Per deal match | $0 | Zero API calls at match time |
| Paperclip Droplet | $6 | Monthly |
| Anthropic total expected | ~$5-10 | Monthly |

### Monitoring checklist (weekly)

- [ ] `pm2 list` on Droplet — all jobs green
- [ ] `pm2 logs parsed-prefs-nightly` — last 3 nights ran without errors
- [ ] Sample 3 buyer contacts in GHL — `Parsed Preferences (AI)` looks fresh
- [ ] Anthropic console — spend < $20/month
- [ ] GHL API key not rotated without updating Netlify env vars (both TFS + Dispo Buddy)

---

## 11. Compliance reminders (legal)

These are non-negotiable:

1. **Never message a contact without `opt in` tag.** TCPA/CAN-SPAM enforced at code level via `hasOptInTag()`.
2. **Campaign sender identity is locked:** SMS from `+1 480-637-3117`, email from `Terms For Sale <info@termsforsale.com>`.
3. **STOP/UNSUBSCRIBE honored instantly:** `opt-out:sms` and `dnd` flags block all future sends.
4. **Never use parsed_prefs to target protected classes.** The AI is trained not to extract race/religion/national origin/etc. but always sanity-check the JSON output.

---

## 12. Related files & reference

| File | Purpose |
|---|---|
| `termsforsale/netlify/functions/notify-buyers.js` | Main match engine, runs every 30 min |
| `termsforsale/netlify/functions/_parse-preferences.js` | AI parser (shared helper) |
| `termsforsale/netlify/functions/buy-box-save.js` | Form endpoint that auto-parses on save |
| `termsforsale/netlify/functions/_ghl.js` | GHL API wrapper + compliance helpers |
| `termsforsale/netlify/functions/_ai-match.js` | Optional Claude-based per-buyer fit check |
| `scripts/backfill-parsed-prefs.js` | One-shot backfill script |
| `jobs/parsed-prefs-nightly.js` | Nightly cron wrapper for parsed_prefs refresh |
| `jobs/ecosystem.config.js` | PM2 config for all Droplet crons |
| `docs/ghl-reference/tfs/tfs-fields.csv` | Canonical TFS field reference |
| `docs/ghl-reference/tfs/tfs-tags.csv` | Canonical TFS tag reference |
| `docs/smart-matching-team-brief.md` | Non-technical explainer for team |
| `CLAUDE.md` | Session log + developer rules |

---

## 13. Change log

| Date | Change |
|---|---|
| April 21, 2026 | `Parsed Preferences (AI)` shipped — 9 smart filters + tier bumps. Nightly refresh cron active. |
| April 20, 2026 | PR #99 Hybrid Tier Router — staggered sends by tier via n8n |
| April 14, 2026 | PR #95 Opt-out compliance gates (`opt-out:*`, `dnd`) |
| April 14, 2026 | `opt in` tag gate shipped across all campaign functions |

---

**Questions? Ping Brooke.**
