import * as db from '../db/index.js';
import { nowMs, localDay } from '../util.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// 'YYYY-MM-DD' (local) -> integer day number, for consecutive-day math.
function dayIndex(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

// The set of local days on which the user did real emotional work. We count
// the surfaces that take intention (vent, unsent, journal, mood, gratitude,
// coping) and skip auto-seeded rows like preset affirmations.
function activeDays(userId) {
  const rows = db.all(
    `SELECT DISTINCT d FROM (
       SELECT logged_for_day d FROM mood_checkins   WHERE user_id = ?
       UNION SELECT logged_for_day FROM coping_sessions WHERE user_id = ?
       UNION SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'localtime') FROM vent_rooms        WHERE user_id = ?
       UNION SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'localtime') FROM unsent_messages   WHERE user_id = ?
       UNION SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'localtime') FROM journal_entries   WHERE user_id = ?
       UNION SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'localtime') FROM gratitude_entries WHERE user_id = ?
     ) WHERE d IS NOT NULL`,
    [userId, userId, userId, userId, userId, userId]
  );
  return rows.map((r) => r.d);
}

// Current streak counts consecutive days ending today; if nothing's logged yet
// today the streak is still "alive" (anchored on yesterday) until midnight.
export function computeStreak(dayStrings, todayStr = localDay()) {
  const set = new Set(dayStrings.map(dayIndex));
  const today = dayIndex(todayStr);

  const todayActive = set.has(today);
  let current = 0;
  let anchor = todayActive ? today : (set.has(today - 1) ? today - 1 : null);
  if (anchor !== null) { current = 1; while (set.has(anchor - current)) current += 1; }

  let longest = 0;
  const sorted = [...set].sort((a, b) => a - b);
  let run = 0, prev = null;
  for (const idx of sorted) {
    run = (prev !== null && idx === prev + 1) ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = idx;
  }

  const week = [];
  for (let i = 6; i >= 0; i--) week.push({ offset: i, active: set.has(today - i) });

  return {
    current,
    longest,
    today_active: todayActive,
    total_active_days: set.size,
    week,
  };
}

export default async function (fastify) {
  fastify.get('/api/streak', async (req) => computeStreak(activeDays(req.userId)));

  fastify.get('/api/home', async (req) => {
    const now = nowMs();
    const day = localDay(now);

    const vents_today = db.get(
      `SELECT COUNT(*) AS n FROM vent_rooms WHERE user_id = ? AND created_at >= ?`,
      [req.userId, now - DAY_MS]
    ).n;
    const recent_vents = db.all(
      `SELECT id, title, body, mood_at_vent, created_at FROM vent_rooms WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
      [req.userId]
    ).map(v => ({ ...v, preview: (v.body || '').slice(0, 80) }));

    const recent_journal = db.all(
      `SELECT id, kind, body, created_at FROM journal_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
      [req.userId]
    ).map(j => ({ ...j, preview: (j.body || '').slice(0, 80) }));

    const today_mood = db.get(
      `SELECT mood, intensity, created_at FROM mood_checkins WHERE user_id = ? AND logged_for_day = ? ORDER BY created_at DESC LIMIT 1`,
      [req.userId, day]
    );

    const weekAgo = now - 7 * DAY_MS;
    const week = db.all(
      `SELECT mood, intensity FROM mood_checkins WHERE user_id = ? AND created_at >= ?`,
      [req.userId, weekAgo]
    );
    const moodCounts = {};
    for (const w of week) moodCounts[w.mood] = (moodCounts[w.mood] || 0) + 1;
    const topMoods = Object.entries(moodCounts).sort((a,b) => b[1]-a[1]).slice(0, 3).map(([mood, n]) => ({ mood, count: n }));

    const settings = db.get(`SELECT free_vent_count, premium, free_vent_reset_at FROM settings WHERE user_id = ?`, [req.userId]);

    return {
      today_mood: today_mood || null,
      vents_today,
      recent_vents,
      recent_journal,
      week_summary: { count: week.length, top_moods: topMoods },
      streak: computeStreak(activeDays(req.userId), day),
      quota: { used: settings.free_vent_count, limit: 3, premium: !!settings.premium, reset_at: settings.free_vent_reset_at },
    };
  });
}
