/**
 * Kiser Group — Cody Smith & Robert Dulin (csmith@kisergroup.com) —
 * Minneapolis/Twin Cities multifamily sales.
 *
 * Deterministic — no network, no AI at runtime. Authored 2026-07-18 from real
 * samples (Mailchimp blasts, one property per email):
 *
 *   <description paragraph>
 *   Listing Agent / Cody Smith / Robert Dulin
 *   <subject repeated>                          "The Loon | Hopkins, MN | 12 Units"
 *   <name | street[, City, ST ZIP]>             "The Loon | 57 6th Avenue South"
 *   Sale Price      $1,350,000                  (or "Subject To Offer")
 *   Cap Rate 6.84% / Number of Units 12 / Building Size 33,988 SF / Year Built…
 *   View on Map (https://kisergroup.com/…?propertyId=1658007-sale&…)
 *
 * The propertyId in the kisergroup.com link is the stable native id — repeat
 * blasts of the same property (The Loon appears twice in one week) dedupe on
 * it for free. City falls back subject → info line → a bare "Minneapolis"
 * mention in the prose (some blasts never say "City, ST" at all).
 */

import { saneMoney, saneCapRate } from '../../schema.js';
import { normalizeAddress } from '../registry.js';

export const meta = {
  slug:        'kiser_group',
  displayName: 'Kiser Group',
  addresses:   ['csmith@kisergroup.com'],
  assetClass:  'commercial',
};

export function matches(msg) {
  return meta.addresses.includes(normalizeAddress(msg.from));
}

const num = s => { const n = Number(String(s ?? '').replace(/[^0-9.]/g, '')); return n > 0 ? n : null; };

const CITY_ST_RE = /([A-Z][A-Za-z .'-]{2,25}?),\s*([A-Z]{2})\b(?:\s*(\d{5}))?/;

export function parse(msg) {
  const subject = msg.subject || '';
  if (/\b(?:JUST\s+)?(?:SOLD|CLOSED)\b/i.test(subject)) return [];

  const text = msg.text || '';
  const propertyId = text.match(/kisergroup\.com\/[^\s)]*propertyId=(\d+)/i)?.[1];
  if (!propertyId) return []; // every listing blast links the property page

  const url = `https://kisergroup.com/properties/available-properties/?propertyId=${propertyId}-sale`;

  // The "name | street" info line sits right above the Sale Price label.
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const priceIdx = lines.findIndex(l => /^Sale Price/i.test(l));
  const infoLine = priceIdx > 0 ? lines[priceIdx - 1] : '';

  let name = null, street = null, city = null, state = null, zip = null;
  for (const seg of infoLine.split('|').map(s => s.trim()).filter(Boolean)) {
    const cs = seg.match(new RegExp(CITY_ST_RE.source + '\\s*$'));
    if (cs) {
      city = cs[1].trim(); state = cs[2]; zip = cs[3] ?? null;
      const before = seg.slice(0, cs.index).replace(/[,\s]+$/, '');
      if (/^\d/.test(before)) street = before;
      else if (before) name = before;
    } else if (/^\d/.test(seg)) street = seg;
    else if (seg !== subject.trim()) name = seg;
  }

  if (!city) {
    const subj = subject.match(CITY_ST_RE);
    if (subj) { city = subj[1].trim(); state = subj[2]; }
    else if (/\bMinneapolis\b/.test(text)) { city = 'Minneapolis'; state = 'MN'; }
  }
  if (!city) return []; // no location anywhere → operator follows up manually

  const address = street
    ? `${street}, ${city}, ${state}${zip ? ' ' + zip : ''}`
    : `${name || subject.split('|')[0].trim()}, ${city}, ${state}`;

  const description = lines
    .slice(0, lines.findIndex(l => /^Listing Agent/i.test(l)) + 1 || 1)
    .filter(l => !/^Listing Agent/i.test(l))
    .join(' ').replace(/\s+/g, ' ').trim() || null;

  return [{
    source:       meta.slug,
    source_id:    propertyId,
    asset_class:  meta.assetClass,
    listing_type: 'sale',
    scraped_at:   new Date().toISOString(),
    url,
    listing: {
      id:        propertyId,
      title:     subject.trim() || name,
      address,
      city,
      state,
      zip,
      latitude:  null,
      longitude: null,
      brokerage: meta.displayName,
      listed_on: msg.date || null,
    },
    auction: {},
    sale: {
      asking_price_usd: saneMoney(text.match(/Sale Price\s*\$([\d,]+)/i)?.[1]), // "Subject To Offer" → null
      cap_rate_pct:     saneCapRate(text.match(/Cap Rate\s*([\d.]+)\s*%/i)?.[1]),
      noi_usd:          null,
      price_per_sqft:   null,
      tenant:           null,
    },
    property: {
      property_types: ['Multifamily'],
      units:          num(text.match(/Number of Units\s*(\d+)/i)?.[1])
                   ?? num(subject.match(/(\d{1,4})\s*Units?\b/i)?.[1]),
      square_footage: num(text.match(/Building Size\s*([\d,]+)\s*SF/i)?.[1]),
      year_built:     num(text.match(/Year Built\s*(\d{4})/i)?.[1]),
      occupancy_pct:  num(text.match(/Occupancy\s*([\d.]+)\s*%/i)?.[1]),
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
