/**
 * walk_score.js
 *
 * Fetches Walk Score, Transit Score, and Bike Score for a property address
 * using the Walk Score Public API.
 *
 * Requires WALKSCORE_API_KEY in environment (free key at walkscore.com/professional/api.php).
 *
 * Usage (standalone):
 *   node enrichment/walk_score.js 41.4256 -82.3479 "4580 Liberty Ave Vermilion OH"
 *
 * API:
 *   import { fetchWalkScore } from './enrichment/walk_score.js';
 *   const data = await fetchWalkScore({ lat, lng, address });
 */

import { withRetry } from './retry.js';

// Walk Score descriptions by score band
const WALK_LABEL   = s => s >= 90 ? "Walker's Paradise" : s >= 70 ? 'Very Walkable' : s >= 50 ? 'Somewhat Walkable' : s >= 25 ? 'Car-Dependent' : 'Almost All Errands Require a Car';
const TRANSIT_LABEL = s => s >= 90 ? 'Rider\'s Paradise' : s >= 70 ? 'Excellent Transit' : s >= 50 ? 'Excellent Transit' : s >= 25 ? 'Some Transit' : 'Minimal Transit';
const BIKE_LABEL    = s => s >= 90 ? 'Biker\'s Paradise' : s >= 70 ? 'Very Bikeable' : s >= 50 ? 'Bikeable' : 'Minimal Infrastructure';

export async function fetchWalkScore({ lat, lng, address } = {}) {
  const key = process.env.WALKSCORE_API_KEY;

  if (!key) {
    return {
      source:  'Walk Score API',
      status:  'key_required',
      message: 'Set WALKSCORE_API_KEY in .env (free key at walkscore.com/professional/api.php)',
      walk_score: null, transit_score: null, bike_score: null,
    };
  }

  const url = `https://api.walkscore.com/score?format=json` +
    `&address=${encodeURIComponent(address || '')}` +
    `&lat=${lat}&lon=${lng}&transit=1&bike=1&wsapikey=${key}`;

  const data = await withRetry(async () => {
    const res = await fetch(url);
    if (!res.ok) {
      const err = new Error(`Walk Score API HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const d = await res.json();
    if (d.status === 40) throw new Error('Walk Score API key is invalid or inactive');
    return d;
  }, { label: 'api.walkscore.com' });

  const ws = data.walkscore ?? null;
  const ts = data.transit?.score ?? null;
  const bs = data.bike?.score   ?? null;

  return {
    source:        'Walk Score API',
    status:        data.status === 1 ? 'ok' : 'partial',
    walk_score:    ws,
    walk_label:    ws != null ? WALK_LABEL(ws)    : null,
    transit_score: ts,
    transit_label: ts != null ? TRANSIT_LABEL(ts) : null,
    bike_score:    bs,
    bike_label:    bs != null ? BIKE_LABEL(bs)    : null,
    updated:       data.updated ?? null,
    more_info_url: data.more_info_link ?? null,
  };
}

if (process.argv[1]?.endsWith('walk_score.js')) {
  const [,, lat, lng, ...addrParts] = process.argv;
  fetchWalkScore({ lat: parseFloat(lat||'41.4256'), lng: parseFloat(lng||'-82.3479'), address: addrParts.join(' ') || '4580 Liberty Ave Vermilion OH' })
    .then(d => console.log(JSON.stringify(d, null, 2)))
    .catch(e => { console.error(e.message); process.exit(1); });
}
