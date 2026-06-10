// Shared test helpers. Builds an isolated app per test, on a fresh in-memory
// SQLite DB, so tests are independent and don't pollute ./data/unsent.db.
//
// Usage in tests:
//   import { buildTestApp } from './helpers.js';
//   const app = await buildTestApp();
//   const res = await app.inject({ method: 'GET', url: '/api/me' });
//   assert.equal(res.statusCode, 200);
//   await app.close();

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../src/server.js';
import { closeDb } from '../src/db/index.js';

export async function buildTestApp() {
  const dir = mkdtempSync(join(tmpdir(), 'unsent-test-'));
  const dbPath = join(dir, 'test.db');
  const app = await build({ dbPath, logger: false });
  // Attach the temp dir so the caller can clean up.
  app.testTmpDir = dir;
  app.cleanup = async () => {
    try { await app.close(); } catch {}
    try { closeDb(); } catch {}
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  };
  return app;
}

export function uuid() {
  // RFC 4122 v4 — we just need the format for zod's .uuid() validator.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function authedInject(app, { method = 'GET', url, headers = {}, payload, query }) {
  // Fastify 5 rejects bodyless methods that carry a JSON content-type
  // (FST_ERR_CTP_EMPTY_JSON_BODY). Mirror what real HTTP clients do:
  // only attach content-type when we're actually sending a body.
  const h = { ...headers };
  if (payload !== undefined) h['content-type'] = h['content-type'] || 'application/json';
  return app.inject({
    method,
    url,
    headers: h,
    ...(payload !== undefined ? { payload } : {}),
    ...(query ? { query } : {}),
  });
}
