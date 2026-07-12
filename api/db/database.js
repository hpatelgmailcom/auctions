import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH   = join(__dirname, 'crexi.db');

let _db;

// Columns added after initial schema — ALTER TABLE is idempotent via the catch
const MIGRATIONS = [
  "ALTER TABLE listings ADD COLUMN enrichment_sold_comps TEXT",
  "ALTER TABLE listings ADD COLUMN enrichment_walk_score TEXT",
  "ALTER TABLE listings ADD COLUMN enrichment_schools    TEXT",
  "ALTER TABLE listings ADD COLUMN enrichment_flood_risk TEXT",
  // Multi-provider columns
  "ALTER TABLE listings ADD COLUMN source           TEXT",
  "ALTER TABLE listings ADD COLUMN source_id        TEXT",
  "ALTER TABLE listings ADD COLUMN asset_class      TEXT",
  "ALTER TABLE listings ADD COLUMN beds             REAL",
  "ALTER TABLE listings ADD COLUMN baths            REAL",
  "ALTER TABLE listings ADD COLUMN living_area_sqft REAL",
  "ALTER TABLE listings ADD COLUMN home_type        TEXT",
  "ALTER TABLE listings ADD COLUMN occupancy_status TEXT",
];

export function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    _db.exec(schema);
    // Apply any columns not yet in the live DB (SQLite ignores duplicate-column errors)
    for (const sql of MIGRATIONS) {
      try { _db.exec(sql); } catch { /* column already exists */ }
    }
  }
  return _db;
}
