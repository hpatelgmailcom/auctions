/**
 * Cushman & Wakefield listing-detail fetcher.
 *
 * Email blasts are thin (no street address, no coords, no unit metadata), but
 * every parsed listing carries the numeric id of its portal page —
 * https://multifamily.cushwake.com/Listings/<id> — which is PUBLIC (login only
 * gates OM documents). The page is server-rendered ASP.NET, so this is a plain
 * HTTPS GET + deterministic HTML parse, no browser and no session.
 *
 * Extracted per listing (markup: <span class="label">X:</span><span class="value">Y</span>,
 * plus the Google-map "var markers" inline script for coords/address):
 *   title, street address, city, state, zip, latitude, longitude, units,
 *   property type, configuration, intended use, rate, posted date, About text.
 *
 * Usage:
 *   node auctions/providers/cushman_wakefield/details.js              # all cushman_wakefield__*.json
 *   node auctions/providers/cushman_wakefield/details.js --id 31977   # one listing id
 *   node auctions/providers/cushman_wakefield/details.js --enrich     # re-run enrichment after merging
 *                                                                     # (coords unlock walk/flood/comps)
 *
 * Merged in place into the listing JSON (filenames stay stable — the DB keys
 * on source:source_id, not the filename). Finishes with POST /api/import.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { withRetry } from '../../enrichment/retry.js';
import { enrich } from '../../enrichment/enrich.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const LISTINGS_DIR = path.join(__dirname, '../../listings');
const BASE         = 'https://multifamily.cushwake.com';
const PAUSE_MS     = 600;

const argv   = process.argv.slice(2);
const getArg = (flag, def) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : def; };
const ONE_ID    = getArg('--id', null);
const DO_ENRICH = argv.includes('--enrich');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const deent = s => s?.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
  .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim() || null;

/** <span class="label">Type:</span>…<span class="value">X</span> → "X" */
function labeled(html, label) {
  const m = html.match(new RegExp(`class="label">\\s*${label}:?\\s*</span>[^<]*<span class="value">([^<]*)<`, 'i'));
  return deent(m?.[1]);
}

export async function fetchDetails(listingId) {
  const html = await withRetry(async () => {
    const res = await fetch(`${BASE}/Listings/${listingId}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
    });
    if (!res.ok) { const e = new Error(`${res.status} ${res.statusText} — Listings/${listingId}`); e.status = res.status; throw e; }
    return res.text();
  });

  // Removed/expired listings bounce to the index page.
  if (!html.includes(`/Listings/${listingId}`) && /Property Listings/i.test(html) && !/var markers/.test(html)) return null;

  const d = { listing_id: String(listingId), fetched_at: new Date().toISOString() };

  // var markers = [['1025 Metro', 25.8457429, -80.2609373]];
  const marker = html.match(/var markers = \[\['([^']*)',\s*(-?[\d.]+),\s*(-?[\d.]+)/);
  if (marker) {
    d.title = deent(marker[1]);
    const lat = Number(marker[2]), lng = Number(marker[3]);
    if (lat > 17 && lat < 72 && lng > -180 && lng < -60) { d.latitude = lat; d.longitude = lng; }
  }

  // infoWindowContent = [['<strong>Title</strong><br />1025 E 25th St<br />Hialeah, FL&nbsp; 33013']];
  const info = html.match(/infoWindowContent = \[\['([\s\S]*?)'\]\]/);
  if (info) {
    const lines = info[1].split(/<br\s*\/?>/).map(s => deent(s.replace(/<[^>]+>/g, ''))).filter(Boolean);
    const cityLine = lines[lines.length - 1]?.match(/^(.*?),\s*([A-Z]{2})\s+(\d{5})?/);
    if (lines.length >= 2) d.street = lines[1];
    if (cityLine) { d.city = cityLine[1]; d.state = cityLine[2]; d.zip = cityLine[3] || null; }
  }

  const units = html.match(/class="units">[\s\S]{0,120}?class="value">(\d+)</i)?.[1];
  if (units) d.units = Number(units);

  d.property_type = labeled(html, 'Type');
  d.configuration = labeled(html, 'Configuration');
  d.intended_use  = labeled(html, 'Intended Use');
  d.rate          = labeled(html, 'Rate');
  d.posted        = labeled(html, 'Posted');

  const about = html.match(/<h\d[^>]*>\s*About [\s\S]{0,80}?<\/h\d>([\s\S]{0,6000}?)(?:<h\d|<div id=)/i);
  if (about) d.description = deent(about[1].replace(/<[^>]+>/g, ' '))?.slice(0, 3000) || null;

  return d;
}

/** Merge portal details into a canonical email-parsed record (portal wins for
 *  location facts; email provenance and sale terms stay untouched). */
export function mergeDetails(record, d) {
  const l = record.listing;
  if (d.title)  l.title = d.title;
  if (d.street) {
    l.address = [d.street, d.city ?? l.city, `${d.state ?? l.state}${d.zip ? ' ' + d.zip : ''}`].join(', ');
  }
  if (d.city)      l.city  = d.city;
  if (d.state)     l.state = d.state;
  if (d.zip)       l.zip   = d.zip;
  if (d.latitude  != null) l.latitude  = d.latitude;
  if (d.longitude != null) l.longitude = d.longitude;

  record.property ??= {};
  if (d.units)         record.property.units = d.units;
  if (d.property_type) record.property.property_types = [d.property_type.split('/').pop().trim()];
  if (d.configuration) record.property.configuration  = d.configuration;
  if (d.intended_use)  record.property.intended_use   = d.intended_use;
  if (d.description && d.description.length > (record.description?.length ?? 0)) {
    record.description = d.description;
  }
  record.provider_details = {
    source: 'multifamily.cushwake.com',
    fetched_at: d.fetched_at,
    rate: d.rate,
    posted: d.posted,
  };
  return record;
}

async function main() {
  const files = fs.readdirSync(LISTINGS_DIR)
    .filter(f => f.startsWith('cushman_wakefield__') && f.endsWith('.json'))
    .filter(f => {
      if (!ONE_ID) return true;
      const rec = JSON.parse(fs.readFileSync(path.join(LISTINGS_DIR, f), 'utf8'));
      return String(rec.source_id) === String(ONE_ID);
    });

  console.log(`\nC&W detail fetch — ${files.length} listing file(s)\n`);
  let updated = 0, failed = 0, gone = 0;

  for (const file of files) {
    const p      = path.join(LISTINGS_DIR, file);
    const record = JSON.parse(fs.readFileSync(p, 'utf8'));
    try {
      const d = await fetchDetails(record.source_id);
      if (!d) { gone++; console.log(`  – gone/expired: ${record.source_id} (${file})`); continue; }
      mergeDetails(record, d);
      fs.writeFileSync(p, JSON.stringify(record, null, 2));
      updated++;
      console.log(`  ✓ ${record.source_id}  ${record.listing.address}${d.units ? `  (${d.units} units)` : ''}`);
      if (DO_ENRICH) {
        try { await enrich(p, { silent: true }); console.log('     enriched'); }
        catch (err) { console.error(`     ✗ enrichment failed: ${err.message.split('\n')[0]}`); }
      }
    } catch (err) {
      failed++;
      console.error(`  ✗ ${record.source_id}: ${err.message.split('\n')[0]}`);
    }
    await sleep(PAUSE_MS);
  }

  console.log(`\nDone. ${updated} updated, ${gone} gone, ${failed} failed.`);
  if (updated > 0) {
    await fetch('http://localhost:3001/api/import', { method: 'POST' })
      .then(r => r.json())
      .then(x => console.log(`  DB synced: ${x.imported} listing(s) imported.`))
      .catch(() => {});
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
