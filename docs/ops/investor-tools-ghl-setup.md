# Investor Tools Hub: GHL Webhook Setup

**Created:** April 27, 2026
**Status:** Pending — `/tools.html` is live but submissions are silently dropped
**Estimated time:** 30 min (Option A, hardcode) or 90 min (Option B, proxy)
**Access needed:** GHL (Terms For Sale sub-account `7IyUgu1zpi38MDYpSDTs`) + Netlify dashboard

---

## Why this doc exists

The `/tools.html` calculator hub launched on 2026-04-27 (PR #153) with a
placeholder webhook URL. Right now:

- The gate form (First/Last/Email/Phone/Company) accepts submissions and
  unlocks the calculators visually.
- **No contact lands in GHL.** The JS detects the placeholder string and
  short-circuits with a `console.warn` — a fire-and-forget no-op.
- The "Save analysis" buttons inside each calculator have the same fate.

This doc walks through closing the loop. Read **Task 1** first (the GHL side
is the same either way), then pick **Option A** or **Option B** for the
client side.

The placeholder lives at `termsforsale/tools.html:951`:

    const GHL_WEBHOOK_URL = "REPLACE_WITH_GHL_INBOUND_WEBHOOK_URL";

---

## Task 1: Build the GHL workflow (~15 min)

The hub posts two different `event` types. One workflow with a branching
If/Else handles both cleanly.

### Steps

1. Log into GHL → switch to the **Terms For Sale** sub-account
   (location ID `7IyUgu1zpi38MDYpSDTs`).
2. Left sidebar → **Automation** → **Workflows** → **+ Create Workflow**
   → **Start from scratch**.
3. Name it `Investor Tools — Lead + Save Capture`.
4. **Add New Trigger** → search **Inbound Webhook** → select → **Save Trigger**.
5. GHL displays the **Webhook URL**. Copy it. Format:

       https://services.leadconnectorhq.com/hooks/<long-id>/webhook-trigger/<long-id>

6. Add the actions:

   **Action 1: Update or Create Contact** (this action de-duplicates by email
   so we don't pile up dupes on repeat sessions)
   - Email = `{{inboundWebhookRequest.email}}`
   - First Name = `{{inboundWebhookRequest.firstName}}`
   - Last Name = `{{inboundWebhookRequest.lastName}}`
   - Phone = `{{inboundWebhookRequest.phone}}`
   - Company = `{{inboundWebhookRequest.company}}`

   **Action 2: If/Else** branching on `{{inboundWebhookRequest.event}}`:

   - **Branch A — `event == "tools_signup"`**
     - Add tag: `tools_signup`
     - Add tag: `investor-tools-lead`
     - (Optional) Send a confirmation email welcoming them.
   - **Branch B — `event == "deal_save"`**
     - Add tag: `deal_save`
     - Add tag: `tools-{{inboundWebhookRequest.calculator}}`
       (gives you per-calculator visibility — `tools-analyzer`, `tools-dscr`, etc.)
     - (Optional) Send Brooke an internal SMS at `+1 480-637-3117` so
       you know in real time when a buyer saves a deal.

7. Click **Publish**. The workflow is now live.

### Payload reference (from `tools.html`)

**`tools_signup`** fires once per gate submission:

    {
      "event": "tools_signup",
      "firstName": "...",
      "lastName": "...",
      "email": "...",
      "phone": "...",
      "company": "...",
      "source": "Investor Tools Hub",
      "submittedAt": "<ISO timestamp>"
    }

**`deal_save`** fires every time a "Save analysis" button is clicked:

    {
      "event": "deal_save",
      "calculator": "analyzer" | "caprate" | "dscr" | "coc" | "mortgage" | "seller",
      "email": "...",
      "firstName": "...",
      "lastName": "...",
      "analysis": { ... calculator-specific outputs ... }
    }

---

## Task 2: Wire the URL into the site

Two options — pick one. Trade-off is roughly **5 min of work** vs **a
spam-able public URL**.

### Option A: Hardcode the URL (~10 min)

**Tradeoff:** Anyone who views the source of `/tools.html` (or scrapes the
public repo) sees the webhook URL. They could fire fake `tools_signup`
events at your CRM. Mitigations:

- GHL inbound webhooks are not authenticated, but they DO rate-limit at the
  workflow level.
- If abused, you can rotate the URL by deleting the trigger and creating a
  new one (the URL changes), then deploying the new URL.
- Bots will eventually find it. Plan on rotating once or twice a year, or
  whenever you see junk leads.

**Steps:**

1. Open `termsforsale/tools.html`, find line containing
   `const GHL_WEBHOOK_URL = "REPLACE_WITH_GHL_INBOUND_WEBHOOK_URL";`
2. Replace with:

       const GHL_WEBHOOK_URL = "https://services.leadconnectorhq.com/hooks/.../webhook-trigger/...";

3. Commit + push, merge to `main`, Netlify auto-deploys.
4. Run **Task 3** (test fire) to verify.

### Option B: Netlify environment variable + serverless proxy (~75 min)

**Tradeoff:** Webhook URL never reaches the browser. Bots can still spam
your `/api/tools-webhook` endpoint, but at least the URL isn't public, and
you can add bot-mitigation (Turnstile, simple rate limit) inside the proxy.

**Steps:**

1. Create `termsforsale/netlify/functions/tools-webhook.js`:

       exports.handler = async (event) => {
         if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
         const url = process.env.GHL_TOOLS_WEBHOOK_URL;
         if (!url) return { statusCode: 500, body: "Webhook not configured" };
         try {
           await fetch(url, {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: event.body
           });
           return { statusCode: 200, body: "ok" };
         } catch (err) {
           console.error("[tools-webhook] forward failed:", err);
           return { statusCode: 502, body: "upstream failed" };
         }
       };

2. Add a redirect to `netlify.toml` (in the `/api/*` block):

       [[redirects]]
         from = "/api/tools-webhook"
         to = "/.netlify/functions/tools-webhook"
         status = 200

3. In the Netlify dashboard → **Site settings → Environment variables**,
   add `GHL_TOOLS_WEBHOOK_URL` with the URL from Task 1, scoped to
   **All deploys**. Save.
4. In `termsforsale/tools.html`, change the constant:

       const GHL_WEBHOOK_URL = "/api/tools-webhook";

5. (Optional hardening) Add Cloudflare Turnstile or hCaptcha to the gate
   form, validate the token in the proxy before forwarding.
6. Commit + push, merge, Netlify deploys both the function and the page.
7. Run **Task 3** (test fire) to verify.

---

## Task 3: Test fire (~5 min)

After deploy:

1. Open `https://termsforsale.com/tools.html` in an **incognito window**
   (so sessionStorage is clean and the gate appears).
2. Open DevTools → Network tab → keep the panel open.
3. Submit the gate with **your own** name + email + phone (not a fake email
   — you want to actually see the contact in GHL).
4. **Expected (Option A):** Network tab shows a POST to
   `services.leadconnectorhq.com/hooks/...` with status 200 (or no status,
   since `mode: "no-cors"` masks it) and **no console error**. Then check
   GHL → Contacts → search your email — the contact should exist with
   tags `tools_signup` and `investor-tools-lead`.
5. **Expected (Option B):** Network tab shows a POST to
   `/api/tools-webhook` with HTTP 200. Same contact check in GHL.
6. After the gate clears, click into the **Full Deal Analyzer** → click
   **Save deal & alert me to matches**. The save toast appears.
7. Verify in GHL that your contact picked up the `deal_save` tag (and
   `tools-analyzer`).

### Fail modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Gate clears but no contact in GHL | Workflow not Published | Re-publish in GHL |
| `console.warn` "GHL webhook not configured" | Placeholder still in code | You haven't deployed Task 2 yet |
| 404 on `/api/tools-webhook` (Option B) | Function file path wrong, or netlify.toml redirect not deployed | Check `termsforsale/netlify/functions/tools-webhook.js` exists, redeploy |
| Contact created but no tags | If/Else condition misconfigured (case-sensitive event names) | Use exact strings `tools_signup` / `deal_save` |
| Duplicate contacts on every visit | "Update or Create" action set to "Create only" | Switch to "Update or Create" |

---

## What NOT to do

- Do **NOT** add a second sender of buyer-facing alerts here. This webhook
  is intake-only. The single canonical buyer broadcast sender lives in
  `termsforsale/netlify/functions/` (see `CLAUDE.md` for the post-2026-04-22
  rules). Don't accidentally wire `deal_save` to a workflow that messages
  buyers.
- Do **NOT** commit Option A's hardcoded URL to a private fork and forget
  to update the public repo — the placeholder will keep silently dropping
  signups in production.
- Do **NOT** skip the `Update or Create Contact` action and use plain
  "Create Contact" — repeat sessions will pile up duplicate contacts.
- Do **NOT** route the test contact through the buyer-blast pipeline. Tag
  this lead distinctly so you can exclude `investor-tools-lead` from
  buyer-broadcast smart lists if/when needed.

---

## Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-04-27 | Ship `/tools.html` with placeholder URL, public repo | Repo is public, hardcoding a real URL on day 1 felt premature. Hub already gracefully degrades. |
| TBD | Pick Option A or B | Pending |
