import { getDb } from '../db/database.js';

export default async function listingsRoutes(fastify) {

  // GET /api/listings — paginated, filterable
  fastify.get('/listings', async (req) => {
    const db = getDb();
    const {
      page = 1, limit = 50,
      state, recommendation, min_price, max_price,
      max_days_to_auction, crime_grade, opportunity_zone,
      auction_type, property_type, asset_class, source, listing_type,
      archived,
      sort = 'bidding_starts', dir = 'asc',
    } = req.query;

    const allowed = ['bidding_starts','starting_bid_usd','max_bid_usd','disposition_score','city','state'];
    const sortCol = allowed.includes(sort) ? sort : 'bidding_starts';
    const sortDir = dir === 'desc' ? 'DESC' : 'ASC';

    const conditions = [];
    const params     = {};

    // Archived listings are hidden everywhere except the explicit archived view.
    conditions.push(archived === '1' || archived === 'true'
      ? 'al.listing_id IS NOT NULL'
      : 'al.listing_id IS NULL');

    if (state)            { conditions.push('state = @state');                          params.state = state; }
    if (asset_class)      { conditions.push('asset_class = @ac');                         params.ac = asset_class; }
    if (source)           { conditions.push('source = @src');                            params.src = source; }
    if (listing_type)     { conditions.push("COALESCE(listing_type,'auction') = @lt");   params.lt = listing_type; }
    if (recommendation)   { conditions.push('recommendation = @rec');                    params.rec = recommendation; }
    if (min_price)        { conditions.push('starting_bid_usd >= @min');                 params.min = Number(min_price); }
    if (max_price)        { conditions.push('starting_bid_usd <= @max');                 params.max = Number(max_price); }
    if (crime_grade)      { conditions.push('crime_grade = @cg');                        params.cg = crime_grade; }
    if (opportunity_zone) { conditions.push('opportunity_zone = 1'); }
    if (auction_type)     { conditions.push('auction_type LIKE @at');                     params.at = `${auction_type}%`; }
    if (property_type)    { conditions.push("property_types LIKE @pt");                  params.pt = `%${property_type}%`; }
    if (max_days_to_auction) {
      const cutoff = new Date(Date.now() + Number(max_days_to_auction) * 86400000).toISOString();
      conditions.push("bidding_starts <= @cutoff AND bidding_starts >= datetime('now')");
      params.cutoff = cutoff;
    }

    const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const join   = 'LEFT JOIN archived_listings al ON al.listing_id = listings.id';
    const offset = (Number(page) - 1) * Number(limit);

    const rows = db.prepare(`
      SELECT listings.id, source, source_id, asset_class, listing_type, title, address, city, state, zip, url,
             starting_bid_usd, max_bid_usd, bidding_starts, bidding_ends,
             asking_price_usd, cap_rate_pct, noi_usd, brokerage,
             auction_type, reserve_met, auction_status,
             square_footage, property_types, opportunity_zone, zoning,
             beds, baths, living_area_sqft, home_type, occupancy_status,
             crime_grade, disposition_score, recommendation,
             avg_retail_rent, compliance_status, pipeline_stage,
             enriched_at, scraped_at, al.archived_at
      FROM listings ${join} ${where}
      ORDER BY ${sortCol} ${sortDir} NULLS LAST
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit: Number(limit), offset });

    const total = db.prepare(`SELECT COUNT(*) as n FROM listings ${join} ${where}`).get(params).n;

    return { data: rows.map(r => ({ ...r, property_types: safeJson(r.property_types) })), total, page: Number(page), limit: Number(limit) };
  });

  // GET /api/listings/:id — full detail
  fastify.get('/listings/:id', async (req, reply) => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
    if (!row) return reply.status(404).send({ error: 'Not found' });
    const arch = db.prepare('SELECT archived_at FROM archived_listings WHERE listing_id = ?').get(row.id);

    return {
      ...row,
      archived_at: arch?.archived_at ?? null,
      property_types:          safeJson(row.property_types),
      sub_types:               safeJson(row.sub_types),
      enrichment_demographics: safeJson(row.enrichment_demographics),
      enrichment_crime:        safeJson(row.enrichment_crime),
      enrichment_retail:       safeJson(row.enrichment_retail),
      enrichment_sold_comps:   safeJson(row.enrichment_sold_comps),
      enrichment_walk_score:   safeJson(row.enrichment_walk_score),
      enrichment_schools:      safeJson(row.enrichment_schools),
      enrichment_flood_risk:   safeJson(row.enrichment_flood_risk),
      due_diligence:           safeJson(row.due_diligence),
      compliance_review:       safeJson(row.compliance_review),
    };
  });

  // PATCH /api/listings/:id/stage — update pipeline stage
  fastify.patch('/listings/:id/stage', async (req, reply) => {
    const db = getDb();
    const { stage } = req.body;
    const valid = ['Scouted','Enriching','Enriched','Due Diligence','Under Review','BID','NO BID','CONDITIONAL','Auction Day','Closed'];
    if (!valid.includes(stage)) return reply.status(400).send({ error: 'Invalid stage' });
    db.prepare("UPDATE listings SET pipeline_stage = ?, updated_at = datetime('now') WHERE id = ?").run(stage, req.params.id);
    db.prepare("INSERT INTO pipeline_events (listing_id, stage) VALUES (?, ?)").run(req.params.id, stage);
    return { ok: true };
  });

  // POST /api/listings/:id/archive — hide a listing from all default views
  fastify.post('/listings/:id/archive', async (req, reply) => {
    const db  = getDb();
    const row = db.prepare('SELECT id FROM listings WHERE id = ?').get(req.params.id);
    if (!row) return reply.status(404).send({ error: 'Not found' });
    db.prepare('INSERT OR IGNORE INTO archived_listings (listing_id) VALUES (?)').run(row.id);
    db.prepare("INSERT INTO pipeline_events (listing_id, stage, note) VALUES (?, 'Archived', 'Archived by operator')").run(row.id);
    return { ok: true };
  });

  // DELETE /api/listings/:id/archive — restore a listing
  fastify.delete('/listings/:id/archive', async (req, reply) => {
    const db = getDb();
    const changed = db.prepare('DELETE FROM archived_listings WHERE listing_id = ?').run(req.params.id).changes;
    if (!changed) return reply.status(404).send({ error: 'Not archived' });
    db.prepare("INSERT INTO pipeline_events (listing_id, stage, note) VALUES (?, 'Unarchived', 'Restored by operator')").run(req.params.id);
    return { ok: true };
  });

  // POST /api/listings/:id/enrich — trigger enrichment (async, returns immediately)
  fastify.post('/listings/:id/enrich', async (req, reply) => {
    const db  = getDb();
    const row = db.prepare('SELECT id, city, state FROM listings WHERE id = ?').get(req.params.id);
    if (!row) return reply.status(404).send({ error: 'Not found' });
    db.prepare("UPDATE listings SET pipeline_stage = 'Enriching', updated_at = datetime('now') WHERE id = ?").run(row.id);
    // Fire-and-forget
    runEnrichment(row).catch(e => console.error('Enrich failed:', e.message));
    return { ok: true, message: 'Enrichment started' };
  });

  // GET /api/listings/:id/events — audit trail
  fastify.get('/listings/:id/events', async (req) => {
    const db = getDb();
    return db.prepare('SELECT * FROM pipeline_events WHERE listing_id = ? ORDER BY created_at DESC').all(req.params.id);
  });
}

function safeJson(str) {
  try { return str ? JSON.parse(str) : null; } catch { return null; }
}

async function runEnrichment(listing) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const { readdirSync } = await import('fs');

  const exec = promisify(execFile);
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../');
  const listingsDir = join(root, 'auctions/listings');

  // Find the file for this listing. listing.id is the composite "source:source_id";
  // match on the file's own source + listing.id so two providers never collide.
  const { readFileSync } = await import('fs');
  const files = readdirSync(listingsDir);
  const file  = files.find(f => {
    try {
      const d = JSON.parse(readFileSync(join(listingsDir, f)));
      const key = `${d.source ?? 'crexi'}:${d.source_id ?? d.listing?.id}`;
      return key === listing.id;
    } catch { return false; }
  });
  if (!file) throw new Error('Listing file not found');

  await exec('node', [join(root, 'auctions/enrichment/enrich.js'), join(listingsDir, file)]);

  // Re-import to refresh DB
  const { importListings, seedAlerts } = await import('../db/importer.js');
  importListings();
  seedAlerts();
}
