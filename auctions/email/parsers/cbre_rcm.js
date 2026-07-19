/**
 * CBRE multifamily via RCM LightBox / DealFlow (cbre@rcm1.com) —
 * institutional midwest multifamily offerings.
 *
 * Deterministic — no network, no AI at runtime. Authored 2026-07-18 from real
 * samples. HTML-only blasts (the text part is just a "view online" stub).
 * These are UNPRICED institutional offerings; the machine-readable facts are
 * in the subject —
 *
 *   "New to Market: … Offered at 6.8% In-Place Cap Rate | 44 Units in Lafayette, IN"
 *   "JUST LISTED || Alpine Hills Apartments | 100% occupied community … | Cadillac, MI"
 *
 * — plus an Investment Highlights prose section where the property name
 * appears as "<Name> presents/is/offers …". Every link (rcm1.com /
 * cbredealflow.com) is per-recipient, so source_id is a hash of
 * "<units> units, <city>, <state>": tour-reminder re-blasts of the same
 * offering ("LIVE VIRTUAL TOUR …", "Now Touring …") collapse onto the
 * original listing instead of creating duplicates.
 */

import { createHash } from 'crypto';
import { saneCapRate } from '../../schema.js';
import { normalizeAddress } from '../registry.js';

export const meta = {
  slug:        'cbre_rcm',
  displayName: 'CBRE',
  addresses:   ['cbre@rcm1.com'],
  assetClass:  'commercial',
};

export function matches(msg) {
  return meta.addresses.includes(normalizeAddress(msg.from));
}

const sha12 = s => createHash('sha1')
  .update(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
  .digest('hex').slice(0, 12);

function htmlToText(html) {
  return html
    .replace(/<(?:style|script)[\s\S]*?<\/(?:style|script)>/gi, ' ')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>/gi, ' $1 ')
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

const SUBJECT_PREFIX_RE = /^(?:New to Market|TAKE A CLOSER LOOK|JUST LISTED|Now Touring|LIVE VIRTUAL TOUR[^|:]*|OFFERS DUE[^|:]*|LAST CALL[^|:]*|PRICE (?:REDUCED|GUIDANCE)[^|:]*)\s*[|:]+\s*/i;

const num = s => { const n = Number(String(s ?? '').replace(/[^0-9.]/g, '')); return n > 0 ? n : null; };

export function parse(msg) {
  const subject = msg.subject || '';
  if (/\b(?:JUST\s+)?(?:SOLD|CLOSED)\b/i.test(subject)) return [];
  if (!msg.html) return [];

  // Location: subjects end "… in Lafayette, IN" / "… | Cadillac, MI".
  // Every city word must be capitalized so "44 Units in Lafayette" → "Lafayette".
  const loc = subject.match(/((?:[A-Z][a-z.'-]+\s)*[A-Z][a-z.'-]+),\s*([A-Z]{2})\s*$/);
  if (!loc) return [];
  const city = loc[1].trim(), state = loc[2];

  // Unit count: "44 Units in", "70-unit community" — subject first, prose second.
  const text  = htmlToText(msg.html);
  const units = num(subject.match(/(\d{1,4})[\s-]?[Uu]nits?\b/)?.[1])
             ?? num(text.match(/(\d{1,4})[\s-]?unit\b/i)?.[1]);
  if (!units) return []; // units+city is the dedup key — without it, skip

  // Property name: a subject segment that looks like a community name, else
  // the prose "<Name> presents/is/offers …" opener.
  const name = subject.split(/\|+/).map(s => s.replace(SUBJECT_PREFIX_RE, '').trim())
      .find(s => /^[A-Z][\w'. ]{2,35}(?:Apartments|Townhomes|Flats|Lofts|Villas|Commons|Estates|Gardens|Heights|Landing|Manor|Park|Place|Pointe?|Ridge|Square|Station|Terrace|Towers?|Village)$/.test(s))
    ?? text.match(/\n(?:[A-Z​ ]{6,60}\n)?((?:The\s)?[A-Z][A-Za-z']+(?:\s[A-Z][A-Za-z']+){0,3})\s(?:presents|is a|offers)\b/)?.[1]
    ?? null;

  const sourceId = sha12(`${units} units, ${city}, ${state}`);

  const capRate = saneCapRate(subject.match(/([\d.]+)\s*%\s*(?:In-Place\s*)?Cap/i)?.[1])
               ?? saneCapRate(text.match(/([\d.]+)\s*%\s*cap rate/i)?.[1])
               ?? saneCapRate(text.match(/cap rate (?:is\s+)?(?:strong\s+)?(?:at|of)\s+([\d.]+)\s*%/i)?.[1]);

  // Some blasts print a street line right under the name: "328 Pearl Street, Cadillac, MI"
  const street = text.match(new RegExp(`^(\\d[\\w\\d .'-]{3,50}?),\\s*${city},\\s*${state}\\b`, 'm'))?.[1] ?? null;

  const description = text
    .match(/(?:Investment Highlights|The Offering)\s*\n([\s\S]{40,2500})/i)?.[1]
    ?.split(/\n(?:Primary|Debt & Structured Finance) Contacts/i)[0]
    ?.replace(/\s+/g, ' ').trim() ?? null;

  const url = msg.html.match(/href="(https:\/\/(?:www\.)?(?:cbredealflow\.com|my\.rcm1\.com)\/handler\/[^"]+)"/i)?.[1]
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
      title:     name && !subject.includes(name)
                   ? `${name} | ${subject.replace(SUBJECT_PREFIX_RE, '').trim()}`
                   : subject.replace(SUBJECT_PREFIX_RE, '').trim(),
      address:   street ? `${street}, ${city}, ${state}`
                        : `${name ?? units + ' Units'}, ${city}, ${state}`,
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
      asking_price_usd: null, // institutional offerings are unpriced
      cap_rate_pct:     capRate,
      noi_usd:          null,
      price_per_sqft:   null,
      tenant:           null,
    },
    property: {
      property_types: ['Multifamily'],
      units,
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
