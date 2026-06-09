// Export, wipe — the "data sovereignty" surface.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, authedInject } from './helpers.js';

let app;
afterEach(async () => { if (app) await app.cleanup(); app = null; });

test('GET /api/export returns a complete JSON bundle of the user data', async () => {
  app = await buildTestApp();
  // Seed a bit of data
  await authedInject(app, {
    method: 'POST', url: '/api/affirmations/seed-presets',
  });
  await authedInject(app, {
    method: 'POST', url: '/api/vents', payload: { body: 'export me', mood_at_vent: 'sad' },
  });

  const res = await authedInject(app, { method: 'GET', url: '/api/export' });
  assert.equal(res.statusCode, 200);
  const ct = res.headers['content-type'] || '';
  assert.ok(ct.includes('json'), `expected JSON, got ${ct}`);
  const body = JSON.parse(res.body);
  assert.equal(body.user_id, 'local_user');
  assert.ok(Array.isArray(body.affirmations));
  assert.ok(body.affirmations.length >= 15, `expected >=15 affirmations, got ${body.affirmations.length}`);
  assert.ok(Array.isArray(body.vent_rooms));
  assert.ok(body.vent_rooms.length >= 1, `expected >=1 vent, got ${body.vent_rooms.length}`);
  assert.ok(body.exported_at);
});

test('POST /api/wipe requires confirm=DELETE', async () => {
  app = await buildTestApp();
  // Missing confirm body — expect 400
  const r1 = await authedInject(app, { method: 'POST', url: '/api/wipe' });
  assert.equal(r1.statusCode, 400);
  // Wrong value — still 400
  const r2 = await authedInject(app, { method: 'POST', url: '/api/wipe', payload: { confirm: true } });
  assert.equal(r2.statusCode, 400);
});

test('POST /api/wipe with confirm=DELETE wipes all user data but keeps settings', async () => {
  app = await buildTestApp();
  await authedInject(app, { method: 'POST', url: '/api/affirmations/seed-presets' });
  await authedInject(app, { method: 'POST', url: '/api/vents', payload: { body: 'bye' } });

  const wipe = await authedInject(app, {
    method: 'POST', url: '/api/wipe', payload: { confirm: 'DELETE' },
  });
  assert.equal(wipe.statusCode, 200);
  const body = JSON.parse(wipe.body);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.wiped));

  // Vents should be gone
  const vents = await authedInject(app, { method: 'GET', url: '/api/vents' });
  assert.equal(JSON.parse(vents.body).vents.length, 0);

  // Settings should still be there
  const me = await authedInject(app, { method: 'GET', url: '/api/me' });
  assert.equal(me.statusCode, 200);
  assert.ok(JSON.parse(me.body).settings);
});
