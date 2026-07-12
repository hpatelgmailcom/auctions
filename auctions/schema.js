/**
 * schema.js — the canonical listing shape shared across all providers.
 *
 * Every provider adapter (providers/<name>/index.js) must emit a record that
 * matches `CANONICAL_SHAPE` below. Everything downstream — enrichment, the
 * due-diligence agent, the SQLite importer, the API and the dashboard — reads
 * only this shape, never a provider's native payload.
 *
 * This module also holds the small, provider-neutral helpers (slugging an
 * address into a filename, stripping HTML, state-name → abbreviation) that used
 * to live inside scraper.js and enrich.js.
 */

// ---------------------------------------------------------------------------
// Canonical shape (documentation + a runtime validator)
// ---------------------------------------------------------------------------

/**
 * A canonical record looks like:
 *
 * {
 *   source:       "crexi" | "auction_com",   // provider slug
 *   source_id:    "1893472",                  // provider-native id (string)
 *   asset_class:  "commercial" | "residential",
 *   scraped_at:   ISO string,
 *   url:          provider-owned listing URL,
 *   listing:  { id, title, address, city, state, zip, latitude, longitude, brokerage, listed_on },
 *   auction:  { status, auction_type, starting_bid_usd, bidding_starts, bidding_ends, ... },
 *   property: { // commercial: apn, property_types, square_footage, zoning, tenancy, ...
 *               // residential: beds, baths, living_area_sqft, home_type, occupancy_status },
 *   description, investment_highlights,
 *   media:    { photos, videos, has_om, ... },
 *   // added later by enrich.js / the DD agent:
 *   market_research, due_diligence, compliance_review
 * }
 *
 * `listing.id` is kept equal to `source_id` for backwards compatibility with
 * code that still reads `record.listing.id`.
 */

export const ASSET_CLASSES = ['commercial', 'residential'];

/**
 * Validate a canonical record. Returns { ok, errors[] }. Providers should run
 * this before writing a file so malformed records never reach the DB.
 */
export function validate(record) {
  const errors = [];
  const req = (cond, msg) => { if (!cond) errors.push(msg); };

  req(record && typeof record === 'object', 'record is not an object');
  if (!record || typeof record !== 'object') return { ok: false, errors };

  req(typeof record.source === 'string' && record.source, 'missing source');
  req(record.source_id != null && String(record.source_id).length > 0, 'missing source_id');
  req(ASSET_CLASSES.includes(record.asset_class), `asset_class must be one of ${ASSET_CLASSES.join('/')}`);
  req(typeof record.url === 'string' && record.url, 'missing url');

  const l = record.listing || {};
  req(l.id != null, 'missing listing.id');
  req(!!l.address, 'missing listing.address');
  req(!!l.city, 'missing listing.city');
  req(!!l.state, 'missing listing.state');

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Shared, provider-neutral helpers
// ---------------------------------------------------------------------------

/** Strip HTML tags from rich-text fields. */
export const stripHtml = str =>
  str?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;

/**
 * "3126 Avenue of the Cities, Moline, Rock Island County, IL 61265"
 *   → "3126_avenue_of_the_cities_moline_il_61265.json"
 */
export function addressToFilename(address) {
  return (address || 'unknown')
    .toLowerCase()
    .replace(/,?\s+[\w\s]+ county,?\s*/gi, ' ') // strip "Rock Island County", etc.
    .replace(/[^a-z0-9]+/g, '_')                // non-alphanumeric → underscore
    .replace(/^_+|_+$/g, '')                    // trim leading/trailing underscores
    .substring(0, 120)                          // cap length
    + '.json';
}

/** US state abbreviation lookup (full name → 2-letter abbr). */
const STATE_ABBR = {
  alabama:'al',alaska:'ak',arizona:'az',arkansas:'ar',california:'ca',colorado:'co',
  connecticut:'ct',delaware:'de',florida:'fl',georgia:'ga',hawaii:'hi',idaho:'id',
  illinois:'il',indiana:'in',iowa:'ia',kansas:'ks',kentucky:'ky',louisiana:'la',
  maine:'me',maryland:'md',massachusetts:'ma',michigan:'mi',minnesota:'mn',
  mississippi:'ms',missouri:'mo',montana:'mt',nebraska:'ne',nevada:'nv',
  'new hampshire':'nh','new jersey':'nj','new mexico':'nm','new york':'ny',
  'north carolina':'nc','north dakota':'nd',ohio:'oh',oklahoma:'ok',oregon:'or',
  pennsylvania:'pa','rhode island':'ri','south carolina':'sc','south dakota':'sd',
  tennessee:'tn',texas:'tx',utah:'ut',vermont:'vt',virginia:'va',washington:'wa',
  'west virginia':'wv',wisconsin:'wi',wyoming:'wy',
};

/** State name → 2-letter abbreviation. Passes through 2-letter input unchanged. */
export function stateToAbbr(stateName) {
  if (!stateName) return null;
  const lower = stateName.toLowerCase().trim();
  if (lower.length === 2) return lower;
  return STATE_ABBR[lower] || lower.substring(0, 2);
}

/**
 * Extract county name from a full address string.
 * "133 Halsted St, Lowell, Lake County, IN 46356" → "lake"
 */
export function countyFrom(address) {
  const m = address?.match(/,\s+([\w\s]+?)\s+County,/i);
  return m ? m[1].trim().toLowerCase() : null;
}

/** Composite DB primary key for a canonical record: "crexi:1893472". */
export function recordKey(record) {
  return `${record.source}:${record.source_id ?? record.listing?.id}`;
}
