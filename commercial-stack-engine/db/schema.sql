-- Commercial Stack Engine — Postgres schema
-- v1: Multifamily 5-50 units + Mobile Home / RV Parks

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================
-- listings: raw scraped data, deduped by SHA256(source_url)
-- =============================================================
CREATE TABLE IF NOT EXISTS listings (
  id                BIGSERIAL PRIMARY KEY,
  source            TEXT NOT NULL CHECK (source IN ('loopnet','crexi','craigslist','bizbuysell','mhpfinder','fsbo')),
  source_url        TEXT NOT NULL,
  source_url_hash   TEXT NOT NULL UNIQUE,
  asset_class       TEXT NOT NULL CHECK (asset_class IN ('mf','mhp')),
  state             TEXT,
  county            TEXT,
  city              TEXT,
  zip               TEXT,
  address           TEXT,
  listing_price     NUMERIC(14,2),
  units             INTEGER,
  year_built        INTEGER,
  lot_size          NUMERIC(12,2),
  raw_json          JSONB NOT NULL,
  scraped_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  notes             TEXT
);
CREATE INDEX IF NOT EXISTS idx_listings_active        ON listings(is_active);
CREATE INDEX IF NOT EXISTS idx_listings_asset_class   ON listings(asset_class);
CREATE INDEX IF NOT EXISTS idx_listings_state_county  ON listings(state, county);
CREATE INDEX IF NOT EXISTS idx_listings_scraped_at    ON listings(scraped_at DESC);

-- =============================================================
-- enriched_properties: county records + owner data + equity calc
-- 30-day cache via expires_at
-- =============================================================
CREATE TABLE IF NOT EXISTS enriched_properties (
  id                          BIGSERIAL PRIMARY KEY,
  listing_id                  BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  parcel_number               TEXT,
  owner_name                  TEXT,
  owner_mailing_address       TEXT,
  owner_state                 TEXT,
  is_llc                      BOOLEAN,
  llc_status                  TEXT, -- active, dissolved, delinquent, unknown
  last_sale_date              DATE,
  last_sale_price             NUMERIC(14,2),
  current_assessed_value      NUMERIC(14,2),
  estimated_market_value      NUMERIC(14,2),
  mortgage_count              INTEGER DEFAULT 0,
  has_active_mortgage         BOOLEAN,
  lender_name                 TEXT,
  mortgage_origination_date   DATE,
  mortgage_estimated_balance  NUMERIC(14,2),
  equity_estimate_dollars     NUMERIC(14,2),
  equity_estimate_percent     NUMERIC(5,2), -- 0.00–100.00
  code_violations_count       INTEGER DEFAULT 0,
  tax_delinquent              BOOLEAN DEFAULT FALSE,
  motivation_signals          JSONB, -- structured array of detected signals
  enrichment_skipped          BOOLEAN DEFAULT FALSE,
  enrichment_skip_reason      TEXT,
  enriched_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at                  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  raw_county_json             JSONB
);
CREATE INDEX IF NOT EXISTS idx_enriched_listing       ON enriched_properties(listing_id);
CREATE INDEX IF NOT EXISTS idx_enriched_equity        ON enriched_properties(equity_estimate_percent DESC);
CREATE INDEX IF NOT EXISTS idx_enriched_expires       ON enriched_properties(expires_at);

-- =============================================================
-- scores: Stack Method qualification scores (Claude Haiku output)
-- =============================================================
CREATE TABLE IF NOT EXISTS scores (
  id                      BIGSERIAL PRIMARY KEY,
  listing_id              BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  enrichment_id           BIGINT NOT NULL REFERENCES enriched_properties(id) ON DELETE CASCADE,
  overall_score           INTEGER NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  equity_score            INTEGER NOT NULL CHECK (equity_score BETWEEN 0 AND 30),
  motivation_score        INTEGER NOT NULL CHECK (motivation_score BETWEEN 0 AND 25),
  asset_quality_score     INTEGER NOT NULL CHECK (asset_quality_score BETWEEN 0 AND 25),
  stack_fit_score         INTEGER NOT NULL CHECK (stack_fit_score BETWEEN 0 AND 20),
  tier                    TEXT NOT NULL CHECK (tier IN ('HOT','WARM','COLD')),
  recommended_structure   JSONB NOT NULL,
  red_flags               JSONB,
  buyer_pitch_angle       TEXT,
  claude_reasoning        TEXT,
  claude_model            TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  claude_input_tokens     INTEGER,
  claude_output_tokens    INTEGER,
  claude_cost_usd         NUMERIC(10,6),
  scored_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scores_listing         ON scores(listing_id);
CREATE INDEX IF NOT EXISTS idx_scores_tier            ON scores(tier);
CREATE INDEX IF NOT EXISTS idx_scores_overall         ON scores(overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_scored_at       ON scores(scored_at DESC);

-- =============================================================
-- leads: hot leads pushed to GHL
-- =============================================================
CREATE TABLE IF NOT EXISTS leads (
  id                 BIGSERIAL PRIMARY KEY,
  listing_id         BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  score_id           BIGINT NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
  ghl_contact_id     TEXT,
  ghl_pipeline_stage TEXT,
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','called','loi_sent','dead','under_contract','closed_won','closed_lost')),
  pushed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  called_at          TIMESTAMPTZ,
  loi_sent_at        TIMESTAMPTZ,
  notes              TEXT,
  UNIQUE(listing_id) -- one lead per listing
);
CREATE INDEX IF NOT EXISTS idx_leads_status           ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_pushed_at        ON leads(pushed_at DESC);

-- =============================================================
-- loi_drafts: generated LOI documents ready to send
-- =============================================================
CREATE TABLE IF NOT EXISTS loi_drafts (
  id                  BIGSERIAL PRIMARY KEY,
  lead_id             BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  structure_type      TEXT NOT NULL CHECK (structure_type IN ('full_seller_finance','wrap','sub_to_plus_seller_carry','cash_with_seller_carry_2nd')),
  purchase_price      NUMERIC(14,2) NOT NULL,
  down_payment        NUMERIC(14,2),
  seller_carry_amount NUMERIC(14,2),
  interest_rate       NUMERIC(5,3),
  term_months         INTEGER,
  balloon_months      INTEGER,
  monthly_payment     NUMERIC(12,2),
  earnest_money       NUMERIC(10,2),
  inspection_days     INTEGER DEFAULT 30,
  contingencies       JSONB,
  generated_pdf_url   TEXT,
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at             TIMESTAMPTZ,
  approved_by         TEXT,
  template_version    TEXT
);
CREATE INDEX IF NOT EXISTS idx_loi_lead               ON loi_drafts(lead_id);
CREATE INDEX IF NOT EXISTS idx_loi_generated_at       ON loi_drafts(generated_at DESC);

-- =============================================================
-- scrape_errors: log scraper failures for debugging
-- =============================================================
CREATE TABLE IF NOT EXISTS scrape_errors (
  id           BIGSERIAL PRIMARY KEY,
  source       TEXT NOT NULL,
  source_url   TEXT,
  error_type   TEXT, -- timeout, parse_error, blocked_403, captcha, network, unknown
  error_msg    TEXT,
  http_status  INTEGER,
  user_agent   TEXT,
  proxy_used   TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scrape_errors_source       ON scrape_errors(source);
CREATE INDEX IF NOT EXISTS idx_scrape_errors_occurred_at  ON scrape_errors(occurred_at DESC);

-- =============================================================
-- county_configs: registered county assessor scrape configs
-- Loaded by `scripts/seed-counties.js`. Edit at runtime to add new ones.
-- =============================================================
CREATE TABLE IF NOT EXISTS county_configs (
  id              BIGSERIAL PRIMARY KEY,
  state           TEXT NOT NULL,
  county          TEXT NOT NULL,
  metro_name      TEXT, -- e.g. 'Phoenix-Mesa-Chandler'
  assessor_url    TEXT,
  scrape_strategy TEXT, -- json_api, html_form, html_search, manual
  scrape_config   JSONB NOT NULL DEFAULT '{}',
  estimated_share_pct NUMERIC(5,2), -- approximate % of national MF inventory
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(state, county)
);
CREATE INDEX IF NOT EXISTS idx_county_active     ON county_configs(is_active);

-- =============================================================
-- claude_cost_log: every Haiku call, for the budget guardrail
-- =============================================================
CREATE TABLE IF NOT EXISTS claude_cost_log (
  id              BIGSERIAL PRIMARY KEY,
  workflow        TEXT NOT NULL, -- scoring, loi, batch_scoring
  listing_id      BIGINT,
  lead_id         BIGINT,
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL,
  output_tokens   INTEGER NOT NULL,
  cost_usd        NUMERIC(10,6) NOT NULL,
  called_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_claude_cost_called_at ON claude_cost_log(called_at DESC);
CREATE INDEX IF NOT EXISTS idx_claude_cost_workflow  ON claude_cost_log(workflow);

-- =============================================================
-- digest_log: daily digest deliveries (idempotency)
-- =============================================================
CREATE TABLE IF NOT EXISTS digest_log (
  id           BIGSERIAL PRIMARY KEY,
  digest_date  DATE NOT NULL UNIQUE,
  hot_count    INTEGER DEFAULT 0,
  warm_count   INTEGER DEFAULT 0,
  scraped_count INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,
  total_cost_usd NUMERIC(10,4),
  payload      JSONB,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================
-- Trigger: when a new listing is inserted, fire NOTIFY so n8n can pick up
-- n8n connects via LISTEN 'new_listing' channel
-- =============================================================
CREATE OR REPLACE FUNCTION notify_new_listing()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('new_listing', json_build_object(
    'listing_id', NEW.id,
    'asset_class', NEW.asset_class,
    'state', NEW.state,
    'county', NEW.county
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listings_notify ON listings;
CREATE TRIGGER trg_listings_notify
  AFTER INSERT ON listings
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_listing();

-- Helpful views for n8n / dashboards
CREATE OR REPLACE VIEW v_hot_leads_24h AS
  SELECT l.id, l.address, l.city, l.state, l.asset_class, l.units, l.listing_price,
         e.equity_estimate_percent, e.owner_name, e.owner_state,
         s.overall_score, s.tier, s.recommended_structure, s.buyer_pitch_angle,
         lead.ghl_contact_id, lead.status,
         s.scored_at
  FROM listings l
  JOIN scores s          ON s.listing_id = l.id
  JOIN enriched_properties e ON e.id = s.enrichment_id
  LEFT JOIN leads lead   ON lead.listing_id = l.id
  WHERE s.tier = 'HOT'
    AND s.scored_at >= NOW() - INTERVAL '24 hours'
  ORDER BY s.overall_score DESC;

CREATE OR REPLACE VIEW v_pipeline_stats_30d AS
  SELECT
    (SELECT COUNT(*) FROM listings WHERE scraped_at >= NOW() - INTERVAL '30 days') AS scraped,
    (SELECT COUNT(*) FROM enriched_properties WHERE enriched_at >= NOW() - INTERVAL '30 days') AS enriched,
    (SELECT COUNT(*) FROM scores WHERE scored_at >= NOW() - INTERVAL '30 days') AS scored,
    (SELECT COUNT(*) FROM scores WHERE tier='HOT' AND scored_at >= NOW() - INTERVAL '30 days') AS hot,
    (SELECT COUNT(*) FROM leads WHERE pushed_at >= NOW() - INTERVAL '30 days') AS pushed_to_ghl,
    (SELECT COALESCE(SUM(cost_usd),0) FROM claude_cost_log WHERE called_at >= NOW() - INTERVAL '30 days') AS claude_cost_30d_usd;
