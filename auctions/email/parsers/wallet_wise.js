/**
 * The Walletwise Hospitality (info-thewalletwise.com@shared1.ccsend.com) —
 * limited-service hotel/motel sales.
 *
 * Deterministic — no network, no AI at runtime. Authored 2026-07-18 from real
 * samples (Constant Contact blasts, one hotel per email):
 *
 *   "Email from The Walletwise Hospitality LLC <teaser>
 *    America's Best Value Inn Klamath Falls, OR
 *    Price: $1,390,000 | 24 Rooms  Click Here To Access Data Room …"
 *
 * The name/city line runs the hotel name straight into the city, so the name
 * must end in a lodging word (Inn/Lodge/Motel/Hotel/Suites/Resort); the state
 * may be a full name ("Texas") or an abbreviation. Re-blasts (reminders,
 * price reductions) hash to the same source_id. Bodies carry U+FEFF
 * zero-width characters mid-word ("5﻿8 Rooms") — stripped before matching.
 */

import { createHash } from 'crypto';
import { saneMoney, stateToAbbr, STATE_ABBR } from '../../schema.js';
import { normalizeAddress } from '../registry.js';

export const meta = {
  slug:        'wallet_wise',
  displayName: 'The Walletwise Hospitality',
  addresses:   ['info-thewalletwise.com@shared1.ccsend.com'],
  assetClass:  'commercial',
};

export function matches(msg) {
  return meta.addresses.includes(normalizeAddress(msg.from));
}

const sha12 = s => createHash('sha1')
  .update(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
  .digest('hex').slice(0, 12);

const STATE_NAME_RE = Object.keys(STATE_ABBR)
  .map(s => s.replace(/(^|\s)\w/g, c => c.toUpperCase()))
  .join('|');

const num = s => { const n = Number(String(s ?? '').replace(/[^0-9.]/g, '')); return n > 0 ? n : null; };

export function parse(msg) {
  const subject = msg.subject || '';
  if (/\b(?:JUST\s+)?(?:SOLD|CLOSED)\b/i.test(subject) && !/currently closed/i.test(msg.text || '')) return [];

  const text = (msg.text || '').replace(/[﻿​‌‍]/g, '');
  if (!text) return [];

  const priced = text.match(/Price:\s*\$([\d,]+)\s*\|\s*([\d,]+)\s*Rooms/i);
  if (!priced) return []; // every listing blast carries "Price: $X | N Rooms"

  // "<Hotel Name> <City>, <State>" precedes the Price line (sometimes with a
  // teaser sentence in between); the name must end in a lodging word to split
  // it from the (multi-word) city.
  const head = text.slice(0, priced.index);
  const nameLoc = head.match(new RegExp(
    `([A-Z][\\w'’.&\\- ]{2,60}?(?:Inn(?: & Suites)?|Suites|Lodge|Motel|Hotel|Resort))\\s+([A-Z][A-Za-z .]{2,25}?),\\s*(${STATE_NAME_RE}|[A-Z]{2})\\b`));
  if (!nameLoc) return [];

  const name  = nameLoc[1].trim();
  const city  = nameLoc[2].trim();
  const state = stateToAbbr(nameLoc[3]).toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return [];

  const address  = `${name}, ${city}, ${state}`;
  const sourceId = sha12(address);

  const url = msg.html?.match(/<a[^>]+href="([^"]+)"[^>]*>(?:(?!<\/a>)[\s\S]){0,300}?Click Here To Access Data Room/i)?.[1]
           ?? `https://mail.google.com/mail/u/0/#all/${msg.id}`;

  const description = text
    .match(/Exceptional Investment Opportunity\s+([\s\S]{40,2500}?)(?:\s+View All Our Listings|\s*$)/i)?.[1]
    ?.replace(/\s+/g, ' ').trim() ?? null;

  return [{
    source:       meta.slug,
    source_id:    sourceId,
    asset_class:  meta.assetClass,
    listing_type: 'sale',
    scraped_at:   new Date().toISOString(),
    url,
    listing: {
      id:        sourceId,
      title:     `${name} | ${city}, ${state}`,
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
      asking_price_usd: saneMoney(priced[1]),
      cap_rate_pct:     null,
      noi_usd:          null,
      price_per_sqft:   null,
      tenant:           null,
    },
    property: {
      property_types: ['Hospitality'],
      rooms:          num(priced[2]),
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
