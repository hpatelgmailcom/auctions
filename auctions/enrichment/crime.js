/**
 * crime.js
 *
 * Fetches crime statistics for a US city from Areavibes (FBI 2024 data).
 *
 * Usage (standalone):
 *   node enrichment/crime.js "vermilion" "oh"
 *
 * API:
 *   import { fetchCrime } from './enrichment/crime.js';
 *   const data = await fetchCrime({ city: 'vermilion', stateAbbr: 'oh' });
 */

import { withRetry } from './retry.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function areavibesSlug(city, stateAbbr) {
  return city.toLowerCase().replace(/\s+/g, '-') + '-' + stateAbbr.toLowerCase();
}

/**
 * Parse the clean text body of the Areavibes crime page.
 * The stats table looks like:
 *   "Total crime  65  n/a (estimate)  606  1,845  2,119"
 *   "Murder  0  n/a  0.0  5.0  5.0"
 *   "Rape  1  n/a  9.3  45.7  37.5"  ...
 */
function parseCrimeText(text) {
  const t = text.replace(/\s+/g, ' ');

  // Overall grade band: "A+ 71% Total crime NAT. AVG."
  const gradeMatch  = t.match(/([A-F][+-]?)\s+(\d+%)\s+Total crime\s+NAT\.\s+AVG\./i);
  const overallGrade = gradeMatch?.[1] ?? null;
  const vsBenchmark  = gradeMatch?.[2] ?? null;   // e.g. "71%" = 71% lower than nat avg

  const violentPct  = t.match(/([A-F][+-]?)\s+(\d+%)\s+Violent crime\s+NAT\.\s+AVG\./i)?.[2] ?? null;
  const propertyPct = t.match(/([A-F][+-]?)\s+(\d+%)\s+Property crime\s+NAT\.\s+AVG\./i)?.[2] ?? null;

  // Source note: "data reflects the 2024 calendar year"
  const dataYear = t.match(/data reflects the (\d{4}) calendar year/i)?.[1] ?? null;

  // Parse crime table rows
  // Pattern: "<Crime type>  <incidents>  n/a (estimate)?  <city /100k>  <state /100k>  <national /100k>"
  const crimeTypes = [
    'Murder', 'Rape', 'Robbery', 'Assault',
    'Burglary', 'Theft', 'Vehicle theft',
  ];
  const totals = {
    total_crime:    parseRow(t, 'Total crime'),
    violent_crime:  parseRow(t, 'Violent crime'),
    property_crime: parseRow(t, 'Property crime'),
  };
  const breakdown = {};
  for (const type of crimeTypes) {
    breakdown[type.toLowerCase().replace(/\s+/g, '_')] = parseRow(t, type);
  }

  // Summary sentence
  const summaryMatch = t.match(/the Vermilion crime rate is ([\d.]+%)\s+lower than the national average/i)
    || t.match(/crime rate is ([\d.]+%)\s+lower than the national average/i);

  return {
    source:    'Areavibes (FBI UCR)',
    data_year: dataYear ? parseInt(dataYear) : 2024,
    overall_grade:  overallGrade,
    pct_below_national_avg: {
      total_crime:    vsBenchmark,
      violent_crime:  violentPct,
      property_crime: propertyPct,
    },
    crime_rate_summary: summaryMatch?.[0]?.trim() ?? null,
    incidents_per_100k: {
      ...totals,
      ...breakdown,
    },
  };
}

function parseRow(text, label) {
  // e.g. "Total crime 65 n/a (estimate) 606 1,845 2,119"
  // Capture: city_incidents, city_per_100k, state_per_100k, national_per_100k
  const esc  = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re   = new RegExp(
    esc + '\\s+([\\d,]+)\\s+n\\/a(?:\\s+\\(estimate\\))?\\s+([\\d,.]+)\\s+([\\d,.]+)\\s+([\\d,.]+)', 'i'
  );
  const m = text.match(re);
  if (!m) return null;
  return {
    city_incidents:      parseInt(m[1].replace(/,/g, '')),
    city_per_100k:       parseFloat(m[2].replace(/,/g, '')),
    state_per_100k:      parseFloat(m[3].replace(/,/g, '')),
    national_per_100k:   parseFloat(m[4].replace(/,/g, '')),
  };
}

export async function fetchCrime({ city, stateAbbr }) {
  const slug = areavibesSlug(city, stateAbbr);
  const url  = `https://www.areavibes.com/${slug}/crime/`;

  const res = await withRetry(async () => {
    const r = await fetch(url, {
      headers: { 'user-agent': UA, 'accept': 'text/html', 'accept-language': 'en-US,en;q=0.9' },
    });
    if (!r.ok) {
      const err = new Error(`Areavibes crime fetch failed: ${r.status} ${url}`);
      err.status = r.status;
      throw err;
    }
    return r;
  }, { label: 'areavibes.com/crime' });

  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { url, ...parseCrimeText(text) };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (process.argv[1].endsWith('crime.js')) {
  const city      = process.argv[2] || 'vermilion';
  const stateAbbr = process.argv[3] || 'oh';
  console.log(`Fetching crime stats for ${city}, ${stateAbbr.toUpperCase()}…`);
  fetchCrime({ city, stateAbbr })
    .then(d => console.log(JSON.stringify(d, null, 2)))
    .catch(e => { console.error(e.message); process.exit(1); });
}
