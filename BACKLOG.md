# Backlog

## High Priority

- [x] **Scraper: integrate enrichment automatically** — run `enrich.js` immediately after each listing is saved, so the full pipeline is a single command
- [x] **Census API integration** — add a Census Bureau API key (free at api.census.gov) for precise 1/3/5-mile radius demographics rather than city-level averages from Areavibes
- [x] **Retry logic** — exponential backoff on failed API calls; currently a single failure silently records `{ error: "…" }` in the JSON
- [x] **Deduplication** — skip listings whose output file already exists (re-runs currently overwrite without checking)

---

## Medium Priority

- [ ] **Price filter on search results page** — currently all auction listings are fetched and filtered client-side; add a `maxPrice` parameter to the Crexi search API body if/when they expose it
- [ ] **Retail market fallback** — when CommercialCafe has fewer than 3 priced comps, automatically widen search to the next major city or use LoopNet as a secondary source
- [ ] **Hispanic/Latino demographics** — Areavibes reports this figure in a different sentence structure; parser handles the common case but misses some city pages
- [x] **Median household income** — Areavibes puts this behind a paywall on some pages; fall back to city-data.com or Census API
- [ ] **Auction status filter** — option to scrape only active (`BidderRegistration`) or upcoming auctions, excluding closed ones

---

## Low Priority / Future

- [ ] **Comparable sales (sold comps)** — pull closed auction results from Crexi's sale comp API for actual transacted prices, not just asking prices
- [ ] **Walk score / transit score** — walkscore.com has a free API (key required) for walkability, transit, and bike scores
- [ ] **School ratings** — GreatSchools.org API or Niche.com scrape for nearby school quality
- [ ] **Flood/climate risk** — FEMA flood zone data or First Street Foundation API for climate risk scores
- [ ] **Export to CSV** — `scripts/to_csv.js` that flattens all listing JSONs into a single spreadsheet for analysis
- [ ] **Automated scheduling** — cron job to run the full pipeline nightly and alert on new listings under the price threshold
- [ ] **New business formation tracker** — fetch recently registered businesses within the property's city/zip from state Secretary of State APIs or the SBA's business formation dataset; high new-business velocity signals a growing local economy and stronger retail demand; flag areas where formation rate is accelerating year-over-year as a positive indicator in the disposition score
- [ ] **Government compliance review agent** — see full spec below
- [ ] **Due diligence agent** — see full spec below

---

## Major Feature Specs

### Government Compliance Review Agent

An AI agent that researches applicable city, county, and state codes and regulations for a given property and translates legal requirements into a plain-English compliance checklist with estimated immediate repair and licensing costs. Designed to surface hidden obligations a buyer inherits at closing — before they bid.

#### Compliance Domains Reviewed

| Domain | Governing Authority | What the Agent Checks |
|--------|--------------------|-----------------------|
| **Parking requirements** | City/county zoning ordinance | Minimum stall count per SF of use, ADA-accessible stall ratio (1 per 25 required by ADA, stricter in some municipalities), van-accessible stall width (11 ft minimum), aisle width, signage, striping condition, lighting requirements, shared parking easements or recorded agreements, EV charging rough-in mandates (some cities require 10–20% of stalls) |
| **ADA compliance** | ADA Title III (federal) + state building code | Accessible route from public right-of-way to entrance, door hardware (lever vs knob), threshold height (max ½ in), restroom clearances, counter heights, signage (Braille + tactile), ramp slopes (max 1:12), curb cuts, accessible parking path-of-travel |
| **Tenant lease terms** | State landlord-tenant law + local rent ordinances | Required lease disclosures, prohibited clauses (illegal waivers of habitability, retaliatory eviction protections), notice periods for rent increases or termination, security deposit limits and return timelines, HVAC/utility maintenance obligations by landlord vs tenant |
| **Certificate of occupancy** | Local building department | Current CO on file, any open permits or unpermitted work, change-of-use requirements if buyer intends to re-tenant, temporary CO expiration |
| **Fire & life safety** | State fire code (NFPA) + local fire marshal | Sprinkler system requirement by occupancy type and SF threshold, exit signage and emergency lighting, fire extinguisher count and placement, annual inspection currency, Knox box requirement |
| **Signage** | City sign ordinance | Max sign area, illuminated sign permits, pylon or monument sign setback, non-conforming sign grandfathering status |
| **Food service / health** | County health department | If prior tenant was food-service: grease trap permitting, hood exhaust compliance, three-compartment sink requirement — obligations transfer with property in some jurisdictions |
| **Environmental compliance** | EPA + state DEQ | Underground storage tank (UST) registration and closure, stormwater permit (NPDES), asbestos/lead-paint disclosure obligations for pre-1978 structures |

#### How the Agent Works

1. **Identify governing jurisdictions** — from the listing's address, resolves city, county, and state; fetches zoning designation (already in the listing's `property.zoning` field) to determine applicable use category
2. **Retrieve codes** — queries municipal code databases (Municode, American Legal, Codify) and state statute repositories for the relevant chapters; falls back to LLM knowledge for jurisdictions without machine-readable codes, flagging confidence level
3. **Cross-reference property facts** — uses data already in the listing JSON (SF, year built, property type, sub-type, parking lot photos if available, APN for permit history lookup) to determine which requirements apply
4. **Score each domain** — `COMPLIANT`, `LIKELY COMPLIANT`, `DEFICIENCY SUSPECTED`, or `REQUIRES INSPECTION` with a plain-English explanation and the specific code section cited
5. **Estimate costs** — for each suspected deficiency, applies RSMeans or published cost-per-unit benchmarks for the region to generate a low/high repair or licensing cost range

#### Cost Estimation Categories

```
Immediate physical repair costs
  ├── Parking lot restriping & ADA stall re-marking       ($/stall)
  ├── Curb cut installation or repair                      ($/location)
  ├── Accessible ramp construction                         ($/ramp)
  ├── Door hardware replacement (knobs → levers)           ($/door)
  ├── Restroom ADA retrofit (grab bars, clearance, sink)   ($/restroom)
  ├── Sprinkler system installation or extension           ($/SF)
  ├── Exit sign / emergency lighting replacement           ($/fixture)
  └── UST closure or remediation                           (highly variable — flag for Phase II)

Licensing & permit costs
  ├── Certificate of occupancy re-issuance                 (city fee schedule)
  ├── Sign permit (if non-conforming)                      (city fee schedule)
  ├── Fire marshal annual inspection fee                   (jurisdiction rate)
  ├── Health department permit (if food-service use)       (county fee schedule)
  └── Stormwater NPDES permit                              (state rate)
```

#### Agent Architecture

```
auctions/agents/compliance/
├── agent.js               # Orchestrator — runs all domain checks, writes report
├── jurisdiction.js        # Resolves city/county/state from address; fetches zoning
├── code_fetcher.js        # Queries Municode, American Legal, state statute APIs
├── ada_checker.js         # ADA Title III requirements by property type and SF
├── parking_checker.js     # Zoning ordinance parking ratios, ADA stall math
├── permits_checker.js     # Open permit search via city building dept APIs
├── cost_estimator.js      # RSMeans regional benchmarks → low/high cost ranges
└── report_generator.js    # Formats findings into compliance checklist + cost summary
```

#### Output Schema (`compliance_review`)

```jsonc
"compliance_review": {
  "analyzed_at": "2026-06-28T…",
  "overall_status": "DEFICIENCIES SUSPECTED",
  "estimated_immediate_repair_cost": { "low_usd": 18500, "high_usd": 47000 },
  "estimated_licensing_cost":        { "low_usd": 1200,  "high_usd": 3500  },
  "domains": {
    "parking": {
      "status": "DEFICIENCY SUSPECTED",
      "finding": "Zoning requires 1 stall per 250 SF for retail. At 11,724 SF, minimum 47 stalls required. Aerial imagery suggests ~40 stalls. ADA-accessible stall ratio (2 required) unverifiable without site visit.",
      "code_ref": "Vermilion OH Zoning Code §1145.06(c)",
      "estimated_cost": { "low_usd": 4000, "high_usd": 9500, "notes": "Restriping + 2 ADA stalls + signage" }
    },
    "ada": {
      "status": "REQUIRES INSPECTION",
      "finding": "Building constructed 1997, post-ADA. Path-of-travel from parking to entrance unverifiable remotely. Restroom compliance unknown — recommend physical inspection before bidding.",
      "code_ref": "ADA Title III, 28 CFR Part 36",
      "estimated_cost": { "low_usd": 0, "high_usd": 25000, "notes": "Range assumes no issues to full restroom retrofit" }
    },
    "certificate_of_occupancy": {
      "status": "LIKELY COMPLIANT",
      "finding": "No open permits found via Erie County building department public records. CO on file for retail use.",
      "code_ref": "Ohio Building Code §101.2",
      "estimated_cost": { "low_usd": 0, "high_usd": 0 }
    },
    "fire_life_safety": {
      "status": "REQUIRES INSPECTION",
      "finding": "Ohio requires sprinklers for retail buildings over 12,000 SF. At 11,724 SF, building is below threshold but within 2.5% — verify with local fire marshal.",
      "code_ref": "Ohio Fire Code §903.2.7",
      "estimated_cost": { "low_usd": 0, "high_usd": 8500, "notes": "Only if marshal requires retrofit" }
    }
  },
  "risk_flags": [
    "ADA compliance unverifiable remotely — budget $5k–$25k contingency before bidding",
    "Parking stall count may be deficient — confirm with survey before closing",
    "Change of use from pharmacy/drug to any food-service tenant triggers full health dept. permitting"
  ]
}
```

---

### Due Diligence Agent

An AI agent that thinks like a seasoned reserve-auction bidder. Given a listing file it reads every available document — auction terms, purchase contract, tax records, title report, inspection reports, environmental studies, and any other third-party disclosures — and produces two outputs: a **maximum bid** and a **disposition score**.

#### What the Agent Ingests

| Document | Source | Key data extracted |
|----------|--------|--------------------|
| Auction terms & conditions | Crexi OM / due diligence vault | Reserve type, bid increments, participation deposit, earnest money rules, buyer's premium / marketing fee, closing timeline, contingency waivers |
| Purchase & sale agreement | Crexi vault / broker | As-is clause, title exceptions, assignment rights, default remedies |
| Property tax records | County assessor API or scraped | Current assessed value, annual tax bill, any delinquent taxes or special assessments |
| Title report / commitment | Title company docs | Existing liens (mortgage, mechanic's, HOA, IRS, judgment), easements, deed restrictions, chain of title defects |
| Inspection / engineering reports | Broker disclosure package | Deferred maintenance estimate, structural/roof/HVAC condition, code violations, estimated capex |
| Environmental reports (Phase I/II) | Broker disclosure package | Contamination flags, remediation cost estimates, EPA/state agency notices |
| Rent roll / lease abstracts | OM or broker supplement | In-place income, WALT, tenant credit quality, lease expiration schedule |
| Insurance quote | Agent-sourced or market rate lookup | Annual hazard + liability premium for the asset class and location |

#### Maximum Bid Calculation

The agent works backwards from a required **16% cash-on-cash return** after all carrying costs:

```
Net Operating Income (NOI)
  = Gross Scheduled Income
  – Vacancy & Credit Loss (market-rate estimate from demographics + retail data)
  – Operating Expenses (taxes + insurance + mgmt + maintenance)

Maximum Supportable Debt Service
  = NOI / 1.25 (minimum DSCR)

Loan Amount (at prevailing rate, 25-yr am)
  = solve for PV given max annual debt service

All-In Cost Budget
  = Loan Amount + Required Equity (to achieve 16% CoC on equity deployed)

Maximum Bid
  = All-In Cost Budget
  – Auction buyer's premium / marketing fee        (always paid on top of bid)
  – Lien payoff amounts                            (title report: mortgages, tax liens, judgments)
  – Deferred maintenance / capex reserve           (inspection report)
  – Environmental remediation reserve              (Phase I/II, if flagged)
  – 6-month operating cash reserve                 (NOI / 2, held in reserve at close)
  – Acquisition closing costs                      (title, transfer tax, legal ~2–3% of price)
```

The agent flags any bid that would produce less than 16% CoC as **NO BID** and explains exactly which cost item consumes the margin.

#### Disposition Score (1–10)

A forward-looking rating of how quickly and safely the asset can be resold without forcing a below-market price. Scored across five dimensions:

| Dimension | Inputs | Weight |
|-----------|--------|--------|
| **Market liquidity** | Days-on-market for comparable sales, number of recent sale comps, buyer pool depth (investor vs owner-user demand) | 25% |
| **Asset quality** | Property condition (inspection score), deferred maintenance as % of value, age, functional obsolescence | 20% |
| **Location fundamentals** | Demographics trend (population growth/decline), crime grade, retail vacancy rate, walk/transit score | 20% |
| **Title & legal clarity** | Number and complexity of title exceptions, lien resolution confidence, deed restriction severity | 20% |
| **Exit strategy breadth** | Number of viable use cases (retail re-lease, owner-user sale, redevelopment, NNN sale-leaseback), zoning flexibility | 15% |

Score interpretation:
- **8–10** — Highly liquid; sellable within 90 days at or above purchase price with multiple buyer types competing
- **5–7** — Moderate; 6–18 month hold expected; price risk manageable with proper marketing
- **3–4** — Illiquid or distressed; requires value-add work or market timing; elevated price-concession risk
- **1–2** — Hard exit; specialized asset, thin buyer pool, or material unresolved title/environmental issue; avoid unless deeply discounted

#### Agent Architecture

```
auctions/agents/due_diligence/
├── agent.js              # Orchestrator — runs all sub-modules, writes report
├── document_reader.js    # Downloads & parses PDFs from Crexi vault + broker links
├── max_bid_calculator.js # Financial model: NOI → DSCR → all-in cost → max bid
├── disposition_scorer.js # Scores the 5 dimensions, produces weighted composite
├── lien_resolver.js      # Parses title commitment, sums payoff amounts
└── risk_flags.js         # Generates plain-English warnings for each cost risk
```

#### Output Schema (`due_diligence`)

```jsonc
"due_diligence": {
  "analyzed_at": "2026-06-28T…",
  "recommendation": "BID | NO BID | CONDITIONAL BID",
  "max_bid_usd": 187500,
  "max_bid_reasoning": "Starting bid $275k exceeds max supportable bid — reserve likely above our ceiling",
  "financial_model": {
    "estimated_noi_usd": 28400,
    "required_coc_return_pct": 16,
    "loan_amount_usd": 142000,
    "required_equity_usd": 63500,
    "buyers_premium_usd": 13750,
    "lien_payoffs_usd": 0,
    "capex_reserve_usd": 35000,
    "six_month_operating_reserve_usd": 14200,
    "closing_costs_usd": 5625,
    "all_in_cost_usd": 274075
  },
  "disposition_score": 6.2,
  "disposition_score_breakdown": {
    "market_liquidity":      7,
    "asset_quality":         5,
    "location_fundamentals": 8,
    "title_legal_clarity":   6,
    "exit_strategy_breadth": 5
  },
  "risk_flags": [
    "Deferred roof replacement estimated $28k–$40k not reflected in listing price",
    "B-3 zoning limits buyer pool to commercial users only — no residential conversion path",
    "Marketing fee of 5% ($13,750 minimum) substantially increases true acquisition cost"
  ]
}
```
