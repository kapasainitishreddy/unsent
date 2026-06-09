// SQLite connection wrapper around Node 22+'s built-in `node:sqlite`.
// API mirrors better-sqlite3: synchronous, prepare/cache, run/all/get/iterate.
// We use WAL mode + a single connection (Fastify handler is single-threaded JS).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_SQL, SEED_SQL } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db = null;

export function openDb(dbPath) {
  if (_db) return _db;

  const absPath = resolve(process.cwd(), dbPath);
  mkdirSync(dirname(absPath), { recursive: true });

  _db = new DatabaseSync(absPath);

  // Apply schema. multi-statement exec is supported by node:sqlite.
  _db.exec(SCHEMA_SQL);

  // Seed local_user row if missing.
  const now = Date.now();
  const seed = SEED_SQL.replaceAll('$now', String(now));
  _db.exec(seed);

  return _db;
}

export function getDb() {
  if (!_db) throw new Error('DB not opened — call openDb() first');
  return _db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ---- Tiny query helpers -------------------------------------------------
// These mirror the better-sqlite3 ergonomic surface so route code is short.

export function all(sql, params = []) {
  return getDb().prepare(sql).all(...normalizeParams(params));
}

export function get(sql, params = []) {
  return getDb().prepare(sql).get(...normalizeParams(params));
}

export function run(sql, params = []) {
  return getDb().prepare(sql).run(...normalizeParams(params));
}

function normalizeParams(params) {
  // node:sqlite's .run/.all/.get spread args positionally. Our code may pass
  // an object (named params) or an array. We force array.
  return Array.isArray(params) ? params : [params];
}
