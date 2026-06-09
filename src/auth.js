// src/auth.js — Clerk auth for the Unsent backend.
//
// What this does:
//   1. Verifies the Clerk session token from the Authorization: Bearer header.
//   2. Maps the verified Clerk user → a stable `userId` stored in settings.
//   3. Auto-provisions a settings row for any new Clerk user (first request).
//   4. Falls back to a single dev user (`local_user`) when no Clerk keys are
//      configured, so you can boot and curl without signing up.
//
// Why a custom wrapper instead of just @clerk/fastify's preHandler?
//   - We need the auto-provision + DB-side user mapping (settings.user_id is a
//     TEXT primary key, not a Clerk id, so the app can keep working offline
//     with a deterministic local id).
//   - We need dev mode to be obvious in logs, not silent.

import { createClerkClient, verifyToken } from '@clerk/fastify';
import * as db from './db/index.js';
import { nowMs, uuid } from './util.js';

const DEV_USER_ID = 'local_user';

let _clerk = null;
function getClerk() {
  if (_clerk) return _clerk;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;
  _clerk = createClerkClient({ secretKey });
  return _clerk;
}

export function isAuthEnabled() {
  return !!process.env.CLERK_SECRET_KEY;
}

/**
 * Ensure a settings row exists for this user_id. Idempotent.
 * Returns the settings row.
 */
export function ensureUserSettings(userId) {
  let row = db.get(`SELECT * FROM settings WHERE user_id = ?`, [userId]);
  if (!row) {
    const now = nowMs();
    db.run(
      `INSERT INTO settings (user_id, created_at, updated_at) VALUES (?, ?, ?)`,
      [userId, now, now]
    );
    // Also seed default avatar for new users (matches the old local_user seed).
    db.run(
      `INSERT OR IGNORE INTO avatar_settings (
         user_id, preset_id, skin_tone, hair_style, hair_color,
         outfit, glasses, expression, source, created_at, updated_at
       ) VALUES (?, 'luna', '#fce8d8', 'short', '#5b3a29',
                 'soft_sweater', 'none', 'calm', 'preset', ?, ?)`,
      [userId, now, now]
    );
    row = db.get(`SELECT * FROM settings WHERE user_id = ?`, [userId]);
  }
  return row;
}

/**
 * Extract a Clerk session token from the request. Looks at:
 *   - Authorization: Bearer <token>
 *   - __session cookie (Clerk's default; set when the front-end uses Clerk's
 *     React hooks in a same-origin setup)
 */
function extractToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  // Clerk also publishes a __session cookie. Fastify exposes raw headers only.
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)__session=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  return null;
}

/**
 * Fastify preHandler. Resolves req.userId (string) or throws 401.
 * In dev mode (no Clerk key), req.userId is always 'local_user'.
 */
export async function requireAuth(req, reply) {
  const clerk = getClerk();

  // ---- DEV MODE -------------------------------------------------------
  if (!clerk) {
    req.userId = DEV_USER_ID;
    req.authMode = 'dev';
    req.clerkUser = null;
    ensureUserSettings(DEV_USER_ID);
    return;
  }

  // ---- CLERK MODE -----------------------------------------------------
  const token = extractToken(req);
  if (!token) {
    return reply.code(401).send({
      error: 'unauthenticated',
      message: 'Missing session token. Send Authorization: Bearer <token> from Clerk.',
    });
  }

  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    // payload.sub is the Clerk user id (e.g. "user_2abc...")
    // We use it directly as our settings.user_id — Clerk ids are stable + unique.
    req.userId = payload.sub;
    req.authMode = 'clerk';
    req.clerkUser = { id: payload.sub, sessionId: payload.sid };
    ensureUserSettings(req.userId);
  } catch (err) {
    req.log.warn({ err: err.message }, 'Clerk token verification failed');
    return reply.code(401).send({
      error: 'invalid_token',
      message: 'Session token is invalid or expired. Sign in again.',
    });
  }
}
