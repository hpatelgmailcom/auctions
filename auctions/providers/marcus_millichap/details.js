/**
 * Marcus & Millichap / RI Marketplace auction-detail fetcher.
 *
 * M&M emails carry no auction id, address, or bidding dates — but their
 * VIEW AUCTION PAGE tracking link 302s to rimarketplace.com/auction/<id>,
 * and RIM's API is open behind an anonymous JWT:
 *
 *   POST api.rimarketplace.com/api/authenticate            → results.token
 *   POST api.rimarketplace.com/api/auction                 (Bearer token)
 *        {"propertyId":"<id>","userId":"","isCmsUrl":false}
 *        → data.propertyList[0].information: propertyAddress/City/State/Zip,
 *          startBidding/endBidding, start_bid, reserve, bidIncrements,
 *          buyersPremium*, absolute_auction, yearBuilt, property_type_name,
 *          propertyDescription, propertySold/soldAmount, current_bid …
 *
 * Per listing file: resolve the tracking redirect once (rim_id is cached in
 * provider_details so later runs skip it), fetch the API, merge in place,
 * rewrite `url` to the canonical RIM page (drops the per-recipient token).
 *
 * Usage:
 *   node auctions/providers/marcus_millichap/details.js            # all M&M files
 *   node auctions/providers/marcus_millichap/details.js --id <rim_id|source_id>
 *   node auctions/providers/marcus_millichap/details.js --enrich   # re-enrich after merge
 *   node auctions/providers/marcus_millichap/details.js --missing-only --pause 2500
 *                                # retry only files without RIM data yet; the
 *                                # API teapots (418) under fast sequential hits
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { withRetry } from '../../enrichment/retry.js';
import { enrich } from '../../enrichment/enrich.js';
import { stripHtml } from '../../schema.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const LISTINGS_DIR = path.join(__dirname, '../../listings');
const API_BASE     = 'https://api.rimarketplace.com';
const PAUSE_MS     = 600;

const argv   = process.argv.slice(2);
const getArg = (flag, def) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : def; };
const ONE_ID       = getArg('--id', null);
const DO_ENRICH    = argv.includes('--enrich');
const MISSING_ONLY = argv.includes('--missing-only');
const PAUSE        = parseInt(getArg('--pause', String(PAUSE_MS)), 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const HEADERS = {
  'accept':       'application/json, text/plain, */*',
  'content-type': 'application/json',
  'origin':       'https://rimarketplace.com',
  'referer':      'https://rimarketplace.com/',
  'user-agent':   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

let _token;
async function getToken() {
  if (_token) return _token;
  const res  = await fetch(`${API_BASE}/api/authenticate`, { method: 'POST', headers: HEADERS });
  const body = await res.json();
  _token = body.results?.token;
  if (!_token) throw new Error('RIM authenticate failed: ' + JSON.stringify(body).slice(0, 200));
  return _token;
}

/** Follow the Constant Contact tracking link (manually, ≤3 hops) to the
 *  rimarketplace auction id. Returns null if it lands anywhere else. */
export async function resolveRimId(trackingUrl) {
  let url = trackingUrl;
  for (let hop = 0; hop < 3; hop++) {
    const m = url.match(/rimarketplace\.com\/auction\/(\d+)/i);
    if (m) return m[1];
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': HEADERS['user-agent'] } });
    const loc = res.headers.get('location');
    if (!loc) return null;
    url = new URL(loc, url).href;
  }
  return url.match(/rimarketplace\.com\/auction\/(\d+)/i)?.[1] ?? null;
}

export async function fetchDetails(rimId) {
  const token = await getToken();
  const body = await withRetry(async () => {
    const res = await fetch(`${API_BASE}/api/auction`, {
      method:  'POST',
      headers: { ...HEADERS, authorization: `Bearer ${token}` },
      body:    JSON.stringify({ propertyId: String(rimId), userId: '', isCmsUrl: false }),
    });
    if (!res.ok) { const e = new Error(`${res.status} ${res.statusText} — /api/auction ${rimId}`); e.status = res.status; throw e; }
    return res.json();
  });
  if (body.error) return null; // removed/expired auction
  const info = body.data?.propertyList?.[0]?.information;
  if (!info) return null;
  return { info, reserveMet: body.data?.reserveMet ?? null, auctionStage: body.data?.auctionStage ?? null };
}

/** Merge RIM details into a canonical email-parsed record (RIM wins for
 *  location facts and auction terms; email provenance stays untouched). */
export function mergeDetails(record, { info, reserveMet, auctionStage }, rimId) {
  const l = record.listing;
  const street = info.propertyAddress?.trim();
  if (street) {
    l.address = `${street}, ${info.propertyCity ?? l.city}, ${info.propertyState ?? l.state}${info.propertyZip ? ' ' + info.propertyZip : ''}`;
  }
  if (info.propertyCity)  l.city  = info.propertyCity;
  if (info.propertyState) l.state = info.propertyState;
  if (info.propertyZip)   l.zip   = info.propertyZip;
  if (info.propertyName)  l.title = info.propertyName.trim();
  const lat = Number(info.lat), lng = Number(info.lang);
  if (lat && lng) { l.latitude = lat; l.longitude = lng; }

  const a = record.auction ??= {};
  if (info.startBidding) a.bidding_starts = info.startBidding;
  if (info.endBidding)   a.bidding_ends   = info.endBidding;
  const bid = Number(info.start_bid);
  if (bid > 0) a.starting_bid_usd = bid;
  a.auction_type = info.absolute_auction ? 'Absolute' : 'Reserve';
  const incr = Number(info.bidIncrements);
  if (incr > 0) a.bid_increment_usd = incr;
  if (reserveMet != null) a.reserve_met = reserveMet;
  if (info.propertySold) a.status = 'sold';

  const p = record.property ??= {};
  if (info.property_type_name) p.property_types = [info.property_type_name];
  const yr = Number(info.yearBuilt);
  if (yr > 1800) p.year_built = yr;
  // homeSquareFootage holds acres for land-ish assets and SF for buildings —
  // disambiguate on magnitude.
  const size = Number(info.homeSquareFootage);
  if (size > 0 && size < 1000) p.acreage = size;
  else if (size >= 1000) p.square_footage = size;
  const gla = Number(info.grossLeasableArea);
  if (gla > 0) p.square_footage = gla;

  const desc = stripHtml(info.propertyDescription);
  if (desc && desc.length > (record.description?.length ?? 0)) record.description = desc;

  record.url = `https://rimarketplace.com/auction/${rimId}`; // drop per-recipient token
  record.provider_details = {
    source:         'rimarketplace.com',
    fetched_at:     new Date().toISOString(),
    rim_id:         String(rimId),
    auction_stage:  auctionStage,
    reserve_usd:    Number(info.reserve) > 0 ? Number(info.reserve) : null,
    buyers_premium_pct:    Number(info.buyersPremiumPercentage) > 0 ? Number(info.buyersPremiumPercentage) : null,
    buyers_premium_usd:    Number(info.buyersPremiumAmount) > 0 ? Number(info.buyersPremiumAmount) : null,
    current_bid_usd:       Number(info.current_bid) > 0 ? Number(info.current_bid) : null,
    bid_count:             info.no_of_bids ?? null,
    sold_amount_usd:       Number(info.soldAmount) > 0 ? Number(info.soldAmount) : null,
    county:                info.county || null,
  };
  return record;
}

async function main() {
  const files = fs.readdirSync(LISTINGS_DIR)
    .filter(f => f.startsWith('marcus_millichap__') && f.endsWith('.json'));

  console.log(`\nM&M / RIM detail fetch — ${files.length} listing file(s)\n`);
  let updated = 0, gone = 0, unresolved = 0, failed = 0;

  for (const file of files) {
    const p      = path.join(LISTINGS_DIR, file);
    const record = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (ONE_ID && String(record.source_id) !== String(ONE_ID) &&
        String(record.provider_details?.rim_id) !== String(ONE_ID)) continue;
    if (MISSING_ONLY && record.provider_details?.rim_id) { continue; }
    try {
      let rimId = record.provider_details?.rim_id ?? null;
      if (!rimId) {
        if (!/^https?:\/\/(?!mail\.google\.com)/.test(record.url)) { unresolved++; continue; }
        rimId = await resolveRimId(record.url);
        if (!rimId) {
          unresolved++;
          console.log(`  ? tracking link no longer resolves: ${record.source_id} (${file})`);
          continue;
        }
      }
      const d = await fetchDetails(rimId);
      if (!d) { gone++; console.log(`  – gone/expired: rim ${rimId} (${file})`); continue; }
      mergeDetails(record, d, rimId);
      fs.writeFileSync(p, JSON.stringify(record, null, 2));
      updated++;
      const a = record.auction;
      console.log(`  ✓ rim ${rimId}  ${record.listing.address}  (bids ${a.bidding_starts?.slice(0,10) ?? '?'} → ${a.bidding_ends?.slice(0,10) ?? '?'})`);
      if (DO_ENRICH) {
        try { await enrich(p, { silent: true }); console.log('     enriched'); }
        catch (err) { console.error(`     ✗ enrichment failed: ${err.message.split('\n')[0]}`); }
      }
    } catch (err) {
      failed++;
      console.error(`  ✗ ${record.source_id}: ${err.message.split('\n')[0]}`);
    }
    await sleep(PAUSE);
  }

  console.log(`\nDone. ${updated} updated, ${gone} gone, ${unresolved} unresolved link(s), ${failed} failed.`);
  if (updated > 0) {
    await fetch('http://localhost:3001/api/import', { method: 'POST' })
      .then(r => r.json())
      .then(x => console.log(`  DB synced: ${x.imported} listing(s) imported.`))
      .catch(() => {});
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
