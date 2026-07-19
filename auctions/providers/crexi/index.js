/**
 * Crexi provider adapter.
 *
 * Talks to Crexi's internal REST API (no browser required) and normalizes each
 * listing into the canonical shape defined in ../../schema.js.
 *
 *   POST api.crexi.com/assets/search            → listing cards (paginated)
 *   GET  api.crexi.com/assets/{id}              → full property detail
 *   GET  api.crexi.com/auctions?auctionIds={id} → auction terms
 *
 * Exports the standard provider contract:
 *   meta                     — { slug, displayName, baseUrl }
 *   async search(opts)       → rawListing[]   (summary + asset + auction bundled)
 *   normalize(raw)           → CanonicalRecord
 */

import { randomUUID } from 'crypto';
import { withRetry } from '../../enrichment/retry.js';
import { stripHtml } from '../../schema.js';

export const meta = {
  slug:        'crexi',
  displayName: 'Crexi',
  baseUrl:     'https://www.crexi.com',
  assetClass:  'commercial',
};

const API_BASE  = 'https://api.crexi.com';
const PAGE_SIZE = 60;   // Crexi's max per request
const PAUSE_MS  = 600;  // polite delay between API calls

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function apiFetch(url, options = {}) {
  return withRetry(async () => {
    const res = await fetch(url, { headers: HEADERS, ...options });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err  = new Error(`${res.status} ${res.statusText} — ${url}\n${body.substring(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }, { label: 'api.crexi.com' });
}

// ---------------------------------------------------------------------------
// Phase 1 — Search: collect eligible listing summaries
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
 * Returns auction listing summaries with askingPrice < maxPrice, up to maxListings.
 */
async function collectEligibleSummaries({ maxPrice, maxListings, onProgress }) {
  const eligible = [];
  let offset = 0;

  while (eligible.length < maxListings) {
    onProgress?.(`Fetching search page (offset ${offset})…`);
    const page  = await fetchAuctionPage(offset);
    const items = page.data || page;
    if (!items?.length) break;

    for (const item of items) {
      const price = item.askingPrice ?? null;
      if (price === null || price < maxPrice) {
        eligible.push({
          id:           item.id,
          name:         item.name,
          askingPrice:  price,
          address:      item.locations?.[0]?.fullAddress || null,
          propertyType: item.types?.join(', ') || null,
          urlSlug:      item.urlSlug,
          url:          `${meta.baseUrl}/properties/${item.id}/${item.urlSlug}`,
        });
        if (eligible.length >= maxListings) break;
      }
    }

    if (items.length < PAGE_SIZE) break;  // last page
    offset += PAGE_SIZE;
    await sleep(PAUSE_MS);
  }

  return eligible;
}

async function fetchAssetDetail(id) {
  return apiFetch(`${API_BASE}/assets/${id}`);
}

async function fetchAuctionDetail(id) {
  const results = await apiFetch(`${API_BASE}/auctions?auctionIds=${id}`);
  return Array.isArray(results) ? results[0] : results;
}

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

/**
 * Fetch eligible listings and their full detail. Returns an array of raw
 * bundles ({ summary, asset, auction }) ready to pass to normalize().
 *
 * @param {object} opts
 * @param {number} opts.maxPrice     — starting-bid ceiling (default 30_000_000)
 * @param {number} opts.maxListings  — cap on records returned (default 10)
 * @param {(msg:string)=>void} opts.onProgress
 */
export async function search({ maxPrice = 30_000_000, maxListings = 10, onProgress } = {}) {
  const summaries = await collectEligibleSummaries({ maxPrice, maxListings, onProgress });
  onProgress?.(`Found ${summaries.length} eligible listings.`);

  const bundles = [];
  for (const summary of summaries) {
    try {
      const [asset, auction] = await Promise.all([
        fetchAssetDetail(summary.id),
        fetchAuctionDetail(summary.id),
      ]);
      bundles.push({ summary, asset, auction });
      await sleep(PAUSE_MS);
    } catch (err) {
      onProgress?.(`Detail fetch failed for ${summary.id}: ${err.message.split('\n')[0]}`);
    }
  }
  return bundles;
}

/** Map a raw Crexi bundle → canonical record. */
export function normalize({ summary, asset, auction }) {
  return {
    source:      meta.slug,
    source_id:   String(summary.id),
    asset_class: meta.assetClass,
    scraped_at:  new Date().toISOString(),
    url:         summary.url,
    listing: {
      id:        summary.id,
      title:     asset.name || summary.name,
      address:   asset.locations?.[0]?.fullAddress || summary.address,
      city:      asset.locations?.[0]?.city        || null,
      state:     asset.locations?.[0]?.state?.name || null,
      zip:       asset.locations?.[0]?.zip         || null,
      latitude:  asset.locations?.[0]?.latitude    || null,
      longitude: asset.locations?.[0]?.longitude   || null,
      brokerage: asset.brokerageName               || null,
      listed_on: asset.activatedOn                 || null,
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
      // Residential fields — null for commercial Crexi inventory
      beds:             null,
      baths:            null,
      living_area_sqft: null,
      home_type:        null,
      occupancy_status: null,
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
