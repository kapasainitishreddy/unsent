import { z } from 'zod';
import * as db from '../db/index.js';
import { uuid, nowMs, localDay, withBody, withParams, logDelete } from '../util.js';

const logSchema = z.object({
  mood:          z.string().min(1).max(40),
  intensity:     z.number().int().min(1).max(10),
  triggers:      z.array(z.string().max(40)).max(20).optional(),
  notes:         z.string().max(2000).optional(),
  logged_for_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const idParam = z.object({ id: z.string().uuid() });

export default async function (fastify) {
  // GET /api/mood — list recent
  fastify.get('/api/mood', async (req) => {
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const rows = db.all(
      `SELECT * FROM mood_checkins WHERE user_id = ?
       ORDER BY created_at DESC LIMIT ?`,
      [req.userId, limit]
    );
    return { checkins: rows };
  });

  // GET /api/mood/today — latest for today
  fastify.get('/api/mood/today', async (req) => {
    const day = localDay();
    const m = db.get(
      `SELECT * FROM mood_checkins WHERE user_id = ? AND logged_for_day = ? ORDER BY created_at DESC LIMIT 1`,
      [req.userId, day]
    );
    return { checkin: m || null, day };
  });

  // GET /api/mood/week — last 7 days
  fastify.get('/api/mood/week', async (req) => {
    const weekAgo = nowMs() - 7 * 24 * 60 * 60 * 1000;
    const rows = db.all(
      `SELECT * FROM mood_checkins WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC`,
      [req.userId, weekAgo]
    );
    return { checkins: rows, since: weekAgo };
  });

  // POST /api/mood — log a check-in
  fastify.post('/api/mood', withBody(logSchema, async (req, reply, d) => {
    const id = uuid();
    const now = nowMs();
    const day = d.logged_for_day || localDay(now);
    db.run(
      `INSERT INTO mood_checkins (id, user_id, mood, intensity, triggers, notes, logged_for_day, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [id, req.userId, d.mood, d.intensity, JSON.stringify(d.triggers || []), d.notes || null, day, now]
    );
    return reply.code(201).send(db.get(`SELECT * FROM mood_checkins WHERE id = ?`, [id]));
  }));

  // DELETE /api/mood/:id
  fastify.delete('/api/mood/:id', withParams(idParam, async (req, reply, { id }) => {
    const m = db.get(`SELECT id FROM mood_checkins WHERE id = ? AND user_id = ?`, [id, req.userId]);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    logDelete(db, { userId: req.userId, what: 'mood', how: 'user_action' });
    db.run(`DELETE FROM mood_checkins WHERE id = ?`, [id]);
    return { ok: true };
  }));
}
