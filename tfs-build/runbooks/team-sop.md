# TFS Buyer Lifecycle — Team SOP

**Audience:** Brooke, Eddie, VAs, anyone touching GHL / Notion for Terms For Sale deals.

**Rule #1:** the system does the work. You don't need to manually match deals to buyers. You don't need to manually text tier-A buyers first. If you find yourself doing that, something's miscconfigured — ping Brooke.

---

## The shape of the system

```
      Buyer submits form       Deal marked "Actively Marketing"
      on /buyer-qualifier      in Notion + Blasted=false
              │                          │
              ▼                          ▼
     ╔════════════════╗          ╔════════════════╗
     ║  GHL Contact   ║          ║ Notion Bridge  ║
     ║  tag buyer:new ║          ║ (polls q10min) ║
     ╚════════╤═══════╝          ╚════════╤═══════╝
              │                           │
        fires WF01                  POSTs to Match Engine
              │                           │
              ▼                           ▼
     ╔════════════════╗          ╔════════════════╗
     ║ Welcome SMS +  ║          ║ n8n filters    ║
     ║ Qualifier SMS  ║          ║ buyer:active   ║
     ║ (with 5min wait│          ║ against deal   ║
     ╚════════╤═══════╝          ╚════════╤═══════╝
              │                           │
    reply? ───┤                           │
              │                           ▼
      YES: book call             ╔════════════════╗
      NO:  day3/7/14 nudges      ║ tag buyers     ║
              │                  ║ deal:new-inv   ║
              ▼                  ╚════════╤═══════╝
     ╔════════════════╗                   │
     ║ Intake call    ║                   ▼
     ║ → stage change║          ╔════════════════╗
     ╚════════╤═══════╝          ║ GHL WF02 fires  ║
              │                  ║ Tier A → now   ║
        WF01 scoring             ║ Tier B → +1h   ║
              │                  ║ Tier C → +4h   ║
              ▼                  ║ SMS+Email       ║
     ╔════════════════╗          ╚════════╤═══════╝
     ║ A, B, or C tag ║                   │
     ║ buyer:active   ║           buyer replies YES
     ╚════════════════╝                   │
                                          ▼
                                ╔════════════════╗
                                ║ Under Negotiation
                                ║ → task for Eddie║
                                ╚════════╤═══════╝
                                         │
                                    deal closes
                                         ▼
                                ╔════════════════╗
                                ║ WF03: VIP tag  ║
                                ║ +1 deals count ║
                                ║ 7-day check-in ║
                                ╚════════════════╝
```

---

## Who does what

### Brooke (owner)
- Confirms tier scoring during intake calls (rep moves stage, workflow scores automatically)
- Confirms assignment fee distribution after WF03 creates the task
- Moves closed deals to "Closed" stage in GHL pipeline → triggers WF03
- Responds to buyer inbound replies personally (set up as primary SMS inbox in GHL)

### Eddie (acquisitions)
- Gets notified when a buyer replies on a deal (via task created by WF02)
- Calls the hot buyer within 2 hours of the task firing
- Moves opportunity to "Offer Submitted" / "Assigned" / "Closed" as deal progresses

### VAs / operators
- Mark new deals in Notion as `Deal Status = Actively Marketing` + `Blasted = unchecked` — that's all that's needed to blast to buyers
- Monitor GHL inbox for inbound replies during working hours (forward anything confusing to Brooke)

---

## Daily operator checklist

### Morning (Brooke or VA, 10 min)

- [ ] Open Notion → deals DB → scan for any overnight inbound seller leads
- [ ] Any deal ready to go out to buyers?
  - Set `Deal Status = Actively Marketing`
  - Make sure `Blasted` checkbox is UNCHECKED
  - Fill required fields: Asking Price, Deal Type, Asset Class (multi-select), City, State, Street Address
  - Add the `Summary URL` (deal package link) — buyers see this in their SMS/email
  - Confirm `Website Link` is the TFS deals URL for the deal
- [ ] Notion bridge picks it up within 10 min, match engine fires, buyers start receiving alerts

### Throughout the day

- Watch GHL inbox (Conversations tab) for buyer inbound replies
- Hot replies → Eddie has a task auto-created; confirm he sees it
- Maybe replies → move opportunity to "Under Negotiation" manually if the AI didn't

### Evening (Brooke, 5 min)

- Check GHL → Opportunities board → any deals that need stage moves?
  - **Offer Submitted** — when Eddie sends the offer
  - **Assigned** — when PSA is signed (executed)
  - **Closed** — when the deal funds (this fires WF03)
- Review any new buyer contacts that landed today

---

## Per-event playbook

### New buyer submits the intake form (automatic)

1. Buyer fills out `/buyer-qualifier` on termsforsale.com
2. GHL creates/updates the contact; applies `buyer:new` + `form:qualifier-submitted`
3. **WF01 fires**: welcome SMS + welcome email immediately, qualifier SMS 5 min later
4. Buyer replies or submits full form → moves to `Intake Call Scheduled` stage
5. **Book the intake call** (Brooke's calendar link is in the SMS they received)

### Intake call complete (manual)

1. After the call, go to the contact's opportunity in GHL → move stage to `Intake Call Complete`
2. **WF01 scoring branch fires** (this is the second trigger on WF01): reads PoF on File, Deals Last 12 Months, Decision Maker custom fields → assigns tier → sends confirmation SMS
3. During the call, **make sure you set those 3 fields on the contact**. If you leave them blank, the buyer lands on Tier C by default.

### New deal goes to market (manual)

1. In Notion deals DB, find the deal
2. Set `Deal Status = Actively Marketing`
3. Leave `Blasted` unchecked
4. Make sure all required fields are populated:
   - Street Address (stays internal, not shared in outreach)
   - City, State, Zip
   - Asking Price
   - Deal Type (Cash / Subject To / Seller Finance / Hybrid)
   - **Asset Class** (multi-select — SFR, MFR 2-4, MFR 5+, Commercial, Land, Mixed-Use, NNN, Mobile Home Park)
   - Summary URL (the deal page)
5. Within 10 minutes the Notion bridge picks it up. Match engine finds buyers whose:
   - Asset Class overlaps with the deal
   - Market contains the deal's city/state
   - Price band covers the deal's asking price
6. Matched buyers get tagged `deal:new-inventory`. GHL WF02 fires:
   - **Tier A buyers**: SMS + email **immediately**
   - **Tier B buyers**: SMS + email **1 hour later**
   - **Tier C buyers**: SMS + email **4 hours later**
7. Every matched buyer has their `Last Deal Sent Date` + `Last Touch Date` updated.

### Buyer replies INTERESTED on a deal

1. GHL receives the SMS reply
2. Existing `buyer-response-tag.js` automation tags the contact based on their response
3. **WF02 Step 7** (If/Else after 24h wait) checks for inbound message — if yes, moves opportunity to `Under Negotiation` + creates task for Eddie
4. Eddie calls within 2 hours

### Buyer disengages / passes

1. Buyer replies with no-interest text OR no reply after 24h
2. WF02 exits cleanly; `deal:new-inventory` tag is removed so the next deal can fire again
3. No action needed

### Deal closes (manual — fires automation)

1. Deal is funded
2. Move the opportunity to `Closed` stage in GHL Buyer Lifecycle pipeline
3. **WF03 fires**:
   - Tag `buyer:vip` applied
   - Buyer Tier set to `A` (promoted)
   - Old tier tag removed, `engage:a-tier` applied
   - n8n webhook increments `Deals Last 12 Months` by 1
   - `Last Touch Date` + `Re-verify Due Date` refreshed
   - Task created for Brooke: "Confirm assignment fee distributed"
   - 7 days later: check-in SMS to the buyer
4. **Your job after this**: confirm the assignment fee actually hit the account within 2 days (the task is your reminder)

### Buyer goes silent for 90+ days (automatic)

1. Daily at 8:00 AM AZ, WF04a scans all `buyer:active` contacts
2. Any with `Last Touch Date > 90 days ago` get:
   - `buyer:active` removed
   - `buyer:dormant` added
   - Opportunity moved to `Dormant` stage
3. No action needed. If you want to re-engage a dormant buyer, manually apply `buyer:active` back and reach out.

### Quarterly POF re-verify (automatic)

1. Daily at 9:00 AM AZ, WF04b scans for buyers whose `Re-verify Due Date` has hit
2. Those buyers receive the quarterly check-in SMS
3. `PoF on File` gets set to `Pending`
4. After 5 days:
   - If they replied → you get a task: "Update POF for [buyer]"
   - If no reply → they move to dormant (same as WF04a)

---

## Monitoring & health

### Weekly (Brooke, 10 min)

- **GHL → Opportunities → Buyer Lifecycle** — scan for stuck deals (in a stage too long)
- **n8n (dealpros.app.n8n.cloud OR n8n.termsforsale.com if migrated)** — Executions tab → any errored runs in the last 7 days?
- **Notion → deals DB** — any deals stuck in `Actively Marketing` with `Blasted = true` but no engagement? Check buyers list in GHL for that deal (`sent:[slug]` tag)

### Monthly (Brooke, 30 min)

- Pull the list of `buyer:active` contacts — check tier distribution
  - Everyone's Tier C? Your scoring criteria are too strict. Loosen.
  - Everyone's Tier A? Tighten.
  - Good baseline: ~10% A, ~30% B, ~60% C
- Check deals blasted vs. deals that got buyer replies — conversion rate
- Review any errored WF03 runs (assignment fee webhook failures)

### When something looks wrong

**Buyer didn't get a deal alert but should have:**
1. Check GHL contact — is `buyer:active` tag present?
2. Check Buyer Tier — is it set?
3. Check Buyer Asset Class / Market / Price Min/Max — any empty?
4. Check n8n → Match Engine → Executions → was that buyer matched?
5. If matched but no SMS: check GHL WF02 → History for that contact

**New deal didn't fire to buyers:**
1. Check Notion — is `Deal Status = Actively Marketing`?
2. Is `Blasted` checked? (if yes, it already fired once — can't re-fire unless you uncheck)
3. Wait 10 minutes for the cron, then check n8n → Notion Bridge → Executions
4. If bridge ran but no matches: check Asset Class / Market / Price on the deal

**n8n showing errors:**
1. If recurring: likely credential expiry (GHL PIT tokens can be revoked/rotated)
2. Re-open the GHL credential in n8n, paste fresh Bearer token, save

---

## Tag cheat sheet

| Tag | Meaning | How it gets applied |
|---|---|---|
| `buyer:new` | Just signed up — in intake flow | Form submission OR manually applied |
| `buyer:active` | Live, receiving deal alerts | WF01 scoring, OR manual |
| `buyer:cold` | No response during 14-day intake | WF01 day-14 branch |
| `buyer:dormant` | 90+ days no touch OR failed re-verify | WF04a/WF04b |
| `buyer:vip` | Closed at least 1 deal | WF03 |
| `engage:a-tier` | 3/3 scoring criteria | WF01 / WF03 |
| `engage:b-tier` | 2/3 scoring criteria | WF01 |
| `engage:c-tier` | 0–1 scoring criteria | WF01 |
| `deal:new-inventory` | Matched a new deal (WF02 trigger) | Match engine |
| `form:qualifier-submitted` | Filled out Light Qualifier form | Form action |

---

## Things NOT to do

- **Don't manually apply `deal:new-inventory`** to a buyer — that fires WF02 with no custom fields populated → buyer gets a broken SMS. The match engine is the only thing that should apply this tag.
- **Don't manually move buyers between tier stages** in the pipeline. Use the custom fields + tag changes, and let the workflows do it. Stage changes have triggers that cascade into other workflows.
- **Don't delete the `sent:[deal-slug]` tags** — they're used by the admin deal-buyer lookup tool to show who got each deal.
- **Don't uncheck `Blasted` on closed deals to re-fire** — once a deal has gone out, it's done. Create a new deal record if you need to re-market (rare).
- **Don't edit the match engine JS in n8n** without telling Brooke. It's the brain.

---

## Escalation

| Problem | Who to call |
|---|---|
| A workflow stopped firing | Brooke — check GHL History + n8n Executions |
| Buyer replied NEGATIVE | Brooke — personal response required |
| Deal data is wrong in Notion | VA who created the record |
| Buyer wants to change their buy box | Brooke — update custom fields manually in GHL |
| Workflow config question | Check `tfs-build/ghl/WF_MANUAL_BUILD_GUIDE.md` first |
| Technical error I can't read | Brooke — screenshot the error + paste it |

---

## Full system reference

- **BUILD_STATUS.md** (repo root) — current state of everything, field IDs, issues log
- **tfs-build/sop/TFS_Buyer_Lifecycle_Build_SOP.md** — original master SOP
- **tfs-build/ghl/WF_MANUAL_BUILD_GUIDE.md** — node-by-node workflow builds
- **tfs-build/runbooks/n8n-migration-to-droplet.md** — self-hosting migration guide
- **tfs-build/runbooks/team-sop.md** — this document
