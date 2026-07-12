/**
 * disposition_scorer.js
 *
 * Scores how quickly and safely the asset can be resold without forcing a
 * below-market price. Five dimensions, each 1–10, weighted per the spec:
 *
 *   market_liquidity      25%   sold comp depth, retail lease market depth
 *   asset_quality         20%   age, deferred maintenance vs price, condition
 *   location_fundamentals 20%   crime, income/poverty, walk score, schools, flood
 *   title_legal_clarity   20%   liens, exceptions, deed restrictions
 *   exit_strategy_breadth 15%   number of viable uses, zoning, opportunity zone
 *
 * Data gaps score toward the middle (5) rather than penalizing the asset —
 * the accompanying note says what was missing so the risk flags can call it out.
 */

const WEIGHTS = {
  market_liquidity:      0.25,
  asset_quality:         0.20,
  location_fundamentals: 0.20,
  title_legal_clarity:   0.20,
  exit_strategy_breadth: 0.15,
};

const clamp = (v, lo = 1, hi = 10) => Math.max(lo, Math.min(hi, v));

const CRIME_GRADE_SCORE = {
  'A+': 10, 'A': 9.5, 'A-': 9, 'B+': 8, 'B': 7.5, 'B-': 7,
  'C+': 6, 'C': 5.5, 'C-': 5, 'D+': 4, 'D': 3.5, 'D-': 3, 'F': 1.5,
};

function scoreMarketLiquidity(mr) {
  const notes = [];
  let score = 5;

  const comps = mr?.sold_comps?.total_comps;
  if (comps == null) notes.push('no sold comp data');
  else {
    score = clamp(2 + Math.min(comps, 24) / 3);   // 0 comps → 2, 24+ comps → 10
    notes.push(`${comps} sold comps in area`);
  }

  const leases = mr?.retail_market?.total_listings;
  if (leases != null) {
    if (mr.retail_market.thin_market) { score -= 1.5; notes.push('thin retail lease market'); }
    else if (leases >= 10) { score += 0.5; notes.push('active lease market'); }
  }

  return { score: clamp(score), note: notes.join('; ') };
}

function scoreAssetQuality(listing, facts, maxBid) {
  const notes = [];
  let score = 5;

  const built = listing.property?.year_built ?? facts?.property?.year_built;
  if (built) {
    const age = new Date().getFullYear() - built;
    score = age <= 10 ? 9 : age <= 25 ? 7.5 : age <= 45 ? 6 : age <= 70 ? 4.5 : 3.5;
    notes.push(`built ${built}`);
  } else notes.push('year built unknown');

  const dmLow  = facts?.inspection?.deferred_maintenance_low_usd;
  const dmHigh = facts?.inspection?.deferred_maintenance_high_usd;
  if ((dmLow != null || dmHigh != null) && maxBid > 0) {
    const dm = ((dmLow ?? dmHigh) + (dmHigh ?? dmLow)) / 2;
    const pct = dm / maxBid * 100;
    if (pct > 20) { score -= 3; notes.push(`deferred maintenance ≈${pct.toFixed(0)}% of max bid`); }
    else if (pct > 10) { score -= 1.5; notes.push(`deferred maintenance ≈${pct.toFixed(0)}% of max bid`); }
    else notes.push('modest deferred maintenance');
  } else if (!facts?.inspection?.condition_notes?.length) {
    notes.push('no inspection report');
  }

  const occ = facts?.property?.occupancy_pct;
  if (occ != null) {
    if (occ >= 90) score += 1;
    else if (occ === 0) { score -= 1; notes.push('vacant'); }
  }

  return { score: clamp(score), note: notes.join('; ') };
}

function scoreLocationFundamentals(listing, mr) {
  const parts = [];
  const notes = [];

  const grade = mr?.crime?.overall_grade;
  if (grade && CRIME_GRADE_SCORE[grade] != null) { parts.push(CRIME_GRADE_SCORE[grade]); notes.push(`crime ${grade}`); }

  const income  = mr?.demographics?.income?.median_household_income_usd ?? mr?.demographics?.income?.median_household_income;
  const poverty = mr?.demographics?.poverty?.poverty_rate_pct ?? mr?.demographics?.poverty?.rate_pct;
  if (income != null) parts.push(clamp(income / 12000));            // $120k+ → 10
  if (poverty != null) { parts.push(clamp(10 - poverty / 3.5)); if (poverty > 20) notes.push(`poverty ${poverty}%`); }

  const walk = mr?.walk_score?.walk_score;
  if (walk != null) { parts.push(clamp(walk / 10)); notes.push(`walk score ${walk}`); }

  const schools = mr?.schools?.grade;
  if (schools && CRIME_GRADE_SCORE[schools] != null) parts.push(CRIME_GRADE_SCORE[schools]);

  const floodRisk = mr?.flood_risk?.flood_factor ?? mr?.flood_risk?.risk_score;
  if (floodRisk != null && floodRisk >= 7) { parts.push(2); notes.push('elevated flood risk'); }

  if (parts.length === 0) return { score: 5, note: 'no location data' };
  const score = parts.reduce((s, v) => s + v, 0) / parts.length;
  return { score: clamp(Math.round(score * 10) / 10), note: notes.join('; ') || 'composite of demographics/crime/walkability' };
}

function scoreTitleLegalClarity(facts, liens, docsReviewed) {
  if (!docsReviewed) return { score: 6, note: 'no title report reviewed — unverified' };

  const t = facts?.title;
  const hasAdverseItems = t && ((t.liens?.length ?? 0) + (t.exceptions?.length ?? 0) + (t.deed_restrictions?.length ?? 0) > 0);
  if (!hasAdverseItems) return { score: 8, note: 'no adverse title items in reviewed documents — confirm a title commitment was part of the set' };

  const notes = [];
  let score = 9;

  const lienCount = (liens?.items?.length ?? 0) + (liens?.unquantified?.length ?? 0);
  if (lienCount > 0) { score -= Math.min(4, lienCount * 1.5); notes.push(`${lienCount} lien(s)/payoff item(s)`); }
  if ((liens?.unquantified?.length ?? 0) > 0) { score -= 1; notes.push('lien amount(s) unquantified'); }

  const exceptions = facts.title.exceptions?.length ?? 0;
  if (exceptions > 3) { score -= 2; notes.push(`${exceptions} title exceptions`); }
  else if (exceptions > 0) { score -= 1; notes.push(`${exceptions} title exception(s)`); }

  if ((facts.title.deed_restrictions?.length ?? 0) > 0) { score -= 1.5; notes.push('deed restrictions recorded'); }

  return { score: clamp(score), note: notes.join('; ') || 'clean title report' };
}

function scoreExitStrategyBreadth(listing) {
  const notes = [];
  const types = listing.property?.property_types ?? [];
  let score = 4 + Math.min(types.length, 3) * 1.5;    // 1 use → 5.5, 3+ uses → 8.5
  notes.push(types.length ? `${types.length} viable use type(s): ${types.join(', ')}` : 'use type unknown');

  if (types.includes('Land')) { score -= 1; notes.push('land component narrows buyer pool to developers'); }
  if (listing.property?.zoning) notes.push(`zoned ${listing.property.zoning}`);
  if (listing.property?.opportunity_zone) { score += 1; notes.push('opportunity zone — tax-advantaged buyer pool'); }

  return { score: clamp(score), note: notes.join('; ') };
}

/**
 * @returns {{ disposition_score: number, breakdown: object, notes: object }}
 */
export function scoreDisposition({ listing, facts, liens, maxBid, docsReviewed = 0 }) {
  const mr = listing.market_research ?? {};

  const dims = {
    market_liquidity:      scoreMarketLiquidity(mr),
    asset_quality:         scoreAssetQuality(listing, facts, maxBid),
    location_fundamentals: scoreLocationFundamentals(listing, mr),
    title_legal_clarity:   scoreTitleLegalClarity(facts, liens, docsReviewed),
    exit_strategy_breadth: scoreExitStrategyBreadth(listing),
  };

  const composite = Object.entries(WEIGHTS)
    .reduce((sum, [k, w]) => sum + dims[k].score * w, 0);

  return {
    disposition_score: Math.round(composite * 10) / 10,
    breakdown: Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, Math.round(v.score * 10) / 10])),
    notes:     Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, v.note])),
  };
}
