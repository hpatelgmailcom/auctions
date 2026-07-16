/**
 * test_parsers.js — regression harness for every registered email parser.
 *
 * For each fixtures/<slug>/ directory: load every normalized-message JSON,
 * confirm the registry routes it to that parser, parse it, and assert every
 * record is canonical-valid with sane numbers and a stable source_id.
 *
 * Usage: npm run email:test   (plain node, no test framework — exit 1 on failure)
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validate } from '../schema.js';
import { resolveParser } from './registry.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

let checks = 0, failures = 0;
const assert = (cond, msg) => {
  checks++;
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
};

const slugs = fs.existsSync(FIXTURES_DIR)
  ? fs.readdirSync(FIXTURES_DIR).filter(d => fs.statSync(path.join(FIXTURES_DIR, d)).isDirectory())
  : [];

if (!slugs.length) { console.error('No fixture directories found.'); process.exit(1); }

for (const slug of slugs) {
  const dir   = path.join(FIXTURES_DIR, slug);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  console.log(`\n${slug} (${files.length} fixture(s))`);

  for (const file of files) {
    const msg    = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const parser = resolveParser(msg);

    assert(parser, `${file}: no parser matched ${msg.from}`);
    if (!parser) continue;
    assert(parser.meta.slug === slug, `${file}: routed to ${parser.meta.slug}, expected ${slug}`);

    let records;
    try { records = parser.parse(msg); }
    catch (err) { assert(false, `${file}: parse threw — ${err.message}`); continue; }

    console.log(`  ${file}: ${records.length} record(s)`);

    for (const r of records) {
      const { ok, errors } = validate(r);
      assert(ok, `${file}: invalid record ${r.source_id} — ${errors.join(', ')}`);
      assert(r.listing_type === 'sale', `${file}: listing_type should be 'sale'`);
      assert(r.listing.id === r.source_id, `${file}: listing.id must equal source_id`);
      assert(r.email?.message_id === msg.id, `${file}: email.message_id missing/wrong`);

      const price = r.sale?.asking_price_usd;
      assert(price == null || (price >= 10000 && price <= 500_000_000),
             `${file}: asking price out of range: ${price}`);
      assert(price != null, `${file}: parsed record has no asking price`);
      const cap = r.sale?.cap_rate_pct;
      assert(cap == null || (cap > 0 && cap <= 20), `${file}: cap rate out of range: ${cap}`);
      assert(/^[A-Z]{2}$/.test(r.listing.state), `${file}: state not a 2-letter abbr: ${r.listing.state}`);
    }

    // source_id stability: same message parsed twice → identical ids
    if (records.length) {
      const again = parser.parse(msg);
      assert(JSON.stringify(records.map(r => r.source_id)) === JSON.stringify(again.map(r => r.source_id)),
             `${file}: source_id not stable across re-parses`);
    }
  }
}

console.log(`\n${checks} checks, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
