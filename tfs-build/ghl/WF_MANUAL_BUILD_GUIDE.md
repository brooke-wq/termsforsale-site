# GHL Workflows — Manual Build Guide

AI Builder kept producing bad flows, so this is the node-by-node manual path. Every workflow below is a **click-by-click walkthrough** using GHL's Workflow Builder UI.

## Rules that apply to every workflow

- **Start every workflow:** GHL → Automations → Workflows → **+ Create Workflow** → **Start from scratch** (not AI).
- **Every action node in GHL is called a "Step"** — added by clicking the `+` below the previous step.
- **"Update Contact Field" / "Update Contact"** is the action name for setting a custom field. Some GHL accounts call it "Set Contact Field".
- **For "Update Opportunity"** to work, the contact must already have an opportunity in the Buyer Lifecycle pipeline. WF01 Step 2 creates that opportunity.
- **Save often** — GHL doesn't auto-save. Top-right corner → Save.
- **Copy message bodies from** `tfs-build/ghl/WF0X_*.json` → the `messages` block.

---

## WF01a — Buyer Intake Sequence  (~20 min)

**Purpose:** Catch new buyer → send welcome → nudge to qualifier → book call or go cold.

### Trigger
- Click **"Add Trigger"** (pink button top-left)
- Pick **"Contact Tag"** → "Tag Added"
- **Tag:** `buyer:new`
- Save trigger

### Step 1 — Create Opportunity
- Click the `+` → **Create/Update Opportunity**
- Pipeline: **Buyer Lifecycle**
- Stage: **New Buyer — Intake**
- Name: `{{contact.first_name}} {{contact.last_name}} — Intake`
- Status: **Open**
- Save

### Step 2 — Send SMS (welcome)
- `+` → **Send SMS**
- Paste message body from `WF01_SMS_Welcome`:
  ```
  Hey {{contact.first_name}} — Brooke with Terms For Sale. You just landed on our buyer list. Question: what's the #1 thing that's stopped you from getting enough deals in your pipeline right now?
  ```
- Save

### Step 3 — Send Email (welcome)
- `+` → **Send Email**
- Subject: `You're in — here's what happens next`
- Body: paste from `WF01_Email_Welcome.body`
- Save

### Step 4 — Update Contact Field (Last Touch Date)
- `+` → **Update Contact Field** (or "Set Contact Field")
- Field: **Last Touch Date** (search by name — GHL auto-fills dropdown)
- Value: `{{right_now | date: "%Y-%m-%d"}}` (GHL's date expression) OR use the "Set to today" toggle if present
- Save

### Step 5 — Wait
- `+` → **Wait**
- Type: **For a specific amount of time**
- Duration: **5 minutes**
- Save

### Step 6 — Send SMS (qualifier)
- `+` → **Send SMS**
- Body from `WF01_SMS_Qualifier`:
  ```
  Real quick {{contact.first_name}} — 2 questions to get you matched to deals fast: https://termsforsale.com/buyer-qualifier (takes 60 seconds)
  ```
- Save

### Step 7 — If/Else (did they reply or submit form?)
- `+` → **If/Else**
- **Condition 1:** Inbound message received = yes (within last 3 days)
  OR **Condition 2:** Form submission on form = `TFS — Light Qualifier (Pre-Intake)` (within last 3 days)
  - Join conditions with **OR**
- You now have two branches: **If (YES path)** and **Else (NO path)**

### YES branch (they replied)

**Step 8.Y — Update Opportunity**
- Pipeline: Buyer Lifecycle → Stage: **Intake Call Scheduled**

**Step 9.Y — Send SMS (book call)**
- From `WF01_SMS_BookCall`:
  ```
  Got it. Let's do a 15-min call so I can make sure we only send you deals you'd actually close on. Grab a time: https://termsforsale.com/book-intake
  ```

**Step 10.Y — Update Contact Field**
- Last Touch Date = today

**End of YES branch.** Click **"End this branch"** or **"End workflow"** node.

### NO branch (silence)

**Step 8.N — Wait:** 3 days

**Step 9.N — Send SMS (day 3 re-engage)**
- From `WF01_SMS_Reengage_Day3`

**Step 10.N — Update Contact Field:** Last Touch Date = today

**Step 11.N — Wait:** 4 days

**Step 12.N — Send Email (day 7 re-engage)**
- Subject: `Pulling you off the list?`
- Body from `WF01_Email_Reengage_Day7.body`

**Step 13.N — Update Contact Field:** Last Touch Date = today

**Step 14.N — Wait:** 7 days

**Step 15.N — If/Else:** still no reply?
- YES (still silent):
  - **Step 16.N — Add Tag:** `buyer:cold`
  - **Step 17.N — Remove Tag:** `buyer:new`
  - End branch
- NO: end branch (they replied somewhere in between)

### Final — Save + Publish
- Top right → **Save**
- Top right → toggle to **Published** / **Active**

---

## WF01b — Buyer Scoring  (~15 min)

**Purpose:** When an intake call is complete, score the buyer into A/B/C tier and set them live.

Split from WF01a because GHL workflows are cleaner with one trigger each.

### Trigger
- **Pipeline Stage Changed** → Pipeline: **Buyer Lifecycle** → Stage: **Intake Call Complete**

### Step 1 — If/Else (Branch A: all 3 criteria met)
- **Condition:** Custom field **PoF on File** = `Yes` **AND** Custom field **Deals Last 12 Months** is greater than or equal to `3` **AND** Custom field **Decision Maker** = `Yes`
- Join with **AND**

### If Branch A passes

**Step 2.A — Add Tag:** `engage:a-tier`
**Step 3.A — Update Contact Field:** Buyer Tier = `A`
**Step 4.A — Update Opportunity Stage:** `Active Buyer — A Tier`
**Step 5.A — Send SMS:** `WF01_SMS_TierA_Confirm`
```
Confirmed {{contact.first_name}} — you're on our VIP buyer list. That means: first look on every new deal, priority response times, and direct line to me. Expect your first deal match within 7-14 days.
```
→ merge point (after ALL branches finish)

### Else: If/Else (Branch B: any 2 of 3 met)
- **Condition:** ((PoF on File = `Yes` AND Deals Last 12 Months >= `3`) OR (PoF on File = `Yes` AND Decision Maker = `Yes`) OR (Deals Last 12 Months >= `3` AND Decision Maker = `Yes`))
- GHL's condition builder supports grouped OR/AND — build 3 condition groups joined by OR

### If Branch B passes

**Step 2.B — Add Tag:** `engage:b-tier`
**Step 3.B — Update Contact Field:** Buyer Tier = `B`
**Step 4.B — Update Opportunity Stage:** `Active Buyer — B Tier`
**Step 5.B — Send SMS:** `WF01_SMS_TierB_Confirm`
→ merge

### Else: Branch C (everything else)

**Step 2.C — Add Tag:** `engage:c-tier`
**Step 3.C — Update Contact Field:** Buyer Tier = `C`
**Step 4.C — Update Opportunity Stage:** `Active Buyer — C Tier`
**Step 5.C — Send SMS:** `WF01_SMS_TierC_Confirm`

### Universal steps (after all 3 branches — merge point)

After each branch's tier-specific actions, add these 4 steps. You can either add them to the end of each branch separately, OR (if GHL supports) use a "merge" node and put them once.

**Step 6 — Add Tag:** `buyer:active`
**Step 7 — Remove Tag:** `buyer:new` (safety — in case WF01a didn't remove it)
**Step 8 — Update Contact Field:** Last Touch Date = today
**Step 9 — Update Contact Field:** Re-verify Due Date = **today + 90 days**
  - GHL expression: `{{right_now | date_add: "90", "days" | date: "%Y-%m-%d"}}`
  - If GHL doesn't support date arithmetic in expressions, use the "Set Date Field" action with "90 days from now" option

**Save + Publish.**

---

## WF02 — Deal Match & Send  (~15 min)

**Purpose:** When n8n tags a buyer with `deal:new-inventory`, send the tier-appropriate deal alert.

### Trigger
- **Contact Tag** → Tag Added → `deal:new-inventory`

### Step 1 — If/Else (Tier A)
- **Condition:** Custom field **Buyer Tier** = `A`

#### If Tier A

**Step 2.A — Send SMS:** `WF02_SMS_DealAlert_A`
```
🏠 VIP ALERT {{contact.first_name}} — new deal fits your box. {{custom_field.deal_asset_class}}, {{custom_field.deal_market}}, asking {{custom_field.deal_price}}. Full breakdown: {{custom_field.deal_summary_url}}. Reply YES and I'll send the address + underwriting.
```

**Step 3.A — Send Email:** `WF02_Email_DealAlert` (subject + body)
**Step 4.A — Update Contact Field:** Last Touch Date = today
**Step 5.A — Update Contact Field:** Last Deal Sent Date = today
→ merge

#### Else: If/Else (Tier B)

**Step 2.B — Wait:** 1 hour
**Step 3.B — Send SMS:** `WF02_SMS_DealAlert_B`
**Step 4.B — Send Email:** `WF02_Email_DealAlert`
**Step 5.B — Update Last Touch Date + Last Deal Sent Date**
→ merge

#### Else: Tier C

**Step 2.C — Wait:** 4 hours
**Step 3.C — Send SMS:** `WF02_SMS_DealAlert_C`
**Step 4.C — Send Email:** `WF02_Email_DealAlert`
**Step 5.C — Update Last Touch Date + Last Deal Sent Date**

### Universal after all 3 tiers

**Step 6 — Wait:** 24 hours

**Step 7 — If/Else:** did they reply to SMS OR click the deal link?
- Condition 1: Inbound message received within last 24h
- OR Condition 2: Email link clicked within last 24h (GHL tracks this)
- Join with OR

#### YES (they engaged)
**Step 8.Y — Update Opportunity Stage:** `Under Negotiation`
**Step 9.Y — Create Task:** assigned to Eddie, title `Buyer replied on deal — call within 2 hours`, due today
**Step 10.Y — (Optional) Webhook to Slack** — skip for now

#### NO
— do nothing

### Step 11 (CRITICAL) — Remove Tag: `deal:new-inventory`

**This step is MANDATORY.** Without it, the next deal won't re-fire the workflow because the tag is already present.

**Save + Publish.**

---

## WF03 — Close & Recycle  (~10 min)

**Purpose:** When a deal closes with a buyer, upgrade them to VIP + increment their deal counter.

### Trigger
- **Pipeline Stage Changed** → Pipeline: **Buyer Lifecycle** → Stage: **Closed**

### Step 1 — Add Tag: `buyer:vip`
### Step 2 — Update Contact Field: Buyer Tier = `A`
### Step 3 — Add Tag: `engage:a-tier`
### Step 4 — Remove Tags (two actions): `engage:b-tier`, `engage:c-tier`

### Step 5 — Webhook (increment deals counter)
- `+` → **Custom Webhook**
- Method: **POST**
- URL: `https://dealpros.app.n8n.cloud/webhook/increment-deals`
- Body (JSON):
  ```json
  { "contact_id": "{{contact.id}}" }
  ```
- Headers: Content-Type = `application/json`
- Save

### Step 6 — Update Contact Field: Last Touch Date = today
### Step 7 — Update Contact Field: Re-verify Due Date = today + 90 days

### Step 8 — Create Task
- Assigned to: Brooke
- Title: `Confirm assignment fee distributed for {{contact.first_name}} {{contact.last_name}}`
- Due: in 2 days

### Step 9 — Wait: 7 days
### Step 10 — Send SMS: `WF03_SMS_NextDeal`
```
{{contact.first_name}} — closing went smooth on your end right? Good. You're now VIP on our list — first look on everything moving forward. What's next on your acquisition wishlist? Hit me back with asset class + market and I'll prioritize it.
```

### Step 11 — Add Tag: `buyer:active` (defensive re-apply)

**Save + Publish.**

---

## WF04a — 90-Day Dormant Check  (~5 min)

**Purpose:** Auto-flag buyers who've gone silent for 90 days.

### Trigger
- **Schedule Trigger**
- Runs: **Daily**
- Time: **8:00 AM** (your timezone: America/Phoenix)
- Filter: **Contact has tag `buyer:active` AND Last Touch Date > 90 days ago**
  - In GHL's schedule trigger, use the "Filter Contacts" option
  - Condition: Tag contains `buyer:active` AND Last Touch Date is more than 90 days ago

### Step 1 — Remove Tag: `buyer:active`
### Step 2 — Add Tag: `buyer:dormant`
### Step 3 — Update Opportunity Stage: `Dormant`
### Step 4 — Update Contact Field: Last Touch Date = today
  - (prevents the same workflow re-firing tomorrow)

**Save + Publish.**

---

## WF04b — Quarterly POF Re-Verify  (~5 min)

**Purpose:** Every 90 days, ping the buyer to re-confirm POF + buy-box.

### Trigger
- **Schedule Trigger**
- Daily at **9:00 AM AZ**
- Filter: has tag `buyer:active` AND Re-verify Due Date <= today

### Step 1 — Send SMS: `WF04b_SMS_Reverify`
```
Quarterly check-in {{contact.first_name}} — need to refresh your POF on file so we keep sending you deals. Reply with updated POF amount + any market/buy box changes. Takes 30 seconds.
```

### Step 2 — Update Contact Field: PoF on File = `Pending`
### Step 3 — Update Contact Field: Last Touch Date = today
### Step 4 — Wait: 5 days

### Step 5 — If/Else: did they reply?
- Condition: Inbound message received within last 5 days

#### YES
- **Step 6.Y — Create Task** for Brooke: `Update POF for {{contact.first_name}} {{contact.last_name}}`, due today

#### NO
- **Step 6.N — Remove Tag:** `buyer:active`
- **Step 7.N — Add Tag:** `buyer:dormant`
- **Step 8.N — Update Opportunity Stage:** `Dormant`

**Save + Publish.**

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Workflow won't save — "stage not found" | Your pipeline stages don't match the names. Check GHL → Opportunities → Pipelines → Buyer Lifecycle. Stages must be exactly "New Buyer — Intake", "Active Buyer — A Tier", etc. |
| Custom field not in dropdown | Field name mismatch. Check `tfs-build/ghl/01_custom_fields_IDS.json` for exact names. |
| Tag not firing trigger | GHL tags are case-sensitive. `buyer:new` ≠ `Buyer:New`. Check `tfs-build/ghl/02_tags_IDS.json`. |
| Date arithmetic not working | GHL's date expression syntax varies. Fall back to the "Update Date Field" action with a "X days from now" option. |
| "If/Else" doesn't support OR grouping | Split into multiple nested If/Else nodes, or use a single If/Else with all conditions joined by OR (no nested groupings). |

---

## Testing the Chain

After you publish WF01a, WF01b, WF02:

1. **Create a test contact** in GHL with name "Test Buyer A", phone/email you control
2. **Apply tag `buyer:new`** manually → WF01a should fire → welcome SMS + email
3. **Move opportunity** to "Intake Call Complete" manually → WF01b fires → scores into tier based on fields
4. **Fire a test deal** to match engine:
   ```bash
   cd ~/termsforsale-site
   node scripts/dry-run-match-engine.js
   ```
5. **Verify in GHL** the contact got `deal:new-inventory` tag → WF02 fires → deal alert SMS/email arrives

If any step fails, check the workflow's execution log (GHL workflow → History tab).
