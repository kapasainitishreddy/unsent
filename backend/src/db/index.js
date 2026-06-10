// SQLite connection wrapper around Node 22+'s built-in `node:sqlite`.
// API mirrors better-sqlite3: synchronous, prepare/cache, run/all/get/iterate.
// We use WAL mode + a single connection (Fastify handler is single-threaded JS).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';
import { SCHEMA_SQL, SEED_SQL } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// We keep a tiny registry so repeated openDb() calls with the same path reuse
// the connection, but a different path replaces it. This matters for tests,
// which build a fresh app on a temp file per test — the previous connection
// must be released before the new one is opened.
let _db = null;
let _dbPath = null;

export function openDb(dbPath) {
  const absPath = resolve(process.cwd(), dbPath);

  if (_db && _dbPath === absPath) return _db;

  if (_db) {
    try { _db.close(); } catch {}
    _db = null;
    _dbPath = null;
  }

  mkdirSync(dirname(absPath), { recursive: true });

  const db = new DatabaseSync(absPath);
  db.exec(SCHEMA_SQL);
  const now = Date.now();
  db.exec(SEED_SQL.replaceAll('$now', String(now)));

  _db = db;
  _dbPath = absPath;
  return _db;
}

export function getDb() {
  if (!_db) throw new Error('DB not opened — call openDb() first');
  return _db;
}

export function closeDb() {
  if (_db) {
    try { _db.close(); } catch {}
    _db = null;
    _dbPath = null;
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
