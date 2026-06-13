import { z } from 'zod';
import * as db from '../db/index.js';
import { uuid, nowMs, withBody, withParams, withParamsAndBody, logDelete } from '../util.js';

// ---------------------------------------------------------------------------
// Heartbreak toolkit — focused support for people going through a breakup.
//
//   No-Contact Tracker .......... GET/POST/DELETE /api/heartbreak/no-contact
//                                 POST            /api/heartbreak/no-contact/reset
//   Reasons / Triggers /
//   Standards / Glow-up /
//   Memory box (items) .......... CRUD            /api/heartbreak/items
//   Timed future-self letters ... CRUD + open     /api/heartbreak/letters
//   Recovery roadmap ............ GET             /api/heartbreak/roadmap
//
// Everything is per-user, local-first, and shows up in /api/export.
// ---------------------------------------------------------------------------

const DAY = 24 * 3600 * 1000;

const ITEM_KINDS = ['reason', 'trigger', 'standard', 'glowup', 'memory'];

const noContactSchema = z.object({
  label: z.string().max(80).optional().nullable(),
});

const itemSchema = z.object({
  kind:           z.enum(ITEM_KINDS),
  title:          z.string().max(120).optional().nullable(),
  body:           z.string().min(1).max(2000),
  plan:           z.string().max(2000).optional().nullable(),
  image_data_url: z.string().max(2_000_000).optional().nullable(),  // ~2MB base64 cap
});

const itemPatchSchema = z.object({
  title:          z.string().max(120).optional().nullable(),
  body:           z.string().min(1).max(2000).optional(),
  plan:           z.string().max(2000).optional().nullable(),
  image_data_url: z.string().max(2_000_000).optional().nullable(),
  sealed:         z.boolean().optional(),
  done:           z.boolean().optional(),
  active:         z.boolean().optional(),
}).refine((o) => Object.keys(o).length > 0, { message: 'empty_patch' });

const idParam = z.object({ id: z.string().min(1).max(64) });
const kindQuery = z.object({ kind: z.enum(ITEM_KINDS).optional() });

const letterSchema = z.object({
  title: z.string().max(120).optional().nullable(),
  body:  z.string().min(1).max(5000),
  // exactly one of these picks the delivery time
  deliver_in_days: z.number().int().min(1).max(3650).optional(),
  deliver_at:      z.number().int().optional(),
}).refine((o) => o.deliver_in_days != null || o.deliver_at != null, {
  message: 'deliver_in_days_or_deliver_at_required',
});

function noContactStatus(row, now = nowMs()) {
  if (!row || !row.active) return { tracking: false };
  const streakMs = Math.max(0, now - row.started_at);
  return {
    tracking: true,
    label: row.label,
    started_at: row.started_at,
    days: Math.floor(streakMs / DAY),
    streak_ms: streakMs,
    reset_count: row.reset_count,
    last_reset_at: row.last_reset_at,
    longest_streak_ms: Math.max(row.longest_streak_ms, streakMs),
    longest_days: Math.floor(Math.max(row.longest_streak_ms, streakMs) / DAY),
  };
}

export default async function heartbreakRoutes(fastify) {
  // ---------------- No-Contact Tracker ----------------
  fastify.get('/api/heartbreak/no-contact', async (req) => {
    const row = db.get(`SELECT * FROM no_contact WHERE user_id = ?`, [req.userId]);
    return noContactStatus(row);
  });

  // Start (or restart fresh) the tracker.
  fastify.post('/api/heartbreak/no-contact', withBody(noContactSchema, async (req, reply, d) => {
    const now = nowMs();
    const existing = db.get(`SELECT * FROM no_contact WHERE user_id = ?`, [req.userId]);
    if (existing) {
      db.run(
        `UPDATE no_contact SET label = ?, started_at = ?, active = 1, updated_at = ? WHERE user_id = ?`,
        [d.label ?? existing.label ?? null, now, now, req.userId]
      );
    } else {
      db.run(
        `INSERT INTO no_contact (user_id, label, started_at, reset_count, longest_streak_ms, active, created_at, updated_at)
         VALUES (?, ?, ?, 0, 0, 1, ?, ?)`,
        [req.userId, d.label ?? null, now, now, now]
      );
    }
    return noContactStatus(db.get(`SELECT * FROM no_contact WHERE user_id = ?`, [req.userId]));
  }));

  // Relapse — reset the streak, keep the longest run and bump the counter.
  // No judgement: the message is gentle on the client.
  fastify.post('/api/heartbreak/no-contact/reset', async (req, reply) => {
    const now = nowMs();
    const row = db.get(`SELECT * FROM no_contact WHERE user_id = ?`, [req.userId]);
    if (!row) return reply.code(404).send({ error: 'not_tracking' });
    const endedStreak = now - row.started_at;
    const longest = Math.max(row.longest_streak_ms, endedStreak);
    db.run(
      `UPDATE no_contact
         SET started_at = ?, last_reset_at = ?, reset_count = reset_count + 1,
             longest_streak_ms = ?, active = 1, updated_at = ?
       WHERE user_id = ?`,
      [now, now, longest, now, req.userId]
    );
    return noContactStatus(db.get(`SELECT * FROM no_contact WHERE user_id = ?`, [req.userId]));
  });

  fastify.delete('/api/heartbreak/no-contact', async (req, reply) => {
    const r = db.run(`UPDATE no_contact SET active = 0, updated_at = ? WHERE user_id = ?`, [nowMs(), req.userId]);
    if (r.changes === 0) return reply.code(404).send({ error: 'not_tracking' });
    return { ok: true, tracking: false };
  });

  // ---------------- Items (reasons / triggers / standards / glow-up / memories) ----------------
  fastify.get('/api/heartbreak/items', async (req, reply) => {
    const parsed = kindQuery.safeParse(req.query || {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', details: parsed.error.flatten() });
    const { kind } = parsed.data;
    const rows = kind
      ? db.all(
          `SELECT * FROM heartbreak_items WHERE user_id = ? AND kind = ? AND active = 1 ORDER BY created_at DESC LIMIT 500`,
          [req.userId, kind]
        )
      : db.all(
          `SELECT * FROM heartbreak_items WHERE user_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 500`,
          [req.userId]
        );
    return { items: rows };
  });

  fastify.post('/api/heartbreak/items', withBody(itemSchema, async (req, reply, d) => {
    const id = uuid();
    const now = nowMs();
    db.run(
      `INSERT INTO heartbreak_items (id, user_id, kind, title, body, plan, image_data_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.userId, d.kind, d.title ?? null, d.body, d.plan ?? null, d.image_data_url ?? null, now, now]
    );
    return { ok: true, id, created_at: now };
  }));

  fastify.patch('/api/heartbreak/items/:id', withParamsAndBody(idParam, itemPatchSchema, async (req, reply, { params, body }) => {
    const row = db.get(`SELECT * FROM heartbreak_items WHERE id = ? AND user_id = ?`, [params.id, req.userId]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const next = {
      title:          body.title          !== undefined ? body.title          : row.title,
      body:           body.body           !== undefined ? body.body           : row.body,
      plan:           body.plan           !== undefined ? body.plan           : row.plan,
      image_data_url: body.image_data_url !== undefined ? body.image_data_url : row.image_data_url,
      sealed:         body.sealed         !== undefined ? (body.sealed ? 1 : 0) : row.sealed,
      done:           body.done           !== undefined ? (body.done ? 1 : 0)   : row.done,
      active:         body.active         !== undefined ? (body.active ? 1 : 0) : row.active,
    };
    db.run(
      `UPDATE heartbreak_items
         SET title = ?, body = ?, plan = ?, image_data_url = ?, sealed = ?, done = ?, active = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [next.title, next.body, next.plan, next.image_data_url, next.sealed, next.done, next.active, nowMs(), params.id, req.userId]
    );
    return { ok: true };
  }));

  fastify.delete('/api/heartbreak/items/:id', withParams(idParam, async (req, reply, p) => {
    const r = db.run(`DELETE FROM heartbreak_items WHERE id = ? AND user_id = ?`, [p.id, req.userId]);
    if (r.changes === 0) return reply.code(404).send({ error: 'not_found' });
    logDelete(db, { userId: req.userId, what: 'heartbreak_item', how: 'user_delete' });
    return { ok: true };
  }));

  // ---------------- Timed future-self letters ----------------
  fastify.get('/api/heartbreak/letters', async (req) => {
    const now = nowMs();
    const rows = db.all(
      `SELECT * FROM timed_letters WHERE user_id = ? ORDER BY deliver_at ASC LIMIT 500`,
      [req.userId]
    );
    // Body is withheld until a letter is due — the whole point is the wait.
    const letters = rows.map((r) => {
      const due = now >= r.deliver_at;
      return {
        id: r.id,
        title: r.title,
        deliver_at: r.deliver_at,
        delivered_at: r.delivered_at,
        due,
        opened: r.delivered_at != null,
        created_at: r.created_at,
        body: due ? r.body : null,
      };
    });
    return { letters, due_count: letters.filter((l) => l.due && !l.opened).length };
  });

  fastify.post('/api/heartbreak/letters', withBody(letterSchema, async (req, reply, d) => {
    const now = nowMs();
    const deliverAt = d.deliver_at != null ? d.deliver_at : now + d.deliver_in_days * DAY;
    if (deliverAt <= now) return reply.code(400).send({ error: 'deliver_at_must_be_future' });
    const id = uuid();
    db.run(
      `INSERT INTO timed_letters (id, user_id, title, body, deliver_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, req.userId, d.title ?? null, d.body, deliverAt, now, now]
    );
    return { ok: true, id, deliver_at: deliverAt };
  }));

  // Open a letter — only allowed once it's due. Returns the body.
  fastify.post('/api/heartbreak/letters/:id/open', withParams(idParam, async (req, reply, p) => {
    const now = nowMs();
    const row = db.get(`SELECT * FROM timed_letters WHERE id = ? AND user_id = ?`, [p.id, req.userId]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (now < row.deliver_at) {
      return reply.code(403).send({ error: 'not_yet', deliver_at: row.deliver_at });
    }
    if (!row.delivered_at) {
      db.run(`UPDATE timed_letters SET delivered_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        [now, now, p.id, req.userId]);
    }
    return { ok: true, id: row.id, title: row.title, body: row.body, deliver_at: row.deliver_at, delivered_at: row.delivered_at || now };
  }));

  fastify.delete('/api/heartbreak/letters/:id', withParams(idParam, async (req, reply, p) => {
    const r = db.run(`DELETE FROM timed_letters WHERE id = ? AND user_id = ?`, [p.id, req.userId]);
    if (r.changes === 0) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  }));

  // ---------------- Recovery roadmap ----------------
  // A gentle multi-week program anchored on the no-contact start date (day 0).
  // If the user isn't tracking no-contact yet, the roadmap is "not started".
  fastify.get('/api/heartbreak/roadmap', async (req) => {
    const nc = db.get(`SELECT * FROM no_contact WHERE user_id = ?`, [req.userId]);
    if (!nc || !nc.active) {
      return { started: false, message: 'Start the No-Contact tracker to begin your recovery roadmap.' };
    }
    const STAGES = [
      { key: 'raw',      label: 'The Raw Days',     from: 0,  task: 'Just get through today. Vent freely, drink water, sleep.' },
      { key: 'fog',      label: 'The Fog',          from: 4,  task: 'Name one feeling a day. Write one unsent letter you never plan to send.' },
      { key: 'anger',    label: 'Naming It',        from: 11, task: 'List the real reasons it ended. Reread when you start to romanticize.' },
      { key: 'rebuild',  label: 'Rebuilding You',   from: 22, task: 'Pick one glow-up goal and take a tiny step toward it.' },
      { key: 'horizon',  label: 'The Horizon',      from: 46, task: 'Define your standards for what comes next. You are allowed to want more.' },
      { key: 'lighter',  label: 'Lighter',          from: 91, task: 'Notice what no longer hurts. Write your future self a letter.' },
    ];
    const days = Math.floor((nowMs() - nc.started_at) / DAY);
    let current = STAGES[0];
    for (const s of STAGES) if (days >= s.from) current = s;
    const idx = STAGES.indexOf(current);
    const next = STAGES[idx + 1] || null;
    return {
      started: true,
      day: days,
      stage: current.key,
      stage_index: idx,
      stage_label: current.label,
      task: current.task,
      total_stages: STAGES.length,
      next_stage_in_days: next ? Math.max(0, next.from - days) : null,
      stages: STAGES.map((s, i) => ({ ...s, reached: days >= s.from, current: i === idx })),
    };
  });
}
