import { z } from 'zod';
import * as db from '../db/index.js';
import { uuid, nowMs, withBody } from '../util.js';
import { callCompanion, detectCrisis, detectSoftFlags, extractMemoryCues, CRISIS_RESOURCES } from '../ai/companion.js';

const companionSchema = z.object({
  text:    z.string().min(1).max(5000),
  mood:    z.string().max(40).optional(),
  history: z.array(z.object({ role: z.enum(['user','assistant']), content: z.string().max(2000) })).max(20).optional(),
  persist: z.boolean().optional(),   // also save as a journal reflection
});

const crisisCheckSchema = z.object({
  text: z.string().min(1).max(5000),
});

export default async function (fastify) {
  // POST /api/ai/companion — main chat endpoint
  fastify.post('/api/ai/companion', withBody(companionSchema, async (req, reply, d) => {
    const apiKey = process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY;
    const baseUrl = process.env.OPENROUTER_API_KEY
      ? 'https://openrouter.ai/api/v1'
      : 'https://api.groq.com/openai/v1';
    const model = process.env.UNSENT_MODEL || (
      process.env.OPENROUTER_API_KEY
        ? 'meta-llama/llama-3.3-70b-instruct:free'
        : 'llama-3.1-8b-instant'
    );

    // Pull memory cues from the user's recent vents + unsent messages.
    // Capped at 3, role-based only, no journal/mood data.
    let memoryCues = [];
    try {
      const recentVents = db.all(
        `SELECT title, body FROM vents WHERE user_id = ? ORDER BY created_at DESC LIMIT 12`,
        [req.userId]
      ) || [];
      const recentUnsent = db.all(
        `SELECT body FROM unsent WHERE user_id = ? AND outcome != 'deleted' ORDER BY created_at DESC LIMIT 12`,
        [req.userId]
      ) || [];
      memoryCues = extractMemoryCues([...recentVents, ...recentUnsent]);
    } catch { /* memory cues are best-effort */ }

    const result = await callCompanion({
      userText: d.text,
      mood: d.mood || null,
      history: d.history || [],
      memoryCues,
      apiKey,
      model,
      baseUrl,
    });

    // If crisis, write a safety_flag (privacy-respecting: no full text, just hash)
    if (result.kind === 'crisis') {
      const crypto = await import('node:crypto');
      const h = crypto.createHash('sha256').update(d.text.slice(0, 280)).digest('hex').slice(0, 16);
      db.run(
        `INSERT INTO safety_flags (id, user_id, category, trigger_text, response_kind, resources, created_at) VALUES (?,?,?,?,?,?,?)`,
        [uuid(), req.userId, result.crisis_category, `sha256:${h}`, 'resources_shown', JSON.stringify(result.resources), nowMs()]
      );
    }

    // Optionally persist as journal reflection
    if (d.persist) {
      db.run(
        `INSERT INTO journal_entries (id, user_id, kind, prompt, body, ai_reflection, mood_at_write, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [uuid(), req.userId, 'reflection', 'Companion reflection', d.text, result.text, d.mood || null, nowMs(), nowMs()]
      );
    }

    return result;
  }));

  // POST /api/ai/crisis-check — pure pre-check, no LLM call.
  fastify.post('/api/ai/crisis-check', withBody(crisisCheckSchema, async (req, reply, d) => {
    const category = detectCrisis(d.text);
    const soft = detectSoftFlags(d.text);
    if (!category) return { crisis: false, soft_flags: soft };
    return {
      crisis: true,
      category,
      resources: CRISIS_RESOURCES[process.env.UNSENT_REGION || 'US'],
      soft_flags: soft,
    };
  }));

  // GET /api/ai/status — what AI is wired?
  fastify.get('/api/ai/status', async () => {
    return {
      has_openrouter: !!process.env.OPENROUTER_API_KEY,
      has_groq: !!process.env.GROQ_API_KEY,
      model: process.env.UNSENT_MODEL || (
        process.env.OPENROUTER_API_KEY ? 'meta-llama/llama-3.3-70b-instruct:free'
        : process.env.GROQ_API_KEY ? 'llama-3.1-8b-instant'
        : 'mock'
      ),
      region: process.env.UNSENT_REGION || 'US',
    };
  });
}
