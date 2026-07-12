/**
 * scraper.js — backwards-compatibility shim.
 *
 * The Crexi-specific scraping logic now lives in providers/crexi/index.js and
 * the orchestration in pipeline.js. This shim forwards the old
 * `node auctions/scraper.js [--max-price N --max-listings N ...]` invocation to
 * the pipeline with --provider crexi, so existing scripts and the API's /scrape
 * route keep working unchanged.
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pipeline  = path.join(__dirname, 'pipeline.js');

const forwarded = process.argv.slice(2);
if (!forwarded.includes('--provider')) forwarded.unshift('--provider', 'crexi');

spawn('node', [pipeline, ...forwarded], { stdio: 'inherit' })
  .on('exit', code => process.exit(code ?? 0));
