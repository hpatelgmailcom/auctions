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

/** Extract city, state-abbr, zip, lat, lng from a listing record */
function locationFrom(record) {
  const { city, state, zip, latitude, longitude } = record.listing ?? {};
  if (!city || !state) throw new Error('Listing is missing city or state');
  if (!latitude || !longitude) throw new Error('Listing is missing coordinates');
  return {
    city,
    stateAbbr: stateToAbbr(state),
    zip:       zip ?? null,
    lat:       latitude,
    lng:       longitude,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function enrich(jsonPath, { radius = RADIUS, silent = false } = {}) {
  const absPath = path.resolve(jsonPath);
  if (!fs.existsSync(absPath)) throw new Error(`File not found: ${absPath}`);

  const record = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  const { city, stateAbbr, zip, lat, lng } = locationFrom(record);

  if (!silent) {
    console.log(`\n  Enriching: ${record.listing?.address}`);
    console.log(`    City: ${city}, ${stateAbbr.toUpperCase()}${zip ? `  ZIP: ${zip}` : ''}  |  Radius: ${radius} mi`);
  }

  const results = { radius_miles: radius, enriched_at: new Date().toISOString() };
  const steps   = [
    ['demographics',  () => fetchDemographics({ zip, city, stateAbbr })],
    ['crime',         () => fetchCrime({ city, stateAbbr })],
    ['retail_market', () => fetchRetailMarket({ city, stateAbbr })],
  ];

  for (const [key, fn] of steps) {
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
