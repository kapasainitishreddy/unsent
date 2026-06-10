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

  // Idempotent column migrations for fields added after the initial schema.
  // SQLite has no ADD COLUMN IF NOT EXISTS, so we check pragma table_info first.
  const settingsCols = new Set(
    db.prepare('PRAGMA table_info(settings)').all().map(c => c.name)
  );
  const addCol = (table, col, decl) => {
    if (table === 'settings' && settingsCols.has(col)) return;
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`); } catch {}
  };
  addCol('settings', 'aria_name',          'TEXT NOT NULL DEFAULT \'Aria\'');
  addCol('settings', 'aria_mascot',        'TEXT NOT NULL DEFAULT \'crane\'');
  addCol('settings', 'aria_voice',         'TEXT');           // web speech voiceURI
  addCol('settings', 'voice_pitch',        'REAL NOT NULL DEFAULT 1');
  addCol('settings', 'voice_rate',         'REAL NOT NULL DEFAULT 1');
  addCol('settings', 'user_display_name',  'TEXT');
  addCol('settings', 'onboarding_purpose', 'TEXT');           // 'releases' | 'clarity' | 'companion' | 'health'
  addCol('settings', 'onboarding_mood',    'TEXT');           // starter mood they picked

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
