// Mood, affirmations, intentions, coping — the "feel better" surface.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, authedInject } from './helpers.js';

let app;
afterEach(async () => { if (app) await app.cleanup(); app = null; });

// --- mood ---

test('POST /api/mood records a check-in and GET returns it', async () => {
  app = await buildTestApp();
  const r = await authedInject(app, {
    method: 'POST', url: '/api/mood',
    payload: { mood: 'anxious', intensity: 6, notes: 'tight chest' },
  });
  assert.equal(r.statusCode, 201);
  const list = await authedInject(app, { method: 'GET', url: '/api/mood' });
  const body = JSON.parse(list.body);
  assert.ok(body.checkins.length >= 1);
  assert.equal(body.checkins[0].mood, 'anxious');
  assert.equal(body.checkins[0].notes, 'tight chest');
});

test('DELETE /api/mood/:id removes a check-in', async () => {
  app = await buildTestApp();
  const create = JSON.parse((await authedInject(app, {
    method: 'POST', url: '/api/mood', payload: { mood: 'sad', intensity: 4 },
  })).body);
  const del = await authedInject(app, { method: 'DELETE', url: `/api/mood/${create.id}` });
  assert.equal(del.statusCode, 200);
  assert.equal(JSON.parse(del.body).ok, true);
  const list = JSON.parse((await authedInject(app, { method: 'GET', url: '/api/mood' })).body);
  assert.equal(list.checkins.find(e => e.id === create.id), undefined);
});

// --- affirmations ---

test('POST /api/affirmations/seed-presets is idempotent', async () => {
  app = await buildTestApp();
  const a = await authedInject(app, { method: 'POST', url: '/api/affirmations/seed-presets' });
  const b = await authedInject(app, { method: 'POST', url: '/api/affirmations/seed-presets' });
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  const added1 = JSON.parse(a.body).added;
  const added2 = JSON.parse(b.body).added;
  assert.ok(added1 >= 15, `expected >=15 first run, got ${added1}`);
  assert.equal(added2, 0, 'second run should be a no-op');
});

test('GET /api/affirmations?mood=anxious filters by mood_filter', async () => {
  app = await buildTestApp();
  await authedInject(app, { method: 'POST', url: '/api/affirmations/seed-presets' });
  const r = await authedInject(app, { method: 'GET', url: '/api/affirmations?mood=anxious' });
  const body = JSON.parse(r.body);
  assert.ok(body.affirmations.length >= 1);
  assert.ok(body.affirmations.every(a => a.mood_filter === 'anxious'));
  assert.ok(Array.isArray(body.categories));
});

test('PATCH /api/affirmations/:id can favorite', async () => {
  app = await buildTestApp();
  await authedInject(app, { method: 'POST', url: '/api/affirmations/seed-presets' });
  const list = JSON.parse((await authedInject(app, { method: 'GET', url: '/api/affirmations' })).body);
  const target = list.affirmations[0];
  const fav = await authedInject(app, {
    method: 'PATCH', url: `/api/affirmations/${target.id}`, payload: { favorited: true },
  });
  assert.equal(fav.statusCode, 200);
  assert.equal(JSON.parse(fav.body).favorited, 1);
});

// --- intentions ---

test('POST /api/intentions creates, PATCH toggles active', async () => {
  app = await buildTestApp();
  const create = JSON.parse((await authedInject(app, {
    method: 'POST', url: '/api/intentions',
    payload: { kind: 'daily', body: 'Take a walk' },
  })).body);
  assert.equal(create.body, 'Take a walk');
  assert.equal(create.active, 1);

  const done = await authedInject(app, {
    method: 'PATCH', url: `/api/intentions/${create.id}`, payload: { active: false },
  });
  assert.equal(JSON.parse(done.body).active, 0);
});

// --- coping ---

test('GET /api/coping returns empty sessions list, POST records one', async () => {
  app = await buildTestApp();
  const list = await authedInject(app, { method: 'GET', url: '/api/coping' });
  const body = JSON.parse(list.body);
  assert.ok(Array.isArray(body.sessions));
  assert.equal(body.sessions.length, 0);

  const use = await authedInject(app, {
    method: 'POST', url: '/api/coping',
    payload: { tool: 'breath_4_7_8', duration_sec: 90 },
  });
  assert.equal(use.statusCode, 201);
  const created = JSON.parse(use.body);
  assert.equal(created.tool, 'breath_4_7_8');
  assert.equal(created.duration_sec, 90);

  // Now list shows it
  const list2 = JSON.parse((await authedInject(app, { method: 'GET', url: '/api/coping' })).body);
  assert.equal(list2.sessions.length, 1);
});
