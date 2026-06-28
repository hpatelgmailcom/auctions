import { getDb } from '../db/database.js';

export default async function alertsRoutes(fastify) {

  // GET /api/alerts
  fastify.get('/alerts', async (req) => {
    const db = getDb();
    const { unseen_only } = req.query;
    const where = unseen_only === 'true' ? 'WHERE a.seen = 0' : '';
    return db.prepare(`
      SELECT a.*, l.address, l.city, l.state, l.starting_bid_usd, l.bidding_starts
      FROM alerts a LEFT JOIN listings l ON a.listing_id = l.id
      ${where}
      ORDER BY a.severity DESC, a.created_at DESC
      LIMIT 100
    `).all();
  });

  // PATCH /api/alerts/:id/seen
  fastify.patch('/alerts/:id/seen', async (req) => {
    getDb().prepare('UPDATE alerts SET seen = 1 WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  // PATCH /api/alerts/seen-all
  fastify.patch('/alerts/seen-all', async () => {
    getDb().prepare('UPDATE alerts SET seen = 1').run();
    return { ok: true };
  });

  // GET /api/alerts/count
  fastify.get('/alerts/count', async () => {
    const n = getDb().prepare('SELECT COUNT(*) as n FROM alerts WHERE seen = 0').get().n;
    return { unseen: n };
  });
}
