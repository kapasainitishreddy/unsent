// Health, me, home, settings, avatar — the "shape" of the app.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, authedInject } from './helpers.js';

let app;
afterEach(async () => { if (app) await app.cleanup(); app = null; });

test('GET / returns server info and endpoint list', async () => {
  app = await buildTestApp();
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.name, 'unsent-backend');
  assert.equal(body.auth_mode, 'dev');
  assert.ok(Array.isArray(body.endpoints));
  assert.ok(body.endpoints.length >= 30);
});

test('GET /api/health is public and returns ok', async () => {
  app = await buildTestApp();
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);
});

test('GET /api/me resolves dev user in dev mode', async () => {
  app = await buildTestApp();
  const res = await authedInject(app, { method: 'GET', url: '/api/me' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.user_id, 'local_user');
  assert.equal(body.auth_mode, 'dev');
  assert.ok(body.settings);
  assert.equal(body.settings.user_id, 'local_user');
});

test('GET /api/settings returns default settings on first call', async () => {
  app = await buildTestApp();
  const res = await authedInject(app, { method: 'GET', url: '/api/settings' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.user_id, 'local_user');
  assert.equal(body.theme, 'dark');
  assert.equal(body.premium, 0);
  assert.equal(body.onboarding_complete, 0);
});

test('PATCH /api/settings updates only the fields provided', async () => {
  app = await buildTestApp();
  const res = await authedInject(app, {
    method: 'PATCH', url: '/api/settings',
    payload: { theme: 'light', onboarding_complete: true },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.theme, 'light');
  assert.equal(body.onboarding_complete, 1);
  // unchanged
  assert.equal(body.app_lock_enabled, 0);
  assert.equal(body.premium, 0);
});

test('PATCH /api/avatar rejects unknown source', async () => {
  app = await buildTestApp();
  const res = await authedInject(app, {
    method: 'PATCH', url: '/api/avatar',
    payload: { source: 'haX0r' },
  });
  assert.equal(res.statusCode, 400);
});

test('GET /api/avatar returns default avatar (luna)', async () => {
  app = await buildTestApp();
  const res = await authedInject(app, { method: 'GET', url: '/api/avatar' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.preset_id, 'luna');
  assert.equal(body.source, 'preset');
  assert.ok(Array.isArray(body.meta.hair_styles));
  assert.ok(Array.isArray(body.meta.glasses));
});

test('PATCH /api/avatar updates hair color', async () => {
  app = await buildTestApp();
  const res = await authedInject(app, {
    method: 'PATCH', url: '/api/avatar',
    payload: { hair_color: '#ff00aa' },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.hair_color, '#ff00aa');
  // preset_id stays as the original (luna)
  assert.equal(body.preset_id, 'luna');
});
