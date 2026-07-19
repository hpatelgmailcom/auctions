/**
 * sold_comps.js
 *
 * Fetches recently sold comparable properties near a coordinate using
 * Crexi's SoldComps API, filtered to the same asset type and proximity.
 *
 * Usage (standalone):
 *   node enrichment/sold_comps.js 41.4256 -82.3479 Retail
 *
 * API:
 *   import { fetchSoldComps } from './enrichment/sold_comps.js';
 *   const data = await fetchSoldComps({ lat, lng, assetTypes, radiusMiles });
 */

import { withRetry } from '../../enrichment/retry.js';

const API_BASE = 'https://api.crexi.com';
const HEADERS  = {
  'accept':          'application/json, text/plain, */*',
  'content-type':    'application/json',
  'origin':          'https://www.crexi.com',
  'referer':         'https://www.crexi.com/',
  'user-agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

/** Haversine distance in miles between two lat/lng points */
function distanceMiles(lat1, lng1, lat2, lng2) {
  const R   = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a   = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function avg(arr) {
  if (!arr.length) return null;
  return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
}

async function searchSoldComps(assetTypes, stateCode = null) {
  const body = {
    listingType:     'SoldComps',
    assetTypes,
    count:           100,
    offset:          0,
    sortOrder:       'createdOn',
    sortDirection:   'Descending',
    includeUnpriced: false,
    ...(stateCode ? { stateCode } : {}),
  };
  return withRetry(async () => {
    const res = await fetch(`${API_BASE}/assets/search`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
    if (!res.ok) {
      const err = new Error(`Crexi SoldComps API ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const d = await res.json();
    return d.data || [];
  }, { label: 'api.crexi.com/sold-comps' });
}

function mapComp(l, lat, lng) {
  const loc = l.locations?.[0];
  if (!loc?.latitude || !loc?.longitude) return null;
  return {
    id:           l.id,
    name:         l.name,
    address:      loc.fullAddress,
    city:         loc.city,
    state:        loc.state?.code,
    asset_types:  l.types,
    sale_price:   l.askingPrice,
    price_per_sf: l.pricePerSqft ?? null,
    sq_footage:   l.squareFootage ?? null,
    sold_on:      l.updatedOn?.substring(0, 10) ?? null,
    distance_mi:  Math.round(distanceMiles(lat, lng, loc.latitude, loc.longitude) * 10) / 10,
    url:          `https://www.crexi.com/properties/${l.id}/${l.urlSlug}`,
  };
}

export async function fetchSoldComps({ lat, lng, assetTypes = ['Retail'], stateCode, radiusMiles = 25 } = {}) {
  // Crexi SoldComps bounds filter doesn't apply — fetch all and filter client-side
  const all    = await searchSoldComps(assetTypes);
  let   nearby = all.map(l => mapComp(l, lat, lng)).filter(c => c && c.distance_mi <= radiusMiles).sort((a, b) => a.distance_mi - b.distance_mi);

  // If empty, widen to state level
  let   scope  = `${radiusMiles}mi radius`;
  if (!nearby.length && stateCode) {
    const stateAll = await searchSoldComps(assetTypes, stateCode);
    nearby = stateAll.map(l => mapComp(l, lat, lng)).filter(Boolean).sort((a, b) => a.distance_mi - b.distance_mi);
    scope  = `${stateCode} (state-level, no local comps)`;
  }

  const prices    = nearby.map(c => c.sale_price).filter(Boolean);
  const pricesPSF = nearby.map(c => c.price_per_sf).filter(Boolean);

  return {
    source:           'Crexi SoldComps API',
    search_center:    { lat, lng },
    scope,
    asset_types:      assetTypes,
    total_comps:      nearby.length,
    avg_sale_price:   avg(prices),
    min_sale_price:   prices.length ? Math.min(...prices) : null,
    max_sale_price:   prices.length ? Math.max(...prices) : null,
    avg_price_per_sf: pricesPSF.length ? Math.round(avg(pricesPSF)) : null,
    comps:            nearby.slice(0, 10),
  };
}

if (process.argv[1]?.endsWith('sold_comps.js')) {
  const [,, lat, lng, type] = process.argv;
  fetchSoldComps({ lat: parseFloat(lat||'41.4256'), lng: parseFloat(lng||'-82.3479'), assetTypes: [type||'Retail'] })
    .then(d => console.log(JSON.stringify(d, null, 2)))
    .catch(e => { console.error(e.message); process.exit(1); });
}
