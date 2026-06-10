import { z } from 'zod';
import { getDb } from '../db/index.js';
import { nowMs } from '../util.js';

const bodySchema = z.object({
  event: z.object({
    type: z.string().optional(),
    app_user_id: z.string().optional(),
    subscriber_id: z.string().optional(),
    product_id: z.string().optional(),
    entitlement_ids: z.array(z.string()).optional(),
    expiration_at_ms: z.number().optional(),
  }).passthrough(),
}).passthrough();

/**
 * RevenueCat webhook handler.
 *
 * RC sends POSTs to this endpoint for every subscription lifecycle event.
 * We flip the `premium` flag on the user's settings row based on entitlement.
 *
 * Configure in RevenueCat dashboard:
 *   Project -> Integrations -> Webhooks -> Add Endpoint
 *   URL:    https://<your-api-host>/api/billing/webhook
 *   Events: INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE, CANCELLATION, BILLING_ISSUE
 *   Auth:   set REVENUECAT_WEBHOOK_SECRET in your .env to require a matching
 *           Bearer token in the Authorization header.
 *
 * The user_id in RevenueCat must equal the Clerk user id (e.g. `user_abc123`).
 * Configure this in the mobile app: `Purchases.configure({ appUserID: clerkUserId })`.
 *
 * IMPORTANT: this route is registered in server.js as PUBLIC (no auth preHandler)
 * so RevenueCat can POST without a Clerk token. Don't move it to require auth.
 */
export default async function billingRoutes(fastify) {
  const WEBHOOK_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET || '';

  fastify.post('/api/billing/webhook', async (req, reply) => {
    if (WEBHOOK_SECRET) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${WEBHOOK_SECRET}`) {
        return reply.code(401).send({ error: 'invalid_webhook_secret' });
      }
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.issues });
    }

    const ev = parsed.data.event;
    const rcUserId = ev.app_user_id || ev.subscriber_id;

    if (!rcUserId) {
      // Initial TEST events from RC have no user. Acknowledge so RC doesn't retry.
      return { ok: true, mapped: false, reason: 'no_app_user_id' };
    }

    const isActiveEntitlement = Array.isArray(ev.entitlement_ids) && ev.entitlement_ids.length > 0;
    const isCancelling = ev.type === 'CANCELLATION';
    const isExpired = ev.expiration_at_ms && ev.expiration_at_ms < Date.now();

    const shouldBePremium = isActiveEntitlement && !isCancelling && !isExpired;

    const db = getDb();
    const now = nowMs();

    const existing = db.prepare(`SELECT user_id FROM settings WHERE user_id = ?`).get(rcUserId);
    if (!existing) {
      // Webhook fired before user was created in our DB. Create a stub.
      db.prepare(`INSERT INTO settings (user_id, premium, created_at, updated_at)
                  VALUES (?, ?, ?, ?)`).run(rcUserId, shouldBePremium ? 1 : 0, now, now);
    } else {
      db.prepare(`UPDATE settings SET premium = ?, updated_at = ? WHERE user_id = ?`)
        .run(shouldBePremium ? 1 : 0, now, rcUserId);
    }

    return {
      ok: true,
      mapped: true,
      user_id: rcUserId,
      premium: shouldBePremium,
      event_type: ev.type || null,
      product_id: ev.product_id || null,
    };
  });
}
