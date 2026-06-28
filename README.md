# Crexi Auction Intelligence

Scrapes commercial real estate auction listings from Crexi and enriches each one with socio-demographic, crime, and retail market data — all saved as individual JSON files named after the property address.

---

## Project Structure

```
crexi/
├── package.json
├── README.md
└── auctions/
    ├── scraper.js                  # Phase 1 — scrape Crexi auction listings
    ├── enrichment/
    │   ├── enrich.js               # Coordinator — enriches a single listing file
    │   ├── demographics.js         # Socio-demographic data (Areavibes)
    │   ├── crime.js                # Crime statistics (Areavibes / FBI UCR)
    │   └── retail_market.js        # Retail rent comps (CommercialCafe)
    └── listings/                   # Output — one JSON file per listing
        └── 4580_liberty_ave_vermilion_oh_44089.json
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
  // --- Scraped from Crexi API ---
  "scraped_at": "2026-06-28T…",
  "url": "https://www.crexi.com/properties/…",
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
# Default: up to 10 listings under $300,001, saved to auctions/listings/
node auctions/scraper.js

# Custom options
node auctions/scraper.js \
  --max-price    500000 \
  --max-listings 50     \
  --out-dir      ./output
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
