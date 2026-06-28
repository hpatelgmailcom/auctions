CREATE TABLE IF NOT EXISTS listings (
  id               INTEGER PRIMARY KEY,
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

  -- Property
  property_types   TEXT,
  sub_types        TEXT,
  square_footage   REAL,
  tenancy          TEXT,
  year_built       INTEGER,
  acreage          REAL,
  zoning           TEXT,
  opportunity_zone INTEGER,

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

CREATE TABLE IF NOT EXISTS alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  INTEGER REFERENCES listings(id),
  type        TEXT NOT NULL,
  message     TEXT NOT NULL,
  severity    TEXT DEFAULT 'info',
  seen        INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipeline_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  INTEGER REFERENCES listings(id),
  stage       TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
