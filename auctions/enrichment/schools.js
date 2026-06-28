/**
 * schools.js
 *
 * Fetches public school quality data for a city from Areavibes,
 * which aggregates NCES/state assessment data.
 *
 * Returns: school grade, test score percentile, student/teacher ratio,
 * school counts (public, private, post-secondary).
 *
 * Usage (standalone):
 *   node enrichment/schools.js vermilion oh
 *
 * API:
 *   import { fetchSchools } from './enrichment/schools.js';
 *   const data = await fetchSchools({ city: 'vermilion', stateAbbr: 'oh' });
 */

import { withRetry } from './retry.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function parseSchoolsText(text) {
  const t = text.replace(/\s+/g, ' ');

  // Grade e.g. "Schools B-"
  const grade = t.match(/Schools\s+([A-F][+-]?)\s+User Ratings/i)?.[1] ?? null;

  // Test scores e.g. "B- 40% Avg. test scores NAT. AVG."
  const testScorePct = t.match(/([A-F][+-]?)\s+(\d+)%\s+Avg\.\s+test scores\s+NAT\.\s+AVG\./i)?.[2] ?? null;

  // Stats table: "Average Test Scores 67% 61% 48%"
  const testScoreCity  = t.match(/Average Test Scores\s+(\d+)%/i)?.[1] ?? null;
  const testScoreState = t.match(/Average Test Scores\s+\d+%\s+(\d+)%/i)?.[1] ?? null;
  const testScoreNat   = t.match(/Average Test Scores\s+\d+%\s+\d+%\s+(\d+)%/i)?.[1] ?? null;

  // Student/Teacher ratio e.g. "Student/Teacher ratio 17:1 17:1 16:1"
  const strMatch = t.match(/Student\/Teacher ratio\s+([\d:]+)\s+([\d:]+)\s+([\d:]+)/i);

  // School counts
  const publicSchools   = t.match(/Total public schools\s+([\d,]+)/i)?.[1]?.replace(/,/g,'') ?? null;
  const privateSchools  = t.match(/Total private schools\s+([\d,]+)/i)?.[1]?.replace(/,/g,'') ?? null;
  const postSecSchools  = t.match(/Total post-secondary schools\s+([\d,]+|n\/a)/i)?.[1] ?? null;

  // Key findings sentences
  const findings = [];
  const findingMatches = [...t.matchAll(/The school [^.]+\.|There are approximately [^.]+\.|[\d.]+%\s+of people in [A-Za-z]+ have (?:completed|complete)[^.]+\./gi)];
  findingMatches.slice(0, 4).forEach(m => findings.push(m[0].trim()));

  return {
    source:    'Areavibes (NCES data)',
    grade,
    test_scores: {
      city_percentile:     testScorePct   ? parseInt(testScorePct)   : testScoreCity  ? parseInt(testScoreCity)  : null,
      state_avg_pct:       testScoreState ? parseInt(testScoreState) : null,
      national_avg_pct:    testScoreNat   ? parseInt(testScoreNat)   : null,
    },
    student_teacher_ratio: {
      city:     strMatch?.[1] ?? null,
      state:    strMatch?.[2] ?? null,
      national: strMatch?.[3] ?? null,
    },
    school_counts: {
      public:         publicSchools  ? parseInt(publicSchools)  : null,
      private:        privateSchools ? parseInt(privateSchools) : null,
      post_secondary: postSecSchools === 'n/a' ? null : (postSecSchools ? parseInt(postSecSchools) : null),
    },
    key_findings: findings,
  };
}

export async function fetchSchools({ city, stateAbbr }) {
  const slug = city.toLowerCase().replace(/\s+/g, '-') + '-' + stateAbbr.toLowerCase();
  const url  = `https://www.areavibes.com/${slug}/schools/`;

  const res = await withRetry(async () => {
    const r = await fetch(url, {
      headers: { 'user-agent': UA, 'accept': 'text/html', 'accept-language': 'en-US,en;q=0.9' },
    });
    if (!r.ok) {
      const err = new Error(`Areavibes schools HTTP ${r.status} for ${url}`);
      err.status = r.status;
      throw err;
    }
    return r;
  }, { label: 'areavibes.com/schools' });

  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<')
    .replace(/&#x[0-9a-f]+;/gi, '').replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();

  return { url, ...parseSchoolsText(text) };
}

if (process.argv[1]?.endsWith('schools.js')) {
  const [,, city = 'vermilion', stateAbbr = 'oh'] = process.argv;
  console.log(`Fetching school data for ${city}, ${stateAbbr.toUpperCase()}…`);
  fetchSchools({ city, stateAbbr })
    .then(d => console.log(JSON.stringify(d, null, 2)))
    .catch(e => { console.error(e.message); process.exit(1); });
}
