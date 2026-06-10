import { z } from 'zod';
import * as db from '../db/index.js';
import { uuid, nowMs, withBody, withParams, withParamsAndBody, logDelete } from '../util.js';

const createSchema = z.object({
  kind:         z.enum(['free','reflection','gratitude','shadow','cbt','future_self']).default('free'),
  prompt:       z.string().max(500).optional(),
  body:         z.string().min(1).max(20_000),
  ai_reflection: z.string().max(20_000).optional(),
  mood_at_write: z.string().max(40).optional(),
  vent_id:      z.string().uuid().optional(),
});
const updateSchema = z.object({
  prompt:        z.string().max(500).optional(),
  body:          z.string().min(1).max(20_000).optional(),
  ai_reflection: z.string().max(20_000).optional(),
  mood_at_write: z.string().max(40).optional(),
});
const idParam = z.object({ id: z.string().uuid() });

export default async function (fastify) {
  fastify.get('/api/journal', async (req) => {
    const kind = typeof req.query.kind === 'string' ? req.query.kind : null;
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const offset = parseInt(req.query.offset || '0', 10) || 0;
    let sql = `SELECT * FROM journal_entries WHERE user_id = ?`;
    const args = [req.userId];
    if (kind) { sql += ` AND kind = ?`; args.push(kind); }
    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    args.push(limit, offset);
    const total = db.get(`SELECT COUNT(*) AS n FROM journal_entries WHERE user_id = ?`, [req.userId]).n;
    return { entries: db.all(sql, args), total, limit, offset };
  });

  fastify.post('/api/journal', withBody(createSchema, async (req, reply, d) => {
    const id = uuid();
    const now = nowMs();
    db.run(
      `INSERT INTO journal_entries (id, user_id, kind, prompt, body, ai_reflection, mood_at_write, vent_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, req.userId, d.kind, d.prompt || null, d.body, d.ai_reflection || null, d.mood_at_write || null, d.vent_id || null, now, now]
    );
    if (d.vent_id) {
      db.run(`UPDATE vent_rooms SET saved_as_journal = 1, updated_at = ? WHERE id = ? AND user_id = ?`, [now, d.vent_id, req.userId]);
    }
    return reply.code(201).send(db.get(`SELECT * FROM journal_entries WHERE id = ?`, [id]));
  }));

  fastify.get('/api/journal/:id', withParams(idParam, async (req, reply, { id }) => {
    const e = db.get(`SELECT * FROM journal_entries WHERE id = ? AND user_id = ?`, [id, req.userId]);
    if (!e) return reply.code(404).send({ error: 'not_found' });
    return e;
  }));

  fastify.patch('/api/journal/:id', withParamsAndBody(idParam, updateSchema, async (req, reply, { params: { id }, body: d }) => {
    const e = db.get(`SELECT * FROM journal_entries WHERE id = ? AND user_id = ?`, [id, req.userId]);
    if (!e) return reply.code(404).send({ error: 'not_found' });
    const fields = [], vals = [];
    for (const k of ['prompt','body','ai_reflection','mood_at_write']) {
      if (d[k] !== undefined) { fields.push(`${k} = ?`); vals.push(d[k]); }
    }
    if (!fields.length) return e;
    fields.push('updated_at = ?'); vals.push(nowMs());
    vals.push(id);
    db.run(`UPDATE journal_entries SET ${fields.join(', ')} WHERE id = ?`, vals);
    return db.get(`SELECT * FROM journal_entries WHERE id = ?`, [id]);
  }));

  fastify.delete('/api/journal/:id', withParams(idParam, async (req, reply, { id }) => {
    const e = db.get(`SELECT id FROM journal_entries WHERE id = ? AND user_id = ?`, [id, req.userId]);
    if (!e) return reply.code(404).send({ error: 'not_found' });
    logDelete(db, { userId: req.userId, what: 'journal', how: 'user_action' });
    db.run(`DELETE FROM journal_entries WHERE id = ?`, [id]);
    return { ok: true };
  }));
}
