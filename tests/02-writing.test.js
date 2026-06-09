// Vents, unsent, journal — the "writing" surface of the app.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, authedInject, uuid } from './helpers.js';

let app;
afterEach(async () => { if (app) await app.cleanup(); app = null; });

// --- vents ---

test('POST /api/vents creates a vent and returns it', async () => {
  app = await buildTestApp();
  const res = await authedInject(app, {
    method: 'POST', url: '/api/vents',
    payload: { body: 'I am so angry right now.', mood_at_vent: 'angry' },
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.body, 'I am so angry right now.');
  assert.equal(body.mood_at_vent, 'angry');
  assert.equal(body.user_id, 'local_user');
});

test('GET /api/vents lists user vents newest first', async () => {
  app = await buildTestApp();
  await authedInject(app, { method: 'POST', url: '/api/vents', payload: { body: 'first' } });
  await new Promise(r => setTimeout(r, 5));  // ensure created_at differs
  await authedInject(app, { method: 'POST', url: '/api/vents', payload: { body: 'second' } });
  const res = await authedInject(app, { method: 'GET', url: '/api/vents' });
  const body = JSON.parse(res.body);
  assert.equal(body.vents.length, 2);
  assert.equal(body.vents[0].body, 'second');
  assert.equal(body.vents[1].body, 'first');
});

test('PATCH /api/vents/:id updates fields and bumps updated_at', async () => {
  app = await buildTestApp();
  const create = JSON.parse((await authedInject(app, {
    method: 'POST', url: '/api/vents', payload: { body: 'a' },
  })).body);
  const before = create.updated_at;
  await new Promise(r => setTimeout(r, 5));
  const res = await authedInject(app, {
    method: 'PATCH', url: `/api/vents/${create.id}`, payload: { intent: 'release', released: true },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.intent, 'release');
  assert.equal(body.released, 1);
  assert.ok(body.updated_at >= before);
});

test('DELETE /api/vents/:id removes the vent', async () => {
  app = await buildTestApp();
  const create = JSON.parse((await authedInject(app, {
    method: 'POST', url: '/api/vents', payload: { body: 'temp' },
  })).body);
  const del = await authedInject(app, { method: 'DELETE', url: `/api/vents/${create.id}` });
  assert.equal(del.statusCode, 200);
  assert.equal(JSON.parse(del.body).ok, true);
  const get = await authedInject(app, { method: 'GET', url: `/api/vents/${create.id}` });
  assert.equal(get.statusCode, 404);
});

test('free-tier vent quota blocks after 3 vents/day', async () => {
  app = await buildTestApp();
  for (let i = 0; i < 3; i++) {
    const r = await authedInject(app, { method: 'POST', url: '/api/vents', payload: { body: `v${i}` } });
    assert.equal(r.statusCode, 201, `vent ${i} should succeed`);
  }
  const r4 = await authedInject(app, { method: 'POST', url: '/api/vents', payload: { body: 'fourth' } });
  assert.equal(r4.statusCode, 402);
  const body = JSON.parse(r4.body);
  assert.equal(body.error, 'free_tier_limit_reached');
  assert.equal(body.limit, 3);
});

test('premium=1 bypasses free vent quota', async () => {
  app = await buildTestApp();
  // Bump to premium via settings — schema is z.boolean(), so send `true`
  const sp = await authedInject(app, { method: 'PATCH', url: '/api/settings', payload: { premium: true } });
  assert.equal(sp.statusCode, 200, `settings patch should succeed, got ${sp.statusCode} ${sp.body}`);
  for (let i = 0; i < 5; i++) {
    const r = await authedInject(app, { method: 'POST', url: '/api/vents', payload: { body: `v${i}` } });
    assert.equal(r.statusCode, 201, `vent ${i} should succeed for premium`);
  }
});

test('POST /api/vents rejects empty body', async () => {
  app = await buildTestApp();
  const r = await authedInject(app, { method: 'POST', url: '/api/vents', payload: { body: '' } });
  assert.equal(r.statusCode, 400);
});

// --- unsent ---

test('POST /api/unsent creates a message and lists it', async () => {
  app = await buildTestApp();
  const r = await authedInject(app, {
    method: 'POST', url: '/api/unsent',
    payload: { shape: 'breakup', body: 'I will never send this to them.' },
  });
  assert.equal(r.statusCode, 201);
  const list = await authedInject(app, { method: 'GET', url: '/api/unsent' });
  const body = JSON.parse(list.body);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].shape, 'breakup');
  assert.equal(body.messages[0].body, 'I will never send this to them.');
  assert.equal(body.messages[0].outcome, 'private');
});

test('PATCH /api/unsent/:id can change outcome to deleted', async () => {
  app = await buildTestApp();
  const create = JSON.parse((await authedInject(app, {
    method: 'POST', url: '/api/unsent', payload: { shape: 'angry', body: 'x' },
  })).body);
  const update = await authedInject(app, {
    method: 'PATCH', url: `/api/unsent/${create.id}`,
    payload: { outcome: 'deleted' },
  });
  assert.equal(update.statusCode, 200);
  assert.equal(JSON.parse(update.body).outcome, 'deleted');
});

test('GET /api/unsent?outcome=private filters correctly', async () => {
  app = await buildTestApp();
  const a = JSON.parse((await authedInject(app, {
    method: 'POST', url: '/api/unsent', payload: { shape: 'angry', body: 'a' },
  })).body);
  await authedInject(app, {
    method: 'POST', url: '/api/unsent', payload: { shape: 'work', body: 'b' },
  });
  await authedInject(app, {
    method: 'PATCH', url: `/api/unsent/${a.id}`, payload: { outcome: 'deleted' },
  });
  const priv = await authedInject(app, { method: 'GET', url: '/api/unsent?outcome=private' });
  const del  = await authedInject(app, { method: 'GET', url: '/api/unsent?outcome=deleted' });
  assert.equal(JSON.parse(priv.body).messages.length, 1);
  assert.equal(JSON.parse(del.body).messages.length, 1);
});

test('POST /api/unsent requires a valid shape', async () => {
  app = await buildTestApp();
  const r = await authedInject(app, {
    method: 'POST', url: '/api/unsent', payload: { shape: 'not-a-shape', body: 'x' },
  });
  assert.equal(r.statusCode, 400);
});

// --- journal ---

test('POST /api/journal requires non-empty body, GET returns it', async () => {
  app = await buildTestApp();
  const empty = await authedInject(app, {
    method: 'POST', url: '/api/journal', payload: { body: '' },
  });
  assert.equal(empty.statusCode, 400);

  const create = await authedInject(app, {
    method: 'POST', url: '/api/journal', payload: { body: 'Today I noticed...', mood_at_write: 'sad' },
  });
  assert.equal(create.statusCode, 201);
  const list = await authedInject(app, { method: 'GET', url: '/api/journal' });
  const body = JSON.parse(list.body);
  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0].body, 'Today I noticed...');
  assert.equal(body.entries[0].mood_at_write, 'sad');
});
