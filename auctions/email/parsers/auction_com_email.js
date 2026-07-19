/**
 * Auction.com notification emails (notifications@adc.auction.com) — archive-only.
 *
 * These are "RECOMMENDED PROPERTIES FOR YOU" digests for the same residential
 * inventory the auction_com scraper already ingests from the site/GraphQL API.
 * Creating listings here would only produce duplicates under a different
 * source key, so this parser deliberately returns no records: the message is
 * recorded as `no_listings` and moved to Gmail Trash, which is exactly the
 * "dedupe and remove the clutter in my email" behavior PROVIDERS.md asks for.
 */

import { normalizeAddress } from '../registry.js';

export const meta = {
  slug:        'auction_com_email',
  displayName: 'Auction.com (email)',
  addresses:   ['notifications@adc.auction.com'],
  assetClass:  'residential',
};

export function matches(msg) {
  return meta.addresses.includes(normalizeAddress(msg.from));
}

export function parse() {
  return []; // inventory already covered by the auction_com site scraper
}
