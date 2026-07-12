/**
 * Auction.com provider adapter.
 *
 * Talks to Auction.com's internal GraphQL API (no browser required) and
 * normalizes each listing into the canonical shape defined in ../../schema.js.
 *
 *   POST graph.auction.com/graphql
 *     seek_listings_from_filters(filters)  → paginated listing cards (search)
 *     listing(listingId)                   → per-listing property detail
 *
 * The endpoint has no bot-protection but requires (a) Origin/Referer headers
 * pointing at www.auction.com and (b) a *named* GraphQL operation — anonymous
 * operations are rejected with GRAPH_RESILIENCY_ERROR.
 *
 * Exports the standard provider contract: meta, search(opts), normalize(raw).
 */

import { withRetry } from '../../enrichment/retry.js';

export const meta = {
  slug:        'auction_com',
  displayName: 'Auction.com',
  baseUrl:     'https://www.auction.com',
};

const GRAPH_URL = 'https://graph.auction.com/graphql';
const PAGE_SIZE = 200;   // server accepts up to 500; 200 keeps payloads sane
const PAUSE_MS  = 500;

const HEADERS = {
  'accept':          'application/json',
  'content-type':    'application/json',
  'origin':          'https://www.auction.com',
  'referer':         'https://www.auction.com/',
  'user-agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function graphql(operationName, query, variables) {
  return withRetry(async () => {
    const res = await fetch(GRAPH_URL, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify({ operationName, query, variables }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err  = new Error(`${res.status} ${res.statusText} — ${GRAPH_URL}\n${body.substring(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(`GraphQL error: ${json.errors.map(e => e.message).join('; ')}`);
    }
    return json.data;
  }, { label: 'graph.auction.com' });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// Search — one page of listing cards for a state.
const SEARCH_QUERY = `
  query acomSearch($filters: ListingCompatabilityFilters!) {
    seek_listings_from_filters(filters: $filters) {
      total_count
      total_pages
      size
      current_page
      content {
        ... on Listing {
          listing_id
          listing_status
          listing_status_group
          formatted_address(format: DOUBLE_LINE)
          listing_page_path
          primary_photo
          listing_photos_count
          listing_configuration {
            product_type
            asset_type
            occupancy_status
          }
          selling_method(resolvePolicy: CACHE_ONLY) {
            __typename
            ... on OnlineAuctionSegment {
              starting_bid_amount
              start_date
              initial_end_date
            }
          }
          external_information(resolvePolicy: CACHE_ONLY) {
            collateral { summary { estimated low high } }
          }
        }
      }
    }
  }`;

// Detail — extra facts not present on the search card.
// NOTE: only bedrooms/bathrooms are confirmed on the Property type. Square
// footage, year built, lot size, granular home_type, AND the property's
// latitude/longitude live under nested structures whose exact field names still
// need to be captured from the site's own PDP query (open a /details/ page, hook
// window.fetch for graph.auction.com, read the operation). Until then those
// canonical fields stay null, and enrich.js runs only its city/state-based steps
// for these records (see enrichment/enrich.js coordinate handling).
const DETAIL_QUERY = `
  query acomDetail($listingId: ID!) {
    listing(listingId: $listingId) {
      listing_id
      primary_property {
        bedrooms
        bathrooms
      }
    }
  }`;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

async function searchState({ state, listingType, sort, maxListings, onProgress }) {
  const cards = [];
  let offset = 0;

  while (cards.length < maxListings) {
    onProgress?.(`Fetching ${state} page (offset ${offset})…`);
    const data = await graphql('acomSearch', SEARCH_QUERY, {
      filters: {
        property_state: state,
        listing_type:   listingType,
        sort,
        limit:   PAGE_SIZE,
        offset,
        version: 1,
      },
    });

    const result = data.seek_listings_from_filters;
    const batch  = (result?.content || []).filter(Boolean);
    if (!batch.length) break;

    cards.push(...batch);
    if (offset + PAGE_SIZE >= (result.total_count ?? 0)) break;
    offset += PAGE_SIZE;
    await sleep(PAUSE_MS);
  }

  return cards.slice(0, maxListings);
}

async function fetchDetail(listingId) {
  try {
    const data = await graphql('acomDetail', DETAIL_QUERY, { listingId: String(listingId) });
    return data.listing || null;
  } catch {
    return null;   // detail is best-effort; card data is enough to save a record
  }
}

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string|string[]} opts.state         — 2-letter state code(s) (default "OH")
 * @param {number} opts.maxListings            — cap on records returned (default 10)
 * @param {string} opts.listingType            — auction.com listing_type (default "active")
 * @param {string} opts.sort                   — sort key (default "auction_date")
 * @param {(msg:string)=>void} opts.onProgress
 */
export async function search({
  state = 'OH', maxListings = 10, listingType = 'active', sort = 'auction_date', onProgress,
} = {}) {
  const states = Array.isArray(state) ? state : [state];
  const bundles = [];

  for (const st of states) {
    if (bundles.length >= maxListings) break;
    const cards = await searchState({
      state: st.toUpperCase(), listingType, sort,
      maxListings: maxListings - bundles.length, onProgress,
    });

    for (const card of cards) {
      const detail = await fetchDetail(card.listing_id);
      bundles.push({ card, detail });
      await sleep(PAUSE_MS);
      if (bundles.length >= maxListings) break;
    }
  }
  return bundles;
}

// auction.com asset_type values → canonical asset_class.
function assetClassFrom(card) {
  const t = (card.listing_configuration?.asset_type || card.listing_configuration?.product_type || '').toLowerCase();
  if (/commercial|land|multi|industrial|office|retail/.test(t)) return 'commercial';
  return 'residential';   // default: auction.com is overwhelmingly residential
}

/** [ "179 Hickory St", "Lower Salem, OH 45745, Washington County" ] → parts */
function parseAddress(formatted) {
  const lines = Array.isArray(formatted) ? formatted : [formatted].filter(Boolean);
  const street = lines[0] || null;
  const rest   = lines[1] || '';
  // "Lower Salem, OH 45745, Washington County"
  const m = rest.match(/^(.*?),\s*([A-Z]{2})\s*(\d{5})?/);
  return {
    address: [street, rest].filter(Boolean).join(', ') || null,
    city:    m?.[1]?.trim() || null,
    state:   m?.[2] || null,
    zip:     m?.[3] || null,
  };
}

/** Map a raw Auction.com bundle → canonical record. */
export function normalize({ card, detail }) {
  const seg  = card.selling_method?.__typename === 'OnlineAuctionSegment' ? card.selling_method : null;
  const val  = card.external_information?.collateral?.summary || null;
  const prop = detail?.primary_property || {};
  const { address, city, state, zip } = parseAddress(card.formatted_address);

  return {
    source:      meta.slug,
    source_id:   String(card.listing_id),
    asset_class: assetClassFrom(card),
    scraped_at:  new Date().toISOString(),
    url:         `${meta.baseUrl}${card.listing_page_path}`,
    listing: {
      id:        card.listing_id,
      title:     address,
      address,
      city,
      state,
      zip,
      latitude:  null,   // not exposed on the search card
      longitude: null,
      brokerage: null,
      listed_on: seg?.start_date || null,
    },
    auction: {
      status:            card.listing_status || null,
      auction_type:      card.listing_configuration?.product_type || null,
      starting_bid_usd:  seg?.starting_bid_amount ?? null,
      bidding_starts:    seg?.start_date || null,
      bidding_ends:      seg?.initial_end_date || null,
      reserve_met:       null,
      bid_increment_usd: null,
      participation_deposit:  null,
      earnest_money_deposit:  null,
      marketing_fee_pct:      null,
      closing_period_days:    null,
      non_contingent:         null,
      // auction.com-specific extras kept for reference
      estimated_value_usd:    val?.estimated ?? null,
      value_range_low_usd:    val?.low ?? null,
      value_range_high_usd:   val?.high ?? null,
    },
    property: {
      // Commercial fields — null for residential auction.com inventory
      apn:            null,
      property_types: card.listing_configuration?.product_type ? [card.listing_configuration.product_type] : null,
      sub_types:      null,
      square_footage: null,   // see DETAIL_QUERY note (follow-up)
      tenancy:        null,
      year_built:     null,   // follow-up
      zoning:         null,
      opportunity_zone: null,
      // Residential fields
      beds:             prop.bedrooms ?? null,
      baths:            prop.bathrooms ?? null,
      living_area_sqft: null, // follow-up
      home_type:        card.listing_configuration?.asset_type || null,
      occupancy_status: card.listing_configuration?.occupancy_status || null,
    },
    description:           null,
    investment_highlights: null,
    media: {
      photos: card.listing_photos_count ?? (card.primary_photo ? 1 : 0),
      videos: 0,
      has_om: false,
    },
  };
}
