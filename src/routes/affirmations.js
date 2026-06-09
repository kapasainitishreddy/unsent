import { z } from 'zod';
import * as db from '../db/index.js';
import { uuid, nowMs, withBody, withParams, withParamsAndBody, logDelete } from '../util.js';

const CATEGORIES = ['morning','night','breakup','anxiety','self_worth','work','loneliness','general'];

const createSchema = z.object({
  text:        z.string().min(1).max(500),
  source:      z.enum(['preset','ai','custom']).default('custom'),
  mood_filter: z.string().max(40).optional(),
  category:    z.enum(CATEGORIES).optional(),
});
const updateSchema = z.object({
  favorited: z.boolean().optional(),
  category:  z.enum(CATEGORIES).optional(),
});
const idParam = z.object({ id: z.string().uuid() });

// Curated preset list — the brief's example affirmations + a few more
const PRESETS = [
  { text: 'I can feel this without acting on it.',                 mood_filter: 'angry',     category: 'general' },
  { text: 'I do not need to send every thought I have.',            mood_filter: 'angry',     category: 'general' },
  { text: 'My feelings are valid, but I can choose my response.',   mood_filter: 'hurt',      category: 'general' },
  { text: 'I can miss someone and still protect my peace.',         mood_filter: 'lonely',    category: 'breakup' },
  { text: 'I am allowed to pause.',                                 mood_filter: 'anxious',   category: 'anxiety' },
  { text: 'One hard moment is not my whole life.',                   mood_filter: 'sad',       category: 'general' },
  { text: 'I am allowed to take up space.',                         mood_filter: 'hurt',      category: 'self_worth' },
  { text: 'Today, I choose one small act of care for myself.',      mood_filter: 'stressed',  category: 'morning' },
  { text: 'My nervous system is doing its best. I can work with it.', mood_filter: 'anxious', category: 'anxiety' },
  { text: 'I do not have to be perfect to be loved.',               mood_filter: 'hurt',      category: 'self_worth' },
  { text: 'Rest is not laziness. It is maintenance.',               mood_filter: 'tired',     category: 'night' },
  { text: 'I release what I cannot control.',                       mood_filter: 'stressed',  category: 'work' },
  { text: 'I am allowed to outgrow people who once felt safe.',    mood_filter: 'lonely',    category: 'breakup' },
  { text: 'I am the calm in my own storm.',                         mood_filter: 'anxious',   category: 'anxiety' },
  { text: 'I do not need to earn my own kindness.',                 mood_filter: 'hurt',      category: 'self_worth' },
];

export default async function (fastify) {
  fastify.get('/api/affirmations', async (req) => {
    const mood = typeof req.query.mood === 'string' ? req.query.mood : null;
    const favorites = req.query.favorites === '1';
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);

    let sql = `SELECT * FROM affirmations WHERE user_id = ?`;
    const args = [req.userId];
    if (mood) { sql += ` AND mood_filter = ?`; args.push(mood); }
    if (favorites) { sql += ` AND favorited = 1`; }
    sql += ` ORDER BY favorited DESC, created_at DESC LIMIT ?`;
    args.push(limit);
    return { affirmations: db.all(sql, args), categories: CATEGORIES };
  });

  // Seed presets (idempotent — only inserts if user has none for that text)
  fastify.post('/api/affirmations/seed-presets', async (req) => {
    let added = 0;
    for (const p of PRESETS) {
      const exists = db.get(`SELECT id FROM affirmations WHERE user_id = ? AND text = ?`, [req.userId, p.text]);
      if (exists) continue;
      db.run(
        `INSERT INTO affirmations (id, user_id, text, source, mood_filter, category, favorited, created_at) VALUES (?,?,?,?,?,?,0,?)`,
        [uuid(), req.userId, p.text, 'preset', p.mood_filter, p.category, nowMs()]
      );
      added += 1;
    }
    return { ok: true, added };
  });

  fastify.post('/api/affirmations', withBody(createSchema, async (req, reply, d) => {
    const id = uuid();
    db.run(
      `INSERT INTO affirmations (id, user_id, text, source, mood_filter, category, favorited, created_at) VALUES (?,?,?,?,?,?,0,?)`,
      [id, req.userId, d.text, d.source, d.mood_filter || null, d.category || null, nowMs()]
    );
    return reply.code(201).send(db.get(`SELECT * FROM affirmations WHERE id = ?`, [id]));
  }));

  fastify.patch('/api/affirmations/:id', withParamsAndBody(idParam, updateSchema, async (req, reply, { params: { id }, body: d }) => {
    const a = db.get(`SELECT * FROM affirmations WHERE id = ? AND user_id = ?`, [id, req.userId]);
    if (!a) return reply.code(404).send({ error: 'not_found' });
    const fields = [], vals = [];
    if (d.favorited !== undefined) { fields.push('favorited = ?'); vals.push(d.favorited ? 1 : 0); }
    if (d.category !== undefined) { fields.push('category = ?'); vals.push(d.category); }
    if (!fields.length) return a;
    vals.push(id);
    db.run(`UPDATE affirmations SET ${fields.join(', ')} WHERE id = ?`, vals);
    return db.get(`SELECT * FROM affirmations WHERE id = ?`, [id]);
  }));

  fastify.delete('/api/affirmations/:id', withParams(idParam, async (req, reply, { id }) => {
    const a = db.get(`SELECT id FROM affirmations WHERE id = ? AND user_id = ?`, [id, req.userId]);
    if (!a) return reply.code(404).send({ error: 'not_found' });
    logDelete(db, { userId: req.userId, what: 'affirmation', how: 'user_action' });
    db.run(`DELETE FROM affirmations WHERE id = ?`, [id]);
    return { ok: true };
  }));
}
