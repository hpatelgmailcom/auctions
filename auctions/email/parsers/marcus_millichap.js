/**
 * Marcus & Millichap Auction Services (mmauctions@marcusmillichap.com) parser.
 *
 * Deterministic — no network, no AI at runtime. Authored 2026-07-17 from real
 * samples. These are AUCTION announcements (Constant Contact blasts), one
 * property per email:
 *
 *   Subject: "Upcoming Auction - REIT Sale | 1529 West Lancaster Street - Bluffton, IN"
 *            "Coming Soon to Auction - 2.24 AC Development Site | … - Eagan, MN"
 *   Body:    "Starting Bid: $100,000 ASSET SNAPSHOT Property Type: Healthcare
 *             Number of Rooms: 46 Rooms Property Size: 36,194 SF Land Area: 3.77 AC
 *             Year Built: 1962/2026 VIEW AUCTION PAGE INVESTMENT HIGHLIGHTS …"
 *
 * The only link is a per-recipient Constant Contact tracking URL that 302s to
 * rimarketplace.com/auction/<id>; the raw email carries no auction id and no
 * bidding dates. So source_id is an address hash (stable across re-blasts of
 * the same property) and `url` is the tracking link (functional when clicked).
 * A future details fetcher can resolve the redirect for the canonical RIM URL
 * and auction dates.
 */

import { createHash } from 'crypto';
import { saneMoney } from '../../schema.js';
import { normalizeAddress } from '../registry.js';

export const meta = {
  slug:        'marcus_millichap',
  displayName: 'Marcus & Millichap',
  addresses:   ['mmauctions@marcusmillichap.com'],
  assetClass:  'commercial',
};

export function matches(msg) {
  return meta.addresses.includes(normalizeAddress(msg.from));
}

const sha12 = s => createHash('sha1')
  .update(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
  .digest('hex').slice(0, 12);

/** "Starting Bid: $100,000 …" — labeled fields run inline in one long line.
 *  A value ends at the next "Label:" or at an ALL-CAPS section header
 *  (ASSET SNAPSHOT, VIEW AUCTION PAGE, INVESTMENT HIGHLIGHTS…). */
const field = (body, label) => {
  const m = body.match(new RegExp(
    `${label}\\s*:\\s*([^:]{1,60}?)(?=\\s+[A-Z][a-zA-Z ]{2,25}:|\\s+[A-Z]{3,}(?:\\s+[A-Z]{3,})+|\\s*$)`, 'i'));
  return m ? m[1].trim() : null;
};

const num = s => { const n = Number(String(s ?? '').replace(/[^0-9.]/g, '')); return n > 0 ? n : null; };

const SUBJECT_PREFIX_RE = /^(?:Auction\s*[-–:]\s*)?(?:Upcoming Auction|Coming Soon to Auction|Upcoming Property Tour[^|]*|Auction (?:Reminder|Alert)|Last (?:Chance|Call)[^|]*|Bidding Now Live|Bidding (?:Opens|Now Open)[^|]*|Now Accepting Offers|Register to Bid)\s*[-–:|]*\s*/i;

const STREET_RE = /\b\d+[\w\d .'-]*?\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Parkway|Pkwy|Place|Pl|Highway|Hwy)\b\.?/i;

// "City, ST" with at most a 2-word city — greedy multi-word matching would
// swallow property names ("…Assemblage Hollywood, FL" lesson from C&W).
const CITY_ST_RE = /((?:[A-Z][a-z.']+\s)?[A-Z][a-z.']+),\s*([A-Z]{2})\b/;

/** Location priority: subject trailing "- City, ST" (whole final segment =
 *  city, so Branson West survives) → "City, ST" anywhere in the subject →
 *  first "City, ST" in the body. Digest/MSA-only emails yield null. */
function locationFrom(subject, body) {
  const tail = subject.match(/[-–|]\s*([A-Za-z .'-]{2,30}?),\s*([A-Z]{2})\s*$/);
  if (tail) return { city: tail[1].trim(), state: tail[2] };
  const mid = subject.match(CITY_ST_RE) || body.match(CITY_ST_RE);
  return mid ? { city: mid[1].trim(), state: mid[2] } : null;
}

export function parse(msg) {
  if (/^\s*(?:JUST\s+)?(?:SOLD|CLOSED)\b/i.test(msg.subject || '')) return [];

  const body = (msg.text || '')
    .split(/BROKER OF RECORD|Yes, continue sending me emails|SafeUnsubscribe/i)[0];
  if (!body) return [];

  // Single-property announcements always carry the auction-page CTA; digests
  // ("Bidding Ends Today: July 13-15 Auctions") and promos don't get parsed —
  // digests re-blast auctions that were announced individually.
  if (!/VIEW AUCTION PAGE/i.test(body) || /\bAuctions\s*$/i.test(msg.subject || '')) return [];

  // Coming-soon announcements often have no bid yet — bid is optional.
  const startingBid = saneMoney(field(body, 'Starting Bid'), { min: 1000 });

  const subject = msg.subject || '';
  const loc = locationFrom(subject, body);
  if (!loc) return []; // "Atlanta MSA" etc. — no parseable city/state anywhere
  const { city, state } = loc;

  const title  = subject.replace(SUBJECT_PREFIX_RE, '')
    .replace(/[-–|]\s*[A-Za-z .'-]{2,30}?,\s*[A-Z]{2}\s*$/, '').trim();
  const street = subject.match(STREET_RE)?.[0]?.trim() ?? null;

  const address  = street ? `${street}, ${city}, ${state}`
                          : `${title.split('|')[0].trim()}, ${city}, ${state}`;
  const sourceId = sha12(address);

  // Per-recipient tracking link (302s to rimarketplace.com/auction/<id>) —
  // only present in the HTML part.
  const url = msg.html?.match(/<a[^>]+href="([^"]+)"[^>]*>(?:(?!<\/a>)[\s\S]){0,300}?VIEW AUCTION PAGE/i)?.[1]
           ?? `https://mail.google.com/mail/u/0/#all/${msg.id}`;

  const highlights = body.match(/INVESTMENT HIGHLIGHTS\s+([\s\S]{40,2500}?)(?:\s{2,}[A-Z][a-z]+ [A-Z][a-z]+ (?:Director|Senior|Vice|Broker|First)|$)/i)?.[1]?.trim() ?? null;
  const propType   = field(body, 'Property Type')?.replace(/\s*\(.*\)$/, '') ?? null;

  return [{
    source:       meta.slug,
    source_id:    sourceId,
    asset_class:  meta.assetClass,
    listing_type: 'auction',
    scraped_at:   new Date().toISOString(),
    url,
    listing: {
      id:        sourceId,
      title,
      address,
      city,
      state,
      zip:       null,
      latitude:  null,
      longitude: null,
      brokerage: meta.displayName,
      listed_on: msg.date || null,
    },
    auction: {
      status:           /coming soon/i.test(subject) ? 'coming_soon' : 'upcoming',
      auction_type:     null,
      starting_bid_usd: startingBid,
      bidding_starts:   null,   // not in the email; RIM page has it (future details step)
      bidding_ends:     null,
    },
    property: {
      property_types: propType ? [propType] : null,
      square_footage: num(field(body, 'Property Size')),
      acreage:        num(field(body, 'Land Area')),
      year_built:     num(field(body, 'Year Built')?.match(/\d{4}/)?.[0]),
      rooms:          num(field(body, 'Number of Rooms')),
      occupancy_pct:  num(field(body, 'Occupancy')),
    },
    email: {
      message_id:  msg.id,
      received_at: msg.date || null,
      from:        normalizeAddress(msg.from),
    },
    description: highlights,
    media: {},
  }];
}
