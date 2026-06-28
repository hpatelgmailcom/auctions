import { getDb } from '../db/database.js';
import { importListings, seedAlerts } from '../db/importer.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);

export default async function pipelineRoutes(fastify) {

  // POST /api/scrape — trigger a scraper run
  fastify.post('/scrape', async (req, reply) => {
    const { max_price = 300001, max_listings = 50 } = req.body || {};
    reply.status(202).send({ ok: true, message: 'Scrape started' });
    const scraperPath = join(__dirname, '../../auctions/scraper.js');
    exec('node', [scraperPath, '--max-price', String(max_price), '--max-listings', String(max_listings)])
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
    const stages = ['Scouted','Enriching','Enriched','Under Review','BID','NO BID','CONDITIONAL','Auction Day','Closed'];
    const rows = db.prepare(`
      SELECT id, title, address, city, state, starting_bid_usd, max_bid_usd,
             bidding_starts, disposition_score, recommendation, crime_grade,
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
