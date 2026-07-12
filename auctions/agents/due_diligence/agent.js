/**
 * agent.js — Due Diligence Agent orchestrator (CLI)
 *
 * Thinks like a seasoned reserve-auction bidder: reads the listing's due
 * diligence documents, runs a deterministic max-bid financial model and a
 * disposition score, and writes a `due_diligence` block back into the
 * listing JSON (picked up by the dashboard on the next DB sync).
 *
 * Usage:
 *   node auctions/agents/due_diligence/agent.js <listing.json> [options]
 *   node auctions/agents/due_diligence/agent.js --all [options]
 *
 * Options:
 *   --docs <path>       Folder of due diligence docs (PDF/txt/md) for this
 *                       listing. Default: auctions/documents/<listing-slug>/
 *                       (s3:// and other cloud sources planned — see
 *                       document_sources.js)
 *   --docs-root <path>  With --all: root folder containing one
 *                       <listing-slug>/ docs folder per listing
 *   --rate <pct>        Interest rate for the debt model (default 7.5)
 *   --coc <pct>         Required cash-on-cash return (default 16)
 *   --no-llm            Skip Claude document extraction (deterministic only)
 *   --dry-run           Print the due_diligence block, don't write the file
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveDocuments } from './document_sources.js';
import { extractFacts }     from './document_reader.js';
import { resolveLiens }     from './lien_resolver.js';
import { calculateMaxBid }  from './max_bid_calculator.js';
import { scoreDisposition } from './disposition_scorer.js';
import { buildRiskFlags }   from './risk_flags.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const AUCTIONS_DIR = path.resolve(__dirname, '../../');

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { files: [], all: false, docs: null, docsRoot: null, dryRun: false, noLlm: false, options: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--all':       opts.all = true; break;
      case '--docs':      opts.docs = argv[++i]; break;
      case '--docs-root': opts.docsRoot = argv[++i]; break;
      case '--rate':      opts.options.interestRatePct = parseFloat(argv[++i]); break;
      case '--coc':       opts.options.targetCocPct = parseFloat(argv[++i]); break;
      case '--no-llm':    opts.noLlm = true; break;
      case '--dry-run':   opts.dryRun = true; break;
      default:
        if (a.startsWith('--')) { console.error(`Unknown option: ${a}`); process.exit(1); }
        opts.files.push(a);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

function decide({ calc, listing, docStatus, docsReviewed }) {
  const startingBid = listing.auction?.starting_bid_usd ?? null;

  if (!calc.feasible) {
    if (calc.financial_model?.estimated_noi_usd < 0) {
      return { recommendation: 'NO BID', reasoning: calc.reason };
    }
    return { recommendation: 'CONDITIONAL BID', reasoning: `${calc.reason} — provide a rent roll or square footage to complete the model` };
  }

  const maxBid = calc.max_bid_usd;
  if (maxBid <= 0) {
    return { recommendation: 'NO BID', reasoning: 'One-time costs (premium, liens, capex, reserves) consume the entire supportable budget — no bid produces the required return' };
  }
  if (startingBid != null && startingBid > maxBid) {
    return { recommendation: 'NO BID', reasoning: `Starting bid $${startingBid.toLocaleString()} exceeds max supportable bid $${maxBid.toLocaleString()} — reserve likely above our ceiling` };
  }

  const headroom = startingBid != null ? maxBid - startingBid : null;
  if (docStatus !== 'ok' || docsReviewed === 0) {
    return { recommendation: 'CONDITIONAL BID', reasoning: `Max bid $${maxBid.toLocaleString()} clears the starting bid, but no due diligence documents were reviewed — verify title, condition, and income before bidding` };
  }
  if (headroom != null && startingBid > 1000 && headroom < startingBid * 0.10) {
    return { recommendation: 'CONDITIONAL BID', reasoning: `Max bid $${maxBid.toLocaleString()} is within 10% of the starting bid — thin margin; bid only if the auction stays quiet` };
  }
  return { recommendation: 'BID', reasoning: `Max supportable bid $${maxBid.toLocaleString()}${startingBid != null ? ` vs starting bid $${startingBid.toLocaleString()}` : ''} at the required return, with document-verified inputs` };
}

// ---------------------------------------------------------------------------
// Per-listing run
// ---------------------------------------------------------------------------

export async function runDueDiligence(listingPath, { docs = null, noLlm = false, dryRun = false, options = {} } = {}) {
  const absPath = path.resolve(listingPath);
  const record  = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  const slug    = path.basename(absPath, '.json');

  const docsLocation = docs ?? path.join(AUCTIONS_DIR, 'documents', slug);
  const { source, files, skipped } = resolveDocuments(docsLocation);

  console.log(`\n  Due diligence: ${record.listing?.address ?? slug}`);
  console.log(`    Documents: ${files.length ? files.map(f => f.name).join(', ') : 'none found'} (${source})`);
  for (const s of skipped) console.log(`    Skipped: ${s}`);

  // 1. LLM extraction (documents + listing description)
  let extraction = { status: 'skipped', facts: null, documents_reviewed: files.map(f => f.name) };
  if (!noLlm) {
    process.stdout.write('    Extracting facts with Claude… ');
    extraction = await extractFacts({ files, listing: record });
    console.log(extraction.status === 'ok' ? '✓' : `✗ ${extraction.error ?? extraction.status}`);
  } else {
    console.log('    Claude extraction skipped (--no-llm)');
  }
  const facts = extraction.facts;

  // 2. Deterministic pipeline
  const liens = resolveLiens(facts);
  const calc  = calculateMaxBid({ listing: record, facts, lienTotal: liens.total_usd, options });
  const dispo = scoreDisposition({ listing: record, facts, liens, maxBid: calc.max_bid_usd ?? 0, docsReviewed: files.length });
  const risks = buildRiskFlags({ listing: record, calc, facts, liens, docStatus: extraction.status, docsReviewed: files.length });
  const { recommendation, reasoning } = decide({ calc, listing: record, docStatus: extraction.status, docsReviewed: files.length });

  record.due_diligence = {
    analyzed_at:       new Date().toISOString(),
    recommendation,
    max_bid_usd:       calc.max_bid_usd,
    max_bid_reasoning: reasoning,
    financial_model:   calc.financial_model,
    assumptions:       calc.assumptions,
    disposition_score:           dispo.disposition_score,
    disposition_score_breakdown: dispo.breakdown,
    disposition_notes:           dispo.notes,
    risk_flags: risks,
    documents: {
      source,
      reviewed:   extraction.documents_reviewed,
      extraction: extraction.status,
      ...(extraction.error ? { extraction_error: extraction.error } : {}),
    },
    ...(facts ? { extracted_facts: facts } : {}),
  };

  console.log(`    → ${recommendation}  |  max bid: ${calc.max_bid_usd != null ? `$${calc.max_bid_usd.toLocaleString()}` : '—'}  |  disposition: ${dispo.disposition_score}/10  |  flags: ${risks.length}`);

  if (dryRun) {
    console.log(JSON.stringify(record.due_diligence, null, 2));
  } else {
    fs.writeFileSync(absPath, JSON.stringify(record, null, 2));
    console.log(`    Saved → ${absPath}`);
  }
  return record.due_diligence;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('agent.js')) {
  const opts = parseArgs(process.argv.slice(2));

  let targets = opts.files;
  if (opts.all) {
    const dir = path.join(AUCTIONS_DIR, 'listings');
    targets = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => path.join(dir, f));
  }
  if (targets.length === 0) {
    console.error('Usage: node agents/due_diligence/agent.js <listing.json> [--docs <folder>] [--rate N] [--coc N] [--no-llm] [--dry-run]');
    console.error('       node agents/due_diligence/agent.js --all [--docs-root <folder>] …');
    process.exit(1);
  }

  const run = async () => {
    for (const target of targets) {
      const slug = path.basename(target, '.json');
      const docs = opts.docs ?? (opts.docsRoot ? path.join(opts.docsRoot, slug) : null);
      try {
        await runDueDiligence(target, { docs, noLlm: opts.noLlm, dryRun: opts.dryRun, options: opts.options });
      } catch (err) {
        console.error(`    ✗ ${slug}: ${err.message}`);
        if (targets.length === 1) process.exit(1);
      }
    }
  };
  run();
}
