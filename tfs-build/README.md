# TFS Buyer Lifecycle — Build Package

Full implementation package for the Terms For Sale buyer lifecycle system across GHL, n8n, and Notion.

## File Map

```
tfs-build/
├── sop/
│   └── TFS_Buyer_Lifecycle_Build_SOP.md     ← START HERE. Master build SOP with checklist + step-by-step process.
│
├── ghl/                                      ← GoHighLevel assets (Terms For Sale sub-account)
│   ├── 01_custom_fields.json                 ← 21 custom fields. Build FIRST.
│   ├── 02_tags.json                          ← 9 tags + rules. Build SECOND.
│   ├── 03_pipeline.json                      ← 12-stage Buyer Lifecycle pipeline. Build THIRD.
│   ├── WF01_intake_scoring.json              ← Intake + tier scoring. AI Builder prompt + all SMS/email copy.
│   ├── WF02_deal_match_send.json             ← Tier-staggered deal blasts.
│   ├── WF03_close_recycle.json               ← VIP upgrade + deal counter increment via n8n.
│   └── WF04_maintenance.json                 ← 90-day dormant + quarterly POF re-verify (two workflows).
│
├── forms/
│   └── intake_forms.json                     ← Light qualifier (4 fields) + full intake (16 fields).
│
└── n8n/                                      ← Self-hosted n8n workflows
    ├── 01_buyer_match_engine.json            ← THE BRAIN. Import this directly.
    ├── 02_notion_bridge.json                 ← Polls Notion Deal Inventory every 10 min.
    ├── 03_helper_increment.json              ← +1 math GHL can't do natively.
    └── 04_rollover_and_deadletter.json       ← Monthly cleanup + dead-letter log spec.
```

## Recommended Build Order

1. **Read the SOP cover-to-cover** (15 min). Understand the full flow before clicking anything.
2. **GHL foundation** (60–90 min): custom fields → tags → pipeline → forms.
3. **n8n credentials + imports** (45 min): GHL Private Integration Token, Notion Integration, import 3 workflows.
4. **GHL workflows** (2 hrs): WF01 → WF02 → WF03 → WF04. Paste AI Builder prompts, then paste message copy.
5. **End-to-end test** (30 min): 3 dummy buyers (one per tier) + 1 test deal via curl or Notion.
6. **Slack webhook + dead-letter log** (30 min): Set up internal notifications and the Match Engine Log Notion DB.

Total: 6–8 hours end-to-end.

## Key Architecture Decisions

- **Match logic lives in n8n, not GHL.** GHL if/else branches can't efficiently filter 100+ buyers against a deal's 3 criteria. n8n does it in one JS node.
- **Dual deal inventory source.** GHL Opportunities pipeline OR Notion database — both fire the same webhook.
- **Staggered sends enforce tier priority.** A-tier immediate, B-tier +1h, C-tier +4h. Done via n8n Wait nodes, not GHL (which burns a workflow slot per wait).
- **Cooldown gate prevents spam.** n8n skips any buyer whose Last Deal Sent Date is within 24 hours.
- **Every workflow updates Last Touch Date.** This is what the 90-day dormant rule reads. Miss one and you falsely dormant-flag active buyers.

## Cost

- n8n: $0 (self-hosted, existing DigitalOcean instance).
- GHL API: $0 (included).
- SMS/email: ~$25–30/month at current volume (100 buyers × 1 deal/week).
- No Claude API calls in the matching engine. Pure deterministic JS.

## Owner

Brooke Froehlich — operator/COO, Deal Pros LLC.
