/**
 * Cushman & Wakefield Multifamily (info@cwmultifamily.com) email parser.
 *
 * Deterministic — no network, no AI at runtime. Authored 2026-07-17 from real
 * samples (multifamily.cushwake.com listing-notification blasts). Observed
 * format, one listing per email:
 *
 *   - Subject carries the title behind a prefix:
 *       "EXCLUSIVE OFFERING: 1025 Metro | 151-Unit Multifamily Opportunity"
 *       "NEW OFFERING: The Johnson Street Assemblage Hollywood, FL"
 *       "COMING SOON :: Lamplighter Legacy | ... | Ocala, FL"
 *   - Body links to https://multifamily.cushwake.com/Listings/<id>?RUID=…
 *     (the numeric id is the stable source_id)
 *   - Location lives in prose: "located at 1025 E 25th Street in Hialeah,
 *     Florida" or just "in Ocala, Florida" — or in the subject's trailing
 *     "City, ST". Some emails (development sites, coming-soons) carry no
 *     location at all → we return [] and the message lands as `no_listings`.
 *   - Institutional offerings are UNPRICED — sale.asking_price_usd is null
 *     unless a labeled price appears. Unit count appears as "151-Unit"/"423
 *     Units".
 *   - Footer (after "Thank you for your interest" / "You received this
 *     e-mail") contains C&W *office* addresses — must be truncated before any
 *     address matching.
 */

import { saneMoney, saneCapRate, stateToAbbr, STATE_ABBR } from '../../schema.js';
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

// "…<br>…</p>…" → line-oriented plain text; anchor hrefs inlined so listing
// URLs survive tag stripping.
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

// "Alabama|Alaska|…|Wyoming" — for matching full state names in prose
const STATE_NAME_RE = Object.keys(STATE_ABBR)
  .map(s => s.replace(/(^|\s)\w/g, c => c.toUpperCase()))
  .join('|');

// "NEW OFFERING:", "OM AVAILABLE:", "OFFERS DUE 7/22:", "COMING SOON ::",
// "CFO Reminder: July 29th |", … — marketing prefix up to the first ":"/"::"
const SUBJECT_PREFIX_RE = /^(?:EXCLUSIVE OFFERING|NEW OFFERING|NEW FINANCIALS|COMING SOON|JUST LISTED|FOR SALE|OMS? AVAILABLE|OFFERS DUE|TOURS? AVAILABLE|CALL FOR OFFERS(?: REMINDER)?|CFO REMINDER|AVAILABLE|PRICE (?:REDUCED|IMPROVEMENT))[\s\d/.]*[:|–-]+\s*/i;

/** Strip marketing prefix ("NEW OFFERING:", "COMING SOON ::") from a subject. */
function titleFrom(subject) {
  return (subject || '').replace(SUBJECT_PREFIX_RE, '').trim() || null;
}

// Two-word cities are only accepted when the first word is a common city
// prefix — subjects run the property name straight into the city ("…Assemblage
// Hollywood, FL"), so a greedy multi-word match would swallow the name.
const CITY_PREFIX = '(?:Fort|Port|San|Santa|New|North|South|East|West|Lake|Palm|Coral|Boca|Saint|St\\.?|Los|Las|El|Cape|Mount|Pueblo)';
const CITY_RE     = `(?:${CITY_PREFIX}\\s[A-Z][a-z]+|[A-Z][a-z]+)`;

/**
 * Find the property location. Priority:
 *   1. prose "located/situated at <street> in <City>, <State>"
 *   2. prose "in/throughout <City>, <StateName|ST>"
 *   3. subject trailing "…City, ST"
 * Returns { street, city, state } (street may be null) or null.
 */
function locationFrom(body, subject) {
  const at = body.match(new RegExp(
    `(?:located|situated)\\s+at\\s+(\\d[\\w\\d .'-]{3,50}?)\\s+in\\s+([A-Z][A-Za-z .'-]{2,30}?),\\s+(${STATE_NAME_RE}|[A-Z]{2})\\b`
  ));
  if (at) return { street: at[1].trim(), city: at[2].trim(), state: at[3] };

  // "throughout Pueblo and Pueblo West, Colorado" — skip a leading "<City> and"
  const inCity = body.match(new RegExp(
    `\\b(?:in|throughout|across|of)\\s+(?:${CITY_RE}\\s+and\\s+)?(${CITY_RE}),\\s+(${STATE_NAME_RE}|[A-Z]{2})\\b`
  ));
  if (inCity) return { street: null, city: inCity[1].trim(), state: inCity[2] };

  const subj = (subject || '').match(new RegExp(`(${CITY_RE}),\\s*([A-Z]{2})\\s*$`));
  if (subj) return { street: null, city: subj[1].trim(), state: subj[2] };

  return null;
}

export function parse(msg) {
  // Sold/closed announcements are not actionable inventory.
  if (/^\s*(?:JUST\s+)?(?:SOLD|CLOSED)\b/i.test(msg.subject || '')) return [];

  const raw = msg.text || (msg.html ? htmlToText(msg.html) : null);
  if (!raw) return [];

  // Everything after the sign-off is broker signatures + office addresses +
  // legal boilerplate; matching against it would pick up C&W office locations.
  const body = raw.split(/Thank you for your interest|You received this e-?mail|Global Headquarters/i)[0];

  // The listing page link carries the only stable id. No link → nothing to key on.
  const link = body.match(/https?:\/\/multifamily\.cushwake\.com\/Listings\/(\d+)\S*/i);
  if (!link) return [];
  const sourceId = link[1];
  const url      = `https://multifamily.cushwake.com/Listings/${sourceId}`; // strip per-recipient RUID token

  const loc = locationFrom(body, msg.subject);
  if (!loc) return []; // no location in email → operator follows up via the message itself

  const state   = stateToAbbr(loc.state).toUpperCase();
  const title   = titleFrom(msg.subject);
  // Street when present; else the property name makes the address (and thus
  // the listing filename) unique across same-city offerings. Trailing
  // "City, ST" / unit-count segments are stripped so they don't duplicate.
  const nameForAddress = (title || `Listing ${sourceId}`)
    .replace(new RegExp(`[|,]?\\s*${CITY_RE},\\s*[A-Z]{2}\\s*$`), '')
    .replace(/[|,]?\s*[\d.]+[\s-]?(?:Units?|Acres?)(?:\s+in)?\s*(?=[|,]|$)/gi, '')
    .split('|')[0].replace(/[-,\s]+$/, '').trim();
  const address = loc.street
    ? `${loc.street}, ${loc.city}, ${state}`
    : `${nameForAddress}, ${loc.city}, ${state}`;

  const units   = body.match(/\b(\d{2,4})[\s-]?Units?\b/i)?.[1]
               ?? msg.subject?.match(/\b(\d{2,4})[\s-]?Units?\b/i)?.[1] ?? null;
  // Prices are rare in these blasts; parse only explicit labels.
  const asking  = saneMoney(body.match(/(?:Asking|List|Purchase)?\s*Price\s*[:–-]\s*\$?([\d,.]+)/i)?.[1]);
  const capRate = saneCapRate(body.match(/Cap Rate\s*[:–-]\s*([\d.]+)\s*%/i)?.[1]);
  const noi     = saneMoney(body.match(/\bNOI\s*[:–-]\s*\$?([\d,.]+)/i)?.[1], { min: 1000 });

  // First prose paragraph as the description — skip link preambles, CTA rows,
  // and the account-credential blurb (never store passwords).
  const description = body.split('\n')
    .map(l => l.replace(/\(?https?:\/\/\S+\)?/g, '').replace(/\(mailto:[^)]*\)/g, '').trim())
    .filter(l => l.length > 80 && !/password|unsubscribe|schedule a tour|execute the|watch the video/i.test(l))[0] ?? null;

  return [{
    source:       meta.slug,
    source_id:    sourceId,
    asset_class:  meta.assetClass,
    listing_type: 'sale',
    scraped_at:   new Date().toISOString(),
    url,
    listing: {
      id:        sourceId,
      title,
      address,
      city:      loc.city,
      state,
      zip:       null,
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
      price_per_sqft:   null,
      tenant:           null,
    },
    property: {
      property_types: ['Multifamily'],
      units:          units ? Number(units) : null,
    },
    email: {
      message_id:  msg.id,
      received_at: msg.date || null,
      from:        normalizeAddress(msg.from),
    },
    description,
    media: {},
  }];
}
