import { getDb } from '../db/database.js';
import { importListings, seedAlerts } from '../db/importer.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);

export default async function pipelineRoutes(fastify) {

  // POST /api/scrape — trigger a pipeline run for one or all providers
  fastify.post('/scrape', async (req, reply) => {
    const { provider = 'crexi', max_price = 300001, max_listings = 50, state = 'OH' } = req.body || {};
    reply.status(202).send({ ok: true, message: `Scrape started (${provider})` });
    const pipelinePath = join(__dirname, '../../auctions/pipeline.js');
    const args = [
      pipelinePath,
      '--provider',     String(provider),
      '--max-price',    String(max_price),
      '--max-listings', String(max_listings),
      '--state',        String(state),
    ];
    exec('node', args)
      .then(() => { importListings(); seedAlerts(); })
      .catch(e => console.error('Scrape failed:', e.message));
  });

  // POST /api/import — re-sync DB from all listing JSON files on disk
  fastify.post('/import', async () => {
    const count = importListings();
    seedAlerts();
    return { ok: true, imported: count };
  });

  // GET /api/pipeline — all listings grouped by stage
  fastify.get('/pipeline', async () => {
    const db = getDb();
    const stages = ['Scouted','Enriching','Enriched','Due Diligence','Under Review','BID','NO BID','CONDITIONAL','Auction Day','Closed'];
    const rows = db.prepare(`
      SELECT id, source, asset_class, title, address, city, state, starting_bid_usd, max_bid_usd,
             bidding_starts, bidding_ends, disposition_score, recommendation, crime_grade,
             beds, baths, home_type,
             compliance_status, pipeline_stage, enriched_at, property_types
      FROM listings ORDER BY bidding_starts ASC NULLS LAST
    `).all();

    const grouped = {};
    for (const s of stages) grouped[s] = [];
    for (const r of rows) {
      const s = r.pipeline_stage || 'Scouted';
      if (grouped[s]) grouped[s].push({ ...r, property_types: safeJson(r.property_types) });
    }
    return { stages, groups: grouped };
  });
}

function safeJson(str) {
  try { return str ? JSON.parse(str) : null; } catch { return null; }
}
