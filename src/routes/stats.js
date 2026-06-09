import * as db from '../db/index.js';
import { nowMs, localDay } from '../util.js';

export default async function (fastify) {
  fastify.get('/api/home', async (req) => {
    const now = nowMs();
    const day = localDay(now);

    const vents_today = db.get(
      `SELECT COUNT(*) AS n FROM vent_rooms WHERE user_id = ? AND created_at >= ?`,
      [req.userId, now - 24*60*60*1000]
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

    const weekAgo = now - 7*24*60*60*1000;
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
      quota: { used: settings.free_vent_count, limit: 3, premium: !!settings.premium, reset_at: settings.free_vent_reset_at },
    };
  });
}
