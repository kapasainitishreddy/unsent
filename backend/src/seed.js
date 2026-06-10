// Standalone seed CLI. Usage: `pnpm seed`
// Seeds the dev user (`local_user`) with the curated affirmation presets and a
// default settings row. Idempotent — running twice is a no-op.
//
//   node src/seed.js               # seeds local_user
//   node src/seed.js user_abc      # seeds a specific user id (e.g. after Clerk)
//
// In production, the route POST /api/affirmations/seed-presets handles per-user
// seeding when they first sign in.

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as db from './db/index.js';
import { openDb } from './db/index.js';
import { ensureUserSettings } from './auth.js';
import { PRESETS } from './presets.js';

const userId = process.argv[2] || 'local_user';
const dbPath = process.env.DB_PATH || './data/unsent.db';
const now = Date.now();

console.log(`🌱 seeding for user: ${userId}`);
openDb(dbPath);

// 1. Settings row (needed for FK-less tables — settings has no FKs, but other
//    tables reference user_id by convention, not by FK. Still — be explicit.)
ensureUserSettings(userId);
console.log('  ✓ settings row ready');

// 2. Affirmation presets (idempotent — skip if a row with the same text exists)
let added = 0;
for (const p of PRESETS) {
  const exists = db.get(
    `SELECT id FROM affirmations WHERE user_id = ? AND text = ?`,
    [userId, p.text]
  );
  if (exists) continue;
  db.run(
    `INSERT INTO affirmations
       (id, user_id, text, source, mood_filter, category, favorited, created_at)
     VALUES (?,?,?,?,?,?,0,?)`,
    [randomUUID(), userId, p.text, 'preset', p.mood_filter, p.category, now]
  );
  added++;
}
console.log(`  ✓ affirmations: ${added} added, ${PRESETS.length - added} skipped`);

const total = db.get(`SELECT COUNT(*) as n FROM affirmations WHERE user_id = ?`, [userId]).n;
console.log(`  → ${total} total affirmations for ${userId}`);
console.log('done.');
