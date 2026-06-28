/**
 * demographics.js
 *
 * Fetches socio-demographic stats for a US city from Areavibes.
 *
 * Usage (standalone):
 *   node enrichment/demographics.js "vermilion" "oh"
 *
 * API:
 *   import { fetchDemographics } from './enrichment/demographics.js';
 *   const data = await fetchDemographics({ city: 'vermilion', stateAbbr: 'oh' });
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Build the Areavibes demographics URL slug from city + state abbr */
function areavibesSlug(city, stateAbbr) {
  return city.toLowerCase().replace(/\s+/g, '-') + '-' + stateAbbr.toLowerCase();
}

/** Extract a numeric or percentage value using a keyword pattern in plain text */
function extract(text, ...keywords) {
  // Build a pattern that finds the keywords (in order, ignoring HTML artefacts)
  // then captures the next number/percentage
  const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(escaped.join('[\\s\\S]{0,60}') + '[\\s\\S]{0,40}?([$\\d][\\d,%.]+)', 'i');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/** Parse the clean text body of the Areavibes demographics page */
function parseDemographics(text) {
  // Normalise — collapse runs of whitespace
  const t = text.replace(/\s+/g, ' ');

  // Helper: grab value between a label and the next known delimiter
  const grab = (label, unit = '') => {
    const re = new RegExp(label + '\\s+([\\d,.%]+' + unit + ')', 'i');
    return t.match(re)?.[1] ?? null;
  };

  // Core table: "Statistic  Vermilion  Ohio  National"
  // e.g. "Population 10,808 12,145,682 336,919,644"
  const tableSection = t.match(/Population\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/i);
  const population   = tableSection?.[1]?.replace(/,/g, '') ?? null;

  const densityMatch = t.match(/Population density \(sq mi\)\s+([\d,]+)/i);
  const density      = densityMatch?.[1]?.replace(/,/g, '') ?? null;

  const ageMatch     = t.match(/Median age\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  const medianAge    = ageMatch?.[1] ?? null;

  const marriedMatch = t.match(/Married \(15yrs & older\)\s+(\d+%)/i);
  const married      = marriedMatch?.[1] ?? null;

  const familiesMatch = t.match(/Families w\/ Kids under 18\s+(\d+%)/i);
  const familiesWithKids = familiesMatch?.[1] ?? null;

  // Race/ethnicity — text reads "99.2% White, 0.1% Black…", so % comes BEFORE label
  const race = {};
  for (const [key, label] of [
    ['white',                     'White'],
    ['black_or_african_american',  'Black or African American'],
    ['asian',                     'Asian'],
    ['american_indian',           'American Indian'],
    ['native_hawaiian',           'Native Hawaiian'],
    ['hispanic_or_latino',        'Hispanic or Latino'],
  ]) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Primary: "99.2% White"  |  Fallback: "3% of the population identifying as Hispanic or Latino"
    const m = t.match(new RegExp('([\\d.]+%)\\s+' + esc, 'i'))
           || t.match(new RegExp('([\\d.]+%)\\s+of the population identifying as\\s+' + esc, 'i'));
    race[key] = m?.[1] ?? null;
  }

  // Foreign-born
  const foreignBorn  = t.match(/([\d.]+%)\s+of residents were classified as foreign-born/i)?.[1] ?? null;

  // Income brackets (from the overview paragraph)
  const incBelow25k  = t.match(/(\d+%)\s+of households have a median income below \$25,000/i)?.[1] ?? null;
  const incOver150k  = t.match(/(\d+%)\s+report an income exceeding \$150,000/i)?.[1] ?? null;

  // Language
  const englishOnly  = t.match(/([\d.]+%)\s+reported speaking English only/i)?.[1] ?? null;
  const spanishOnly  = t.match(/([\d.]+%)\s+reported speaking Spanish only/i)?.[1] ?? null;

  // Livability score (e.g. "Livability 81")
  const livability   = t.match(/Livability\s+(\d+)/i)?.[1] ?? null;

  return {
    source:     'Areavibes',
    data_year:  2024,
    population: population ? parseInt(population) : null,
    population_density_per_sq_mi: density ? parseInt(density) : null,
    median_age: medianAge ? parseFloat(medianAge) : null,
    married_pct: married,
    families_with_kids_pct: familiesWithKids,
    income: {
      pct_households_below_25k: incBelow25k,
      pct_households_above_150k: incOver150k,
    },
    race_ethnicity: race,
    language: {
      english_only_pct: englishOnly,
      spanish_only_pct: spanishOnly,
    },
    foreign_born_pct: foreignBorn,
    livability_score: livability ? parseInt(livability) : null,
  };
}

export async function fetchDemographics({ city, stateAbbr }) {
  const slug = areavibesSlug(city, stateAbbr);
  const url  = `https://www.areavibes.com/${slug}/demographics/`;

  const res = await fetch(url, {
    headers: { 'user-agent': UA, 'accept': 'text/html', 'accept-language': 'en-US,en;q=0.9' },
  });

  if (!res.ok) throw new Error(`Areavibes demographics fetch failed: ${res.status} ${url}`);

  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { url, ...parseDemographics(text) };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (process.argv[1].endsWith('demographics.js')) {
  const city      = process.argv[2] || 'vermilion';
  const stateAbbr = process.argv[3] || 'oh';
  console.log(`Fetching demographics for ${city}, ${stateAbbr.toUpperCase()}…`);
  fetchDemographics({ city, stateAbbr })
    .then(d => console.log(JSON.stringify(d, null, 2)))
    .catch(e => { console.error(e.message); process.exit(1); });
}
