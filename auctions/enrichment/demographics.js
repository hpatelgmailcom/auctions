/**
 * demographics.js
 *
 * Fetches socio-demographic stats for a property location.
 *
 * Primary source:  US Census Bureau ACS 5-Year Estimates API (zip/ZCTA level)
 *                  Requires CENSUS_API_KEY env var.
 * Fallback source: Areavibes.com (city level, plain fetch — no key needed)
 *
 * Usage (standalone):
 *   node enrichment/demographics.js --zip 44089
 *   node enrichment/demographics.js --city vermilion --state oh
 *
 * API:
 *   import { fetchDemographics } from './enrichment/demographics.js';
 *   const data = await fetchDemographics({ zip: '44089', city: 'vermilion', stateAbbr: 'oh' });
 */

import { withRetry } from './retry.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Census ACS API
// ---------------------------------------------------------------------------

// ACS 5-year variable codes
const CENSUS_VARS = [
  'NAME',
  'B01003_001E',   // Total population
  'B19013_001E',   // Median household income
  'B01002_001E',   // Median age (total)
  'B01002_002E',   // Median age (male)
  'B01002_003E',   // Median age (female)
  'B17001_002E',   // Population below poverty level
  'B17001_001E',   // Total (poverty universe)
  'B25077_001E',   // Median home value
  'B11001_001E',   // Total households
  'B23025_004E',   // Employed civilian population 16+
  'B23025_005E',   // Unemployed
  'B23025_003E',   // Civilian labor force
  'B02001_001E',   // Total race (universe)
  'B02001_002E',   // White alone
  'B02001_003E',   // Black or African American alone
  'B02001_004E',   // American Indian alone
  'B02001_005E',   // Asian alone
  'B02001_008E',   // Two or more races
  'B03001_001E',   // Hispanic/Latino universe
  'B03001_003E',   // Hispanic or Latino
  'B15003_001E',   // Total population 25+ (education universe)
  'B15003_017E',   // High school diploma
  'B15003_022E',   // Bachelor's degree
  'B15003_023E',   // Master's degree
  'B15003_024E',   // Professional degree
  'B15003_025E',   // Doctorate degree
  'B19001_002E',   // HH income <$10k
  'B19001_014E',   // HH income $100k–$124,999
  'B19001_015E',   // HH income $125k–$149,999
  'B19001_016E',   // HH income $150k–$199,999
  'B19001_017E',   // HH income $200k+
  'B19001_001E',   // Total HH (income universe)
].join(',');

function pct(num, denom) {
  if (num == null || denom == null || denom === 0) return null;
  return `${((num / denom) * 100).toFixed(1)}%`;
}

async function fetchCensusZip(zip) {
  const key = process.env.CENSUS_API_KEY;
  if (!key) throw new Error('CENSUS_API_KEY not set');

  const url = `https://api.census.gov/data/2023/acs/acs5?get=${CENSUS_VARS}&for=zip%20code%20tabulation%20area:${zip}&key=${key}`;

  const text = await withRetry(async () => {
    const res = await fetch(url);
    if (!res.ok) {
      const err = new Error(`Census API HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.text();
  }, { label: 'api.census.gov', maxRetries: 2 });

  if (text.trim().startsWith('<')) throw new Error('Census API returned HTML — key may not be activated yet');

  const [headers, values] = JSON.parse(text);
  const row = Object.fromEntries(headers.map((h, i) => [h, values[i]]));

  const n = k => { const v = parseInt(row[k]); return isNaN(v) || v < 0 ? null : v; };
  const f = k => { const v = parseFloat(row[k]); return isNaN(v) || v < 0 ? null : v; };

  const totalPop    = n('B01003_001E');
  const totalRace   = n('B02001_001E');
  const totalHispUniverse = n('B03001_001E');
  const totalEdu    = n('B15003_001E');
  const totalHH     = n('B19001_001E');
  const laborForce  = n('B23025_003E');
  const povertyUni  = n('B17001_001E');

  const hsGrads     = [n('B15003_017E'), n('B15003_022E'), n('B15003_023E'), n('B15003_024E'), n('B15003_025E')].filter(v => v != null);
  const hsOrHigher  = hsGrads.reduce((s, v) => s + v, 0);
  const bachelors   = [n('B15003_022E'), n('B15003_023E'), n('B15003_024E'), n('B15003_025E')].filter(v => v != null).reduce((s, v) => s + v, 0);

  const hhOver100k  = [n('B19001_014E'), n('B19001_015E'), n('B19001_016E'), n('B19001_017E')].filter(v => v != null).reduce((s, v) => s + v, 0);
  const hhOver200k  = n('B19001_017E');

  return {
    source:    'US Census Bureau ACS 5-Year Estimates 2023',
    geography: `ZIP Code Tabulation Area ${zip}`,
    data_year: 2023,
    population: {
      total:                totalPop,
      households:           n('B11001_001E'),
    },
    median_age: {
      total:  f('B01002_001E'),
      male:   f('B01002_002E'),
      female: f('B01002_003E'),
    },
    income: {
      median_household_usd:       n('B19013_001E'),
      pct_households_above_100k:  pct(hhOver100k, totalHH),
      pct_households_above_200k:  pct(hhOver200k, totalHH),
    },
    poverty: {
      population_below_poverty:   n('B17001_002E'),
      poverty_rate:               pct(n('B17001_002E'), povertyUni),
    },
    housing: {
      median_home_value_usd: n('B25077_001E'),
    },
    employment: {
      civilian_labor_force:  laborForce,
      employed:              n('B23025_004E'),
      unemployed:            n('B23025_005E'),
      unemployment_rate:     pct(n('B23025_005E'), laborForce),
    },
    race_ethnicity: {
      white_alone:                  pct(n('B02001_002E'), totalRace),
      black_or_african_american:    pct(n('B02001_003E'), totalRace),
      american_indian:              pct(n('B02001_004E'), totalRace),
      asian:                        pct(n('B02001_005E'), totalRace),
      two_or_more_races:            pct(n('B02001_008E'), totalRace),
      hispanic_or_latino:           pct(n('B03001_003E'), totalHispUniverse),
    },
    education: {
      universe_25_plus:          totalEdu,
      high_school_or_higher_pct: pct(hsOrHigher, totalEdu),
      bachelors_or_higher_pct:   pct(bachelors,  totalEdu),
    },
  };
}

// ---------------------------------------------------------------------------
// Areavibes fallback (city-level, no key required)
// ---------------------------------------------------------------------------

function areavibesSlug(city, stateAbbr) {
  return city.toLowerCase().replace(/\s+/g, '-') + '-' + stateAbbr.toLowerCase();
}

function parseDemographicsText(text) {
  const t = text.replace(/\s+/g, ' ');

  const tableMatch  = t.match(/Population\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/i);
  const population  = tableMatch?.[1]?.replace(/,/g, '') ?? null;
  const densityMatch = t.match(/Population density \(sq mi\)\s+([\d,]+)/i);
  const ageMatch     = t.match(/Median age\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  const marriedMatch = t.match(/Married \(15yrs & older\)\s+(\d+%)/i);
  const familiesMatch = t.match(/Families w\/ Kids under 18\s+(\d+%)/i);
  const livability   = t.match(/Livability\s+(\d+)/i)?.[1] ?? null;

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
    // Primary:  "99.2% White"  (percentage precedes label)
    // Fallback: "with 3% of the population identifying as Hispanic or Latino"
    //           "- 44.6% of the population identify as Hispanic or Latino"
    //           (identif\w+ covers both "identifying" and "identify")
    const m   = t.match(new RegExp('([\\d.]+%)\\s+' + esc, 'i'))
             || t.match(new RegExp('([\\d.]+%)\\s+of the population identif\\w+ as\\s+' + esc, 'i'));
    race[key] = m?.[1] ?? null;
  }

  return {
    source:       'Areavibes (city-level fallback)',
    data_year:    2024,
    population:   { total: population ? parseInt(population) : null,
                    density_per_sq_mi: densityMatch?.[1]?.replace(/,/g,'') ? parseInt(densityMatch[1].replace(/,/g,'')) : null },
    median_age:   { total: ageMatch?.[1] ? parseFloat(ageMatch[1]) : null },
    household:    { married_pct: marriedMatch?.[1] ?? null,
                    families_with_kids_pct: familiesMatch?.[1] ?? null },
    race_ethnicity: race,
    income: {
      pct_households_below_25k:  t.match(/(\d+%)\s+of households have a median income below \$25,000/i)?.[1] ?? null,
      pct_households_above_150k: t.match(/(\d+%)\s+report an income exceeding \$150,000/i)?.[1]           ?? null,
    },
    language: {
      english_only_pct: t.match(/([\d.]+%)\s+reported speaking English only/i)?.[1] ?? null,
      spanish_only_pct: t.match(/([\d.]+%)\s+reported speaking Spanish only/i)?.[1]  ?? null,
    },
    foreign_born_pct: t.match(/([\d.]+%)\s+of residents were classified as foreign-born/i)?.[1] ?? null,
    livability_score: livability ? parseInt(livability) : null,
  };
}

// State abbreviation → full name for city-data.com URL construction
const STATE_NAMES = {
  al:'Alabama',ak:'Alaska',az:'Arizona',ar:'Arkansas',ca:'California',
  co:'Colorado',ct:'Connecticut',de:'Delaware',fl:'Florida',ga:'Georgia',
  hi:'Hawaii',id:'Idaho',il:'Illinois',in:'Indiana',ia:'Iowa',ks:'Kansas',
  ky:'Kentucky',la:'Louisiana',me:'Maine',md:'Maryland',ma:'Massachusetts',
  mi:'Michigan',mn:'Minnesota',ms:'Mississippi',mo:'Missouri',mt:'Montana',
  ne:'Nebraska',nv:'Nevada',nh:'New-Hampshire',nj:'New-Jersey',nm:'New-Mexico',
  ny:'New-York',nc:'North-Carolina',nd:'North-Dakota',oh:'Ohio',ok:'Oklahoma',
  or:'Oregon',pa:'Pennsylvania',ri:'Rhode-Island',sc:'South-Carolina',
  sd:'South-Dakota',tn:'Tennessee',tx:'Texas',ut:'Utah',vt:'Vermont',
  va:'Virginia',wa:'Washington',wv:'West-Virginia',wi:'Wisconsin',wy:'Wyoming',
};

/**
 * Fetch median household income from city-data.com.
 * Returns the integer value (e.g. 70972) or null if unavailable.
 */
async function fetchCityDataIncome(city, stateAbbr) {
  const stateName = STATE_NAMES[stateAbbr?.toLowerCase()];
  if (!stateName) return null;

  const citySlug = city.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
  const url      = `https://www.city-data.com/city/${citySlug}-${stateName}.html`;

  try {
    const res = await withRetry(async () => {
      const r = await fetch(url, {
        headers: { 'user-agent': UA, 'accept': 'text/html', 'accept-language': 'en-US,en;q=0.9' },
      });
      if (!r.ok) {
        const err = new Error(`city-data.com HTTP ${r.status}`);
        err.status = r.status;
        throw err;
      }
      return r;
    }, { label: 'city-data.com', maxRetries: 2 });

    const text = (await res.text())
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#[0-9]+;/g, c => String.fromCharCode(parseInt(c.slice(2, -1))))
      .replace(/&amp;/g, '&').replace(/\s+/g, ' ');

    // "median household income in 2024: $70,972"
    const m = text.match(/median household income in \d{4}:\s*\$([\d,]+)/i);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  } catch {
    return null;  // non-critical — silently skip
  }
}

async function fetchAreavibes(city, stateAbbr) {
  const slug = areavibesSlug(city, stateAbbr);
  const url  = `https://www.areavibes.com/${slug}/demographics/`;
  const res  = await withRetry(async () => {
    const r = await fetch(url, {
      headers: { 'user-agent': UA, 'accept': 'text/html', 'accept-language': 'en-US,en;q=0.9' },
    });
    if (!r.ok) {
      const err = new Error(`Areavibes HTTP ${r.status} for ${url}`);
      err.status = r.status;
      throw err;
    }
    return r;
  }, { label: 'areavibes.com' });
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const result = { url, ...parseDemographicsText(text) };

  // Areavibes paywalls the exact median — backfill from city-data.com
  const median = await fetchCityDataIncome(city, stateAbbr);
  if (median) result.income.median_household_usd = median;

  return result;
}

// ---------------------------------------------------------------------------
// Public API — Census primary, Areavibes fallback
// ---------------------------------------------------------------------------

export async function fetchDemographics({ zip, city, stateAbbr }) {
  // Try Census first (needs zip + active key)
  if (zip && process.env.CENSUS_API_KEY) {
    try {
      const data = await fetchCensusZip(zip.toString().padStart(5, '0'));
      return data;
    } catch (err) {
      const reason = err.message.includes('HTML') ? 'key not yet activated' : err.message;
      console.warn(`    [demographics] Census API unavailable (${reason}), falling back to Areavibes`);
    }
  }

  // Fallback: Areavibes (city-level)
  if (!city || !stateAbbr) throw new Error('Need city + stateAbbr for Areavibes fallback');
  return fetchAreavibes(city, stateAbbr);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (process.argv[1].endsWith('demographics.js')) {
  const argv    = process.argv.slice(2);
  const getArg  = flag => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : null; };
  const zip     = getArg('--zip');
  const city    = getArg('--city') || 'vermilion';
  const state   = getArg('--state') || 'oh';

  console.log(`Fetching demographics${zip ? ` for ZIP ${zip}` : ` for ${city}, ${state.toUpperCase()}`}…`);
  fetchDemographics({ zip, city, stateAbbr: state })
    .then(d => console.log(JSON.stringify(d, null, 2)))
    .catch(e => { console.error(e.message); process.exit(1); });
}
