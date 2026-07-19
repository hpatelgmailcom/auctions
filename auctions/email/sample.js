/**
 * sample.js — dump raw email samples for one sender, for one-time parser authoring.
 *
 * Usage:
 *   node auctions/email/sample.js --from info@cwmultifamily.com --max 5 [--out <dir>]
 *
 * Writes, per message, into auctions/email/samples/<sender-slug>/:
 *   <gmail_id>.json  — the normalized message shape (what parse() receives)
 *   <gmail_id>.html  — decoded HTML body (if any)
 *   <gmail_id>.txt   — decoded text body (if any)
 *
 * Workflow (the ONLY step where AI touches email content, and only dev-time):
 * dump samples → author parsers/<slug>.js from them → commit 2-3 scrubbed
 * samples as fixtures/<slug>/ → register in registry.js → node test_parsers.js
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { listMessages, getMessage } from './gmail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv   = process.argv.slice(2);
const getArg = (flag, def) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : def; };

const FROM = getArg('--from', null);
const MAX  = parseInt(getArg('--max', '5'), 10);

if (!FROM) {
  console.error('Usage: node auctions/email/sample.js --from <address> [--max 5] [--out <dir>]');
  process.exit(1);
}

const slug   = FROM.toLowerCase().replace(/@.*$/, '').replace(/[^a-z0-9]+/g, '_');
const OUT    = getArg('--out', path.join(__dirname, 'samples', slug));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const ids = await listMessages({ query: `from:${FROM}`, maxResults: MAX });
  if (!ids.length) { console.log(`No messages found from ${FROM}.`); return; }

  for (const { id } of ids) {
    const msg = await getMessage(id);
    fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(msg, null, 2));
    if (msg.html) fs.writeFileSync(path.join(OUT, `${id}.html`), msg.html);
    if (msg.text) fs.writeFileSync(path.join(OUT, `${id}.txt`), msg.text);
    console.log(`  ✓ ${id}  ${msg.date}  ${msg.subject}`);
  }
  console.log(`\n${ids.length} sample(s) → ${OUT}/`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
