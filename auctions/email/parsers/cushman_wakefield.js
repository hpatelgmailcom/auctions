/**
 * Cushman & Wakefield (info@cwmultifamily.com) email parser.
 *
 * Deterministic — no network, no AI at runtime. AUTHORED AGAINST SYNTHETIC
 * FIXTURES (auctions/email/fixtures/cushman_wakefield/): once real samples are
 * dumped with `npm run email:sample -- --from info@cwmultifamily.com`, re-author
 * the field extraction below against them and replace the fixtures with
 * scrubbed real messages. See auctions/email/README.md.
 *
 * Expected blast structure (one email can carry several listings):
 *
 *   <title line>
 *   1234 N High St, Columbus, OH 43201
 *   Asking Price: $4,250,000
 *   Cap Rate: 6.25%
 *   NOI: $265,625
 *   Building Size: 14,550 SF
 *   View Listing: https://...
 */

import { createHash } from 'crypto';
import { saneMoney, saneCapRate, stateToAbbr } from '../../schema.js';
import { normalizeAddress } from '../registry.js';

export const meta = {
  slug:        'cushman_wakefield',
  displayName: 'Cushman & Wakefield',
  addresses:   ['info@cwmultifamily.com'],
  assetClass:  'commercial',
};

export function matches(msg) {
  return meta.addresses.includes(normalizeAddress(msg.from));
}

// "…<br>…</p>…" → line-oriented plain text (stripHtml would collapse newlines).
// Anchor hrefs are inlined first so listing URLs survive tag stripping.
function htmlToText(html) {
  return html
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>/gi, ' $1 ')
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

// "1234 N High St, Columbus, OH 43201"
const ADDRESS_RE = /^(\d+[^,\n]{3,60}),\s*([A-Za-z .'-]{2,40}),\s*([A-Za-z]{2})\.?\s*(\d{5})?/gm;

const field = (block, label) => {
  const m = block.match(new RegExp(`${label}\\s*[:—-]\\s*([^\\n]+)`, 'i'));
  return m ? m[1].trim() : null;
};

/** Stable source_id: listing-page URL slug when present, else address hash. */
function sourceIdFor(url, address) {
  const m = url?.match(/\/(?:listings?|properties|property)\/([\w-]+)/i);
  if (m) return m[1];
  const norm = address.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return createHash('sha1').update(norm).digest('hex').slice(0, 12);
}

export function parse(msg) {
  const body = msg.text || (msg.html ? htmlToText(msg.html) : null);
  if (!body) return [];

  // Locate every address line; each one anchors a listing block that runs
  // until the next address (blast emails carry several listings).
  const anchors = [...body.matchAll(ADDRESS_RE)];
  const records = [];

  for (let i = 0; i < anchors.length; i++) {
    const [line, street, city, state, zip] = anchors[i];
    const start = anchors[i].index;
    const end   = i + 1 < anchors.length ? anchors[i + 1].index : body.length;
    const block = body.slice(start, end);

    const asking  = saneMoney(field(block, 'Asking Price') ?? field(block, 'Price'));
    if (!asking) continue; // not a listing block (footer address, office address, …)

    const capRate = saneCapRate(field(block, 'Cap Rate'));
    const noi     = saneMoney(field(block, 'NOI'), { min: 1000 });
    const sqftRaw = field(block, 'Building Size') ?? field(block, 'Size') ?? field(block, 'SF');
    const sqft    = sqftRaw ? Number(sqftRaw.replace(/[^0-9.]/g, '')) || null : null;
    const url     = block.match(/https?:\/\/[^\s>"')]+/)?.[0] || null;

    // Title: nearest non-empty line above the address line
    const before  = body.slice(0, start).split('\n').filter(l => l.trim());
    const title   = before.length ? before[before.length - 1].trim() : null;

    const address   = zip ? `${street}, ${city}, ${state} ${zip}` : `${street}, ${city}, ${state}`;
    const sourceId  = sourceIdFor(url, address);

    records.push({
      source:       meta.slug,
      source_id:    sourceId,
      asset_class:  meta.assetClass,
      listing_type: 'sale',
      scraped_at:   new Date().toISOString(),
      url:          url || `https://mail.google.com/mail/u/0/#all/${msg.id}`,
      listing: {
        id:        sourceId,
        title:     title || line.trim(),
        address,
        city:      city.trim(),
        state:     stateToAbbr(state).toUpperCase(),
        zip:       zip || null,
        latitude:  null,
        longitude: null,
        brokerage: meta.displayName,
        listed_on: msg.date || null,
      },
      auction: {},
      sale: {
        asking_price_usd: asking,
        cap_rate_pct:     capRate,
        noi_usd:          noi,
        price_per_sqft:   sqft ? Math.round((asking / sqft) * 100) / 100 : null,
        tenant:           null,
      },
      property: {
        property_types: [field(block, 'Property Type') || 'Multifamily'],
        square_footage: sqft,
      },
      email: {
        message_id:  msg.id,
        received_at: msg.date || null,
        from:        normalizeAddress(msg.from),
      },
      description: msg.subject || null,
      media: {},
    });
  }

  return records;
}
