/**
 * enrich.js
 *
 * Reads a listing JSON file produced by scraper.js, fetches socio-demographics,
 * crime, and retail market data for the property's location, then writes the
 * enriched result back to the same file under a "market_research" key.
 *
 * Usage:
 *   node enrichment/enrich.js <path-to-listing.json> [--radius 3]
 *
 *   # Enrich every file in the listings directory:
 *   for f in auctions/listings/*.json; do node enrichment/enrich.js "$f"; done
 */

import fs   from 'fs';
import path from 'path';
import { fetchDemographics } from './demographics.js';
import { fetchCrime }        from './crime.js';
import { fetchRetailMarket } from './retail_market.js';
import { fetchSoldComps }    from '../providers/crexi/sold_comps.js';
import { fetchWalkScore }    from './walk_score.js';
import { fetchSchools }      from './schools.js';
import { fetchFloodRisk }    from './flood_risk.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const argv      = process.argv.slice(2);
const filePath  = argv.find(a => !a.startsWith('--'));
const radiusArg = argv.indexOf('--radius');
const RADIUS    = radiusArg !== -1 ? parseFloat(argv[radiusArg + 1]) : 3;

/** US state abbreviation lookup (name → abbr) */
const STATE_ABBR = {
  alabama:'al',alaska:'ak',arizona:'az',arkansas:'ar',california:'ca',colorado:'co',
  connecticut:'ct',delaware:'de',florida:'fl',georgia:'ga',hawaii:'hi',idaho:'id',
  illinois:'il',indiana:'in',iowa:'ia',kansas:'ks',kentucky:'ky',louisiana:'la',
  maine:'me',maryland:'md',massachusetts:'ma',michigan:'mi',minnesota:'mn',
  mississippi:'ms',missouri:'mo',montana:'mt',nebraska:'ne',nevada:'nv',
  'new hampshire':'nh','new jersey':'nj','new mexico':'nm','new york':'ny',
  'north carolina':'nc','north dakota':'nd',ohio:'oh',oklahoma:'ok',oregon:'or',
  pennsylvania:'pa','rhode island':'ri','south carolina':'sc','south dakota':'sd',
  tennessee:'tn',texas:'tx',utah:'ut',vermont:'vt',virginia:'va',washington:'wa',
  'west virginia':'wv',wisconsin:'wi',wyoming:'wy',
};

function stateToAbbr(stateName) {
  if (!stateName) return null;
  const lower = stateName.toLowerCase().trim();
  return STATE_ABBR[lower] || lower.substring(0, 2); // fallback: first 2 chars
}

/** Extract county name from a full address string.
 *  "133 Halsted St, Lowell, Lake County, IN 46356" → "lake"
 */
function countyFrom(address) {
  const m = address?.match(/,\s+([\w\s]+?)\s+County,/i);
  return m ? m[1].trim().toLowerCase() : null;
}

/** Extract city, state-abbr, county, zip, lat, lng from a listing record.
 *  city/state are required (needed for the geo-name-based enrichers). Coordinates
 *  are optional — providers that don't expose them (e.g. auction.com today) still
 *  get the city/state-based steps; lat/lng-dependent steps are skipped upstream. */
function locationFrom(record) {
  const { city, state, zip, latitude, longitude, address } = record.listing ?? {};
  if (!city || !state) throw new Error('Listing is missing city or state');
  return {
    city,
    stateAbbr: stateToAbbr(state),
    county:    countyFrom(address),
    zip:       zip ?? null,
    lat:       latitude  ?? null,
    lng:       longitude ?? null,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function enrich(jsonPath, { radius = RADIUS, silent = false } = {}) {
  const absPath = path.resolve(jsonPath);
  if (!fs.existsSync(absPath)) throw new Error(`File not found: ${absPath}`);

  const record = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  const { city, stateAbbr, county, zip, lat, lng } = locationFrom(record);

  // Which enrichers apply depends on the asset class and whether we have coords.
  //   - retail_market / sold_comps are commercial-only (retail rent & CRE comps).
  //   - walk_score / flood_risk / sold_comps need latitude & longitude.
  const isCommercial = (record.asset_class ?? 'commercial') === 'commercial';
  const hasCoords    = lat != null && lng != null;

  if (!silent) {
    console.log(`\n  Enriching: ${record.listing?.address}`);
    console.log(`    ${record.asset_class ?? 'commercial'} | City: ${city}, ${stateAbbr.toUpperCase()}${county ? `  County: ${county}` : ''}${zip ? `  ZIP: ${zip}` : ''}${hasCoords ? '' : '  (no coordinates)'}  |  Radius: ${radius} mi`);
  }

  const address    = record.listing?.address ?? '';
  const assetTypes = record.property?.property_types ?? ['Retail'];

  const results = { radius_miles: radius, enriched_at: new Date().toISOString() };
  const steps   = [
    ['demographics',  true,                     () => fetchDemographics({ zip, city, stateAbbr })],
    ['crime',         true,                     () => fetchCrime({ city, stateAbbr })],
    ['retail_market', isCommercial,             () => fetchRetailMarket({ city, stateAbbr, county })],
    ['sold_comps',    isCommercial && hasCoords, () => fetchSoldComps({ lat, lng, assetTypes, stateCode: stateAbbr?.toUpperCase(), radiusMiles: 25 })],
    ['walk_score',    hasCoords,                () => fetchWalkScore({ lat, lng, address })],
    ['schools',       true,                     () => fetchSchools({ city, stateAbbr })],
    ['flood_risk',    hasCoords,                () => fetchFloodRisk({ lat, lng })],
  ];

  for (const [key, applies, fn] of steps) {
    if (!applies) continue;
    if (!silent) process.stdout.write(`    ${key}… `);
    try {
      results[key] = await fn();
      if (!silent) console.log('✓');
    } catch (err) {
      results[key] = { error: err.message };
      if (!silent) console.log(`✗  ${err.message.split('\n')[0]}`);
    }
  }

  record.market_research = results;
  fs.writeFileSync(absPath, JSON.stringify(record, null, 2));
  if (!silent) console.log(`    Saved → ${absPath}`);
}

// Run as CLI script
if (process.argv[1].endsWith('enrich.js')) {
  if (!filePath) {
    console.error('Usage: node enrichment/enrich.js <path-to-listing.json> [--radius N]');
    process.exit(1);
  }
  enrich(filePath).catch(err => { console.error('Fatal:', err.message); process.exit(1); });
}
