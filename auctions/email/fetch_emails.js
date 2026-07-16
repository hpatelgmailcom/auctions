/**
 * fetch_emails.js — email-ingestion orchestrator (mirrors auctions/pipeline.js).
 *
 * For every registered sender (registry.js) it:
 *   1. lists new Gmail messages (incremental via the email_messages table)
 *   2. routes each message to its parser → canonical records
 *   3. validate + dedup + write one JSON file per listing to auctions/listings/
 *   4. enrich() each new file (unless --no-enrich)
 *   5. records every message in email_messages, then pings the API to re-import
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

  const seen = db.prepare("SELECT 1 FROM email_messages WHERE gmail_id = ? AND status = 'parsed'");
  const messages = [];
  for (const { id } of ids) {
    if (!FORCE && seen.get(id)) continue;
    messages.push(await getMessage(id));
  }
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

  const messages = FIXTURES ? loadFixtureMessages(FIXTURES) : await loadGmailMessages(db);
  console.log(`  Processing ${messages.length} message(s)…\n`);

  let parsed = 0, saved = 0, skipped = 0, noParser = 0, errors = 0;

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

    const parser = resolveParser(msg);
    if (!parser) {
      row.status = 'no_parser';
      noParser++;
      console.log(`  ? no parser for ${row.sender} — "${row.subject}"`);
      upsertMsg.run(row);
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
      upsertMsg.run(row);
      continue;
    }

    if (!records.length) {
      row.status = 'no_listings';
      console.log(`  – no listings in "${row.subject}"`);
      upsertMsg.run(row);
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

    row.status      = 'parsed';
    row.listing_ids = JSON.stringify(ids);
    parsed++;
    upsertMsg.run(row);
  }

  console.log(`\nDone. ${parsed} parsed, ${saved} listing(s) saved, ${skipped} skipped, ${noParser} no-parser, ${errors} error(s).`);

  // Notify the API to re-sync its DB (silently skipped if it isn't running).
  if (saved > 0) {
    await fetch('http://localhost:3001/api/import', { method: 'POST' })
      .then(r => r.json())
      .then(d => console.log(`  DB synced: ${d.imported} listing(s) imported.`))
      .catch(() => {});
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
