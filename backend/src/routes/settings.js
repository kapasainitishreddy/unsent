import { z } from 'zod';
import * as db from '../db/index.js';
import { nowMs, withBody } from '../util.js';

const patchSchema = z.object({
  app_lock_enabled:    z.boolean().optional(),
  theme:               z.enum(['dark','light','system']).optional(),
  voice_save_enabled:  z.boolean().optional(),
  cloud_transcription: z.boolean().optional(),
  cloud_sync_enabled:  z.boolean().optional(),
  onboarding_complete: z.boolean().optional(),
  default_avatar_id:   z.string().max(40).nullable().optional(),
  premium:             z.boolean().optional(),
  aria_name:           z.string().min(1).max(24).optional(),
  aria_mascot:         z.enum(['crane','moon','feather','leaf','wave','sprout']).optional(),
  aria_voice:          z.string().nullable().optional(),
  voice_pitch:         z.number().min(0.5).max(2).optional(),
  voice_rate:          z.number().min(0.5).max(2).optional(),
  user_display_name:   z.string().min(1).max(24).nullable().optional(),
  onboarding_purpose:  z.enum(['releases','clarity','companion','health']).nullable().optional(),
  onboarding_mood:     z.string().max(40).nullable().optional(),
});

export default async function (fastify) {
  fastify.get('/api/settings', async (req, reply) => {
    const s = db.get(`SELECT * FROM settings WHERE user_id = ?`, [req.userId]);
    if (!s) return reply.code(404).send({ error: 'not_found' });
    // strip pin_hash from the public response
    const { app_lock_pin_hash, ...rest } = s;
    return rest;
  });

  fastify.patch('/api/settings', withBody(patchSchema, async (req, reply, d) => {
    const fields = [], vals = [];
    for (const k of Object.keys(d)) {
      if (d[k] !== undefined) { fields.push(`${k} = ?`); vals.push(typeof d[k] === 'boolean' ? (d[k] ? 1 : 0) : d[k]); }
    }
    if (!fields.length) {
      const s = db.get(`SELECT * FROM settings WHERE user_id = ?`, [req.userId]);
      const { app_lock_pin_hash, ...rest } = s;
      return rest;
    }
    fields.push('updated_at = ?'); vals.push(nowMs()); vals.push(req.userId);
    db.run(`UPDATE settings SET ${fields.join(', ')} WHERE user_id = ?`, vals);
    const s = db.get(`SELECT * FROM settings WHERE user_id = ?`, [req.userId]);
    const { app_lock_pin_hash, ...rest } = s;
    return rest;
  }));
}
