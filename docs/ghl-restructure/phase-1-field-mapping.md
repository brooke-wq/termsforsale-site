# GHL Buyer System Restructure — Phase 1: Field Mapping

**Branch:** `claude/restructure-ghl-buyer-system-SBYYf`
**Source data:** GHL Contact export Apr 17 2026 (17,346 contacts, 62 fields)
**Signed-off decisions:**
1. SFR-only buyers → existing values go to `BB_SFR_Flip_*`; multi-asset → `BB_Legacy_*` holding fields, buyer re-scopes on next edit
2. Added `BB_Priority_Counties` + `BB_Priority_Zips` to canonical schema (keeps 14% + 35% fill data)
3. Split profile gates: `BB_Buyer_Profile_Cash_Active` + `BB_Buyer_Profile_Creative_Active` (yes/no each)
4. `alert_*` and `deal_*` fields → new group `08 – Last Deal Alert` (stay outside BB_ namespace)
5. Deprecate <0.5% fill fields that don't map cleanly to target schema

---

## Summary counts

| Action | Count |
|---|---|
| Keep as-is (system identity) | 6 |
| Rename into BB_ schema | 26 |
| Rename into `08 – Last Deal Alert` group | 11 |
| **Deprecate** | 16 |
| **Schema additions beyond original spec (see §4)** | 11 |
| Flagged duplicates to merge | 2 pairs |
| Total old fields audited | 62 |

---

## 1. Mapping table — Keep / Rename

Columns: **Old_Key** | **Old_Label** | **Fill %** | **Action** | **New_Key** | **New_Group** | **Notes**

### System / Identity (no BB_ prefix — GHL core)

| Old_Key | Old_Label | Fill % | Action | New_Key | New_Group | Notes |
|---|---|---|---|---|---|---|
| `contact_id` | Contact Id | 100 | keep | `contact_id` | System | GHL internal |
| `first_name` | First Name | 96.4 | keep | `first_name` | System | |
| `last_name` | Last Name | 85.4 | keep | `last_name` | System | |
| `phone` | Phone | 93.8 | keep | `phone` | System | E.164 |
| `email` | Email | 66.9 | keep | `email` | System | |
| `tags` | Tags | 95.7 | keep | `tags` | System | 440 unique tags in data — separate tag-hygiene pass recommended |

### 01 – Buyer Core

| Old_Key | Old_Label | Fill % | Action | New_Key | Notes |
|---|---|---|---|---|---|
| `buyer_type` | Contact Role | 71.7 | keep name | `Contact_Role` (no BB_ prefix — it's identity, not criteria) | Values: Buyer / Wholesaler. Critical filter — CLAUDE.md notes broken backfill already |
| `buyer_status` | Vetted Status | 5.0 | keep name | `Vetted_Status` (no BB_ prefix — operational status) | Values: "Buys Now" etc. |
| `buyer_tier` | Buyer Tier | 0.2 | rename | `BB_Volume_Tier` | A/B/C. Only 28 filled — will need re-collect but preserve existing |
| `purchase_timeline` | Purchase Timeline | 8.4 | rename | `BB_Purchase_Timeline` | Immediate / Short-Term / Long-Term |
| `capacity_90d` | Capacity 90D | 0.9 | rename | `BB_Capacity_90d` | Integer. Also derive `BB_Max_Deals_Per_Month` = capacity_90d / 3 during migration |
| `criteria_last_update` | Criteria Last Update | 4.2 | rename | `BB_Criteria_Last_Update` | Audit field |
| `deal_alerts_delivered_by` | Deal Alerts Delivered By | 4.3 | rename | `BB_Alert_Channel_Pref` | SMS / Email / Both / Phone |
| `pof_on_file` | PoF on File | 0.3 | rename | `BB_Proof_Of_Funds_Provided` | Yes/No. Also add new `BB_Proof_Of_Funds_URL` for the file itself |
| `buy_box` | Buy Box Notes | 25.8 | rename | `BB_Notes_Legacy` | Free-text dump from old import. Keep for reference; don't use as source of truth |
| `deal_structure` | Deal Structures | 35.7 | SPLIT | see §2 | Needs split into Cash/Creative profile gates + per-asset will-do flags |
| `property_type_new` | Property Type | 30.3 | REMAP | `BB_Asset_Types_Active` | See §3 for translation table |
| `exits` | Exit Strategies | 12.7 | SPLIT | see §2 | Mix of exits + hold-strategies + structures |
| `states_buying_in` | Target States | 57.6 | rename | `BB_Priority_States` | Highest-quality geo field. Multi-select |
| `target_location` | Target Cities | 26.8 | rename | `BB_Priority_Metros` | Array of `[City, State]` pairs |
| `counties` | Target Counties | 14.1 | rename | `BB_Priority_Counties` | NEW field in canonical schema (decision 2) |
| `target_zips` | Target Markets | 35.1 | rename + clean | `BB_Priority_Zips` | NEW field (decision 2). BUT: sample values show this is NOT zips — it's a messy mix of city/state/zip. Migration needs a cleaner pass that splits into states/cities/zips based on content pattern |
| `neighborhood_class` | Neighborhood Class | 0.2 | rename | `BB_Neighborhood_Class_Pref` | A/B/C/D. Cross-asset — kept in Core per spec |
| `occupancy_preference` | Occupancy Preference | 0.5 | rename | `BB_Occupancy_Preference` | Vacant/Tenant/Either. Cross-asset |

### 02 – Profile: SFR (shared)

| Old_Key | Old_Label | Fill % | Action | New_Key | Notes |
|---|---|---|---|---|---|
| `bedrooms_min` | Min Beds | 7.6 | rename | `BB_SFR_Min_Beds` | SFR-specific per spec |
| `baths_min` | Min Baths | 6.8 | rename | `BB_SFR_Min_Baths` | |
| `min_sqft` | Min Square Footage | 4.5 | rename | `BB_SFR_Min_Sqft` | |
| `min_year_build` | Min Year Built | 4.4 | rename | `BB_SFR_Min_Year_Built` | |
| `remodel_level` | Condition | 8.1 | remap | `BB_SFR_Condition_Tolerance` | Remap table: Turnkey→Wholetail, Light Remodel→Light, Medium→Heavy(?), Heavy→Gut, Teardown→separate flag |
| `hoa` | HOA | 1.4 | rename | `BB_SFR_HOA_OK` | Yes/No. **Duplicates `hoa_tolerance` — merge** |
| `hoa_tolerance` | HOA Tolerance | 1.4 | **deprecate** | — | Duplicate of `hoa` (identical 246 fill count) |
| `pool` | Pool | 0.4 | rename | `BB_SFR_Pool_OK` | Borderline <0.5%, but useful dealbreaker flag — keep |

### 02 – Profile: SFR Flip

| Old_Key | Old_Label | Fill % | Action | New_Key | Notes |
|---|---|---|---|---|---|
| `max_price` | Max Purchase Price | 13.0 | CONDITIONAL MIGRATE | `BB_SFR_Flip_Max_Purchase_Price` (SFR-only buyers) OR `BB_Legacy_Max_Price` (multi-asset) | Decision 1 option A |
| `max_repair_budget` | Max Repair Budget | 0.1 | rename | `BB_SFR_Flip_Max_Rehab_$` | Sparse but maps cleanly |
| `_of_arv` | % of ARV | 1.3 | rename | `BB_SFR_Flip_Max_AllIn_%_ARV` | Key currently starts with `_` — legacy bug |
| `min_gross_profit` | Min Gross Profit | 0.0 | rename (re-collect) | `BB_SFR_Flip_Min_Gross_Profit_$` | Only 3 records; ship field but accept near-zero migration |
| `min_gross_margin_5` | Min Gross Margin | 0.2 | rename (data quality flag) | `BB_SFR_Flip_Min_Gross_Profit_%` | Key corrupted (`_5` looks like `%` mangled). Sample values mixed $ and % — **migration script must manually review 30 records** |
| `arv` | Minimum ARV | 0.6 | **deprecate** | — | Label "Minimum ARV" is ambiguous (flip min or hold min?), fill too low. Re-collect |

### 02 – Profile: SFR Hold

| Old_Key | Old_Label | Fill % | Action | New_Key | Notes |
|---|---|---|---|---|---|
| `target_monthly_cashflow` | Min Monthly Cashflow | 0.4 | rename | `BB_SFR_Hold_Min_Cashflow_$` | |
| `coc_return` | CoC Return | 0.1 | rename | `BB_SFR_Hold_Min_CoC_%` | |
| `cap_rate` | Cap Rate % | 0.1 | rename | `BB_SFR_Hold_Min_Cap_%` | Also maps to SMF/LMF if buyer is MF — migration default to SFR |
| `max_down` | Max Entry Fee | 2.2 | rename | `BB_SFR_Hold_Creative_Max_EntryFee_$` | NEW sub-field (see §4) |
| `max_monthly` | Max Monthly Payment | 1.7 | rename | `BB_SFR_Hold_Creative_Max_PITI_$` | NEW sub-field |
| `max_rate_` | Max Interest Rate | 2.3 | rename | `BB_SFR_Hold_Creative_Max_Rate_%` | Key has trailing `_` — legacy bug |
| `max_entry_` | Max Entry % | 1.7 | **deprecate — data corrupted** | — | Label says %, values mix `12` / `450000` / `15` (half $, half %). Unreliable — re-collect via new form |

### 03 – Profile: Small MF (2-20)

*No existing fields map cleanly. Migration creates empty `BB_SMF_*` group; buyers with `property_type_new` containing "Multi-Family (2-4)" get `BB_SMF_Profile_Active = Yes` and re-scope on next edit.*

`noi` (0.0%, 7 records) → **deprecate** (too sparse to be useful, re-collect)

### 04 – Profile: Large MF (20+)

*No existing fields map cleanly. Buyers with `property_type_new` containing "Multi-Family 5+" get `BB_LMF_Profile_Active = Yes` AND a flag requiring manual review — current "5+" is ambiguous (could be Small MF 5-20 or Large MF 20+). Set `BB_Needs_Rescope = Yes` during migration.*

### 05 – Profile: Commercial / Industrial

*No existing fields map cleanly. Buyers with `property_type_new` ∈ {Commercial, Storage, Hotels/Motels, Industrial} get `BB_COM_Profile_Active = Yes`.*

### 06 – Profile: MHP / RV

*Buyers with `property_type_new` ∈ {Mobile Homes, Mobile Home/RV Parks} → flag for rescope (single mobile home = SFR, park = MHP).*

### 07 – Profile: Land / Dev

*Buyers with `property_type_new` ∈ {Land, Tear Down/Dev Lots} get `BB_Land_Profile_Active = Yes`.*

### 08 – Last Deal Alert (NEW group — per decision 4)

| Old_Key | Old_Label | Fill % | Action | New_Key |
|---|---|---|---|---|
| `deal_address` | Deal Address | 12.0 | keep name, move group | `DA_Address` |
| `deal_city` | Deal City | 12.0 | keep name, move group | `DA_City` |
| `deal_state` | Deal State | 12.0 | keep name, move group | `DA_State` |
| `deal_zip` | Deal ZIP | 12.0 | keep name, move group | `DA_Zip` |
| `alert_asking_price` | Alert Asking Price | 5.2 | keep | `DA_Asking_Price` |
| `alert_entry_fee` | Alert Entry Fee | 4.1 | keep | `DA_Entry_Fee` |
| `alert_property_type` | Alert Property Type | 5.2 | keep | `DA_Property_Type` |
| `alert_beds` | Alert Beds | 5.2 | keep | `DA_Beds` |
| `alert_baths` | Alert Baths | 5.2 | keep | `DA_Baths` |
| `alert_year_built` | Alert Year Built | 5.2 | keep | `DA_Year_Built` |
| `alert_sqft` | Alert Sqft | 5.2 | keep | `DA_Sqft` |
| `alert_highlights` | Alert Highlights | 2.5 | keep | `DA_Highlights` |
| `alert_cover_photo` | Alert Cover Photo | 0.0 | **deprecate** | — (0 fill) |

*Namespace prefix `DA_` = "Deal Alert" — mirrors `BB_` prefix convention for grouping but keeps them clearly separate from buy-box criteria.*

---

## 2. Fields that split into multiple new fields

### `deal_structure` (35.7%) — SPLIT

Source: single multi-select. Target: 2 profile gates + per-asset will-do flags.

| Old value | New writes (during migration) |
|---|---|
| contains `Cash` | `BB_Buyer_Profile_Cash_Active = Yes` |
| contains any of `Subject To`, `Seller Finance`, `Hybrid`, `Morby/Stack Method`, `Wrap`, `Lease Option`, `Novation`, `Assumable Loans` | `BB_Buyer_Profile_Creative_Active = Yes` AND set per-asset will-do flags based on `property_type_new` |
| contains `Subject To` | `BB_{ASSET}_Will_Do_Subto = Yes` (ASSET defaults to SFR for SFR-only buyers) |
| contains `Seller Finance` | `BB_{ASSET}_Will_Do_SellerFin = Yes` |
| contains `Wrap` | `BB_{ASSET}_Will_Do_Wraps = Yes` |
| contains `DSCR` | `BB_Funding_Type = DSCR` (in Core) |
| contains `Traditional Financing` | `BB_Funding_Type = Traditional` |

### `exits` (12.7%) — SPLIT

| Old value | New field |
|---|---|
| `Fix & Flip`, `BRRR` | `BB_Primary_Exit` or `BB_Secondary_Exits` (category: Flip) |
| `Buy & Hold` | `BB_Primary_Exit` (category: Hold) |
| `Wholesale` | `BB_Primary_Exit` (category: Wholesale) |
| `Primary Residence` | `BB_Primary_Exit` (category: Owner-Occupy) |
| `Development` | `BB_Primary_Exit` (category: Development) |
| `Long Term Rental`, `Short Term Rental`, `Mid Term Rental`, `Co-Living/PadSplit`, `Section 8`, `Assisted Living`, `Group Homes` | `BB_SFR_Strategies` (multi) — these are holding strategies, not exits |
| `Lease Option` | `BB_SFR_Will_Do_LeaseOption = Yes` (new field — see §4) |
| `Wrap Around` | `BB_SFR_Will_Do_Wraps = Yes` |
| `Note Trading` | `BB_Primary_Exit` (category: Notes) OR deprecate (specialist strategy, low fit) |

Migration complexity: **medium-high**. Recommend shipping the new fields empty and letting the next buy-box form edit populate them, with the old `exits` value rendered as a hint ("Your old exits list: [...]  — please re-categorize").

---

## 3. `property_type_new` → `BB_Asset_Types_Active` translation table

| Old value | New `BB_Asset_Types_Active` entry | Triggers `*_Profile_Active = Yes` |
|---|---|---|
| `Single Family` | SFR | `BB_SFR_Profile_Active` |
| `Condo/Townhouse` | SFR | `BB_SFR_Profile_Active` |
| `Multi-Family (2-4)` | Small MF | `BB_SMF_Profile_Active` |
| `Multi-Family 5+` | **AMBIGUOUS** — flag `BB_Needs_Rescope = Yes` | *neither auto-set* |
| `Mobile Homes` | **AMBIGUOUS** (single home = SFR, park = MHP) — flag | *neither auto-set* |
| `Mobile Home/RV Parks` | MHP/RV | `BB_MHP_Profile_Active` |
| `Land` | Land | `BB_Land_Profile_Active` |
| `Tear Down/Dev Lots` | Land | `BB_Land_Profile_Active` |
| `Commercial` | Commercial | `BB_COM_Profile_Active` |
| `Storage` | Commercial | `BB_COM_Profile_Active` (subtype: self-storage) |
| `Hotels/Motels` | Commercial | `BB_COM_Profile_Active` (subtype: hospitality) |
| `Industrial` | Commercial | `BB_COM_Profile_Active` (subtype: industrial) |
| `New Construction` | **NOT an asset type** — move to exits | Appends `New Construction` to `BB_Secondary_Exits` |

---

## 4. Schema additions beyond your original target spec

Recommended additions to canonical schema, justified by existing data or decision sign-offs:

### 01 – Buyer Core
- **`BB_Buyer_Profile_Cash_Active`** (yes/no) — decision 3 split
- **`BB_Buyer_Profile_Creative_Active`** (yes/no) — decision 3 split
- **`BB_Priority_Counties`** (text, comma-sep list) — decision 2 (preserves 14% fill)
- **`BB_Priority_Zips`** (text, comma-sep list) — decision 2 (preserves 35% fill)
- **`BB_Proof_Of_Funds_Provided`** (yes/no) — maps `pof_on_file`; complements existing `BB_Proof_Of_Funds_URL`
- **`BB_Occupancy_Preference`** (Vacant/Tenant/Either) — cross-asset, was missing from spec
- **`BB_Neighborhood_Class_Pref`** (A/B/C/D multi-select) — cross-asset
- **`BB_Legacy_Max_Price`** (number) — holding field for multi-asset buyers per decision 1
- **`BB_Needs_Rescope`** (yes/no) — flag for buyers whose old data is ambiguous (Multi-Family 5+, Mobile Homes)

### 02 – Profile: SFR
- **`BB_SFR_HOA_OK`** (yes/no) — was missing
- **`BB_SFR_Pool_OK`** (yes/no) — was missing
- **`BB_SFR_Will_Do_LeaseOption`** (yes/no) — was missing (the Wrap equivalent)

### 02 – Profile: SFR Hold (creative-finance sub-criteria — NEW block)
The original spec's Hold section has cashflow/CoC/DSCR/Cap fields, but no slot for creative-finance-specific filters (max entry fee, max PITI, max rate). These are high-value fields currently in use (~2% fill each = ~350 buyers). Propose:
- **`BB_SFR_Hold_Creative_Max_EntryFee_$`** — maps `max_down`
- **`BB_SFR_Hold_Creative_Max_PITI_$`** — maps `max_monthly`
- **`BB_SFR_Hold_Creative_Max_Rate_%`** — maps `max_rate_`
- **`BB_SFR_Hold_Creative_Balloon_Tolerance`** (dropdown: None / ≤5yr / ≤10yr / Any) — maps existing form field

*Same block pattern should be added to SMF/LMF Hold sections in Phase 2.*

---

## 5. Deprecation list (full)

16 fields to deactivate from forms and workflows. Flagged <0.5% fill AND no clean schema mapping, or corrupted data:

| Old_Key | Fill % | Why |
|---|---|---|
| `deals_closed_total` | 0.0 | Never populated |
| `cash__close_speed` | 0.0 | 1 record, double-underscore typo |
| `cash_criteria` | 0.0 | 1 record, free-text — superseded by `buy_box` notes |
| `creative_criteria` | 0.0 | 1 record, free-text — superseded by `buy_box` notes |
| `arv` | 0.6 | "Minimum ARV" label ambiguous, fill too low to salvage |
| `max_entry_` | 1.7 | Data corrupted (mix $ and %) — re-collect via new form |
| `hoa_tolerance` | 1.4 | Duplicate of `hoa` (identical fill count) |
| `solar` | 0.1 | Too sparse, not in target schema |
| `flood_zone` | 0.1 | Too sparse |
| `foundation_issues` | 0.1 | Too sparse |
| `55_communities` | 0.0 | 7 records, key starts with digit (invalid), not in target schema |
| `special_repair` | 0.3 | Overlaps `remodel_level` |
| `construction_type` | 0.0 | 2 records |
| `number_of_stories` | 0.0 | 3 records |
| `min_lot_size_sqft` | 0.4 | Below threshold, not in target schema |
| `alert_cover_photo` | 0.0 | Never populated |

**Workflows / forms to review before deactivating** (inferred from field names — team must confirm manually):
- `buying-criteria.html` — does not use any of the above (verified via the form schema pull)
- `buy-box.html` — active form writes `hoa_tolerance` (via chip `grp-hoa`); need to repoint to `BB_SFR_HOA_OK`
- `notify-buyers.js` — reads no deprecated fields
- Any GHL workflows filtering on these tags/fields — grep in GHL UI under Automation → Workflows

---

## 6. Open follow-ups for Phase 2 sign-off

1. **`remodel_level` remap**: confirm Turnkey→Wholetail, Light Remodel→Light, Medium→??, Heavy→Gut, Teardown→separate flag. The "Medium" bucket is ambiguous — does it map to Light or Heavy in the new 4-level scale?
2. **`exits` split**: 2,199 records carry mixed exits + hold-strategies + structures. Migration script can auto-split ~80% of cases; ~20% (odd combos like "Note Trading" or "Development" only) need manual review. OK to ship `BB_Primary_Exit` empty for ambiguous and prompt rescope?
3. **Creative-finance Hold sub-block**: OK to add the 4 proposed fields to SFR, then mirror the pattern in SMF/LMF/COM/MHP/Land in Phase 2?
4. **Tag hygiene**: 440 unique tags in the dataset. Recommend a separate tag-consolidation pass (not part of this restructure). Flag for later.
5. **`target_zips` data cleanup**: this field's samples show it contains states AND cities, not zips. Recommend a migration sub-pass that regex-splits values into their real type (2-letter all-caps → states, mixed case → cities, digit-only → zips) and redistributes into the three new geo fields.

---

## 7. Ready for Phase 2?

If the 6 open follow-ups above get your sign-off (or reasonable defaults applied), I'll produce:
- The **full YAML/JSON field-creation spec** for every new `BB_*` / `DA_*` / Core field (key, label, type, options, group) — ready to paste into a GHL field builder or an API script
- The **cleanup list** with exact field keys to deactivate/hide
- The **workflow reference scan** (grep across `termsforsale/netlify/functions/` for every deprecated key) so we know exactly what code paths to update

Approve or adjust Phase 1 first. Then I'll run Phase 2.
