import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, authedInject } from './helpers.js';
import { computeStreak } from '../src/routes/stats.js';

test('computeStreak — counts consecutive days ending today', () => {
  const s = computeStreak(['2026-06-11', '2026-06-12', '2026-06-13'], '2026-06-13');
  assert.equal(s.current, 3);
  assert.equal(s.longest, 3);
  assert.equal(s.today_active, true);
  assert.equal(s.total_active_days, 3);
});

test('computeStreak — yesterday keeps the streak alive before today is logged', () => {
  const s = computeStreak(['2026-06-11', '2026-06-12'], '2026-06-13');
  assert.equal(s.current, 2);          // still alive, anchored on yesterday
  assert.equal(s.today_active, false);
});

test('computeStreak — a gap of two days breaks the current streak', () => {
  const s = computeStreak(['2026-06-09', '2026-06-10'], '2026-06-13');
  assert.equal(s.current, 0);
  assert.equal(s.longest, 2);
});

test('computeStreak — longest is the best run, not the current one', () => {
  const s = computeStreak(['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-13'], '2026-06-13');
  assert.equal(s.current, 1);
  assert.equal(s.longest, 3);
  assert.equal(s.week.length, 7);
});

test('computeStreak — no activity is an empty streak', () => {
  const s = computeStreak([], '2026-06-13');
  assert.equal(s.current, 0);
  assert.equal(s.longest, 0);
  assert.equal(s.today_active, false);
});

test('GET /api/streak — reflects real activity', async () => {
  const app = await buildTestApp();
  try {
    let res = await authedInject(app, { url: '/api/streak', headers: { authorization: 'Bearer dev' } });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).current, 0);

    // Log a mood today -> today becomes active, streak is 1.
    res = await authedInject(app, {
      method: 'POST', url: '/api/mood',
      headers: { authorization: 'Bearer dev' },
      payload: { mood: 'sad', intensity: 3 },
    });
    assert.ok(res.statusCode === 200 || res.statusCode === 201, res.body);

    res = await authedInject(app, { url: '/api/streak', headers: { authorization: 'Bearer dev' } });
    const s = JSON.parse(res.body);
    assert.equal(s.current, 1);
    assert.equal(s.today_active, true);
    assert.equal(s.week.at(-1).active, true);
  } finally {
    await app.cleanup();
  }
});
