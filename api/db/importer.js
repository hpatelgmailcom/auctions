/**
 * Reads all listing JSON files from auctions/listings/ and upserts into SQLite.
 * Safe to re-run — uses INSERT OR REPLACE on the listing id.
 *
 * Usage: node api/db/importer.js
 */

import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './database.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const LISTINGS_DIR = join(__dirname, '../../auctions/listings');

function parseJson(str) {
  try { return str ? JSON.parse(str) : null; } catch { return null; }
}

function inferStage(listing) {
  if (listing.due_diligence)    return 'Due Diligence';
  if (listing.market_research)  return 'Enriched';
  return 'Scouted';
}

function toRow(raw) {
  const l  = raw.listing   || {};
  const a  = raw.auction   || {};
  const p  = raw.property  || {};
  const mr = raw.market_research || {};
  const dd = raw.due_diligence   || null;
  const cr = raw.compliance_review || null;

  const demo   = mr.demographics  || {};
  const crime  = mr.crime         || {};
  const retail = mr.retail_market || {};

  return {
    id:                    l.id,
    title:                 l.title,
    address:               l.address,
    city:                  l.city,
    state:                 l.state,
    zip:                   l.zip,
    latitude:              l.latitude,
    longitude:             l.longitude,
    brokerage:             l.brokerage,
    listed_on:             l.listed_on,
    url:                   raw.url,
    scraped_at:            raw.scraped_at,

    auction_status:            a.status,
    auction_type:              a.auction_type,
    starting_bid_usd:          a.starting_bid_usd,
    bidding_starts:            a.bidding_starts,
    bidding_ends:              a.bidding_ends,
    reserve_met:               a.reserve_met ? 1 : 0,
    bid_increment_usd:         a.bid_increment_usd,
    participation_deposit:     a.participation_deposit,
    earnest_money_deposit:     a.earnest_money_deposit,
    marketing_fee_pct:         a.marketing_fee_pct,
    minimum_marketing_fee_usd: a.minimum_marketing_fee_usd,
    closing_period_days:       a.closing_period_days,
    non_contingent:            a.non_contingent ? 1 : 0,

    property_types: JSON.stringify(p.property_types),
    sub_types:      JSON.stringify(p.sub_types),
    square_footage: p.square_footage,
    tenancy:        p.tenancy,
    year_built:     p.year_built,
    acreage:        p.acreage,
    zoning:         p.zoning,
    opportunity_zone: p.opportunity_zone ? 1 : 0,

    pipeline_stage: inferStage(raw),

    enrichment_demographics: JSON.stringify(demo),
    enrichment_crime:        JSON.stringify(crime),
    enrichment_retail:       JSON.stringify(retail),
    due_diligence:           JSON.stringify(dd),
    compliance_review:       JSON.stringify(cr),

    crime_grade:       crime.overall_grade || null,
    disposition_score: dd?.disposition_score || null,
    recommendation:    dd?.recommendation   || null,
    max_bid_usd:       dd?.max_bid_usd      || null,
    avg_retail_rent:   retail.retail_asking_rent?.avg_per_sf_yr || null,
    compliance_status: cr?.overall_status || null,
    enriched_at:       mr.enriched_at || null,
  };
}

export function importListings() {
  const db = getDb();

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO listings (
      id, title, address, city, state, zip, latitude, longitude, brokerage, listed_on, url, scraped_at,
      auction_status, auction_type, starting_bid_usd, bidding_starts, bidding_ends,
      reserve_met, bid_increment_usd, participation_deposit, earnest_money_deposit,
      marketing_fee_pct, minimum_marketing_fee_usd, closing_period_days, non_contingent,
      property_types, sub_types, square_footage, tenancy, year_built, acreage, zoning, opportunity_zone,
      pipeline_stage,
      enrichment_demographics, enrichment_crime, enrichment_retail, due_diligence, compliance_review,
      crime_grade, disposition_score, recommendation, max_bid_usd, avg_retail_rent,
      compliance_status, enriched_at
    ) VALUES (
      @id, @title, @address, @city, @state, @zip, @latitude, @longitude, @brokerage, @listed_on, @url, @scraped_at,
      @auction_status, @auction_type, @starting_bid_usd, @bidding_starts, @bidding_ends,
      @reserve_met, @bid_increment_usd, @participation_deposit, @earnest_money_deposit,
      @marketing_fee_pct, @minimum_marketing_fee_usd, @closing_period_days, @non_contingent,
      @property_types, @sub_types, @square_footage, @tenancy, @year_built, @acreage, @zoning, @opportunity_zone,
      @pipeline_stage,
      @enrichment_demographics, @enrichment_crime, @enrichment_retail, @due_diligence, @compliance_review,
      @crime_grade, @disposition_score, @recommendation, @max_bid_usd, @avg_retail_rent,
      @compliance_status, @enriched_at
    )
  `);

  const insertMany = db.transaction(rows => { for (const r of rows) upsert.run(r); });

  let files;
  try { files = readdirSync(LISTINGS_DIR).filter(f => f.endsWith('.json')); }
  catch { console.log('No listings directory found — skipping import.'); return 0; }

  const rows = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(join(LISTINGS_DIR, file), 'utf8'));
      if (!raw.listing?.id) { console.warn(`Skipping ${file} — no listing.id`); continue; }
      rows.push(toRow(raw));
    } catch (e) { console.warn(`Skipping ${file}: ${e.message}`); }
  }

  insertMany(rows);
  console.log(`Imported ${rows.length} listings.`);
  return rows.length;
}

// Generate seed alerts for upcoming auctions
export function seedAlerts() {
  const db = getDb();
  db.prepare('DELETE FROM alerts').run();

  const listings = db.prepare(`
    SELECT id, title, address, bidding_starts, starting_bid_usd, recommendation
    FROM listings WHERE bidding_starts IS NOT NULL
  `).all();

  const insert = db.prepare(`
    INSERT INTO alerts (listing_id, type, message, severity) VALUES (?, ?, ?, ?)
  `);

  const insertMany = db.transaction(items => { for (const i of items) insert.run(...i); });
  const alertRows = [];
  const now = Date.now();

  for (const l of listings) {
    const deadline = new Date(l.bidding_starts).getTime();
    const daysLeft = (deadline - now) / 86400000;

    if (daysLeft > 0 && daysLeft <= 1)
      alertRows.push([l.id, 'deadline', `Auction starts in <24 hours: ${l.address}`, 'critical']);
    else if (daysLeft > 0 && daysLeft <= 3)
      alertRows.push([l.id, 'deadline', `Auction starts in ${Math.ceil(daysLeft)} days: ${l.address}`, 'warning']);
    else if (daysLeft > 0 && daysLeft <= 7)
      alertRows.push([l.id, 'deadline', `Auction starts in ${Math.ceil(daysLeft)} days: ${l.address}`, 'info']);

    if (!l.recommendation)
      alertRows.push([l.id, 'pending_review', `No due diligence run for: ${l.address}`, 'info']);
  }

  insertMany(alertRows);
  console.log(`Seeded ${alertRows.length} alerts.`);
}

// Run as script
if (process.argv[1].endsWith('importer.js')) {
  importListings();
  seedAlerts();
}
