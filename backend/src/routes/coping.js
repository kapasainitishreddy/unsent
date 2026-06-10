import { z } from 'zod';
import * as db from '../db/index.js';
import { uuid, nowMs, localDay, withBody } from '../util.js';

const logSchema = z.object({
  tool:          z.string().min(1).max(60),
  duration_sec:  z.number().int().min(0).max(60 * 60 * 4),
  completed:     z.boolean().optional(),
  helpful_score: z.number().int().min(1).max(5).nullable().optional(),
  logged_for_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export default async function (fastify) {
  // GET /api/coping — list recent sessions
  fastify.get('/api/coping', async (req) => {
    const rows = db.all(
      `SELECT * FROM coping_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
      [req.userId]
    );
    return { sessions: rows };
  });

  // POST /api/coping — log a session
  fastify.post('/api/coping', withBody(logSchema, async (req, reply, d) => {
    const now = nowMs();
    const id = uuid();
    const day = d.logged_for_day || localDay(now);
    db.run(
      `INSERT INTO coping_sessions (id, user_id, tool, duration_sec, completed, helpful_score, logged_for_day, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [id, req.userId, d.tool, d.duration_sec, d.completed ? 1 : 0, d.helpful_score || null, day, now]
    );
    return reply.code(201).send(db.get(`SELECT * FROM coping_sessions WHERE id = ?`, [id]));
  }));
}
