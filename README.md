# Deal Intel — Auction Intelligence

Scrapes real estate auction listings from multiple providers (**Crexi** — commercial, **Auction.com** — residential/REO) into one canonical schema, enriches each with socio-demographic, crime, schools, and (for commercial) retail-market data, and surfaces them in a unified dashboard with separate **Commercial** and **Residential** sections. Each listing is saved as an individual JSON file named after the property address.

## Adding a provider

Each provider is a self-contained adapter under `auctions/providers/<name>/index.js` exporting:

| Export | Purpose |
|--------|---------|
| `meta` | `{ slug, displayName, baseUrl }` — used for source labels/links |
| `async search(opts)` | Provider API calls + pagination → array of raw bundles |
| `normalize(raw)` | Maps a raw bundle → the canonical record in `auctions/schema.js` |

Register it in the `PROVIDERS` map in `auctions/pipeline.js`. Everything downstream
(enrichment, DB, API, dashboard) consumes only the canonical shape, so no other code changes.
Records carry `source`, `source_id`, and `asset_class` (`commercial` | `residential`); the DB
primary key is `"{source}:{source_id}"`, so two providers never collide.

---

## Project Structure

```
crexi/
├── package.json
├── README.md
└── auctions/
    ├── pipeline.js                 # Orchestrator — runs providers → normalize → enrich → import
    ├── schema.js                   # Canonical listing shape, validate(), shared helpers
    ├── scraper.js                  # Back-compat shim → pipeline.js --provider crexi
    ├── providers/
    │   ├── crexi/
    │   │   ├── index.js            # Crexi adapter (search + normalize)
    │   │   └── sold_comps.js       # Crexi SoldComps (commercial-only enrichment)
    │   └── auction_com/
    │       └── index.js            # Auction.com adapter (graph.auction.com GraphQL)
    ├── enrichment/
    │   ├── enrich.js               # Coordinator — asset-class-aware step gating
    │   ├── demographics.js         # Socio-demographic data (Areavibes)
    │   ├── crime.js                # Crime statistics (Areavibes / FBI UCR)
    │   └── retail_market.js        # Retail rent comps (CommercialCafe, commercial-only)
    └── listings/                   # Output — one JSON file per listing (source-prefixed)
        └── auction_com__179_hickory_st_lower_salem_oh_45745.json
```

---

## How It Works

### Phase 1 — Scrape

`scraper.js` calls Crexi's internal REST API directly — no browser, no Puppeteer.

```
POST api.crexi.com/assets/search      → paginated auction listing cards
GET  api.crexi.com/assets/{id}        → full property detail (APN, SF, zoning, description…)
GET  api.crexi.com/auctions?auctionIds={id} → auction terms (bid, deposits, timeline)
```

For each listing that passes the price filter, the two detail calls run in parallel. Results are written incrementally to `auctions/listings/` — one file per listing — named from the property address:

```
3126_avenue_of_the_cities_moline_il_61265.json
4580_liberty_ave_vermilion_oh_44089.json
```

### Phase 2 — Enrich

`enrich.js` reads any listing JSON, extracts city/state/coordinates, and appends a `market_research` block by running three sub-tools sequentially:

| Tool | Source | Transport | Data |
|------|--------|-----------|------|
| `demographics.js` | Areavibes | plain `fetch` | Population, density, median age, race/ethnicity, income brackets, language, livability score |
| `crime.js` | Areavibes (FBI UCR 2024) | plain `fetch` | Overall grade, incidents/100k for 7 crime categories, vs state & national benchmarks |
| `retail_market.js` | CommercialCafe | Puppeteer | Active retail lease listings, avg/min/max $/SF/YR, full comp table |

Each tool is independently runnable and importable as a module.

---

## Output Schema

Each listing file contains two top-level sections:

```jsonc
{
  // --- Provenance (set by every provider adapter) ---
  "source":      "crexi",          // provider slug: crexi | auction_com
  "source_id":   "1893472",        // provider-native id
  "asset_class": "commercial",     // commercial | residential

  // --- Scraped from the provider API ---
  "scraped_at": "2026-06-28T…",
  "url": "https://www.crexi.com/properties/…",   // provider-owned
  "listing":   { "id", "title", "address", "city", "state", "zip", "lat", "lng", "brokerage" },
  "auction":   { "status", "auction_type", "starting_bid_usd", "bidding_starts", "bidding_ends",
                 "reserve_met", "bid_increment_usd", "participation_deposit",
                 "earnest_money_deposit", "marketing_fee_pct", "closing_period_days" },
  "property":  { "apn", "property_types", "sub_types", "square_footage", "tenancy",
                 "year_built", "buildings", "stories", "acreage", "zoning", "opportunity_zone" },
  "description": "…",
  "investment_highlights": "…",
  "sale_terms": […],
  "media":     { "photos", "videos", "has_om" },

  // --- Added by enrich.js ---
  "market_research": {
    "radius_miles": 3,
    "enriched_at": "2026-06-28T…",
    "demographics": {
      "source": "Areavibes",
      "population", "population_density_per_sq_mi", "median_age",
      "married_pct", "families_with_kids_pct",
      "income":        { "pct_households_below_25k", "pct_households_above_150k" },
      "race_ethnicity": { "white", "black_or_african_american", "asian", "hispanic_or_latino", … },
      "language":      { "english_only_pct", "spanish_only_pct" },
      "foreign_born_pct", "livability_score"
    },
    "crime": {
      "source": "Areavibes (FBI UCR)",
      "overall_grade", "pct_below_national_avg": { "total_crime", "violent_crime", "property_crime" },
      "incidents_per_100k": {
        "total_crime", "violent_crime", "property_crime",
        "murder", "rape", "robbery", "assault", "burglary", "theft", "vehicle_theft"
        // each: { city_incidents, city_per_100k, state_per_100k, national_per_100k }
      }
    },
    "retail_market": {
      "source": "CommercialCafe.com",
      "retail_asking_rent": { "avg_per_sf_yr", "min_per_sf_yr", "max_per_sf_yr" },
      "retail_leases_with_price": 2,
      "all_priced_leases": [ { "address", "asking_per_sf_yr", "size_sf_range", … } ]
    }
  }
}
```

---

## Installation

```bash
cd crexi
npm install
cd api && npm install && cd ..
cd dashboard && npm install && cd ..
```

Requires Node.js 18+ (uses native `fetch`).

## Dashboard & API

```bash
# Start the API server (port 3001)
cd api && node server.js

# Start the dashboard dev server (port 3000, proxies /api → 3001)
cd dashboard && npm run dev
```

Then open **http://localhost:3000** in your browser.

Pages:
| Route | Description |
|-------|-------------|
| `/` | Pipeline Board — Kanban by lifecycle stage |
| `/screening` | Screening Table — sortable, filterable across all listings |
| `/analytics` | Analytics — funnel, market snapshot, crime distribution |
| `/alerts` | Alerts — auction deadlines, pending reviews |
| `/listing/:id` | Property Detail — all enrichment data, tabbed |

---

## Usage

### Scrape auction listings

```bash
# Crexi (commercial) — up to 10 listings, saved to auctions/listings/
node auctions/pipeline.js --provider crexi --max-listings 10

# Auction.com (residential) — filter by state
node auctions/pipeline.js --provider auction_com --state OH --max-listings 10

# All providers in one run
node auctions/pipeline.js --provider all --max-listings 10

# Options: --max-price N  --max-listings N  --state XX[,YY]  --out-dir DIR  --no-enrich  --force
# (node auctions/scraper.js still works — it forwards to the pipeline as --provider crexi)
```

### Enrich a single listing

```bash
node auctions/enrichment/enrich.js auctions/listings/4580_liberty_ave_vermilion_oh_44089.json
```

### Enrich all listings in batch

```bash
for f in auctions/listings/*.json; do
  node auctions/enrichment/enrich.js "$f"
done
```

### Run individual enrichment tools standalone

```bash
# Demographics for any US city
node auctions/enrichment/demographics.js "davenport" "ia"

# Crime stats
node auctions/enrichment/crime.js "davenport" "ia"

# Retail lease market
node auctions/enrichment/retail_market.js "davenport" "ia"
```

### Full pipeline (scrape + enrich everything)

```bash
node auctions/scraper.js --max-listings 50 && \
for f in auctions/listings/*.json; do node auctions/enrichment/enrich.js "$f"; done
```

---

## Design Decisions

**Why no browser for scraping?**
Crexi's detail pages are protected by Cloudflare's managed challenge, which blocks headless Chromium reliably. Crexi's internal REST API (`api.crexi.com`) has no auth requirement and no bot protection, making it far faster and more reliable than browser automation.

**Why Puppeteer for retail market?**
CommercialCafe blocks plain `fetch` (403). Crexi's own lease API doesn't support geographic filtering. CommercialCafe loads cleanly in a headed or headless Chrome session with a standard user-agent.

**Why Areavibes for demographics and crime?**
It's the only free source that returns both datasets in a single HTML page accessible via plain `fetch` without a key. Data is sourced from the US Census Bureau (demographics) and FBI UCR (crime).

**Why one file per listing?**
Incremental saves mean a failed run never loses completed work. Files named after addresses are human-readable and easy to diff, filter, or load selectively.

---

## Backlog

See **[BACKLOG.md](./BACKLOG.md)** for the full prioritised backlog including detailed specs for the Due Diligence Agent and Government Compliance Review Agent.
