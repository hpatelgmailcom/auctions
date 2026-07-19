CREATE TABLE IF NOT EXISTS listings (
  id               TEXT PRIMARY KEY,   -- "{source}:{source_id}", e.g. "crexi:1893472"
  source           TEXT,               -- provider slug: crexi | auction_com | email-parser slug
  source_id        TEXT,               -- provider-native id
  asset_class      TEXT,               -- commercial | residential
  listing_type     TEXT,               -- auction | sale
  title            TEXT,
  address          TEXT,
  city             TEXT,
  state            TEXT,
  zip              TEXT,
  latitude         REAL,
  longitude        REAL,
  brokerage        TEXT,
  listed_on        TEXT,
  url              TEXT,
  scraped_at       TEXT,

  -- Auction
  auction_status       TEXT,
  auction_type         TEXT,
  starting_bid_usd     REAL,
  bidding_starts       TEXT,
  bidding_ends         TEXT,
  reserve_met          INTEGER,
  bid_increment_usd    REAL,
  participation_deposit TEXT,
  earnest_money_deposit TEXT,
  marketing_fee_pct    TEXT,
  minimum_marketing_fee_usd REAL,
  closing_period_days  INTEGER,
  non_contingent       INTEGER,

  -- Property (commercial)
  property_types   TEXT,
  sub_types        TEXT,
  square_footage   REAL,
  tenancy          TEXT,
  year_built       INTEGER,
  acreage          REAL,
  zoning           TEXT,
  opportunity_zone INTEGER,

  -- Sale listings (email-sourced brokers)
  asking_price_usd REAL,
  cap_rate_pct     REAL,
  noi_usd          REAL,
  email_message_id TEXT,
  received_at      TEXT,

  -- Property (residential)
  beds             REAL,
  baths            REAL,
  living_area_sqft REAL,
  home_type        TEXT,
  occupancy_status TEXT,

  -- Pipeline stage
  pipeline_stage   TEXT DEFAULT 'Scouted',

  -- Enrichment blobs (full JSON)
  enrichment_demographics TEXT,
  enrichment_crime        TEXT,
  enrichment_retail       TEXT,
  enrichment_sold_comps   TEXT,
  enrichment_walk_score   TEXT,
  enrichment_schools      TEXT,
  enrichment_flood_risk   TEXT,
  due_diligence           TEXT,
  compliance_review       TEXT,

  -- Computed fields cached for fast filtering
  crime_grade          TEXT,
  disposition_score    REAL,
  recommendation       TEXT,
  max_bid_usd          REAL,
  avg_retail_rent      REAL,
  compliance_status    TEXT,
  enriched_at          TEXT,

  updated_at TEXT DEFAULT (datetime('now'))
);

-- Operator-archived listings. Deliberately a separate table (not a listings
-- column, which INSERT OR REPLACE would reset on every import) and with no
-- foreign key (REPLACE deletes+reinserts the listings row mid-import, which
-- would trip enforcement). Survives re-imports and re-scrapes.
CREATE TABLE IF NOT EXISTS archived_listings (
  listing_id  TEXT PRIMARY KEY,
  archived_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  TEXT REFERENCES listings(id),
  type        TEXT NOT NULL,
  message     TEXT NOT NULL,
  severity    TEXT DEFAULT 'info',
  seen        INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipeline_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  TEXT REFERENCES listings(id),
  stage       TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Every Gmail message we have processed (idempotency + parser health)
CREATE TABLE IF NOT EXISTS email_messages (
  gmail_id     TEXT PRIMARY KEY,
  thread_id    TEXT,
  sender       TEXT,               -- normalized from-address, lowercase
  subject      TEXT,
  received_at  TEXT,
  parser_slug  TEXT,               -- registry slug, NULL if no parser matched
  status       TEXT,               -- parsed | no_parser | no_listings | error
  error        TEXT,
  listing_ids  TEXT,               -- JSON array of "source:source_id"
  processed_at TEXT DEFAULT (datetime('now'))
);
