import { getDb } from '../db/database.js';

export default async function analyticsRoutes(fastify) {

  // GET /api/analytics/funnel
  fastify.get('/analytics/funnel', async () => {
    const db = getDb();
    const stages = ['Scouted','Enriching','Enriched','Under Review','BID','NO BID','CONDITIONAL','Auction Day','Closed'];
    const counts = db.prepare(`
      SELECT pipeline_stage as stage, COUNT(*) as count FROM listings GROUP BY pipeline_stage
    `).all();
    const map = Object.fromEntries(counts.map(r => [r.stage, r.count]));
    return stages.map(s => ({ stage: s, count: map[s] || 0 }));
  });

  // GET /api/analytics/market-snapshot
  fastify.get('/analytics/market-snapshot', async () => {
    const db = getDb();

    const totals = db.prepare(`
      SELECT
        COUNT(*)                                          AS total,
        AVG(starting_bid_usd)                            AS avg_bid,
        MIN(starting_bid_usd)                            AS min_bid,
        MAX(starting_bid_usd)                            AS max_bid,
        SUM(CASE WHEN recommendation = 'BID' THEN 1 ELSE 0 END) AS bids,
        SUM(CASE WHEN recommendation = 'NO BID' THEN 1 ELSE 0 END) AS no_bids,
        SUM(CASE WHEN enriched_at IS NOT NULL THEN 1 ELSE 0 END)    AS enriched,
        AVG(disposition_score)                           AS avg_disposition,
        AVG(avg_retail_rent)                             AS avg_retail_rent
      FROM listings
    `).get();

    const byState = db.prepare(`
      SELECT state,
             COUNT(*) as count,
             AVG(starting_bid_usd) as avg_bid,
             AVG(disposition_score) as avg_disposition
      FROM listings
      WHERE state IS NOT NULL
      GROUP BY state ORDER BY count DESC LIMIT 10
    `).all();

    const byType = db.prepare(`
      SELECT property_types as type, COUNT(*) as count
      FROM listings WHERE property_types IS NOT NULL
      GROUP BY property_types ORDER BY count DESC LIMIT 8
    `).all();

    const crimeDistribution = db.prepare(`
      SELECT crime_grade, COUNT(*) as count
      FROM listings WHERE crime_grade IS NOT NULL
      GROUP BY crime_grade ORDER BY crime_grade
    `).all();

    return { totals, byState, byType, crimeDistribution };
  });

  // GET /api/analytics/pipeline-velocity
  fastify.get('/analytics/pipeline-velocity', async () => {
    const db = getDb();
    const events = db.prepare(`
      SELECT listing_id, stage, created_at FROM pipeline_events ORDER BY listing_id, created_at
    `).all();

    // Group by listing
    const byListing = {};
    for (const e of events) {
      if (!byListing[e.listing_id]) byListing[e.listing_id] = [];
      byListing[e.listing_id].push(e);
    }

    const transitions = {};
    for (const evts of Object.values(byListing)) {
      for (let i = 1; i < evts.length; i++) {
        const key   = `${evts[i-1].stage} → ${evts[i].stage}`;
        const hours = (new Date(evts[i].created_at) - new Date(evts[i-1].created_at)) / 3600000;
        if (!transitions[key]) transitions[key] = [];
        transitions[key].push(hours);
      }
    }

    return Object.entries(transitions).map(([transition, hours]) => ({
      transition,
      avg_hours: Math.round(hours.reduce((s,v) => s+v, 0) / hours.length),
      count: hours.length,
    }));
  });
}
