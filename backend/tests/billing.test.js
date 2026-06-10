import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, authedInject } from './helpers.js';

test('POST /api/billing/webhook — initial purchase grants premium', async () => {
  const app = await buildTestApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    headers: { 'content-type': 'application/json' },
    payload: {
      event: {
        type: 'INITIAL_PURCHASE',
        app_user_id: 'local_user',
        product_id: 'unsent_premium_monthly',
        entitlement_ids: ['premium'],
        expiration_at_ms: Date.now() + 30 * 24 * 3600 * 1000,
      },
    },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.premium, true);
  assert.equal(body.mapped, true);

  const me = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { authorization: 'Bearer dev' },
  });
  const meBody = JSON.parse(me.body);
  assert.equal(meBody.settings.premium, 1);
  await app.close();
});

test('POST /api/billing/webhook — cancellation revokes premium', async () => {
  const app = await buildTestApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    headers: { 'content-type': 'application/json' },
    payload: {
      event: {
        type: 'CANCELLATION',
        app_user_id: 'local_user',
        product_id: 'unsent_premium_monthly',
        entitlement_ids: [],
      },
    },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.premium, false);
  await app.close();
});

test('POST /api/billing/webhook — expiration_at_ms in past revokes premium', async () => {
  const app = await buildTestApp();
  // Grant first
  await app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    headers: { 'content-type': 'application/json' },
    payload: {
      event: {
        type: 'RENEWAL',
        app_user_id: 'local_user',
        product_id: 'unsent_premium_monthly',
        entitlement_ids: ['premium'],
        expiration_at_ms: Date.now() + 30 * 24 * 3600 * 1000,
      },
    },
  });
  // Then send an expired event
  const res = await app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    headers: { 'content-type': 'application/json' },
    payload: {
      event: {
        type: 'RENEWAL',
        app_user_id: 'local_user',
        product_id: 'unsent_premium_monthly',
        entitlement_ids: ['premium'],
        expiration_at_ms: Date.now() - 1000,
      },
    },
  });
  const body = JSON.parse(res.body);
  assert.equal(body.premium, false);
  await app.close();
});

test('POST /api/billing/webhook — no user id (test event) is acknowledged', async () => {
  const app = await buildTestApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    headers: { 'content-type': 'application/json' },
    payload: { event: { type: 'TEST' } },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.mapped, false);
  assert.equal(body.reason, 'no_app_user_id');
  await app.close();
});

test('POST /api/billing/webhook — malformed payload returns 400', async () => {
  const app = await buildTestApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    headers: { 'content-type': 'application/json' },
    payload: { wrong: 'shape' },
  });
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.error, 'invalid_payload');
  await app.close();
});
