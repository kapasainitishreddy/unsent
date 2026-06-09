import { z } from 'zod';
import * as db from '../db/index.js';
import { nowMs, withBody } from '../util.js';

const PRESETS = ['luna','kai','noor','asher','mira','wren'];
const HAIR_STYLES = ['short','long','curly','bun','buzz'];
const OUTFITS = ['soft_sweater','denim_jacket','oversized_hoodie','linen_shirt'];
const GLASSES = ['none','round','square'];
const EXPRESSIONS = ['calm','listening','nodding','soft_smile','concerned','breathing','heart','release'];
const SOURCES = ['preset','photo_symbolic'];   // 'realistic' is FORBIDDEN

const updateSchema = z.object({
  preset_id:  z.enum(PRESETS).nullable().optional(),
  skin_tone:  z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  hair_style: z.enum(HAIR_STYLES).optional(),
  hair_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  outfit:     z.enum(OUTFITS).optional(),
  glasses:    z.enum(GLASSES).optional(),
  expression: z.enum(EXPRESSIONS).optional(),
  source:     z.enum(SOURCES).optional(),
  photo_phash: z.string().max(64).optional(),
});

export default async function (fastify) {
  fastify.get('/api/avatar', async (req, reply) => {
    const a = db.get(`SELECT * FROM avatar_settings WHERE user_id = ?`, [req.userId]);
    if (!a) return reply.code(404).send({ error: 'not_found' });
    return { ...a, presets: PRESETS, hair_styles: HAIR_STYLES, outfits: OUTFITS, glasses: GLASSES, expressions: EXPRESSIONS };
  });

  fastify.patch('/api/avatar', withBody(updateSchema, async (req, reply, d) => {
    // Hard refusal: any source that looks realistic is denied, with an explanation.
    if (d.source && !SOURCES.includes(d.source)) {
      return reply.code(400).send({ error: 'forbidden_source', message: 'Realistic avatars are not allowed. Unsent only creates symbolic characters.' });
    }
    const a = db.get(`SELECT * FROM avatar_settings WHERE user_id = ?`, [req.userId]);
    if (!a) return reply.code(404).send({ error: 'not_found' });
    const fields = [], vals = [];
    for (const k of ['preset_id','skin_tone','hair_style','hair_color','outfit','glasses','expression','source','photo_phash']) {
      if (d[k] !== undefined) { fields.push(`${k} = ?`); vals.push(d[k]); }
    }
    if (!fields.length) return a;
    fields.push('updated_at = ?'); vals.push(nowMs()); vals.push(req.userId);
    db.run(`UPDATE avatar_settings SET ${fields.join(', ')} WHERE user_id = ?`, vals);
    return db.get(`SELECT * FROM avatar_settings WHERE user_id = ?`, [req.userId]);
  }));
}
