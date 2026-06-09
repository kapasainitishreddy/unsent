import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp } from './helpers.js';

test('GET /api/meta returns option lists (public, no auth)', async () => {
  const app = await buildTestApp();
  const res = await app.inject({ method: 'GET', url: '/api/meta' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.moods) && body.moods.length > 0, 'has moods');
  assert.ok(body.moods[0].id && body.moods[0].name && body.moods[0].emoji, 'mood shape');
  assert.ok(Array.isArray(body.skin) && body.skin[0].value?.startsWith('#'), 'has skin tones with hex value');
  assert.ok(Array.isArray(body.hair) && body.hair[0].value?.startsWith('#'), 'has hair colors with hex value');
  assert.ok(Array.isArray(body.glasses) && body.glasses.find(g => g.value === 'none'), 'has glasses');
  assert.ok(Array.isArray(body.expressions) && body.expressions.length > 0, 'has expressions');
  assert.ok(Array.isArray(body.coping_tools), 'has coping tools');
  assert.ok(Array.isArray(body.unsent_shapes) && body.unsent_shapes.includes('letter'), 'has unsent shapes');
  assert.ok(Array.isArray(body.affirmation_mood_filters), 'has mood filters');
  await app.close();
});
