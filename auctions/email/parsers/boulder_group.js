/**
 * The Boulder Group (listings@bouldergroup.com) — net-lease retail sales.
 *
 * Deterministic — no network, no AI at runtime. Authored 2026-07-18 from real
 * samples. Two blast formats, one property per email:
 *
 * 1. Direct (Constant Contact): text body carries an anchored run
 *      "Freeman Health NWA Medical Plaza … PRICE: $13,520,000 CAP RATE: 6.75%
 *       SPRINGDALE, AR Download Offering Investment Highlights …"
 *    Labels and the city are ALL-CAPS — the case distinguishes real listings
 *    from "Buyer Seeking …" requirement emails ("Price: $2.2mm - $3.5mm").
 *
 * 2. Crexi campaign (emails@campaigns.crexi.com, display name "The Boulder
 *    Group…"): html-only, a label/value Details table (Asking Price, Cap Rate,
 *    NOI, Square Footage, Brand/Tenant, …) with "City, ST" on its own line
 *    near the top. That address also blasts for other brokerages, so matches()
 *    requires the Boulder display name.
 *
 * Emails carry no street address and no stable listing id — source_id is a
 * hash of "<name>, <city>, <state>" (stable across re-blasts); url is the
 * offering tracking link (functional when clicked).
 */

import { createHash } from 'crypto';
import { saneMoney, saneCapRate } from '../../schema.js';
import { normalizeAddress } from '../registry.js';

export const meta = {
  slug:        'boulder_group',
  displayName: 'The Boulder Group',
  addresses:   ['listings@bouldergroup.com', 'emails@campaigns.crexi.com'],
  assetClass:  'commercial',
};

export function matches(msg) {
  const addr = normalizeAddress(msg.from);
  if (addr === 'listings@bouldergroup.com') return true;
  return addr === 'emails@campaigns.crexi.com' && /boulder\s+group/i.test(msg.from || '');
}

const sha12 = s => createHash('sha1')
  .update(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
  .digest('hex').slice(0, 12);

const titleCase = s => s.toLowerCase().replace(/(^|[\s.'-])[a-z]/g, c => c.toUpperCase());

// Campaign html buries content under <style> blocks — strip those before the
// usual tag-to-line conversion; anchor hrefs are inlined so links survive.
function htmlToText(html) {
  return html
    .replace(/<(?:style|script)[\s\S]*?<\/(?:style|script)>/gi, ' ')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>/gi, ' $1 ')
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

const SUBJECT_PREFIX_RE = /^(?:PRICE REDUCED|JUST OPENED|NEW (?:LISTING|TO MARKET)|JUST LISTED|BACK ON MARKET|COMING SOON)\s*[|:–-]+\s*/i;

/** "Details"-table value: label on one line, value on the next. */
const detail = (text, label) =>
  text.match(new RegExp(`^${label}\\s*\\n\\s*(.+)$`, 'im'))?.[1]?.trim() ?? null;

const num = s => { const n = Number(String(s ?? '').replace(/[^0-9.]/g, '')); return n > 0 ? n : null; };

function buildRecord(msg, { name, city, state, url, sale, property, description }) {
  const address  = `${name}, ${city}, ${state}`;
  const sourceId = sha12(address);
  return {
    source:       meta.slug,
    source_id:    sourceId,
    asset_class:  meta.assetClass,
    listing_type: 'sale',
    scraped_at:   new Date().toISOString(),
    url:          url ?? `https://mail.google.com/mail/u/0/#all/${msg.id}`,
    listing: {
      id:        sourceId,
      title:     (msg.subject || '').replace(SUBJECT_PREFIX_RE, '')
                   .replace(/\s*\|\s*For Sale\s*\|\s*[A-Za-z /]+$/i, '').trim(),
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
    sale,
    property,
    email: {
      message_id:  msg.id,
      received_at: msg.date || null,
      from:        normalizeAddress(msg.from),
    },
    description,
    media: {},
  };
}

export function parse(msg) {
  const subject = msg.subject || '';
  // Buyer-requirement and sold blasts are not inventory.
  if (/buyer seeking|buyer requirement|1031 exchange requirement/i.test(subject)) return [];
  if (/^\s*(?:JUST\s+)?(?:SOLD|CLOSED)\b/i.test(subject)) return [];

  const cleanSubject = subject.replace(SUBJECT_PREFIX_RE, '').trim();
  const name         = cleanSubject.split('|')[0].trim();

  // --- Format 1: direct Constant Contact blast (text body) ------------------
  // Case-sensitive on purpose: ALL-CAPS labels + ALL-CAPS city only appear in
  // real listing blasts.
  const direct = (msg.text || '').match(
    /PRICE:\s*\$([\d,]+)\s+CAP RATE:\s*([\d.]+)%\s+([A-Z][A-Z .'-]+?),\s*([A-Z]{2})\b/);
  if (direct) {
    const body = msg.text.split(/Contact Us/i)[0];
    const description = body.match(/Investment Highlights\s+([\s\S]{40,2500}?)\s*$/i)?.[1]
      ?.replace(/\s+/g, ' ').trim() ?? null;
    const url = msg.html?.match(/<a[^>]+href="([^"]+)"[^>]*>(?:(?!<\/a>)[\s\S]){0,300}?Download\s+Offering/i)?.[1] ?? null;
    return [buildRecord(msg, {
      name,
      city:  titleCase(direct[3].trim()),
      state: direct[4],
      url,
      sale: {
        asking_price_usd: saneMoney(direct[1]),
        cap_rate_pct:     saneCapRate(direct[2]),
        noi_usd:          null,
        price_per_sqft:   null,
        tenant:           name,
      },
      property: { property_types: ['Retail'] },
      description,
    })];
  }

  // --- Format 2: Crexi campaign (html-only Details table) -------------------
  if (!msg.html) return [];
  const text = htmlToText(msg.html);
  if (!/^Details$/m.test(text)) return []; // promos/market updates have no Details table

  // Property location: first standalone "City, ST" line (appears right under
  // the tenant name, well before the broker-footer addresses).
  const locLine = text.match(/^([A-Z][A-Za-z .'-]{1,30}),\s*([A-Z]{2})$/m);
  if (!locLine) return [];

  const tenant = detail(text, 'Brand/Tenant');
  const url    = text.match(/^(https:\/\/email\.campaigns\.crexi\.com\/\S+)\s*\n\s*Offering Memorandum/m)?.[1]
              ?? text.match(/https:\/\/email\.campaigns\.crexi\.com\/\S+/)?.[0] ?? null;

  const rawCity = locLine[1].trim();
  return [buildRecord(msg, {
    name,
    city:  rawCity === rawCity.toUpperCase() ? titleCase(rawCity) : rawCity,
    state: locLine[2],
    url,
    sale: {
      asking_price_usd: saneMoney(detail(text, 'Asking Price')),
      cap_rate_pct:     saneCapRate(detail(text, 'Cap Rate')),
      noi_usd:          saneMoney(detail(text, 'NOI'), { min: 1000 }),
      price_per_sqft:   num(detail(text, 'Price per SqFt')),
      tenant:           tenant ?? name,
    },
    property: {
      property_types: [detail(text, 'Property Type') ?? 'Retail'].filter(Boolean),
      square_footage: num(detail(text, 'Square Footage')),
      acreage:        num(detail(text, 'Lot Size \\(acres\\)')),
      year_built:     num(detail(text, 'Year Built')),
      occupancy_pct:  num(detail(text, 'Occupancy')),
    },
    description: null,
  })];
}
