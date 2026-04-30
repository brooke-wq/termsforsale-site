# Phase 1 — GHL Sub-Account Setup Runbook

**Goal:** stand up two new GHL sub-accounts (Dispo Buddy + Acquisitions) ready
for code to talk to. No production traffic flips in this phase — Phase 1 is
pure infra prep.

**Decisions baked in:**

| Brand | Sub-account name | Sender email | Phone number |
|---|---|---|---|
| TFS | Terms For Sale (existing `7IyUgu1zpi38MDYpSDTs`) | `info@termsforsale.com` | `+1 480-637-3117` |
| DB | Dispo Buddy (NEW) | `partners@dispobuddy.com` | existing DID (BYOC port-in) |
| ACQ | Acquisitions (NEW) | `acquisitions@dealpros.com` | existing DID (BYOC port-in) |

**Estimated time:** 1–2 working days end-to-end. Real bottleneck is A2P
10DLC re-registration on the new numbers (24–72h carrier review).

---

## Pre-flight (15 min)

- [ ] Confirm GHL plan supports adding 2 more sub-accounts (Agency Pro tier
      typically allows unlimited; if on Starter, upgrade first)
- [ ] Confirm `dealpros.com` is owned by you and you have DNS access
      (Squarespace registrar)
- [ ] Identify the two existing DIDs you want to port in. Have:
  - the carrier name + account number
  - PIN / port-out passcode
  - billing zip on the carrier account
  - copy of a recent bill (some carriers require)
- [ ] Pick a project tracker for IDs. Recommend a **single Notion page** or
      a 1Password secure-note — DO NOT paste tokens into Slack, email, or git.

---

## Step 1 — Create the Dispo Buddy sub-account (10 min)

1. GHL agency dashboard → **Sub-accounts** → **Create new sub-account**
2. Settings:
   - Name: `Dispo Buddy`
   - Business name: `Dispo Buddy`
   - Email: `partners@dispobuddy.com`
   - Phone: leave blank for now (we attach the DID in step 4)
   - Address: same as TFS sub-account (Deal Pros LLC business address)
   - Timezone: America/Phoenix (no DST, matches existing)
   - Industry: Real Estate
3. Skip the snapshot import (we'll provision via script in step 5)
4. Open the new sub-account → **Settings → Business Profile**:
   - Business hours: Mon–Fri 8am–6pm AZ
   - Default From email: `partners@dispobuddy.com`
   - Reply-to: `partners@dispobuddy.com`
5. **Settings → Company → API Keys → Private Integrations** → Create:
   - Name: `Provisioner + Functions (DB)`
   - Scopes (turn on): `contacts.readonly`, `contacts.write`,
     `opportunities.readonly`, `opportunities.write`, `tags.readonly`,
     `tags.write`, `customFields.readonly`, `customFields.write`,
     `conversations.readonly`, `conversations.write`,
     `conversations/message.readonly`, `conversations/message.write`,
     `locations.readonly`, `users.readonly`, `notes.write`, `notes.readonly`
   - Save the `pit-...` token to your secure-note as
     **`GHL_API_TOKEN_DB`**
6. **Settings → Company → Location ID** (top of the page) → save to your
   secure-note as **`GHL_LOCATION_ID_DB`**

## Step 2 — Create the Acquisitions sub-account (10 min)

Same as Step 1 but:
   - Name: `Acquisitions`
   - Business name: `Deal Pros LLC` (legal entity owns the brand)
   - Email: `acquisitions@dealpros.com`
   - Same scopes on the Private Integration token
   - Save to secure-note as **`GHL_API_TOKEN_ACQ`** + **`GHL_LOCATION_ID_ACQ`**

## Step 3 — Verify the email sending domains (20 min + DNS propagation)

DB sender is `partners@dispobuddy.com`. ACQ sender is
`acquisitions@dealpros.com`. Both need SPF + DKIM verified per sub-account
(GHL handles each location's email reputation independently).

For each new sub-account:

1. **Settings → Email Services → Dedicated Domain** → Add Domain
2. Enter the bare domain (`dispobuddy.com` for DB, `dealpros.com` for ACQ)
3. GHL gives you 3 DNS records:
   - 1× TXT for SPF (or merge into existing `v=spf1` record — don't create
     a second one, you can only have one SPF record per domain)
   - 2× CNAME for DKIM (`mtaXX._domainkey...`)
4. Add those records in **Squarespace → DNS settings** for the
   corresponding domain
5. Wait 10–60 min for propagation, then click **Verify** in GHL — should
   flip to green checkmarks
6. Test send: from inside the new sub-account, send a test email to your
   personal inbox; check that it lands in inbox (not spam) and the
   `Authentication-Results` header shows `spf=pass` + `dkim=pass`

**`dealpros.com` is the new one** — this domain may not have any prior
email verification. Confirm Squarespace registrar still has the DNS panel
exposed for it before you book the sub-account work.

**`dispobuddy.com` was already sending** (Brooke's previous emails from
GHL). The DB sub-account's GHL still needs a fresh DKIM verification —
GHL keys are per-location, not shared across sub-accounts.

## Step 4 — Port the existing DIDs into the new sub-accounts (24–72h)

For each new sub-account:

1. Inside the new sub-account → **Settings → Phone Numbers → Add Number**
   → **Port a Number**
2. Enter the existing DID + carrier info collected in pre-flight
3. Sign + return the **Letter of Authorization** GHL emails
4. Wait for carrier release (Twilio handles this on GHL's behalf — typical
   24–72h, can be longer for landlines or if carrier disputes)
5. Once ported: number shows in GHL with green "Active" pill
6. **A2P 10DLC re-registration:** the brand and campaign on the original
   number do NOT carry over. Re-register:
   - **Settings → Phone Numbers → Trust Center → Brand** → register the
     legal entity (Deal Pros LLC, EIN, address)
   - **Trust Center → Campaign** → register a campaign for marketing or
     mixed use, depending on the brand's outbound mix
   - This is another 24–72h carrier review — start as early as possible
7. **DO NOT send marketing SMS** from a number that hasn't completed A2P
   campaign approval. Carriers will block + fine.

While you wait on Step 4, you can complete Steps 5–7 in parallel.

## Step 5 — Run the provisioner against each new sub-account (5 min each)

Provisioner has been generalized in Phase 0. Each run is idempotent — safe
to re-run on partial failures.

```bash
# from repo root
cd /home/user/termsforsale-site

# put credentials in .env (see .env.split.example)
# OR export inline:
export GHL_API_TOKEN_DB=pit-...   # from Step 1
export GHL_LOCATION_ID_DB=...     # from Step 1
export GHL_API_TOKEN_ACQ=pit-...  # from Step 2
export GHL_LOCATION_ID_ACQ=...    # from Step 2

# Dry-run first (no writes — preview the plan)
DRY_RUN=1 node scripts/provision-ghl.js --brand=db
DRY_RUN=1 node scripts/provision-ghl.js --brand=acq

# If dry-run looks correct, run live:
node scripts/provision-ghl.js --brand=db
node scripts/provision-ghl.js --brand=acq
```

Each live run writes the generated IDs to:

- `tfs-build/ghl-db/01_custom_fields_IDS.json`
- `tfs-build/ghl-db/02_tags_IDS.json`
- `tfs-build/ghl-db/03_pipeline_IDS.json`
- `tfs-build/ghl-acq/01_custom_fields_IDS.json`
- `tfs-build/ghl-acq/02_tags_IDS.json`
- `tfs-build/ghl-acq/03_pipeline_IDS.json`

**Commit those `_IDS.json` files** — Phase 2 code refactors will reference them.

**Spot-check after each run:**
- DB: in GHL → Settings → Custom Fields, expect 40 contact fields. Tags: 18.
  Pipeline "JV Deals" with 9 stages.
- ACQ: 65 contact fields, 36 tags, 1 pipeline "Seller Lifecycle" with 9
  stages. (Bird-Dog Triage and Equity Exit pipelines are documented in
  `docs/ghl-reference/acquisitions/acquisitions-opportunities.csv` but
  intentionally left for manual creation in v1 — operator builds them in
  the Pipelines UI when ready, or we extend the provisioner later.)

If any field/tag/stage failed, the `_IDS.json` will have an `error` key on
that entry — read it, fix the cause, re-run (idempotent — won't duplicate).

## Step 6 — Create a "Brooke" contact in each new sub-account (3 min each)

For each new sub-account → **Contacts → Add Contact**:

- Name: Brooke Froehlich
- Email: brooke@mydealpros.com (or whatever inbox you actually read)
- Phone: `+15167120113` (the existing internal alert phone per CLAUDE.md)
- Tags: skip — internal-only contact

After creation, copy the contact ID from the URL bar
(`/v2/location/.../contacts/detail/{contactId}`) and save:
- DB sub-account → **`BROOKE_CONTACT_ID_DB`**
- ACQ sub-account → **`BROOKE_CONTACT_ID_ACQ`**

These are used by per-brand internal SMS/email alerts in Phase 2.

## Step 7 — Build the GHL workflows in each new sub-account

Workflows trigger Netlify functions via webhook. The function URLs are the
same regardless of which sub-account the workflow lives in — Phase 2 code
will resolve the right brand client at runtime based on which Netlify site
hosts the function. No changes to webhook URLs needed across sub-accounts.

Use **`tfs-build/ghl/WF_MANUAL_BUILD_GUIDE.md`** as the template format.
Per brand:

### Dispo Buddy workflows

| Workflow name | Trigger | Action |
|---|---|---|
| Customer Reply | Inbound SMS or Email contains pattern | Webhook POST `https://dispobuddy.com/.netlify/functions/buyer-response-tag` body `{contactId, message, channel}` |
| Stage Change Notify | Opportunity Stage Changed (Pipeline = JV Deals) | Webhook POST `https://dispobuddy.com/.netlify/functions/partner-stage-notify` body `{contactId, opportunityId, stageName, pipelineName}` |
| New Submission | Tag Added `jv-submitted` | (DEFERRED — when re-enabling triage) Webhook POST `https://dispobuddy.com/.netlify/functions/dispo-buddy-triage` body `{contactId}` |

### Acquisitions workflows

| Workflow name | Trigger | Action |
|---|---|---|
| New Lead Intake | Tag Added `lead-new` | (Currently driven by droplet cron — workflow optional but useful for instant fire) Webhook POST `https://termsforsale.com/.netlify/functions/lead-intake` body `{contactId}` |
| Underwriting Trigger | Tag Added `uw-requested` | Webhook POST `https://termsforsale.com/.netlify/functions/underwriting-poller` body `{contactId}` |
| Customer Reply | Inbound SMS or Email | Webhook POST `https://termsforsale.com/.netlify/functions/buyer-response-tag` body `{contactId, message, channel}` (same function — gates by brand based on tags present on contact) |
| Calendar Booking | New Booking | Webhook POST `https://termsforsale.com/.netlify/functions/booking-notify` body `{contactId, calendarId, startTime}` |

Note: Phase 2 may add a brand-aware variant of `buyer-response-tag` and
`booking-notify` that lives at a `/api/acq-*` URL. For Phase 1, point at the
existing functions; refactor in Phase 2.

---

## Checkpoint — Phase 1 done when:

- [ ] DB sub-account exists, has API token, has Location ID recorded
- [ ] ACQ sub-account exists, has API token, has Location ID recorded
- [ ] Both `dispobuddy.com` and `dealpros.com` show DKIM=verified in their
      respective sub-accounts
- [ ] Both ported numbers show "Active" + A2P 10DLC campaign approved
      (or A2P paperwork submitted and acknowledged)
- [ ] Provisioner ran cleanly against both new sub-accounts; `_IDS.json`
      files committed to the branch
- [ ] Brooke contact created in both, IDs recorded
- [ ] Phase 1 workflow stubs built in each sub-account (Customer Reply,
      Stage Change Notify, etc.) — webhook URLs may 500 today since Phase 2
      code isn't shipped, that's expected

When all 7 checkboxes are green, you're ready for **Phase 2** (code refactor
to make `_ghl.js` brand-aware). Phase 2 ships dark — no production behavior
changes until brand-suffixed env vars are set on Netlify and the legacy
fallback is removed.

---

## Rollback

Phase 1 has zero production impact. To roll back:
1. In GHL agency dashboard, delete the two new sub-accounts
2. Squarespace DNS — remove the SPF/DKIM records you added
3. (Numbers stay portable — if you need to port back out, GHL releases on
   request)

The repo changes from Phase 0 (CLAUDE.md merge, provisioner generalization,
spec JSON) are independent and can stay in `main` regardless of whether
Phase 1 advances.
