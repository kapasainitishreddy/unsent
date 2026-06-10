import { z } from 'zod';
import * as db from '../db/index.js';
import { uuid, nowMs } from '../util.js';

const newEntrySchema = z.object({
  text: z.string().min(1).max(500),
  tag: z.enum(['person', 'moment', 'thing', 'self', 'other']).optional().default('moment'),
  mood_id: z.string().max(40).optional().nullable(),
});

/**
 * Gratitude Garden — every entry plants a seed. Seeds grow over time.
 * No free-tier limit, no premium gate. This is a free, accumulating thing.
 *
 * GET    /api/gratitude                  list entries (most recent first)
 * POST   /api/gratitude                  add an entry → plant a seed
 * DELETE /api/gratitude/:id              remove an entry
 * GET    /api/gratitude/garden           computed view: each entry with its
 *                                        current growth stage (0..4) based on
 *                                        how long since it was planted
 */
export default async function gratitudeRoutes(fastify) {
  fastify.get('/api/gratitude', async (req) => {
    const rows = db.all(
      `SELECT id, text, tag, mood_id, created_at
       FROM gratitude_entries
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 200`,
      [req.userId]
    );
    return { entries: rows };
  });

  fastify.post('/api/gratitude', async (req, reply) => {
    const parsed = newEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const id = uuid();
    const now = nowMs();
    db.run(
      `INSERT INTO gratitude_entries (id, user_id, text, tag, mood_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, req.userId, parsed.data.text, parsed.data.tag, parsed.data.mood_id || null, now, now]
    );
    return { ok: true, id, created_at: now };
  });

  fastify.delete('/api/gratitude/:id', async (req, reply) => {
    const result = db.run(
      `DELETE FROM gratitude_entries WHERE id = ? AND user_id = ?`,
      [req.params.id, req.userId]
    );
    if (result.changes === 0) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // Computed garden view. Each entry has a growth stage derived from age:
  //   stage 0 (seed)    : < 1 day
  //   stage 1 (sprout)  : 1-3 days
  //   stage 2 (leaf)    : 4-7 days
  //   stage 3 (bloom)   : 8-30 days
  //   stage 4 (full)    : > 30 days
  fastify.get('/api/gratitude/garden', async (req) => {
    const rows = db.all(
      `SELECT id, text, tag, mood_id, created_at
       FROM gratitude_entries
       WHERE user_id = ?
       ORDER BY created_at ASC`,
      [req.userId]
    );
    const now = nowMs();
    const DAY = 24 * 3600 * 1000;
    const flowers = rows.map((r, i) => {
      const ageDays = (now - r.created_at) / DAY;
      let stage = 0;
      if (ageDays >= 30) stage = 4;
      else if (ageDays >= 8) stage = 3;
      else if (ageDays >= 4) stage = 2;
      else if (ageDays >= 1) stage = 1;
      return {
        id: r.id,
        text: r.text,
        tag: r.tag,
        mood_id: r.mood_id,
        created_at: r.created_at,
        stage,
        index: i,
      };
    });
    return { garden: flowers, total: rows.length };
  });
}
