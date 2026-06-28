/**
 * retail_market.js
 *
 * Fetches retail market data (asking rent $/SF/YR, lease comps) from
 * CommercialCafe.com using a three-tier fallback strategy:
 *
 *   Tier 1 — City level        (e.g. vermilion, oh)
 *   Tier 2 — County level      (e.g. erie-county, oh)   — if < 3 priced comps
 *   Tier 3 — State capital     (e.g. columbus, oh)      — if still < 3 comps
 *
 * Usage (standalone):
 *   node enrichment/retail_market.js "vermilion" "oh" "erie"
 *
 * API:
 *   import { fetchRetailMarket } from './enrichment/retail_market.js';
 *   const data = await fetchRetailMarket({ city, stateAbbr, county });
 */

import puppeteer from 'puppeteer';
import { withRetry } from './retry.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MIN_PRICED_COMPS = 3;  // threshold below which we try the next tier

/** Average of an array — null if empty */
const avg = arr =>
  arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100 : null;

// State capital cities used as Tier 3 proxy for thin markets
const STATE_CAPITALS = {
  al:'montgomery', ak:'juneau',   az:'phoenix',    ar:'little-rock',
  ca:'sacramento', co:'denver',   ct:'hartford',   de:'dover',
  fl:'tallahassee',ga:'atlanta',  hi:'honolulu',   id:'boise',
  il:'springfield',in:'indianapolis',ia:'des-moines',ks:'topeka',
  ky:'frankfort',  la:'baton-rouge',me:'augusta',  md:'annapolis',
  ma:'boston',     mi:'lansing',  mn:'saint-paul', ms:'jackson',
  mo:'jefferson-city',mt:'helena',ne:'lincoln',    nv:'carson-city',
  nh:'concord',    nj:'trenton',  nm:'santa-fe',   ny:'albany',
  nc:'raleigh',    nd:'bismarck', oh:'columbus',   ok:'oklahoma-city',
  or:'salem',      pa:'harrisburg',ri:'providence',sc:'columbia',
  sd:'pierre',     tn:'nashville',tx:'austin',     ut:'salt-lake-city',
  vt:'montpelier', va:'richmond', wa:'olympia',    wv:'charleston',
  wi:'madison',    wy:'cheyenne',
};

// ---------------------------------------------------------------------------
// CommercialCafe scraper (single page)
// ---------------------------------------------------------------------------

async function scrapeCommercialCafe(page, url) {
  await withRetry(
    () => page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }),
    { label: 'commercialcafe.com', maxRetries: 2,
      shouldRetry: err => /timeout|navigation|net::/i.test(err?.message || '') }
  );
  await new Promise(r => setTimeout(r, 1500));

  return page.evaluate(() => {
    const parsePrice = raw => {
      if (!raw || raw.toLowerCase().includes('contact')) return null;
      const sfMatch = raw.match(/\$([\d,.]+)\/SF\/YR/i);
      if (sfMatch) return { value: parseFloat(sfMatch[1].replace(/,/g, '')), unit: '$/SF/YR' };
      const totMatch = raw.match(/\$([\d,]+)/);
      if (totMatch) return { value: parseFloat(totMatch[1].replace(/,/g, '')), unit: '$' };
      return null;
    };

    const US_STATE = /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)/;

    const blocks  = document.body.innerText.split(/View Details\s*\(opens in new window\)/i);
    const results = [];

    for (const block of blocks) {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 3) continue;

      const addressLine  = lines.find(l => US_STATE.test(l)) ?? null;
      const forLease     = lines.some(l => /for lease/i.test(l));
      const forSale      = lines.some(l => /for sale/i.test(l));
      const priceLine    = lines.find(l => /\$[\d,.]+\/SF\/YR|\$[\d,]+/i.test(l) && !/sq\s*ft|built/i.test(l));
      const typeLine     = lines.find(l => /^(Retail|Office|Industrial|Mixed Use|Land|Multifamily|Flex|Healthcare)/i.test(l)) ?? null;
      const sizeMatch    = lines.find(l => /[\d,]+\s*SF/i.test(l) && /available|size/i.test(l))
                                ?.match(/([\d,]+(?:\s*-\s*[\d,]+)?)\s*SF/i);
      const parsed       = parsePrice(priceLine);

      results.push({
        address:          addressLine,
        listing_type:     forLease ? 'For Lease' : forSale ? 'For Sale' : null,
        property_type:    typeLine,
        price_raw:        priceLine ?? null,
        asking_per_sf_yr: parsed?.unit === '$/SF/YR' ? parsed.value : null,
        sale_price:       parsed?.unit === '$'        ? parsed.value : null,
        size_sf_range:    sizeMatch?.[1]?.replace(/\s+/g, '') ?? null,
      });
    }

    return results.filter(r => r.address || r.price_raw);
  });
}

function buildResult(listings, url, tier, tierLabel) {
  const retailLeases = listings.filter(l =>
    l.listing_type === 'For Lease' &&
    (!l.property_type || /retail/i.test(l.property_type)) &&
    l.asking_per_sf_yr !== null
  );
  const allPriced  = listings.filter(l => l.asking_per_sf_yr !== null);
  const prices     = retailLeases.map(l => l.asking_per_sf_yr);

  return {
    source:                   'CommercialCafe.com',
    url,
    search_tier:              tier,
    search_tier_label:        tierLabel,
    total_listings:           listings.length,
    retail_leases_with_price: retailLeases.length,
    thin_market:              retailLeases.length < 3,
    retail_asking_rent: {
      avg_per_sf_yr: avg(prices),
      min_per_sf_yr: prices.length ? Math.min(...prices) : null,
      max_per_sf_yr: prices.length ? Math.max(...prices) : null,
    },
    all_priced_leases: allPriced,
    all_listings:      listings,
  };
}

// ---------------------------------------------------------------------------
// Public API — three-tier fallback
// ---------------------------------------------------------------------------

export async function fetchRetailMarket({ city, stateAbbr, county } = {}) {
  const state = stateAbbr?.toLowerCase();
  const citySlug   = city?.toLowerCase().replace(/\s+/g, '-');
  const countySlug = county?.toLowerCase().replace(/\s+/g, '-');
  const capital    = STATE_CAPITALS[state];

  const tiers = [
    {
      tier:  1,
      label: `${city}, ${stateAbbr?.toUpperCase()} (city)`,
      url:   `https://www.commercialcafe.com/commercial-real-estate/us/${state}/${citySlug}/`,
    },
    countySlug && {
      tier:  2,
      label: `${county} County, ${stateAbbr?.toUpperCase()} (county)`,
      url:   `https://www.commercialcafe.com/commercial-real-estate/us/${state}/${countySlug}-county/`,
    },
    capital && capital !== citySlug && {
      tier:  3,
      label: `${capital} (state capital proxy)`,
      url:   `https://www.commercialcafe.com/commercial-real-estate/us/${state}/${capital}/`,
    },
  ].filter(Boolean);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 },
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    for (const { tier, label, url } of tiers) {
      const isLastTier = tier === tiers[tiers.length - 1].tier;

      try {
        const listings = await scrapeCommercialCafe(page, url);
        const result   = buildResult(listings, url, tier, label);

        if (!result.thin_market || isLastTier) {
          if (tier > 1) {
            console.warn(`    [retail] Tier ${tier} used: ${label} (${result.retail_leases_with_price} priced comp${result.retail_leases_with_price !== 1 ? 's' : ''})`);
          }
          return result;
        }

        console.warn(`    [retail] Tier ${tier} thin (${result.retail_leases_with_price} comps) — trying ${tiers[tier]?.label ?? 'next tier'}…`);
      } catch (err) {
        if (isLastTier) throw err;
        console.warn(`    [retail] Tier ${tier} failed (${err.message.split('\n')[0]}) — trying next tier…`);
      }
    }
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (process.argv[1].endsWith('retail_market.js')) {
  const [,, city = 'vermilion', stateAbbr = 'oh', county] = process.argv;
  console.log(`Fetching retail market: ${city}, ${stateAbbr.toUpperCase()}${county ? `, ${county} County` : ''}…`);
  fetchRetailMarket({ city, stateAbbr, county })
    .then(d => console.log(JSON.stringify(d, null, 2)))
    .catch(e => { console.error(e.message); process.exit(1); });
}
