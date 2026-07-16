import { getDb } from '../db/database.js';
import { importListings, seedAlerts } from '../db/importer.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);

export default async function emailRoutes(fastify) {

  // POST /api/email/fetch — trigger an on-demand Gmail fetch (async)
  fastify.post('/email/fetch', async (req, reply) => {
    const { sender = 'all', max_messages = 50, since } = req.body || {};
    reply.status(202).send({ ok: true, message: `Email fetch started (${sender})` });
    const fetcherPath = join(__dirname, '../../auctions/email/fetch_emails.js');
    const args = [fetcherPath, '--sender', String(sender), '--max-messages', String(max_messages)];
    if (since) args.push('--since', String(since));
    exec('node', args)
      .then(() => { importListings(); seedAlerts(); })
      .catch(e => console.error('Email fetch failed:', e.message));
  });

  // GET /api/email/status — parser health + fetch history from email_messages
  fastify.get('/email/status', async () => {
    const db = getDb();

    const bySender = db.prepare(`
      SELECT sender, parser_slug,
             SUM(CASE WHEN status = 'parsed'  THEN 1 ELSE 0 END) AS parsed,
             SUM(CASE WHEN status = 'error'   THEN 1 ELSE 0 END) AS errors,
             MAX(received_at) AS last_received
      FROM email_messages
      WHERE parser_slug IS NOT NULL
      GROUP BY sender, parser_slug
      ORDER BY last_received DESC
    `).all();

    const unregistered = db.prepare(`
      SELECT sender, COUNT(*) AS count
      FROM email_messages
      WHERE parser_slug IS NULL
      GROUP BY sender ORDER BY count DESC
    `).all();

    const totals = db.prepare(`
      SELECT SUM(CASE WHEN status = 'parsed'      THEN 1 ELSE 0 END) AS parsed,
             SUM(CASE WHEN status = 'no_parser'   THEN 1 ELSE 0 END) AS no_parser,
             SUM(CASE WHEN status = 'no_listings' THEN 1 ELSE 0 END) AS no_listings,
             SUM(CASE WHEN status = 'error'       THEN 1 ELSE 0 END) AS error
      FROM email_messages
    `).get();

    const lastFetch = db.prepare('SELECT MAX(processed_at) AS m FROM email_messages').get()?.m ?? null;

    return { last_fetch: lastFetch, by_sender: bySender, unregistered, totals };
  });

  // GET /api/email/messages?status=no_parser — debugging view
  fastify.get('/email/messages', async (req) => {
    const db = getDb();
    const { status, limit = 100 } = req.query;
    const where = status ? 'WHERE status = @status' : '';
    return db.prepare(`
      SELECT gmail_id, sender, subject, received_at, parser_slug, status, error, listing_ids, processed_at
      FROM email_messages ${where}
      ORDER BY received_at DESC LIMIT @limit
    `).all({ ...(status && { status }), limit: Number(limit) });
  });
}
