# n8n Manual Import Guide (Free-Trial Workaround)

The n8n Cloud REST API at `/api/v1/` requires a Starter+ plan. On Free
trial, you import through the UI — same end result, ~15 minutes of
click-work.

## Prerequisites

1. Run `node scripts/provision-ghl.js` first so the GHL fields exist.
2. Run `node scripts/prepare-n8n-manual-import.js` — this renders the 3
   workflow JSONs with your location ID, Notion DB ID, and GHL field IDs
   inlined. Outputs to `tfs-build/n8n/ready-to-import/`.
3. Open https://dealpros.app.n8n.cloud/ in your browser.

## Step 1 — Create 2 Credentials (one-time)

### GHL Credential

1. Left sidebar → **Credentials** → **Add credential** (top right)
2. Search for **"HTTP Header Auth"** → select it
3. Fill in:
   - **Name:** `GHL Private Integration Token`
   - **Header Name:** `Authorization`
   - **Header Value:** `Bearer pit-90ea9624-e782-47b0-b727-0c13382732c8`
     (paste your actual token from `.env`, prefixed with `Bearer `)
4. Click **Save**

### Notion Credential

1. **Credentials** → **Add credential**
2. Search for **"Notion API"** → select it
3. Fill in:
   - **Name:** `Notion TFS Integration`
   - **Internal Integration Secret:** `ntn_M2429973991b4YnRpZgrIWWLSEw2WZDnTRsD2WlcXt62cc`
     (or whatever is in your `.env` as `NOTION_SECRET`)
4. Click **Save**

## Step 2 — Import the 3 Workflows

For each of these 3 files, follow the import steps below:
- `tfs-build/n8n/ready-to-import/01_buyer_match_engine.json`
- `tfs-build/n8n/ready-to-import/02_notion_bridge.json`
- `tfs-build/n8n/ready-to-import/03_helper_increment.json`

**Import steps (repeat for each file):**

1. Left sidebar → **Workflows** → click the dropdown arrow next to the
   "Create Workflow" button top-right → **Import from File**
2. Select the JSON file → wait for the flow graph to render
3. The imported workflow opens with credential warnings on some nodes
   (red badge). For each flagged node:
   - Click the node
   - In the Credential dropdown, select the matching credential you
     created in Step 1
     (GHL nodes → "GHL Private Integration Token", Notion nodes → "Notion TFS Integration")
   - Close the panel
4. Top right → click the **Active** toggle so it turns green
5. Note the workflow's webhook URL if it has one (visible on the
   Webhook node, labeled "Production URL")

## Step 3 — Copy the Match Engine Webhook URL

1. Open the **TFS — Buyer Match Engine** workflow
2. Click the **"Webhook: New Deal"** node
3. Copy the **"Production URL"** (looks like `https://dealpros.app.n8n.cloud/webhook/new-deal-inventory`)
4. Paste it to me so I update the dry-run script and BUILD_STATUS doc

## Step 4 — Test the Match Engine

Run from the repo root:
```bash
node scripts/dry-run-match-engine.js
```

This POSTs a test deal to the webhook. Expected result:
- HTTP 200 within a few seconds
- Execution in n8n shows "Success"
- "Filter & Match Buyers" code node returns 0 items (no real buyers yet — 0 is correct)

If the execution log shows an error, paste it to me.

## Step 5 — Activate the GHL Trigger for WF03 Close & Recycle

The helper-increment workflow has a webhook at
`https://dealpros.app.n8n.cloud/webhook/increment-deals`.

When you build the GHL WF03 workflow (see Phase 4 manual checklist),
paste this URL into the Webhook action.

---

## Troubleshooting

**"Cannot find credential"** — your credential name doesn't match the
name the workflow JSON expects. Rename the credential to exactly
`GHL Private Integration Token` or `Notion TFS Integration`.

**Notion node errors on the filter** — make sure your integration has
been added to the deals DB: open the DB in Notion → ⋯ → Connections →
your integration name.

**Workflow won't activate** — check the execution log for the specific
node error. Most common: (a) credential not attached, (b) URL contains
a literal `{{ $env.X }}` (meaning the prep script didn't substitute —
make sure you imported from `ready-to-import/` not from the raw source
files).
