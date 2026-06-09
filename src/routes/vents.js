import { z } from 'zod';
import * as db from '../db/index.js';
import { uuid, nowMs, withBody, withParams, withParamsAndBody, checkFreeVentQuota, maybeResetFreeVentCount, logDelete } from '../util.js';

const createSchema = z.object({
  title:    z.string().max(120).optional(),
  body:     z.string().min(1).max(20_000),
  mood_at_vent: z.string().max(40).optional(),
  avatar_id: z.string().max(40).optional(),
  intent:   z.enum(['release','rewrite','save','journal','breathe','delete']).optional(),
});

const updateSchema = z.object({
  title: z.string().max(120).optional(),
  body:  z.string().min(1).max(20_000).optional(),
  intent: z.enum(['release','rewrite','save','journal','breathe','delete']).optional(),
  released: z.boolean().optional(),
  saved_as_journal: z.boolean().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export default async function (fastify) {
  // GET /api/vents — list (paged)
  fastify.get('/api/vents', async (req) => {
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const offset = parseInt(req.query.offset || '0', 10) || 0;
    const rows = db.all(
      `SELECT id, title, body, mood_at_vent, avatar_id, intent, released, saved_as_journal, created_at, updated_at
         FROM vent_rooms WHERE user_id = ?
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [req.userId, limit, offset]
    );
    const total = db.get(`SELECT COUNT(*) AS n FROM vent_rooms WHERE user_id = ?`, [req.userId]).n;
    return { vents: rows, total, limit, offset };
  });

  // POST /api/vents — create (free-tier capped at 3/day)
  fastify.post('/api/vents', withBody(createSchema, async (req, reply, data) => {
    let settings = db.get(`SELECT * FROM settings WHERE user_id = ?`, [req.userId]);
    const reset = maybeResetFreeVentCount(settings);
    if (reset) {
      db.run(`UPDATE settings SET free_vent_count = ?, free_vent_reset_at = ?, updated_at = ? WHERE user_id = ?`,
        [reset.free_vent_count, reset.free_vent_reset_at, nowMs(), req.userId]);
      settings = db.get(`SELECT * FROM settings WHERE user_id = ?`, [req.userId]);
    }
    const quota = checkFreeVentQuota(settings);
    if (quota) return reply.code(quota.code).send(quota.body);

    const id = uuid();
    const now = nowMs();
    db.run(
      `INSERT INTO vent_rooms (id, user_id, title, body, mood_at_vent, avatar_id, intent, released, saved_as_journal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      [id, req.userId, data.title || null, data.body, data.mood_at_vent || null, data.avatar_id || null, data.intent || null, now, now]
    );
    if (!settings.premium) {
      db.run(`UPDATE settings SET free_vent_count = free_vent_count + 1, updated_at = ? WHERE user_id = ?`, [now, req.userId]);
    }
    return reply.code(201).send(db.get(`SELECT * FROM vent_rooms WHERE id = ?`, [id]));
  }));

  // GET /api/vents/:id
  fastify.get('/api/vents/:id', withParams(idParam, async (req, reply, { id }) => {
    const v = db.get(`SELECT * FROM vent_rooms WHERE id = ? AND user_id = ?`, [id, req.userId]);
    if (!v) return reply.code(404).send({ error: 'not_found' });
    return v;
  }));

  // PATCH /api/vents/:id
  fastify.patch('/api/vents/:id', withParamsAndBody(idParam, updateSchema, async (req, reply, { params: { id }, body: data }) => {
    const v = db.get(`SELECT * FROM vent_rooms WHERE id = ? AND user_id = ?`, [id, req.userId]);
    if (!v) return reply.code(404).send({ error: 'not_found' });
    const fields = [];
    const vals = [];
    for (const k of ['title','body','intent']) {
      if (data[k] !== undefined) { fields.push(`${k} = ?`); vals.push(data[k]); }
    }
    for (const k of ['released','saved_as_journal']) {
      if (data[k] !== undefined) { fields.push(`${k} = ?`); vals.push(data[k] ? 1 : 0); }
    }
    if (!fields.length) return v;
    fields.push('updated_at = ?'); vals.push(nowMs());
    vals.push(id);
    db.run(`UPDATE vent_rooms SET ${fields.join(', ')} WHERE id = ?`, vals);
    return db.get(`SELECT * FROM vent_rooms WHERE id = ?`, [id]);
  }));

  // DELETE /api/vents/:id
  fastify.delete('/api/vents/:id', withParams(idParam, async (req, reply, { id }) => {
    const v = db.get(`SELECT id FROM vent_rooms WHERE id = ? AND user_id = ?`, [id, req.userId]);
    if (!v) return reply.code(404).send({ error: 'not_found' });
    logDelete(db, { userId: req.userId, what: 'vent', how: 'user_action' });
    db.run(`DELETE FROM vent_rooms WHERE id = ?`, [id]);
    return { ok: true };
  }));
}
