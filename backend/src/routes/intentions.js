import { z } from 'zod';
import * as db from '../db/index.js';
import { uuid, nowMs, withBody, withParams, withParamsAndBody, logDelete } from '../util.js';

const createSchema = z.object({
  kind:         z.enum(['daily','future_self','vision_board','goal','action']),
  title:        z.string().max(120).optional(),
  body:         z.string().min(1).max(2000),
  image_data_url: z.string().max(2_000_000).optional(),  // ~1.5MB base64 cap
  active:       z.boolean().optional(),
});
const updateSchema = z.object({
  title:        z.string().max(120).optional(),
  body:         z.string().min(1).max(2000).optional(),
  image_data_url: z.string().max(2_000_000).optional(),
  active:       z.boolean().optional(),
});
const idParam = z.object({ id: z.string().uuid() });

export default async function (fastify) {
  fastify.get('/api/intentions', async (req) => {
    const kind = typeof req.query.kind === 'string' ? req.query.kind : null;
    const onlyActive = req.query.active === '1';
    let sql = `SELECT * FROM intentions WHERE user_id = ?`;
    const args = [req.userId];
    if (kind) { sql += ` AND kind = ?`; args.push(kind); }
    if (onlyActive) { sql += ` AND active = 1`; }
    sql += ` ORDER BY created_at DESC`;
    return { intentions: db.all(sql, args) };
  });

  fastify.post('/api/intentions', withBody(createSchema, async (req, reply, d) => {
    const id = uuid();
    const now = nowMs();
    db.run(
      `INSERT INTO intentions (id, user_id, kind, title, body, image_data_url, active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, req.userId, d.kind, d.title || null, d.body, d.image_data_url || null, d.active === false ? 0 : 1, now, now]
    );
    return reply.code(201).send(db.get(`SELECT * FROM intentions WHERE id = ?`, [id]));
  }));

  fastify.get('/api/intentions/:id', withParams(idParam, async (req, reply, { id }) => {
    const i = db.get(`SELECT * FROM intentions WHERE id = ? AND user_id = ?`, [id, req.userId]);
    if (!i) return reply.code(404).send({ error: 'not_found' });
    return i;
  }));

  fastify.patch('/api/intentions/:id', withParamsAndBody(idParam, updateSchema, async (req, reply, { params: { id }, body: d }) => {
    const i = db.get(`SELECT * FROM intentions WHERE id = ? AND user_id = ?`, [id, req.userId]);
    if (!i) return reply.code(404).send({ error: 'not_found' });
    const fields = [], vals = [];
    for (const k of ['title','body','image_data_url']) {
      if (d[k] !== undefined) { fields.push(`${k} = ?`); vals.push(d[k]); }
    }
    if (d.active !== undefined) { fields.push('active = ?'); vals.push(d.active ? 1 : 0); }
    if (!fields.length) return i;
    fields.push('updated_at = ?'); vals.push(nowMs());
    vals.push(id);
    db.run(`UPDATE intentions SET ${fields.join(', ')} WHERE id = ?`, vals);
    return db.get(`SELECT * FROM intentions WHERE id = ?`, [id]);
  }));

  fastify.delete('/api/intentions/:id', withParams(idParam, async (req, reply, { id }) => {
    const i = db.get(`SELECT id FROM intentions WHERE id = ? AND user_id = ?`, [id, req.userId]);
    if (!i) return reply.code(404).send({ error: 'not_found' });
    logDelete(db, { userId: req.userId, what: 'intention', how: 'user_action' });
    db.run(`DELETE FROM intentions WHERE id = ?`, [id]);
    return { ok: true };
  }));
}
