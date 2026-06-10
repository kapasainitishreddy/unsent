import { randomUUID } from 'node:crypto';

export const nowMs = () => Date.now();
export const uuid = () => randomUUID();

export function localDay(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function maybeResetFreeVentCount(settings) {
  const today = localDay();
  const resetDay = settings.free_vent_reset_at ? localDay(settings.free_vent_reset_at) : null;
  if (resetDay !== today) {
    return { free_vent_count: 0, free_vent_reset_at: nowMs() };
  }
  return null;
}

export function withBody(schema, handler) {
  return async (req, reply) => {
    const r = schema.safeParse(req.body);
    if (!r.success) return reply.code(400).send({ error: 'validation_failed', details: r.error.flatten() });
    return handler(req, reply, r.data);
  };
}

export function withParams(schema, handler) {
  return async (req, reply) => {
    const r = schema.safeParse(req.params);
    if (!r.success) return reply.code(400).send({ error: 'validation_failed', details: r.error.flatten() });
    return handler(req, reply, r.data);
  };
}

export function checkFreeVentQuota(settings) {
  if (settings.premium) return null;
  const FREE_DAILY = 3;
  if (settings.free_vent_count >= FREE_DAILY) {
    return {
      code: 402,
      body: {
        error: 'free_tier_limit_reached',
        message: `You've used all ${FREE_DAILY} vent rooms today. Upgrade to Premium for unlimited, or come back tomorrow.`,
        limit: FREE_DAILY,
        reset_at: settings.free_vent_reset_at,
      },
    };
  }
  return null;
}


// Combine params + body validation. The handler signature becomes
// async (req, reply, { params, body }) => ...
export function withParamsAndBody(paramsSchema, bodySchema, handler) {
  return async (req, reply) => {
    const p = paramsSchema.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'validation_failed', details: p.error.flatten() });
    const b = bodySchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'validation_failed', details: b.error.flatten() });
    return handler(req, reply, { params: p.data, body: b.data });
  };
}

export function logDelete(db, { userId, what, how }) {
  db.run(
    `INSERT INTO deleted_log (id, user_id, what, how, created_at) VALUES (?, ?, ?, ?, ?)`,
    [uuid(), userId, what, how, nowMs()]
  );
}
