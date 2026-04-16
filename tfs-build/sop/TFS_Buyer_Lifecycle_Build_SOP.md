# Buyer Lifecycle System — Build SOP

## Title
Build and deploy the Terms For Sale Buyer Lifecycle System — a closed-loop automation covering buyer intake, scoring, deal matching, disposition, and lifecycle maintenance. Combines GoHighLevel for CRM and communication, n8n for matching logic and math, and Notion for deal inventory source.

## Owner
Brooke Froehlich (operator/COO). Execution lead. Eddie (acquisitions) is notified on hot buyer replies but does not own build steps.

## Resources
| | |
|---|---|
| GHL Sub-Account | Terms For Sale (under REI Built white-label agency) |
| n8n Instance | Self-hosted on DigitalOcean (existing) |
| Notion Workspace | Deal Pros — TFS Deal Inventory DB |
| Asset Package | tfs-build.zip — 14 files across ghl/, n8n/, forms/, sop/ |
| GHL API Docs | https://highlevel.stoplight.io/docs/integrations |
| Estimated Build Time | 6–8 hours end to end (can split across 2 days) |
| Ongoing Cost | $0 incremental (self-hosted n8n). SMS/email = existing GHL LC Phone + Mailgun rates. |

## Timing
- Pre-build setup (custom fields, tags, pipeline): 60–90 minutes.
- Forms build: 30 minutes.
- GHL workflows (WF01–WF04): 2 hours.
- n8n match engine + Notion bridge: 90 minutes (credentials + import).
- Testing with 3 dummy buyers + 1 test deal: 30 minutes.
- Documentation + Slack notification setup: 30 minutes.

## Purpose
Eliminate manual buyer matching. Every deal that hits inventory gets automatically routed to the right buyers, in the right order, at the right time — with zero operator touch after publish. Three outcomes:
1. Faster dispositions. A-tier buyers get first look within minutes, not hours.
2. Tier-enforced priority. VIP buyers earn and keep preferential treatment without Brooke remembering to prioritize them.
3. Self-cleaning list. Dormant buyers roll off automatically. Closed deals upgrade buyers to VIP automatically. The list stays accurate without manual maintenance.

## Checklist
Complete in order. Do not build downstream items before upstream ones — they have dependencies.

- [ ] Create 21 custom fields in GHL (per ghl/01_custom_fields.json) grouped under 'Buyer Profile' folder.
- [ ] Create 9 tags in GHL (per ghl/02_tags.json).
- [ ] Build Buyer Lifecycle pipeline with all 12 stages (per ghl/03_pipeline.json).
- [ ] Build both intake forms in GHL Sites → Forms (per forms/intake_forms.json).
- [ ] Generate GHL Private Integration Token (Settings → Private Integrations) with contacts.read, contacts.write, locations.read scopes.
- [ ] Create GHL credential in n8n using the Private Integration Token.
- [ ] Create Notion internal integration and share the Deal Inventory DB with it.
- [ ] Import n8n workflow 01_buyer_match_engine.json. Set env var GHL_LOCATION_ID.
- [ ] Import n8n workflow 02_notion_bridge.json. Set env var NOTION_DEAL_INVENTORY_DB_ID.
- [ ] Import n8n workflow 03_helper_increment.json.
- [ ] Build WF01 in GHL using AI Builder prompt from ghl/WF01_intake_scoring.json.
- [ ] Build WF02 using prompt from WF02_deal_match_send.json.
- [ ] Build WF03 using prompt from WF03_close_recycle.json.
- [ ] Build WF04a and WF04b using prompts from WF04_maintenance.json.
- [ ] Run end-to-end test with 3 dummy contacts (one per tier) and 1 test deal.
- [ ] Set up Slack webhook URL for internal notifications.
- [ ] Document the n8n webhook URL in your ops runbook.

## Process

### Phase 1 — GHL Foundation (60–90 min)
All downstream workflows depend on fields and tags existing. Build these first or everything else breaks silently.

#### 1.1 Custom Fields
Settings → Custom Fields → Contacts → + Add Field. For each field in ghl/01_custom_fields.json, create with the exact Name and Type listed. Group them into a folder called 'Buyer Profile'. Critical: field names must match exactly or n8n matching will fail.

#### 1.2 Tags
Settings → Tags → + Add Tag. Create all 9 tags from ghl/02_tags.json. Tags are case-sensitive — use lowercase with colons exactly as listed.

#### 1.3 Pipeline
Opportunities → Pipelines → + New Pipeline. Name: 'Buyer Lifecycle'. Add 12 stages in order per ghl/03_pipeline.json.

#### 1.4 Forms
Sites → Forms → Builder → + New Form. Build two forms per forms/intake_forms.json: Light Qualifier (4 fields) and Full Buyer Intake (16 fields). Map each form field to the corresponding custom field.

### Phase 2 — n8n Engine (90 min)

#### 2.1 Create GHL Private Integration Token
1. GHL → Settings → Private Integrations → Create New Integration.
2. Scopes: contacts.readonly, contacts.write, locations.readonly, opportunities.readonly, opportunities.write.
3. Copy the token — it only shows once.
4. Settings → Business Profile → copy Location ID.

#### 2.2 Create Notion Integration
1. notion.so/my-integrations → + New integration. Name: 'TFS n8n Bridge'. Type: Internal.
2. Capabilities: Read, Update, Insert.
3. Copy the Internal Integration Secret.
4. Open TFS Deal Inventory DB → Connections → Add connection → 'TFS n8n Bridge'.

#### 2.3 Add Credentials in n8n
- 'GHL Private Integration Token' — Type: HTTP Header Auth. Header: Authorization. Value: Bearer <token>
- 'Notion TFS Integration' — Type: Notion API. Paste secret.

#### 2.4 Set Environment Variables
```
GHL_LOCATION_ID=<your-tfs-location-id>
NOTION_DEAL_INVENTORY_DB_ID=<your-notion-db-id>
TZ=America/Phoenix
```
Restart n8n after adding.

#### 2.5 Import Workflows
1. Workflows → Import from File → 01_buyer_match_engine.json.
2. Verify credential dropdowns on every HTTP Request node.
3. Activate and copy the webhook URL.
4. Repeat for 02_notion_bridge.json and 03_helper_increment.json.

### Phase 3 — GHL Workflows (2 hrs)
Each uses GHL's AI Builder. Paste ai_builder_prompt from the JSON file, then paste the SMS/email copy into each communication step.

#### 3.1 WF01 — Buyer Intake & Scoring
Automations → Workflows → + New → Start with AI. Paste prompt. Review flow — AI Builder occasionally mis-orders steps. Then paste message copy.

#### 3.2 WF02 — Deal Match & Send
Before building, create the 5 extra custom fields under `additional_custom_fields_required_for_wf02`.

#### 3.3 WF03 — Close & Recycle
Step 2 uses a Webhook action to n8n at `https://n8n.dealpros.io/webhook/increment-deals` with payload `{ contact_id: {{contact.id}} }`.

#### 3.4 WF04a + WF04b — Maintenance
Build as two separate scheduled workflows. Daily cron triggers.

### Phase 4 — End-to-End Test (30 min)

#### 4.1 Create Three Test Buyers
| Tier | Fields |
|---|---|
| A | PoF=Yes, Deals=5, Decision Maker=Yes |
| B | PoF=Yes, Deals=1, Decision Maker=Yes |
| C | PoF=No, Deals=0, Decision Maker=No |

For all three: Buyer Asset Class=SFR, Market='Phoenix AZ', Price Min=100000, Price Max=300000.

#### 4.2 Fire a Test Deal
Option A (Notion): Add deal to Notion DB with Status='Ready to Blast', Blasted=false. Wait up to 10 min.

Option B (direct):
```
curl -X POST https://n8n.dealpros.io/webhook/new-deal-inventory \
  -H 'Content-Type: application/json' \
  -d '{"deal_id":"test-001","asset_class":"SFR","market":"Phoenix AZ","price":200000,"deal_type":"Wholesale","summary_url":"https://example.com"}'
```

#### 4.3 Verify
- [ ] Buyer A received SMS immediately.
- [ ] Buyer B received SMS 1 hour later.
- [ ] Buyer C received SMS 4 hours later.
- [ ] All three have the deal custom fields populated.
- [ ] All three have tag deal:new-inventory applied, then removed after WF02 completes.
- [ ] Moving any test buyer to 'Closed' stage fires WF03 and increments Deals Last 12 Months by 1.

#### 4.4 If Anything Fails
1. n8n execution log — find the errored node. Most common: credentials not attached or field key mismatch.
2. GHL workflow history — any step 'skipped' means a condition didn't evaluate as expected.
3. Tag applied? If not, n8n is firing but HTTP request is failing.
4. WF02 not firing? Check trigger is 'Contact Tag Added' (not 'Tag Exists') with exact tag name.

## Cost Breakdown
| | |
|---|---|
| n8n executions | $0 (self-hosted) |
| GHL API calls | $0 (included) |
| GHL SMS | ~$0.015/send. 100 buyers × 1 deal/week = $6/week |
| GHL Email | ~$0.00068/send. 100 × 1 deal/week = $0.27/week |
| Notion API | $0 |
| Claude API | $0 (not used — pure deterministic JS) |
| Total monthly | ~$25–30 in SMS/email at current volume |

## Out of Scope (v2 Candidates)
- AI deal summary generation (add Claude API node later, ~$0.01–$0.05/deal)
- Two-way SMS reply parsing (GHL handles natively; add NLP only if needed)
- Buyer portal with login (v1 stays in SMS/email/booking)
- Weighted scoring with recency decay (current model is 3-variable binary)

## Next Steps After Go-Live
1. Week 1: monitor execution logs + Match Engine Log Notion DB. Fix 0-match deals.
2. Week 2: run first dormant check; confirm it doesn't flag active buyers.
3. Week 4: review tier distribution. If everyone's Tier C, loosen criteria. Everyone's A, tighten.
4. Month 2: build optional v2 (AI summaries, reply parsing, portal).
