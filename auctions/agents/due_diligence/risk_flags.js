/**
 * risk_flags.js
 *
 * Plain-English warnings for the investor. Rule-based flags come from the
 * financial model, auction terms, and enrichment data; qualitative flags
 * come from Claude's read of the documents (facts.qualitative_risks).
 */

const fmt$ = v => `$${Math.round(v).toLocaleString()}`;

export function buildRiskFlags({ listing, calc, facts, liens, docStatus, docsReviewed = 0 }) {
  const flags = [];
  const auction = listing.auction ?? {};
  const mr      = listing.market_research ?? {};
  const fm      = calc.financial_model;

  // --- Auction terms ------------------------------------------------------
  if (fm?.buyers_premium_usd > 0) {
    const pct = auction.marketing_fee_pct ? ` (${auction.marketing_fee_pct}` +
      (auction.minimum_marketing_fee_usd ? `, ${fmt$(auction.minimum_marketing_fee_usd)} minimum)` : ')') : '';
    flags.push(`Marketing fee${pct} adds ${fmt$(fm.buyers_premium_usd)} on top of the bid — true acquisition cost is well above the hammer price`);
  }
  if (auction.non_contingent) {
    flags.push('Sale is non-contingent — no financing or inspection outs after winning; all diligence must be complete before bidding');
  }
  if (auction.closing_period_days && auction.closing_period_days <= 30) {
    flags.push(`${auction.closing_period_days}-day closing window — financing must be arranged before auction day`);
  }

  // --- Data gaps -----------------------------------------------------------
  if (docStatus !== 'ok' || docsReviewed === 0) {
    flags.push(docStatus === 'ok'
      ? 'Facts extracted from the broker description only — no due diligence documents reviewed; liens, condition, and environmental exposure are unverified'
      : 'No due diligence documents were reviewed — liens, condition, and environmental exposure are unverified; treat the model as an estimate only');
  } else {
    if (!facts?.title || (facts.title.liens == null && !facts.title.exceptions?.length)) {
      flags.push('Title report not found in document set — lien payoffs assumed $0; confirm with a title commitment before bidding');
    }
    if (facts?.inspection?.deferred_maintenance_low_usd == null && facts?.inspection?.deferred_maintenance_high_usd == null) {
      flags.push('No inspection report — capex reserve is a rough estimate');
    }
  }
  if (calc.feasible && !facts?.income?.gross_annual_income_usd) {
    flags.push('Income modeled from market asking rents, not an actual rent roll — in-place income may differ materially');
  }

  // --- Liens ----------------------------------------------------------------
  for (const item of liens?.items ?? []) {
    flags.push(`Payoff at closing: ${item.label} — ${fmt$(item.amount_usd)}`);
  }
  for (const label of liens?.unquantified ?? []) {
    flags.push(`Lien with unstated amount on title: ${label} — obtain payoff letter before bidding`);
  }

  // --- Market / location -----------------------------------------------------
  if (mr.retail_market?.thin_market) {
    flags.push('Thin retail lease market — re-tenanting could take longer than modeled; vacancy assumption already raised');
  }
  const grade = mr.crime?.overall_grade;
  if (grade && /^[DF]/.test(grade)) {
    flags.push(`Area crime grade ${grade} — expect insurance and tenant-quality headwinds`);
  }
  const flood = mr.flood_risk?.flood_factor ?? mr.flood_risk?.risk_score;
  if (flood != null && flood >= 7) {
    flags.push('Elevated flood risk — flood insurance will add carry cost and may narrow the exit buyer pool');
  }

  // --- Environmental / qualitative (from documents, via Claude) ---------------
  for (const f of facts?.environmental?.flags ?? []) flags.push(`Environmental: ${f}`);
  for (const f of facts?.qualitative_risks ?? []) flags.push(f);

  // Dedupe (case-insensitive) and cap
  const seen = new Set();
  return flags.filter(f => {
    const k = f.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 12);
}
