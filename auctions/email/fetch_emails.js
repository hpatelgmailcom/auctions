/**
 * fetch_emails.js — email-ingestion orchestrator (mirrors auctions/pipeline.js).
 *
 * For every registered sender (registry.js) it:
 *   1. lists new Gmail messages (incremental via the email_messages table)
 *   2. routes each message to its parser → canonical records
 *   3. validate + dedup + write one JSON file per listing to auctions/listings/
 *   4. enrich() each new file (unless --no-enrich)
 *   5. records every message in email_messages, then pings the API to re-import
 *   6. moves processed messages to Gmail Trash (recoverable ~30 days; never a
 *      permanent delete) — only AFTER the email_messages row is committed, and
 *      only for status parsed/no_listings. Errors stay in the inbox so a broken
 *      parser never destroys its own evidence. --keep disables trashing.
 *
 * Duplication guardrails (in order): the email_messages PK skips any message
 * already parsed (even if trashing failed); listing files dedupe by filename;
 * the DB upserts on "source:source_id". Already-processed messages still in
 * the inbox are swept to trash on the next run.
 *
 * Usage:
 *   node auctions/email/fetch_emails.js                       # incremental fetch, all senders
 *   node auctions/email/fetch_emails.js --sender cushman_wakefield --since 30d
 *   node auctions/email/fetch_emails.js --from-fixtures auctions/email/fixtures --no-enrich
 *
 * Options:
 *   --sender         parser slug | all                (default: all)
 *   --max-messages   cap per run                      (default: 50)
 *   --since          lookback window, e.g. 7d / 24h   (default: since last fetch, else 7d)
 *   --out-dir        output directory                 (default: auctions/listings)
 *   --no-enrich      skip enrichment after each save
 *   --keep           leave processed messages in the inbox (default: trash them)
 *   --listings-since messages older than this window are recorded as 'archived'
 *                    and trashed WITHOUT creating listings (backlog hygiene),
 *                    e.g. --listings-since 90d
 *   --retry-no-listings  reprocess messages previously recorded as no_listings
 *                    (fetched by id — works even after they were trashed); use
 *                    after improving a parser
 *   --force          reprocess already-seen messages and overwrite listing files
 *   --from-fixtures  read normalized-message JSONs from a directory instead of
 *                    Gmail (offline mode — no credentials needed)
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { enrich } from '../enrichment/enrich.js';
import { addressToFilename, validate, recordKey } from '../schema.js';
import { resolveParser, registeredSenders, normalizeAddress } from './registry.js';
import { getDb } from '../../api/db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv   = process.argv.slice(2);
const getArg = (flag, def) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : def; };

const SENDER    = getArg('--sender', 'all');
const MAX_MSGS  = parseInt(getArg('--max-messages', '50'), 10);
const SINCE     = getArg('--since', null);
const OUT_DIR   = getArg('--out-dir', path.join(__dirname, '../listings'));
const NO_ENRICH = argv.includes('--no-enrich');
const FORCE     = argv.includes('--force');
const FIXTURES  = getArg('--from-fixtures', null);
const TRASH     = !argv.includes('--keep') && !FIXTURES;
const LISTINGS_SINCE = getArg('--listings-since', null);
const RETRY_NO_LISTINGS = argv.includes('--retry-no-listings');

/** Statuses that mean "fully handled — safe to trash the email". */
const TRASHABLE = new Set(['parsed', 'no_listings', 'archived']);

/** "7d" → ms, "24h" → ms */
function windowMs(str) {
  const m = String(str).match(/^(\d+)([dh])$/);
  if (!m) return 7 * 86400_000;
  return Number(m[1]) * (m[2] === 'd' ? 86400_000 : 3600_000);
}

function loadFixtureMessages(dir) {
  const abs = path.resolve(dir);
  const files = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json')) files.push(p);
    }
  };
  walk(abs);
  return files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
}

/** Re-fetch messages previously recorded as no_listings (by gmail id — works
 *  even from trash) so an improved parser gets a second pass at them. */
async function loadRetryMessages(db) {
  const { getMessage } = await import('./gmail.js');
  const senders = registeredSenders().filter(s => SENDER === 'all' || s.slug === SENDER);
  const addresses = senders.flatMap(s => s.addresses);
  const rows = db.prepare(
    `SELECT gmail_id FROM email_messages WHERE status = 'no_listings'
     AND sender IN (${addresses.map(() => '?').join(',')}) ORDER BY received_at DESC`
  ).all(...addresses);
  console.log(`  Retrying ${rows.length} no_listings message(s)…`);
  const messages = [];
  for (const { gmail_id } of rows) {
    try { messages.push(await getMessage(gmail_id)); }
    catch (err) { console.error(`  ✗ fetch failed (${gmail_id}): ${err.message.split('\n')[0]}`); }
  }
  return messages;
}

async function loadGmailMessages(db) {
  // Import lazily so offline (--from-fixtures) runs never touch googleapis/auth.
  const { listMessages, getMessage } = await import('./gmail.js');

  const senders = registeredSenders().filter(s => SENDER === 'all' || s.slug === SENDER);
  if (!senders.length) {
    console.error(`Unknown sender "${SENDER}". Options: ${registeredSenders().map(s => s.slug).join(', ')}, all`);
    process.exit(1);
  }

  // Incremental window: newest received_at we've processed, minus 1 day of
  // overlap (Gmail `after:` is date-granular); --since overrides.
  let afterEpoch;
  if (SINCE) {
    afterEpoch = Date.now() - windowMs(SINCE);
  } else {
    const last = db.prepare('SELECT MAX(received_at) AS m FROM email_messages').get()?.m;
    afterEpoch = last ? new Date(last).getTime() - 86400_000 : Date.now() - windowMs('7d');
  }

  const addresses = senders.flatMap(s => s.addresses);
  const query = `from:(${addresses.join(' OR ')}) after:${Math.floor(afterEpoch / 1000)}`;
  console.log(`  Gmail query: ${query}`);

  const ids = await listMessages({ query, maxResults: MAX_MSGS });
  console.log(`  ${ids.length} message(s) matched.`);

  const { trashMessage } = await import('./gmail.js');
  const seen = db.prepare('SELECT status FROM email_messages WHERE gmail_id = ?');
  const messages = [];
  let swept = 0;
  for (const { id } of ids) {
    const prior = seen.get(id);
    if (!FORCE && prior && TRASHABLE.has(prior.status)) {
      // Already fully handled — sweep the leftover inbox copy to trash.
      if (TRASH) {
        try { await trashMessage(id); swept++; }
        catch (err) { console.error(`  ✗ trash failed (${id}): ${err.message.split('\n')[0]}`); }
      }
      continue;
    }
    messages.push(await getMessage(id));
  }
  if (swept) console.log(`  ${swept} already-processed message(s) swept to trash.`);
  return messages;
}

function saveRecord(record) {
  const filename = `${record.source}__${addressToFilename(record.listing.address)}`;
  const outPath  = path.join(OUT_DIR, filename);
  if (!FORCE && fs.existsSync(outPath)) return { outPath, skipped: true };
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
  return { outPath, skipped: false };
}

async function main() {
  console.log('\nEmail Ingestion');
  console.log(`  Mode:       ${FIXTURES ? `fixtures (${FIXTURES})` : 'Gmail API'}`);
  console.log(`  Sender:     ${SENDER}`);
  console.log(`  Enrichment: ${NO_ENRICH ? 'disabled' : 'enabled'}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const db = getDb();

  const upsertMsg = db.prepare(`
    INSERT OR REPLACE INTO email_messages
      (gmail_id, thread_id, sender, subject, received_at, parser_slug, status, error, listing_ids)
    VALUES (@gmail_id, @thread_id, @sender, @subject, @received_at, @parser_slug, @status, @error, @listing_ids)
  `);

  const messages = FIXTURES ? loadFixtureMessages(FIXTURES)
                 : RETRY_NO_LISTINGS ? await loadRetryMessages(db)
                 : await loadGmailMessages(db);
  console.log(`  Processing ${messages.length} message(s)…\n`);

  let parsed = 0, saved = 0, skipped = 0, noParser = 0, errors = 0, trashed = 0, archived = 0;
  const archiveCutoff = LISTINGS_SINCE ? Date.now() - windowMs(LISTINGS_SINCE) : null;

  // Record the outcome FIRST, then trash — the email_messages row is the dedup
  // guardrail, so a failed trash can never cause a message to be reprocessed.
  const trashMessage = TRASH ? (await import('./gmail.js')).trashMessage : null;
  const finish = async (row) => {
    upsertMsg.run(row);
    if (trashMessage && TRASHABLE.has(row.status)) {
      try { await trashMessage(row.gmail_id); trashed++; }
      catch (err) { console.error(`  ✗ trash failed (${row.gmail_id}): ${err.message.split('\n')[0]}`); }
    }
  };

  for (const msg of messages) {
    const row = {
      gmail_id:    msg.id,
      thread_id:   msg.threadId ?? null,
      sender:      normalizeAddress(msg.from),
      subject:     msg.subject ?? null,
      received_at: msg.date ?? null,
      parser_slug: null,
      status:      null,
      error:       null,
      listing_ids: null,
    };

    // Backlog hygiene: too old to be an actionable offering — record + trash,
    // but don't pollute the pipeline with dead listings.
    if (archiveCutoff && msg.date && new Date(msg.date).getTime() < archiveCutoff) {
      row.status = 'archived';
      archived++;
      await finish(row);
      continue;
    }

    const parser = resolveParser(msg);
    if (!parser) {
      row.status = 'no_parser';
      noParser++;
      console.log(`  ? no parser for ${row.sender} — "${row.subject}"`);
      await finish(row);
      continue;
    }
    row.parser_slug = parser.meta.slug;

    let records;
    try {
      records = parser.parse(msg);
    } catch (err) {
      row.status = 'error';
      row.error  = err.message;
      errors++;
      console.error(`  ✗ parse failed (${parser.meta.slug}): ${err.message.split('\n')[0]}`);
      await finish(row); // error → kept in inbox
      continue;
    }

    if (!records.length) {
      row.status = 'no_listings';
      console.log(`  – no listings in "${row.subject}"`);
      await finish(row);
      continue;
    }

    const ids = [];
    for (const record of records) {
      const { ok, errors: verrs } = validate(record);
      if (!ok) {
        console.error(`  ✗ invalid record (${record.source_id}): ${verrs.join(', ')}`);
        continue;
      }
      const { outPath, skipped: wasSkipped } = saveRecord(record);
      ids.push(recordKey(record));
      if (wasSkipped) {
        skipped++;
        console.log(`  ↷ skipped (exists): ${path.basename(outPath)}`);
        continue;
      }
      saved++;
      console.log(`  ✓ ${path.basename(outPath)}`);
      if (!NO_ENRICH) {
        try { await enrich(outPath, { silent: true }); }
        catch (err) { console.error(`     ✗ enrichment failed: ${err.message.split('\n')[0]}`); }
      }
    }

    if (ids.length === 0) {
      // Every record failed validation — treat as an error and keep the email.
      row.status = 'error';
      row.error  = `${records.length} record(s), all failed validation`;
      errors++;
      await finish(row);
      continue;
    }

    row.status      = 'parsed';
    row.listing_ids = JSON.stringify(ids);
    parsed++;
    await finish(row);
  }

  console.log(`\nDone. ${parsed} parsed, ${saved} listing(s) saved, ${skipped} skipped, ${archived} archived, ${noParser} no-parser, ${errors} error(s), ${trashed} trashed.`);

  // Notify the API to re-sync its DB (silently skipped if it isn't running).
  if (saved > 0) {
    await fetch('http://localhost:3001/api/import', { method: 'POST' })
      .then(r => r.json())
      .then(d => console.log(`  DB synced: ${d.imported} listing(s) imported.`))
      .catch(() => {});
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
