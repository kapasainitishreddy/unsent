// AI companion + crisis-check — the safety surface.
// These run in mock mode (no API keys) so we can assert the shape.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, authedInject } from './helpers.js';

let app;
afterEach(async () => { if (app) await app.cleanup(); app = null; });

test('GET /api/ai/status is public and reports mock mode without keys', async () => {
  app = await buildTestApp();
  const res = await app.inject({ method: 'GET', url: '/api/ai/status' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.has_openrouter, false);
  assert.equal(body.has_groq, false);
});

test('POST /api/ai/companion returns a non-empty reply in mock mode', async () => {
  app = await buildTestApp();
  const r = await authedInject(app, {
    method: 'POST', url: '/api/ai/companion',
    payload: { text: 'I had a rough day.', mood: 'sad' },
  });
  assert.equal(r.statusCode, 200);
  const body = JSON.parse(r.body);
  assert.ok(body.text.length > 20, 'mock reply should be a real sentence, not a stub');
  assert.equal(body.kind, 'mock');
  assert.ok(Array.isArray(body.soft_flags));
});

test('POST /api/ai/companion requires a message', async () => {
  app = await buildTestApp();
  const r = await authedInject(app, {
    method: 'POST', url: '/api/ai/companion', payload: { text: '' },
  });
  assert.equal(r.statusCode, 400);
});

test('POST /api/ai/crisis-check flags suicidal content', async () => {
  app = await buildTestApp();
  const r = await authedInject(app, {
    method: 'POST', url: '/api/ai/crisis-check',
    payload: { text: 'I want to kill myself tonight' },
  });
  assert.equal(r.statusCode, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.crisis, true);
  assert.equal(body.category, 'suicide');
  assert.ok(Array.isArray(body.resources));
  assert.ok(body.resources.length > 0);
  assert.equal(body.resources[0].name, '988 Suicide & Crisis Lifeline');
});

test('POST /api/ai/crisis-check returns no crisis for benign text', async () => {
  app = await buildTestApp();
  const r = await authedInject(app, {
    method: 'POST', url: '/api/ai/crisis-check',
    payload: { text: 'I had a nice walk in the park.' },
  });
  assert.equal(r.statusCode, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.crisis, false);
  assert.ok(Array.isArray(body.soft_flags));
});

test('POST /api/ai/crisis-check detects self-harm language', async () => {
  app = await buildTestApp();
  const r = await authedInject(app, {
    method: 'POST', url: '/api/ai/crisis-check',
    payload: { text: 'I want to hurt myself right now' },
  });
  const body = JSON.parse(r.body);
  assert.equal(body.crisis, true);
  assert.equal(body.category, 'self_harm');
});
