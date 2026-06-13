import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp } from './helpers.js';

const AUTH = { authorization: 'Bearer dev' };
const JSON_AUTH = { 'content-type': 'application/json', authorization: 'Bearer dev' };

function post(app, url, payload) {
  return app.inject({ method: 'POST', url, headers: JSON_AUTH, payload });
}
function get(app, url) {
  return app.inject({ method: 'GET', url, headers: AUTH });
}

// ---------------- No-Contact Tracker ----------------
test('no-contact: starts, reports days, resets, stops', async () => {
  const app = await buildTestApp();

  let res = await get(app, '/api/heartbreak/no-contact');
  assert.equal(JSON.parse(res.body).tracking, false);

  res = await post(app, '/api/heartbreak/no-contact', { label: 'them' });
  let body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.tracking, true);
  assert.equal(body.label, 'them');
  assert.equal(body.days, 0);
  assert.equal(body.reset_count, 0);

  // Relapse → reset bumps the counter, keeps the longest run.
  res = await post(app, '/api/heartbreak/no-contact/reset', {});
  body = JSON.parse(res.body);
  assert.equal(body.reset_count, 1);
  assert.ok(body.last_reset_at);

  // Stop tracking.
  res = await app.inject({ method: 'DELETE', url: '/api/heartbreak/no-contact', headers: AUTH });
  assert.equal(JSON.parse(res.body).tracking, false);

  res = await get(app, '/api/heartbreak/no-contact');
  assert.equal(JSON.parse(res.body).tracking, false);

  await app.cleanup();
});

test('no-contact: reset before tracking is a 404', async () => {
  const app = await buildTestApp();
  const res = await post(app, '/api/heartbreak/no-contact/reset', {});
  assert.equal(res.statusCode, 404);
  await app.cleanup();
});

// ---------------- Items ----------------
test('items: create, list by kind, patch, delete', async () => {
  const app = await buildTestApp();

  const r1 = await post(app, '/api/heartbreak/items', { kind: 'reason', body: 'They never listened' });
  assert.equal(r1.statusCode, 200);
  const id = JSON.parse(r1.body).id;

  await post(app, '/api/heartbreak/items', { kind: 'standard', body: 'Someone who texts back' });

  // Filter by kind.
  let res = await get(app, '/api/heartbreak/items?kind=reason');
  let items = JSON.parse(res.body).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'reason');

  // Unfiltered returns both.
  res = await get(app, '/api/heartbreak/items');
  assert.equal(JSON.parse(res.body).items.length, 2);

  // Patch: seal a memory-style flag and edit body.
  res = await app.inject({
    method: 'PATCH', url: `/api/heartbreak/items/${id}`, headers: JSON_AUTH,
    payload: { body: 'They never really listened', sealed: true },
  });
  assert.equal(res.statusCode, 200);
  res = await get(app, '/api/heartbreak/items?kind=reason');
  items = JSON.parse(res.body).items;
  assert.equal(items[0].body, 'They never really listened');
  assert.equal(items[0].sealed, 1);

  // Delete.
  res = await app.inject({ method: 'DELETE', url: `/api/heartbreak/items/${id}`, headers: AUTH });
  assert.equal(res.statusCode, 200);
  res = await get(app, '/api/heartbreak/items?kind=reason');
  assert.equal(JSON.parse(res.body).items.length, 0);

  await app.cleanup();
});

test('items: rejects unknown kind', async () => {
  const app = await buildTestApp();
  const res = await post(app, '/api/heartbreak/items', { kind: 'nope', body: 'x' });
  assert.equal(res.statusCode, 400);
  await app.cleanup();
});

// ---------------- Timed letters ----------------
test('letters: future letter withholds body until due', async () => {
  const app = await buildTestApp();

  const r = await post(app, '/api/heartbreak/letters', { body: 'Dear future me', deliver_in_days: 30 });
  assert.equal(r.statusCode, 200);
  const id = JSON.parse(r.body).id;

  // Listing a not-yet-due letter hides the body.
  let res = await get(app, '/api/heartbreak/letters');
  let body = JSON.parse(res.body);
  assert.equal(body.letters.length, 1);
  assert.equal(body.letters[0].due, false);
  assert.equal(body.letters[0].body, null);
  assert.equal(body.due_count, 0);

  // Opening early is forbidden.
  res = await post(app, `/api/heartbreak/letters/${id}/open`, {});
  assert.equal(res.statusCode, 403);

  await app.cleanup();
});

test('letters: a due letter can be opened and reveals its body', async () => {
  const app = await buildTestApp();

  // deliver_at in the past is rejected by the scheduler...
  let res = await post(app, '/api/heartbreak/letters', { body: 'hi', deliver_at: Date.now() - 1000 });
  assert.equal(res.statusCode, 400);

  // ...so schedule ~1s out and wait for it to come due.
  const at = Date.now() + 60;
  res = await post(app, '/api/heartbreak/letters', { body: 'You made it', deliver_at: at });
  const id = JSON.parse(res.body).id;
  await new Promise((r) => setTimeout(r, 120));

  res = await get(app, '/api/heartbreak/letters');
  let body = JSON.parse(res.body);
  assert.equal(body.letters[0].due, true);
  assert.equal(body.letters[0].body, 'You made it');
  assert.equal(body.due_count, 1);

  res = await post(app, `/api/heartbreak/letters/${id}/open`, {});
  body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.body, 'You made it');
  assert.ok(body.delivered_at);

  await app.cleanup();
});

test('letters: requires a delivery time', async () => {
  const app = await buildTestApp();
  const res = await post(app, '/api/heartbreak/letters', { body: 'no time given' });
  assert.equal(res.statusCode, 400);
  await app.cleanup();
});

// ---------------- Recovery roadmap ----------------
test('roadmap: not started until no-contact is tracking, then day 0 stage', async () => {
  const app = await buildTestApp();

  let res = await get(app, '/api/heartbreak/roadmap');
  assert.equal(JSON.parse(res.body).started, false);

  await post(app, '/api/heartbreak/no-contact', { label: 'them' });

  res = await get(app, '/api/heartbreak/roadmap');
  const body = JSON.parse(res.body);
  assert.equal(body.started, true);
  assert.equal(body.day, 0);
  assert.equal(body.stage, 'raw');
  assert.equal(body.stage_index, 0);
  assert.equal(body.stages.length, body.total_stages);
  assert.equal(body.stages[0].current, true);

  await app.cleanup();
});
