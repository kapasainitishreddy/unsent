import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp } from './helpers.js';

test('POST /api/gratitude adds a new entry', async () => {
  const app = await buildTestApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/gratitude',
    headers: { 'content-type': 'application/json', authorization: 'Bearer dev' },
    payload: { text: 'My friend made me laugh today', tag: 'person' },
  });
  console.log('RESP:', res.statusCode, res.body);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.ok(body.id);
  assert.ok(body.created_at);
  await app.close();
});

test('GET /api/gratitude lists entries newest first', async () => {
  const app = await buildTestApp();
  // Insert two
  await app.inject({
    method: 'POST', url: '/api/gratitude',
    headers: { 'content-type': 'application/json', authorization: 'Bearer dev' },
    payload: { text: 'first' },
  });
  await new Promise(r => setTimeout(r, 5));
  await app.inject({
    method: 'POST', url: '/api/gratitude',
    headers: { 'content-type': 'application/json', authorization: 'Bearer dev' },
    payload: { text: 'second' },
  });
  const res = await app.inject({
    method: 'GET', url: '/api/gratitude',
    headers: { authorization: 'Bearer dev' },
  });
  const body = JSON.parse(res.body);
  assert.equal(body.entries.length, 2);
  assert.equal(body.entries[0].text, 'second', 'newest first');
  assert.equal(body.entries[1].text, 'first');
  await app.close();
});

test('POST /api/gratitude rejects empty text', async () => {
  const app = await buildTestApp();
  const res = await app.inject({
    method: 'POST', url: '/api/gratitude',
    headers: { 'content-type': 'application/json', authorization: 'Bearer dev' },
    payload: { text: '' },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('GET /api/gratitude/garden returns stage for each entry', async () => {
  const app = await buildTestApp();
  const post = await app.inject({
    method: 'POST', url: '/api/gratitude',
    headers: { 'content-type': 'application/json', authorization: 'Bearer dev' },
    payload: { text: 'a quiet moment', tag: 'moment' },
  });
  const { id } = JSON.parse(post.body);
  const res = await app.inject({
    method: 'GET', url: '/api/gratitude/garden',
    headers: { authorization: 'Bearer dev' },
  });
  const body = JSON.parse(res.body);
  assert.equal(body.total, 1);
  assert.equal(body.garden[0].id, id);
  assert.equal(body.garden[0].stage, 0); // just planted
  assert.equal(body.garden[0].text, 'a quiet moment');
  await app.close();
});

test('DELETE /api/gratitude/:id removes the entry', async () => {
  const app = await buildTestApp();
  const post = await app.inject({
    method: 'POST', url: '/api/gratitude',
    headers: { 'content-type': 'application/json', authorization: 'Bearer dev' },
    payload: { text: 'delete me' },
  });
  const { id } = JSON.parse(post.body);
  const del = await app.inject({
    method: 'DELETE', url: `/api/gratitude/${id}`,
    headers: { authorization: 'Bearer dev' },
  });
  assert.equal(del.statusCode, 200);
  const list = await app.inject({
    method: 'GET', url: '/api/gratitude',
    headers: { authorization: 'Bearer dev' },
  });
  assert.equal(JSON.parse(list.body).entries.length, 0);
  await app.close();
});
