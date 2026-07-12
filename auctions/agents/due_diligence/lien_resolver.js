/**
 * lien_resolver.js
 *
 * Sums the payoff obligations a buyer inherits at closing from the facts
 * extracted out of the title report and tax records. Delinquent taxes and
 * special assessments are treated as payoff items alongside recorded liens.
 */

/**
 * @param {object|null} facts  Extracted facts from document_reader (or null)
 * @returns {{ total_usd: number, items: Array<{label: string, amount_usd: number}>, unquantified: string[] }}
 */
export function resolveLiens(facts) {
  const items       = [];
  const unquantified = [];

  for (const lien of facts?.title?.liens ?? []) {
    const label = [lien.type, lien.holder].filter(Boolean).join(' — ');
    if (lien.amount_usd != null && lien.amount_usd > 0) {
      items.push({ label, amount_usd: Math.round(lien.amount_usd) });
    } else {
      unquantified.push(label || 'unspecified lien');
    }
  }

  const delinquent = facts?.taxes?.delinquent_usd;
  if (delinquent > 0) items.push({ label: 'Delinquent property taxes', amount_usd: Math.round(delinquent) });

  const special = facts?.taxes?.special_assessments_usd;
  if (special > 0) items.push({ label: 'Special assessments', amount_usd: Math.round(special) });

  return {
    total_usd: items.reduce((s, i) => s + i.amount_usd, 0),
    items,
    unquantified,
  };
}
