/**
 * max_bid_calculator.js
 *
 * Deterministic financial model per the Due Diligence Agent spec: works
 * backwards from a required cash-on-cash return to the maximum bid.
 *
 *   NOI = GSI − vacancy − opex (taxes, insurance, mgmt, maintenance)
 *   Max annual debt service = NOI / DSCR
 *   Loan = PV of that payment stream (prevailing rate, 25-yr am)
 *   Max equity = (NOI − debt service) / target CoC
 *   All-in budget = loan + max equity
 *   Max bid = all-in − buyer's premium − liens − capex − environmental
 *             − 6-month operating reserve − closing costs
 *
 * The buyer's premium and closing costs scale with the bid itself, so the
 * final step solves  bid × (1 + feePct + closingPct) = budget  algebraically
 * (with a branch for the flat minimum marketing fee).
 *
 * Every number that isn't sourced from a document or the listing is an
 * explicit entry in `assumptions`.
 */

const DEFAULTS = {
  interestRatePct: 7.5,   // prevailing CRE rate; override with --rate
  amortYears:      25,
  minDscr:         1.25,
  targetCocPct:    16,
  vacancyPct:      10,    // +5 when the retail comp market is thin
  mgmtPctEgi:      4,
  maintenancePctEgi: 5,
  taxesPctGsi:     15,    // fallback when no tax record
  insurancePctGsi: 5,     // fallback when no insurance quote
  closingPct:      2.5,
  marketingFeePct: 5,     // fallback when the listing doesn't state one
};

/** True when the asset is raw land with no building to lease. */
function isLandOnly(listing, facts) {
  const types = listing.property?.property_types ?? [];
  if (types.length > 0 && !types.every(t => t === 'Land')) return false;
  const tenancy = (facts?.property?.tenancy ?? '').toLowerCase();
  return types.includes('Land') || /vacant land|raw land|unimproved/.test(tenancy);
}

function parsePct(value, fallback) {
  if (value == null) return fallback;
  const n = parseFloat(String(value).replace('%', ''));
  return Number.isFinite(n) ? n : fallback;
}

/** Present value of a fixed monthly payment (standard amortization). */
function loanFromPayment(monthlyPayment, annualRatePct, years) {
  const i = annualRatePct / 100 / 12;
  const n = years * 12;
  if (i === 0) return monthlyPayment * n;
  return monthlyPayment * (1 - Math.pow(1 + i, -n)) / i;
}

const round$ = v => Math.round(v);

/**
 * @returns {{ feasible: boolean, reason?: string, max_bid_usd: number|null,
 *             financial_model: object|null, assumptions: string[] }}
 */
export function calculateMaxBid({ listing, facts, lienTotal, options = {} }) {
  const opt = { ...DEFAULTS, ...options };
  const assumptions = [];

  const auction = listing.auction ?? {};
  const retail  = listing.market_research?.retail_market ?? {};
  const sf      = listing.property?.square_footage ?? facts?.property?.square_footage ?? null;
  if (facts?.property?.square_footage && !listing.property?.square_footage) {
    assumptions.push(`Square footage (${facts.property.square_footage.toLocaleString()} SF) taken from documents/description — not in Crexi listing data`);
  }

  // --- Gross Scheduled Income -------------------------------------------
  let gsi = facts?.income?.gross_annual_income_usd ?? null;
  if (gsi != null) {
    assumptions.push('Gross income from rent roll / documents');
  } else if (isLandOnly(listing, facts)) {
    // Raw land produces no lease income — never model it from market rents.
    return {
      feasible: false,
      reason: 'Vacant land — the income approach does not apply; value it on comparable land sales and development pro forma instead',
      max_bid_usd: null, financial_model: null, assumptions,
    };
  } else {
    const avgRent = retail.retail_asking_rent?.avg_per_sf_yr ?? null;
    if (sf && avgRent) {
      gsi = sf * avgRent;
      assumptions.push(`Gross income estimated: ${sf.toLocaleString()} SF × $${avgRent.toFixed(2)}/SF/yr market asking rent (no rent roll)`);
    }
  }

  if (gsi == null || gsi <= 0) {
    return {
      feasible: false,
      reason: 'Cannot estimate income: no rent roll in documents, and square footage and/or market rent comps are missing',
      max_bid_usd: null, financial_model: null, assumptions,
    };
  }

  // --- Vacancy & operating expenses -------------------------------------
  let vacancyPct = opt.vacancyPct;
  if (retail.thin_market) {
    vacancyPct += 5;
    assumptions.push(`Vacancy raised to ${vacancyPct}% — thin retail comp market`);
  } else {
    assumptions.push(`Vacancy & credit loss assumed ${vacancyPct}%`);
  }
  const vacancy = gsi * vacancyPct / 100;
  const egi     = gsi - vacancy;

  let taxes = facts?.taxes?.annual_tax_usd ?? null;
  if (taxes == null) { taxes = gsi * opt.taxesPctGsi / 100; assumptions.push(`Property taxes estimated at ${opt.taxesPctGsi}% of gross income (no tax record)`); }

  let insurance = facts?.insurance?.annual_premium_usd ?? null;
  if (insurance == null) { insurance = gsi * opt.insurancePctGsi / 100; assumptions.push(`Insurance estimated at ${opt.insurancePctGsi}% of gross income (no quote)`); }

  const mgmt        = egi * opt.mgmtPctEgi / 100;
  const maintenance = egi * opt.maintenancePctEgi / 100;
  assumptions.push(`Management ${opt.mgmtPctEgi}% and maintenance ${opt.maintenancePctEgi}% of effective gross income`);

  const noi = egi - taxes - insurance - mgmt - maintenance;
  if (noi <= 0) {
    return {
      feasible: false,
      reason: `Estimated NOI is negative ($${round$(noi).toLocaleString()}) — expenses exceed achievable income`,
      max_bid_usd: null,
      financial_model: {
        gross_scheduled_income_usd: round$(gsi),
        vacancy_usd: round$(vacancy),
        operating_expenses_usd: round$(taxes + insurance + mgmt + maintenance),
        estimated_noi_usd: round$(noi),
      },
      assumptions,
    };
  }

  // --- Debt & equity capacity -------------------------------------------
  const annualDs = noi / opt.minDscr;
  const loan     = loanFromPayment(annualDs / 12, opt.interestRatePct, opt.amortYears);
  const cfAfterDs = noi - annualDs;
  const equity    = cfAfterDs / (opt.targetCocPct / 100);
  const allIn     = loan + equity;
  assumptions.push(`Debt sized at ${opt.minDscr} DSCR, ${opt.interestRatePct}% rate, ${opt.amortYears}-yr amortization; equity sized for ${opt.targetCocPct}% cash-on-cash`);

  // --- One-time deductions -----------------------------------------------
  const capexLow  = facts?.inspection?.deferred_maintenance_low_usd;
  const capexHigh = facts?.inspection?.deferred_maintenance_high_usd;
  let capex;
  if (capexLow != null || capexHigh != null) {
    capex = ((capexLow ?? capexHigh) + (capexHigh ?? capexLow)) / 2;
    assumptions.push('Capex reserve from inspection report (midpoint of range)');
  } else {
    capex = sf ? sf * 15 : gsi * 0.25;
    assumptions.push(sf
      ? 'Capex reserve estimated at $15/SF (no inspection report)'
      : 'Capex reserve estimated at 25% of gross income (no inspection report or square footage)');
  }

  const envLow  = facts?.environmental?.remediation_low_usd;
  const envHigh = facts?.environmental?.remediation_high_usd;
  const envReserve = (envLow != null || envHigh != null) ? ((envLow ?? envHigh) + (envHigh ?? envLow)) / 2 : 0;
  if (envReserve > 0) assumptions.push('Environmental remediation reserve from Phase I/II (midpoint of range)');

  const sixMonthReserve = noi / 2;
  const fixed = (lienTotal ?? 0) + capex + envReserve + sixMonthReserve;

  // --- Solve for bid ------------------------------------------------------
  const feePct     = parsePct(auction.marketing_fee_pct, opt.marketingFeePct) / 100;
  const minFee     = auction.minimum_marketing_fee_usd ?? 0;
  const closingPct = opt.closingPct / 100;

  // Branch 1: flat minimum fee applies (pct fee at this bid is below the minimum)
  let bid = (allIn - fixed - minFee) / (1 + closingPct);
  if (bid * feePct > minFee) {
    // Branch 2: percentage fee applies
    bid = (allIn - fixed) / (1 + feePct + closingPct);
  }
  const buyersPremium = Math.max(bid * feePct, minFee);
  const closingCosts  = bid * closingPct;

  const maxBid = Math.max(0, Math.floor(bid / 500) * 500);

  return {
    feasible: true,
    max_bid_usd: maxBid,
    financial_model: {
      gross_scheduled_income_usd:      round$(gsi),
      vacancy_usd:                     round$(vacancy),
      effective_gross_income_usd:      round$(egi),
      taxes_usd:                       round$(taxes),
      insurance_usd:                   round$(insurance),
      management_usd:                  round$(mgmt),
      maintenance_usd:                 round$(maintenance),
      estimated_noi_usd:               round$(noi),
      required_coc_return_pct:         opt.targetCocPct,
      min_dscr:                        opt.minDscr,
      interest_rate_pct:               opt.interestRatePct,
      amortization_years:              opt.amortYears,
      annual_debt_service_usd:         round$(annualDs),
      loan_amount_usd:                 round$(loan),
      required_equity_usd:             round$(equity),
      buyers_premium_usd:              round$(buyersPremium),
      lien_payoffs_usd:                round$(lienTotal ?? 0),
      capex_reserve_usd:               round$(capex),
      environmental_reserve_usd:       round$(envReserve),
      six_month_operating_reserve_usd: round$(sixMonthReserve),
      closing_costs_usd:               round$(closingCosts),
      all_in_cost_usd:                 round$(allIn),
    },
    assumptions,
  };
}
