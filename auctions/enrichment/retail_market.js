/**
 * retail_market.js
 *
 * Fetches retail market data (asking rent $/SF/YR, lease comps) for a city
 * from CommercialCafe.com using Puppeteer.
 *
 * Usage (standalone):
 *   node enrichment/retail_market.js "vermilion" "oh"
 *
 * API:
 *   import { fetchRetailMarket } from './enrichment/retail_market.js';
 *   const data = await fetchRetailMarket({ city: 'vermilion', stateAbbr: 'oh' });
 */

import puppeteer from 'puppeteer';
import { withRetry } from './retry.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Parse a price string into a structured value */
function parsePrice(raw) {
  if (!raw || raw.toLowerCase().includes('contact')) return null;
  const sfMatch  = raw.match(/\$([\d,.]+)\/SF\/YR/i);
  if (sfMatch) return { value: parseFloat(sfMatch[1].replace(/,/g, '')), unit: '$/SF/YR' };
  const totMatch = raw.match(/\$([\d,]+)/);
  if (totMatch) return { value: parseFloat(totMatch[1].replace(/,/g, '')), unit: '$' };
  return null;
}

/** Average of an array of numbers */
const avg = arr =>
  arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100 : null;

/** Scrape CommercialCafe for a city and return structured listing data */
async function scrapeCommercialCafe(city, stateAbbr) {
  const slug = city.toLowerCase().replace(/\s+/g, '-');
  const url  = `https://www.commercialcafe.com/commercial-real-estate/us/${stateAbbr.toLowerCase()}/${slug}/`;

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

    await withRetry(
      () => page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }),
      { label: 'commercialcafe.com', maxRetries: 2,
        shouldRetry: err => /timeout|navigation|net::/i.test(err?.message || '') }
    );
    await new Promise(r => setTimeout(r, 1500));

    const listings = await page.evaluate(() => {
      const results = [];

      // Inline price parser (must be defined inside page.evaluate)
      const parsePrice = raw => {
        if (!raw || raw.toLowerCase().includes('contact')) return null;
        const sfMatch = raw.match(/\$([\d,.]+)\/SF\/YR/i);
        if (sfMatch) return { value: parseFloat(sfMatch[1].replace(/,/g, '')), unit: '$/SF/YR' };
        const totMatch = raw.match(/\$([\d,]+)/);
        if (totMatch) return { value: parseFloat(totMatch[1].replace(/,/g, '')), unit: '$' };
        return null;
      };

      const allText = document.body.innerText;

      // Split by property boundaries (each listing ends with "View Details")
      const blocks = allText.split(/View Details\s*\(opens in new window\)/i);

      for (const block of blocks) {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 3) continue;

        // Address is usually the first or second meaningful line
        const addressLine = lines.find(l => l.match(/,\s*(OH|AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)/));

        // Listing type
        const forLease = lines.some(l => /for lease/i.test(l));
        const forSale  = lines.some(l => /for sale/i.test(l));

        // Price — $/SF/YR or dollar amount
        const priceLine = lines.find(l => /\$[\d,.]+\/SF\/YR|\$[\d,]+/i.test(l) && !/sq\s*ft|built/i.test(l));

        // Property type
        const typeLine  = lines.find(l => /^(Retail|Office|Industrial|Mixed Use|Land|Multifamily|Flex|Healthcare)/i.test(l));
        const spaceType = lines.find(l => /^Space Type$/i.test(l));

        // Size
        const sizeLine  = lines.find(l => /[\d,]+\s*SF/i.test(l) && /available|size/i.test(l));
        const sizeMatch = sizeLine?.match(/([\d,]+(?:\s*-\s*[\d,]+)?)\s*SF/i);

        const parsed = parsePrice(priceLine);
        results.push({
          address:      addressLine ?? null,
          listing_type: forLease ? 'For Lease' : forSale ? 'For Sale' : null,
          property_type:typeLine ?? null,
          price_raw:    priceLine ?? null,
          asking_per_sf_yr: (parsed?.unit === '$/SF/YR') ? parsed.value : null,
          sale_price:   (parsed?.unit === '$') ? parsed.value : null,
          size_sf_range:sizeMatch?.[1]?.replace(/\s+/g, '') ?? null,
        });
      }

      return results.filter(r => r.address || r.price_raw);
    });

    // Filter to retail lease listings with stated $/SF/YR price
    const retailLeases = listings.filter(l =>
      l.listing_type === 'For Lease' &&
      (!l.property_type || /retail/i.test(l.property_type)) &&
      l.asking_per_sf_yr !== null
    );

    const allPriced = listings.filter(l => l.asking_per_sf_yr !== null);
    const retailPrices = retailLeases.map(l => l.asking_per_sf_yr);

    return {
      source:         'CommercialCafe.com',
      url,
      total_listings: listings.length,
      retail_leases_with_price: retailLeases.length,
      retail_asking_rent: {
        avg_per_sf_yr: avg(retailPrices),
        min_per_sf_yr: retailPrices.length ? Math.min(...retailPrices) : null,
        max_per_sf_yr: retailPrices.length ? Math.max(...retailPrices) : null,
      },
      all_priced_leases: allPriced,
      all_listings:      listings,
    };
  } finally {
    await browser.close();
  }
}

export async function fetchRetailMarket({ city, stateAbbr }) {
  return scrapeCommercialCafe(city, stateAbbr);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (process.argv[1].endsWith('retail_market.js')) {
  const city      = process.argv[2] || 'vermilion';
  const stateAbbr = process.argv[3] || 'oh';
  console.log(`Fetching retail market data for ${city}, ${stateAbbr.toUpperCase()}…`);
  fetchRetailMarket({ city, stateAbbr })
    .then(d => console.log(JSON.stringify(d, null, 2)))
    .catch(e => { console.error(e.message); process.exit(1); });
}
