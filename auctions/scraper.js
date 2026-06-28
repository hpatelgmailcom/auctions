/**
 * Crexi Auction Scraper — pure fetch, no browser required
 *
 * Calls Crexi's internal REST API directly:
 *   POST api.crexi.com/assets/search  → listing cards (paginated)
 *   GET  api.crexi.com/assets/{id}    → full property detail
 *   GET  api.crexi.com/auctions?auctionIds={id} → auction terms
 *
 * Usage:
 *   node auctions/scraper.js [options]
 *
 * Options:
 *   --max-price     Starting bid ceiling in USD (default: 300001)
 *   --max-listings  Max listings to save        (default: 10)
 *   --out-dir       Directory for per-listing JSON files (default: auctions/listings)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const getArg = (flag, def) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : def; };

const MAX_PRICE    = parseInt(getArg('--max-price',    '300001'), 10);
const MAX_LISTINGS = parseInt(getArg('--max-listings', '10'),     10);
const OUT_DIR      = getArg('--out-dir', path.join(__dirname, 'listings'));
const PAGE_SIZE    = 60;   // Crexi's max per request
const PAUSE_MS     = 600;  // polite delay between API calls

const API_BASE = 'https://api.crexi.com';
const HEADERS = {
  'accept':          'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  'content-type':    'application/json',
  'origin':          'https://www.crexi.com',
  'referer':         'https://www.crexi.com/',
  'user-agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

// Crexi expects a stable device ID per "user"; we generate one per run.
const DEVICE_ID = `$device:${randomUUID()}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function apiFetch(url, options = {}) {
  const res = await fetch(url, { headers: HEADERS, ...options });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} — ${url}\n${body.substring(0, 300)}`);
  }
  return res.json();
}

/** Strip HTML tags from rich-text fields */
const stripHtml = str => str?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;

/** "3126 Avenue of the Cities, Moline, Rock Island County, IL 61265" → "3126_avenue_of_the_cities_moline_il_61265.json" */
function addressToFilename(address) {
  return (address || 'unknown')
    .toLowerCase()
    .replace(/,?\s+[\w\s]+ county,?\s*/gi, ' ') // strip "Rock Island County", "Scott County", etc.
    .replace(/[^a-z0-9]+/g, '_')            // non-alphanumeric → underscore
    .replace(/^_+|_+$/g, '')               // trim leading/trailing underscores
    .substring(0, 120)                       // cap length
    + '.json';
}

// ---------------------------------------------------------------------------
// Phase 1 — Search: collect eligible listing IDs
// ---------------------------------------------------------------------------

async function fetchAuctionPage(offset) {
  return apiFetch(`${API_BASE}/assets/search`, {
    method: 'POST',
    body: JSON.stringify({
      tradingStatuses: ['Auction'],
      count:           PAGE_SIZE,
      offset,
      userId:          DEVICE_ID,
      sortDirection:   'Ascending',
      sortOrder:       'timeRemaining',
      includeUnpriced: true,
      mlScenario:      'Recombee-Recommendations',
    }),
  });
}

/**
 * Returns all auction listings with askingPrice < MAX_PRICE,
 * up to MAX_LISTINGS entries.
 */
async function collectEligibleListings() {
  const eligible = [];
  let offset = 0;

  while (eligible.length < MAX_LISTINGS) {
    console.log(`  Fetching search page (offset ${offset})…`);
    const page = await fetchAuctionPage(offset);
    const items = page.data || page;
    if (!items?.length) break;

    for (const item of items) {
      const price = item.askingPrice ?? null;
      if (price === null || price < MAX_PRICE) {
        eligible.push({
          id:           item.id,
          name:         item.name,
          askingPrice:  price,
          address:      item.locations?.[0]?.fullAddress || null,
          propertyType: item.types?.join(', ') || null,
          urlSlug:      item.urlSlug,
          url:          `https://www.crexi.com/properties/${item.id}/${item.urlSlug}`,
        });
        if (eligible.length >= MAX_LISTINGS) break;
      }
    }

    if (items.length < PAGE_SIZE) break;  // last page
    offset += PAGE_SIZE;
    await sleep(PAUSE_MS);
  }

  return eligible;
}

// ---------------------------------------------------------------------------
// Phase 2 — Detail: GET /assets/{id} + GET /auctions?auctionIds={id}
// ---------------------------------------------------------------------------

async function fetchAssetDetail(id) {
  return apiFetch(`${API_BASE}/assets/${id}`);
}

async function fetchAuctionDetail(id) {
  const results = await apiFetch(`${API_BASE}/auctions?auctionIds=${id}`);
  return Array.isArray(results) ? results[0] : results;
}

function buildRecord(summary, asset, auction) {
  return {
    scraped_at: new Date().toISOString(),
    url: summary.url,
    listing: {
      id:           summary.id,
      title:        asset.name || summary.name,
      address:      asset.locations?.[0]?.fullAddress || summary.address,
      city:         asset.locations?.[0]?.city        || null,
      state:        asset.locations?.[0]?.state?.name || null,
      zip:          asset.locations?.[0]?.zip         || null,
      latitude:     asset.locations?.[0]?.latitude    || null,
      longitude:    asset.locations?.[0]?.longitude   || null,
      brokerage:    asset.brokerageName               || null,
      listed_on:    asset.activatedOn                 || null,
    },
    auction: {
      status:                 auction?.auctionStatus           || null,
      auction_type:           auction?.auctionType             || null,
      starting_bid_usd:       auction?.startingBid             || summary.askingPrice,
      bidding_starts:         auction?.auctionStartsOn         || null,
      bidding_ends:           auction?.auctionEndsOn           || null,
      reserve_met:            auction?.reserveMet              ?? null,
      bid_increment_usd:      auction?.bidIncrementAmount      || null,
      participation_deposit:  auction?.participationDepositAmount != null
                                ? `$${auction.participationDepositAmount.toLocaleString()}`
                                : null,
      earnest_money_deposit:  asset.earnestDepositAmountInPercent
                                ? `${asset.earnestDepositAmount}%`
                                : (asset.earnestDepositAmount ? `$${asset.earnestDepositAmount}` : null),
      earnest_money_min_usd:  asset.earnestDepositMinimumAmount || null,
      marketing_fee_pct:      auction?.transactionFee          != null ? `${auction.transactionFee}%` : null,
      minimum_marketing_fee_usd: auction?.minimumFee           || null,
      closing_period_days:    asset.escrowPeriodCap            || null,
      non_contingent:         asset.qualFormRequired === false  ? true : null,
    },
    property: {
      apn:            asset.apn                                 || null,
      property_types: asset.types                              || summary.propertyType?.split(', ') || null,
      sub_types:      asset.subtypes                           || null,
      square_footage: asset.squareFootage                      || null,
      tenancy:        asset.tenancy                            || null,
      year_built:     asset.yearBuilt                          || null,
      buildings:      asset.numberOfBuildings                  || null,
      stories:        asset.stories                            || null,
      acreage:        asset.acreage                            || null,
      zoning:         asset.zoning                             || null,
      investment_type:asset.investmentType                     || null,
      opportunity_zone: asset.isInOpportunityZone              ?? null,
    },
    description:           stripHtml(asset.marketingDescription),
    investment_highlights: stripHtml(asset.investmentHighlights),
    media: {
      photos: asset.numberOfImages   || null,
      videos: asset.hasVideo ? 1 : 0,
      has_virtual_tour: asset.hasVirtualTour || false,
      has_om:           asset.hasOM          || false,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\nCrexi Auction Scraper (API mode — no browser)');
  console.log(`  Max price:    $${MAX_PRICE.toLocaleString()}`);
  console.log(`  Max listings: ${MAX_LISTINGS}`);
  console.log(`  Output dir:   ${OUT_DIR}\n`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Phase 1
  console.log('Phase 1: collecting eligible listings…');
  const listings = await collectEligibleListings();
  console.log(`  Found ${listings.length} listings under $${MAX_PRICE.toLocaleString()}\n`);

  // Phase 2
  console.log('Phase 2: fetching details…');
  let saved = 0;

  for (const summary of listings) {
    console.log(`  → [${saved + 1}/${listings.length}] $${summary.askingPrice?.toLocaleString() ?? '?'} | ${summary.name}`);

    try {
      const [asset, auction] = await Promise.all([
        fetchAssetDetail(summary.id),
        fetchAuctionDetail(summary.id),
      ]);

      const record = buildRecord(summary, asset, auction);
      const filename = addressToFilename(record.listing.address);
      const outPath  = path.join(OUT_DIR, filename);
      fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
      saved++;
      console.log(`     ✓ ${filename}`);
      await sleep(PAUSE_MS);
    } catch (err) {
      console.error(`     ✗ failed: ${err.message.split('\n')[0]}`);
    }
  }

  console.log(`\nDone. ${saved} listing(s) saved → ${OUT_DIR}/`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
