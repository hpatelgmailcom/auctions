/**
 * document_sources.js
 *
 * Resolves a documents location into a list of readable files for the
 * Due Diligence Agent. Phase 1 supports local folders; the scheme check
 * leaves room for s3:// (or other cloud bucket) resolvers later.
 *
 * A "document" is any file in the folder with a supported extension:
 *   .pdf              → sent to Claude as a base64 document block
 *   .txt / .md        → sent inline as plain text
 */

import fs   from 'fs';
import path from 'path';

const SUPPORTED = { '.pdf': 'pdf', '.txt': 'text', '.md': 'text' };

// Anthropic request limit is 32 MB; base64 inflates by ~4/3, so cap raw bytes.
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

/**
 * @param {string|null} location  Local folder path (or s3:// URI in the future)
 * @returns {{ source: string, files: Array<{name, path, kind, bytes}>, skipped: string[] }}
 */
export function resolveDocuments(location) {
  if (!location) return { source: 'none', files: [], skipped: [] };

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(location)) {
    throw new Error(`Remote document sources are not supported yet: ${location} (local folders only for now)`);
  }

  const dir = path.resolve(location);
  if (!fs.existsSync(dir)) return { source: dir, files: [], skipped: [] };
  if (!fs.statSync(dir).isDirectory()) throw new Error(`--docs must be a folder: ${dir}`);

  const files   = [];
  const skipped = [];
  let total     = 0;

  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const ext  = path.extname(name).toLowerCase();
    const kind = SUPPORTED[ext];
    const full = path.join(dir, name);
    if (!kind || !fs.statSync(full).isFile()) { if (kind !== undefined) skipped.push(name); continue; }

    const bytes = fs.statSync(full).size;
    if (total + bytes > MAX_TOTAL_BYTES) {
      skipped.push(`${name} (would exceed ${MAX_TOTAL_BYTES / 1024 / 1024} MB request budget)`);
      continue;
    }
    total += bytes;
    files.push({ name, path: full, kind, bytes });
  }

  return { source: dir, files, skipped };
}
