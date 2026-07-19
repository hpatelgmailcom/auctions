/**
 * Visintainer Group (john@visintainergroup.ccsend.com) — Fresno / Central
 * Valley retail & office sales.
 *
 * Deterministic — no network, no AI at runtime. Authored 2026-07-18 from real
 * samples. Constant Contact blasts whose bodies are IMAGES (the text part is
 * just broker signatures), so everything parseable is in the subject:
 *
 *   "For Sale | Parkway Trails Shopping Center | $20,600,000 | Clovis, CA"
 *
 * "Central Valley Retail Market Tracker" newsletters and "For Closed:" /
 * sold notices are skipped. source_id is a hash of "<name>, <city>, <state>"
 * (re-blasts of the same offering hash identically); url is the first
 * tracking link in the html (the hero-image click-through) when present.
 */

import { createHash } from 'crypto';
import { saneMoney } from '../../schema.js';
import { normalizeAddress } from '../registry.js';

export const meta = {
  slug:        'visintainer_group',
  displayName: 'Visintainer Group',
  addresses:   ['john@visintainergroup.ccsend.com'],
  assetClass:  'commercial',
};

export function matches(msg) {
  const addr = normalizeAddress(msg.from);
  return addr != null && (meta.addresses.includes(addr) || addr.endsWith('@visintainergroup.ccsend.com'));
}

const sha12 = s => createHash('sha1')
  .update(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
  .digest('hex').slice(0, 12);

function propertyTypeFrom(name) {
  if (/office/i.test(name)) return 'Office';
  if (/shopping|retail|plaza|center|pad/i.test(name)) return 'Retail';
  if (/industrial|warehouse/i.test(name)) return 'Industrial';
  return null;
}

export function parse(msg) {
  const subject = msg.subject || '';
  if (/market tracker|newsletter|report/i.test(subject)) return [];
  if (/\b(?:for|just)\s+closed\b|\bsold\b/i.test(subject)) return [];
  if (!/^\s*(?:for sale|new listing|price reduced|back on market)\s*\|/i.test(subject)) return [];

  const segs = subject.split('|').map(s => s.trim()).filter(Boolean);
  // [ "For Sale", <name>, ..., "$20,600,000", ..., "City, ST" ]
  const locSeg = segs[segs.length - 1].match(/^([A-Z][A-Za-z .'-]{2,25}?),\s*([A-Z]{2})$/);
  if (!locSeg) return [];
  const city = locSeg[1].trim(), state = locSeg[2];

  const name = segs[1] && !/^\$/.test(segs[1]) ? segs[1] : null;
  if (!name) return [];

  const price = saneMoney(segs.find(s => /^\$[\d,]+$/.test(s)));

  const address  = `${name}, ${city}, ${state}`;
  const sourceId = sha12(address);

  // Hero-image click-through — the first Constant Contact tracking link.
  const url = msg.html?.match(/<a[^>]+href="(https:\/\/[\w.-]+\.rs6\.net\/tn\.jsp[^"]+)"/i)?.[1]
           ?? `https://mail.google.com/mail/u/0/#all/${msg.id}`;

  // Teaser between the preheader and the broker signature block, if any.
  const description = (msg.text || '')
    .match(/Email from Visintainer Group\s+([\s\S]{10,300}?)(?:\s+[A-Z]+ VISINTAINER|\s+BRETT|\s*$)/i)?.[1]
    ?.replace(/\s+/g, ' ').trim() ?? null;

  const propType = propertyTypeFrom(name);

  return [{
    source:       meta.slug,
    source_id:    sourceId,
    asset_class:  meta.assetClass,
    listing_type: 'sale',
    scraped_at:   new Date().toISOString(),
    url,
    listing: {
      id:        sourceId,
      title:     segs.slice(1).join(' | '),
      address,
      city,
      state,
      zip:       null,
      latitude:  null,
      longitude: null,
      brokerage: meta.displayName,
      listed_on: msg.date || null,
    },
    auction: {},
    sale: {
      asking_price_usd: price,
      cap_rate_pct:     null,
      noi_usd:          null,
      price_per_sqft:   null,
      tenant:           null,
    },
    property: {
      property_types: propType ? [propType] : null,
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
