import { z } from 'zod';
import * as db from '../db/index.js';
import { uuid, nowMs, withBody, withParams, withParamsAndBody, logDelete } from '../util.js';

const createSchema = z.object({
  shape:    z.enum(['breakup','angry','work','family','friend','missing','closure','apology','boundary']),
  body:     z.string().min(1).max(20_000),
  outcome:  z.enum(['private','deleted','rewritten','journal','boundary','self_compassion']).optional(),
});
const updateSchema = z.object({
  body:           z.string().min(1).max(20_000).optional(),
  rewritten_body: z.string().min(1).max(20_000).optional(),
  outcome:        z.enum(['private','deleted','rewritten','journal','boundary','self_compassion']).optional(),
});
const idParam = z.object({ id: z.string().uuid() });

export default async function (fastify) {
  fastify.get('/api/unsent', async (req) => {
    const shape = typeof req.query.shape === 'string' ? req.query.shape : null;
    const outcome = typeof req.query.outcome === 'string' ? req.query.outcome : null;
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const offset = parseInt(req.query.offset || '0', 10) || 0;
    let sql = `SELECT * FROM unsent_messages WHERE user_id = ?`;
    const args = [req.userId];
    if (shape)   { sql += ` AND shape = ?`;   args.push(shape); }
    if (outcome) { sql += ` AND outcome = ?`; args.push(outcome); }
    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    args.push(limit, offset);
    const total = db.get(`SELECT COUNT(*) AS n FROM unsent_messages WHERE user_id = ?`, [req.userId]).n;
    return { messages: db.all(sql, args), total, limit, offset };
  });

  fastify.post('/api/unsent', withBody(createSchema, async (req, reply, d) => {
    const id = uuid();
    const now = nowMs();
    db.run(
      `INSERT INTO unsent_messages (id, user_id, shape, body, rewritten_body, outcome, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      [id, req.userId, d.shape, d.body, null, d.outcome || 'private', now, now]
    );
    return reply.code(201).send(db.get(`SELECT * FROM unsent_messages WHERE id = ?`, [id]));
  }));

  fastify.get('/api/unsent/:id', withParams(idParam, async (req, reply, { id }) => {
    const m = db.get(`SELECT * FROM unsent_messages WHERE id = ? AND user_id = ?`, [id, req.userId]);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    return m;
  }));

  fastify.patch('/api/unsent/:id', withParamsAndBody(idParam, updateSchema, async (req, reply, { params: { id }, body: d }) => {
    const m = db.get(`SELECT * FROM unsent_messages WHERE id = ? AND user_id = ?`, [id, req.userId]);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    const fields = [], vals = [];
    for (const k of ['body','rewritten_body','outcome']) {
      if (d[k] !== undefined) { fields.push(`${k} = ?`); vals.push(d[k]); }
    }
    if (!fields.length) return m;
    fields.push('updated_at = ?'); vals.push(nowMs());
    vals.push(id);
    db.run(`UPDATE unsent_messages SET ${fields.join(', ')} WHERE id = ?`, vals);
    return db.get(`SELECT * FROM unsent_messages WHERE id = ?`, [id]);
  }));

  fastify.delete('/api/unsent/:id', withParams(idParam, async (req, reply, { id }) => {
    const m = db.get(`SELECT id FROM unsent_messages WHERE id = ? AND user_id = ?`, [id, req.userId]);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    logDelete(db, { userId: req.userId, what: 'unsent', how: 'user_action' });
    db.run(`DELETE FROM unsent_messages WHERE id = ?`, [id]);
    return { ok: true };
  }));
}
