# UI Backlog

Items specific to the dashboard and reporting interface.

---

## High Priority

- [ ] **Disable Run Scraper button while scraper is running** — the button currently optimistically disables for 2 seconds then re-enables, regardless of actual scraper state; a `GET /api/scrape/status` endpoint should report whether a run is in progress, and the sidebar button should poll it and remain disabled (with a spinner and "Running…" label) until the job completes; the alert count badge should refresh automatically when the run finishes

- [ ] **Natural language search and smart filters** — see full spec below

---

## Medium Priority

- [x] **Screening page: fix column sorting** — crime grade column sorts alphabetically (A- before A before A+) instead of by grade rank; recommendation column has no meaningful sort order; all other columns audited and fixed to sort correctly
- [x] **Screening page: add Auction Type and Property Type filters** — filter bar missing Auction Type (Reserve / Absolute) and Property Type (Retail / Office / Industrial / Multifamily / Land / Mixed Use / Hospitality) dropdowns; both must wire through to the API and update the table on change
- [x] **Property Detail: Google Maps and Google Earth links on address rows** — in the Market Intelligence tab, each row in the Retail Market comps table and Sold Comps table should have small icon buttons that open the address in Google Maps and Google Earth in a new tab

---

## Low Priority

*(none yet)*

---

## Feature Specs

### Natural Language Search and Smart Filters

A search bar at the top of the Screening page that accepts plain-English queries alongside the existing structured filters, allowing investors to find listings by describing what they want rather than knowing which column to filter on.

#### Natural Language Query Examples

| Query | What it resolves to |
|-------|-------------------|
| `"retail under $500k in Ohio"` | type=Retail, max_price=500000, state=OH |
| `"low crime multifamily Chicago"` | crime_grade=A+/A/A-, type=Multifamily, city=Chicago |
| `"opportunity zones bidding this week"` | opportunity_zone=true, max_days_to_auction=7 |
| `"no flood risk good schools southeast"` | flood_zone=X, school_grade=B+/A, states=AL/GA/FL/SC/NC/TN |
| `"vacant retail under 5000 sf"` | tenancy=Vacant, type=Retail, max_sqft=5000 |
| `"high disposition score BID recommendations"` | min_disposition=7, recommendation=BID |
| `"industrial with comps"` | type=Industrial, has_sold_comps=true |

#### How It Works

1. **Query parsing** — the search input is sent to `POST /api/search/parse` which uses a lightweight rule-based parser (regex + keyword matching) for common patterns, falling back to Claude API for ambiguous queries; returns a structured filter object
2. **Filter merge** — parsed filters merge with any active structured filters already set in the filter bar; structured filter controls update to reflect the parsed values so users can see and tweak what was interpreted
3. **Interpretation badge** — a pill below the search bar shows how the query was interpreted (e.g. `state: OH · type: Retail · max price: $500k`) with an `×` on each token to remove it; a "Clear search" button resets everything
4. **Suggested queries** — when the search bar is focused but empty, show 4–6 example queries as chips that users can click to run immediately

#### Smart Filter Enhancements

Beyond natural language, upgrade the existing filter bar with:

- **Saved filters** — name and save a filter combination; persisted in localStorage; appears as a dropdown of presets at the top of the filter bar
- **Filter from detail page** — "Find similar" button on a listing's detail page pre-populates filters with that listing's state, property type, and approximate price range
- **Range sliders** — replace the price text inputs with a dual-handle range slider; add sliders for square footage and disposition score
- **Quick-filter chips** — one-click chips for the most common queries: `Bidding Soon`, `BID Only`, `Opportunity Zone`, `No Flood Risk`, `Local Comps Available`
- **Column visibility toggle** — let users show/hide columns in the screening table and persist the preference

#### API

```
POST /api/search/parse
  body:  { query: "retail under 500k in Ohio" }
  returns: { filters: { state: "OH", type: "Retail", max_price: 500000 },
             interpretation: ["state: OH", "type: Retail", "max price: $500k"],
             confidence: "high" }

GET /api/search/suggestions
  returns: [{ label: "Bidding this week", filters: { max_days_to_auction: 7 } }, …]
```
