/**
 * pipeline.js — provider-agnostic scrape orchestrator.
 *
 * Replaces the old scraper.js main(). For each selected provider it:
 *   1. search()    → raw provider bundles
 *   2. normalize() → canonical records
 *   3. validate + dedup + write one JSON file per listing to listings/
 *   4. enrich()    (unless --no-enrich)
 *   5. pings the API to re-import the DB
 *
 * Usage:
 *   node auctions/pipeline.js --provider crexi        --max-listings 5
 *   node auctions/pipeline.js --provider auction_com  --state OH --max-listings 5
 *   node auctions/pipeline.js --provider all          --max-listings 5
 *
 * Options:
 *   --provider      crexi | auction_com | all      (default: crexi)
 *   --max-price     starting-bid ceiling (crexi)   (default: 30000000)
 *   --max-listings  cap per provider               (default: 10)
 *   --state         state code(s), comma-separated (auction_com; default: OH)
 *   --out-dir       output directory               (default: auctions/listings)
 *   --no-enrich     skip enrichment after each save
 *   --force         overwrite existing listing files
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { enrich } from './enrichment/enrich.js';
import { addressToFilename, validate } from './schema.js';

import * as crexi      from './providers/crexi/index.js';
import * as auctionCom from './providers/auction_com/index.js';

const PROVIDERS = {
  crexi,
  auction_com: auctionCom,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv   = process.argv.slice(2);
const getArg = (flag, def) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : def; };

const PROVIDER     = getArg('--provider', 'crexi');
const MAX_PRICE    = parseInt(getArg('--max-price', '30000000'), 10);
const MAX_LISTINGS = parseInt(getArg('--max-listings', '10'), 10);
const STATE        = getArg('--state', 'OH');
const OUT_DIR      = getArg('--out-dir', path.join(__dirname, 'listings'));
const NO_ENRICH    = argv.includes('--no-enrich');
const FORCE        = argv.includes('--force');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function selectedProviders() {
  if (PROVIDER === 'all') return Object.keys(PROVIDERS);
  if (!PROVIDERS[PROVIDER]) {
    console.error(`Unknown provider "${PROVIDER}". Options: ${Object.keys(PROVIDERS).join(', ')}, all`);
    process.exit(1);
  }
  return [PROVIDER];
}

/** Options each provider's search() accepts. Extra keys are harmless. */
function searchOptsFor(slug) {
  const onProgress = msg => console.log(`    ${msg}`);
  const base = { maxListings: MAX_LISTINGS, onProgress };
  if (slug === 'crexi')       return { ...base, maxPrice: MAX_PRICE };
  if (slug === 'auction_com') return { ...base, state: STATE.split(',').map(s => s.trim()) };
  return base;
}

async function runProvider(slug) {
  const provider = PROVIDERS[slug];
  console.log(`\n=== Provider: ${provider.meta.displayName} (${slug}) ===`);

  let bundles;
  try {
    bundles = await provider.search(searchOptsFor(slug));
  } catch (err) {
    console.error(`  ✗ search failed: ${err.message.split('\n')[0]}`);
    return { saved: 0, skipped: 0 };
  }

  console.log(`  Normalizing & saving ${bundles.length} listing(s)…`);
  let saved = 0, skipped = 0;

  for (const bundle of bundles) {
    let record;
    try {
      record = provider.normalize(bundle);
    } catch (err) {
      console.error(`  ✗ normalize failed: ${err.message.split('\n')[0]}`);
      continue;
    }

    const { ok, errors } = validate(record);
    if (!ok) {
      console.error(`  ✗ invalid record (${record.source_id}): ${errors.join(', ')}`);
      continue;
    }

    // Prefix filename with the source so two providers never overwrite each
    // other when the same address lists on both platforms.
    const filename = `${slug}__${addressToFilename(record.listing.address)}`;
    const outPath  = path.join(OUT_DIR, filename);

    if (!FORCE && fs.existsSync(outPath)) {
      console.log(`  ↷ skipped (exists): ${filename}`);
      skipped++;
      continue;
    }

    fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
    saved++;
    console.log(`  ✓ ${filename}`);

    if (!NO_ENRICH) {
      try { await enrich(outPath, { silent: true }); }
      catch (err) { console.error(`     ✗ enrichment failed: ${err.message.split('\n')[0]}`); }
    }
  }

  console.log(`  ${provider.meta.displayName}: ${saved} saved, ${skipped} skipped.`);
  return { saved, skipped };
}

async function main() {
  const providers = selectedProviders();
  console.log('\nDeal Pipeline');
  console.log(`  Providers:    ${providers.join(', ')}`);
  console.log(`  Max listings: ${MAX_LISTINGS} (per provider)`);
  console.log(`  Output dir:   ${OUT_DIR}`);
  console.log(`  Enrichment:   ${NO_ENRICH ? 'disabled' : 'enabled'}`);
  console.log(`  Dedup:        ${FORCE ? 'off (--force)' : 'on'}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let totalSaved = 0;
  for (const slug of providers) {
    const { saved } = await runProvider(slug);
    totalSaved += saved;
  }

  console.log(`\nDone. ${totalSaved} listing(s) saved → ${OUT_DIR}/`);

  // Notify the API to re-sync its DB from the listing files on disk.
  // Fire-and-forget — silently skipped if the API server isn't running.
  if (totalSaved > 0) {
    fetch('http://localhost:3001/api/import', { method: 'POST' })
      .then(r => r.json())
      .then(d => console.log(`  DB synced: ${d.imported} listing(s) imported.`))
      .catch(() => {});
    await sleep(500);
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
