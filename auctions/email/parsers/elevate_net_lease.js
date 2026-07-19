/**
 * Elevate Net Lease (info@elevatenla.ccsend.com) — single-tenant NNN retail
 * (Dollar General / Family Dollar / Dollar Tree) sales.
 *
 * Deterministic — no network, no AI at runtime. Authored 2026-07-18 from real
 * samples. Constant Contact blasts, one property per email, with a full street
 * address + zip in the body. Two template variants share label styles:
 *
 *   A. "Family Dollar Website 715 Mccambridge Ave Madison, IL 62060 …
 *       Summary Sale Price: $1,552,940 NOI: $132,000 Cap Rate: 8.5% …
 *       Building Size 9,180 SF Lot Size 1.86 Acres Highlights …"
 *      (labels drift: "Sale Price $954,545", "cap 8.25%" — regexes are loose)
 *   B. Bang Realty co-blast: "Dollar General 3973 V18 Rd., Brooklyn, IA 52215
 *       Investment Summary Price: $1,164,426 Cap Rate: 7.5% … MARKETING PACKAGE"
 *
 * "JUST CLOSED" congratulation blasts are skipped. No listing page exists —
 * source_id is a hash of the street address; url is the MARKETING PACKAGE
 * tracking link when present, else a Gmail deep link.
 */

import { createHash } from 'crypto';
import { saneMoney, saneCapRate } from '../../schema.js';
import { normalizeAddress } from '../registry.js';

export const meta = {
  slug:        'elevate_net_lease',
  displayName: 'Elevate Net Lease',
  addresses:   ['info@elevatenla.ccsend.com'],
  assetClass:  'commercial',
};

export function matches(msg) {
  return meta.addresses.includes(normalizeAddress(msg.from));
}

const sha12 = s => createHash('sha1')
  .update(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
  .digest('hex').slice(0, 12);

const num = s => { const n = Number(String(s ?? '').replace(/[^0-9.]/g, '')); return n > 0 ? n : null; };

// "715 Mccambridge Ave Madison, IL 62060" — street and city run together, so
// the street must end in a suffix; city is everything between suffix and ", ST ZIP".
const ADDRESS_RE = /(\d+[\w\d .'-]*?\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Circle|Cir|Court|Ct|Parkway|Pkwy|Place|Pl|Highway|Hwy|Trail|Trl)\.?,?)\s+([A-Z][A-Za-z .'-]+?),\s*([A-Z]{2})\s+(\d{5})\b/;

export function parse(msg) {
  const subject = msg.subject || '';
  if (/\bJUST\s+(?:CLOSED|SOLD)\b/i.test(subject)) return [];

  const body = (msg.text || '').split(/For more information|Please Contact|Unsubscribe/i)[0];
  if (!body) return [];

  const addr = body.match(ADDRESS_RE);
  if (!addr) return []; // no street address → not a listing blast

  const street = addr[1].replace(/,$/, '').trim();
  const city   = addr[2].trim();
  const state  = addr[3];
  const zip    = addr[4];

  const address  = `${street}, ${city}, ${state} ${zip}`;
  const sourceId = sha12(`${street}, ${city}, ${state}`);

  const price   = saneMoney(body.match(/(?:Sale\s+)?Price:?\s*\$([\d,]+)/i)?.[1]);
  const capRate = saneCapRate(body.match(/cap(?:\s*rate)?:?\s*([\d.]+)\s*%/i)?.[1]);
  const noi     = saneMoney(body.match(/\bNOI:?\s*\$([\d,]+)/i)?.[1], { min: 1000 });

  // "Family Dollar Website" (variant A) else first segment of the subject.
  const tenant = body.match(/\b([A-Z][A-Za-z' ]{2,30}?)\s+Website\b/)?.[1]?.trim()
              ?? subject.replace(/^(?:NNN|Abs(?:olute)? NNN|STNL)\s+/i, '').split(/[|–-]/)[0].trim();

  const description = body
    .match(/Highlights\s+([\s\S]{40,2500}?)(?:\s+Demographics\b|\s+MARKETING PACKAGE|\s+Additional Photos|\s*$)/i)?.[1]
    ?.replace(/\s+/g, ' ').trim() ?? null;

  const url = msg.html?.match(/<a[^>]+href="([^"]+)"[^>]*>(?:(?!<\/a>)[\s\S]){0,300}?MARKETING\s+PACKAGE/i)?.[1]
           ?? `https://mail.google.com/mail/u/0/#all/${msg.id}`;

  return [{
    source:       meta.slug,
    source_id:    sourceId,
    asset_class:  meta.assetClass,
    listing_type: 'sale',
    scraped_at:   new Date().toISOString(),
    url,
    listing: {
      id:        sourceId,
      title:     subject.trim() || `${tenant} | ${city}, ${state}`,
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
      asking_price_usd: price,
      cap_rate_pct:     capRate,
      noi_usd:          noi,
      price_per_sqft:   null,
      tenant,
    },
    property: {
      property_types: ['Retail'],
      square_footage: num(body.match(/Building Size:?\s*([\d,]+)\s*SF/i)?.[1]),
      acreage:        num(body.match(/Lot Size:?\s*([\d.]+)\s*Acres/i)?.[1]),
      year_built:     num(body.match(/Year Built:?\s*(\d{4})/i)?.[1]),
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
