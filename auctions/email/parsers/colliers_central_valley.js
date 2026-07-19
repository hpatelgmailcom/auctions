/**
 * Colliers — Central Valley Investment Team (Adam Lucatello / Jake King,
 * jake.king@colliers.com) — Stockton-area multifamily sales.
 *
 * Deterministic — no network, no AI at runtime. Authored 2026-07-18 from real
 * samples. These blasts are IMAGE-ONLY: the html carries no alt text and the
 * text part is just click-tracking links, so everything parseable lives in
 *
 *   - the subject: "NEW LISTING | Renovated Townhomes | 8.44% Cap | 12 Units
 *     in North Stockton", "22 Units | 7.24% Cap | $96k Per Unit | Stockton, CA"
 *   - the mailto reply link: "?subject=Send More Info on the Swain Townhomes"
 *     → the property name (the only per-property identifier in the email)
 *
 * Location comes from a subject "City, CA" tail or "in <City>"; the team only
 * sells Central Valley (California) product, so a bare city defaults to CA.
 * Subjects with no city at all yield [] — the operator follows up from the
 * message itself. Quarterly "Q2 Multifamily Reports" newsletters are skipped.
 */

import { createHash } from 'crypto';
import { saneCapRate } from '../../schema.js';
import { normalizeAddress } from '../registry.js';

export const meta = {
  slug:        'colliers_central_valley',
  displayName: 'Colliers Central Valley',
  addresses:   ['jake.king@colliers.com'],
  assetClass:  'commercial',
};

export function matches(msg) {
  const addr = normalizeAddress(msg.from);
  if (!addr?.endsWith('@colliers.com')) return false;
  return addr === 'jake.king@colliers.com' || /lucatello/i.test(msg.from || '');
}

const sha12 = s => createHash('sha1')
  .update(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
  .digest('hex').slice(0, 12);

const SUBJECT_PREFIX_RE = /^(?:NEW LISTING|JUST LISTED|PRICE (?:REDUCED|IMPROVEMENT)|BACK ON MARKET|COMING SOON)\s*[|:–-]+\s*/i;

const num = s => { const n = Number(String(s ?? '').replace(/[^0-9.]/g, '')); return n > 0 ? n : null; };

/** Subject "…City, CA" tail, else "… in <City>" (team is CA-only). */
function locationFrom(subject) {
  const tail = subject.match(/([A-Z][A-Za-z .'-]{2,25}?),\s*(CA)\s*$/);
  if (tail) return { city: tail[1].trim(), state: 'CA' };
  const inCity = subject.match(/\bin\s+((?:[A-Z][a-z.'-]+\s?){1,3})\s*$/);
  if (inCity) return { city: inCity[1].trim(), state: 'CA' };
  return null;
}

export function parse(msg) {
  const subject = msg.subject || '';
  // Newsletters and sold/closed announcements are not inventory.
  if (/report|market tracker|newsletter/i.test(subject)) return [];
  if (/\b(?:JUST\s+)?(?:SOLD|CLOSED)\b/i.test(subject)) return [];

  // Real listing blasts always advertise a cap rate or a unit count.
  const capRate = saneCapRate(subject.match(/([\d.]+)\s*%\s*Cap/i)?.[1]);
  const units   = num(subject.match(/(\d{1,4})[\s-]?Units?\b/i)?.[1]);
  if (capRate == null && units == null) return [];

  const loc = locationFrom(subject);
  if (!loc) return []; // image-only email with no city in the subject

  // "mailto:…?subject=Send More Info on (the) Swain Townhomes" → property name
  const mailto = (msg.text || '') + ' ' + (msg.html || '');
  const nameRaw = mailto.match(/mailto:[^?\s"]+\?subject=([^"&\s]+)/i)?.[1] ?? null;
  const name = nameRaw
    ? decodeURIComponent(nameRaw.replace(/\+/g, ' '))
        .replace(/^Send (?:me )?[Mm]ore [Ii]nfo(?:rmation)? (?:on|about) (?:the )?/i, '').trim()
    : null;

  const title = subject.replace(SUBJECT_PREFIX_RE, '').trim();
  const nameForAddress = name || title.split('|')[0].trim();
  const address  = `${nameForAddress}, ${loc.city}, ${loc.state}`;
  const sourceId = sha12(address);

  return [{
    source:       meta.slug,
    source_id:    sourceId,
    asset_class:  meta.assetClass,
    listing_type: 'sale',
    scraped_at:   new Date().toISOString(),
    url:          `https://mail.google.com/mail/u/0/#all/${msg.id}`, // image-only blast, no listing page
    listing: {
      id:        sourceId,
      title:     name ? `${name} | ${title}` : title,
      address,
      city:      loc.city,
      state:     loc.state,
      zip:       null,
      latitude:  null,
      longitude: null,
      brokerage: meta.displayName,
      listed_on: msg.date || null,
    },
    auction: {},
    sale: {
      asking_price_usd: null, // never stated; only $/unit appears in subjects
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
    description: null,
    media: {},
  }];
}
