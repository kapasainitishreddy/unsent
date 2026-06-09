// Unsent backend — Fastify + node:sqlite + Clerk, local-first.
// Run: pnpm dev   (or: node --watch src/server.js)
//
// Auth:
//   - If CLERK_SECRET_KEY is set, every /api/* route requires a valid Clerk
//     session token (Authorization: Bearer *** or __session cookie).
//   - If not, dev mode: all requests run as a single 'local_user'. The server
//     logs a loud warning on boot so this is impossible to ship by accident.

process.removeAllListeners('warning');  // silence the node:sqlite experimental warning
import dotenv from 'dotenv';
dotenv.config();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { openDb, get as dbGet } from './db/index.js';
import { nowMs } from './util.js';
import { requireAuth, isAuthEnabled, ensureUserSettings } from './auth.js';

import vents         from './routes/vents.js';
import unsent        from './routes/unsent.js';
import journal       from './routes/journal.js';
import mood          from './routes/mood.js';
import affirmations  from './routes/affirmations.js';
import intentions    from './routes/intentions.js';
import coping        from './routes/coping.js';
import avatar        from './routes/avatar.js';
import settingsRoute from './routes/settings.js';
import exportRoute   from './routes/export.js';
import wipeRoute     from './routes/wipe.js';
import aiRoute       from './routes/ai.js';
import statsRoute    from './routes/stats.js';
import metaRoute     from './routes/meta.js';

const PORT  = parseInt(process.env.PORT  || '4000', 10);
const HOST  = process.env.HOST  || '127.0.0.1';
const DB    = process.env.DB_PATH || './data/unsent.db';

const ENDPOINTS = [
  'GET    /',
  'GET    /api/health',
  'GET    /api/me                          (auth)',
  'GET    /api/home                        (auth)',
  'GET    /api/settings                    (auth)',
  'PATCH  /api/settings                    (auth)',
  'GET    /api/avatar                      (auth)',
  'PATCH  /api/avatar                      (auth)',
  'GET    /api/vents                       (auth)',
  'POST   /api/vents                       (auth)',
  'GET    /api/vents/:id                   (auth)',
  'PATCH  /api/vents/:id                   (auth)',
  'DELETE /api/vents/:id                   (auth)',
  'GET    /api/unsent                      (auth)',
  'POST   /api/unsent                      (auth)',
  'PATCH  /api/unsent/:id                  (auth)',
  'DELETE /api/unsent/:id                  (auth)',
  'GET    /api/journal                     (auth)',
  'POST   /api/journal                     (auth)',
  'PATCH  /api/journal/:id                 (auth)',
  'DELETE /api/journal/:id                 (auth)',
  'GET    /api/mood                        (auth)',
  'POST   /api/mood                        (auth)',
  'DELETE /api/mood/:id                    (auth)',
  'GET    /api/affirmations                (auth)',
  'POST   /api/affirmations                (auth)',
  'PATCH  /api/affirmations/:id            (auth)',
  'DELETE /api/affirmations/:id            (auth)',
  'POST   /api/affirmations/seed-presets   (auth)',
  'GET    /api/intentions                  (auth)',
  'POST   /api/intentions                  (auth)',
  'PATCH  /api/intentions/:id              (auth)',
  'DELETE /api/intentions/:id              (auth)',
  'GET    /api/coping                      (auth)',
  'POST   /api/coping                      (auth)',
  'GET    /api/export                      (auth)',
  'POST   /api/wipe                        (auth)',
  'POST   /api/ai/companion                (auth)',
  'POST   /api/ai/crisis-check             (auth)',
  'GET    /api/ai/status',
  'GET    /api/meta',
];

/**
 * Build a fully-configured Fastify instance. Exported for tests so they can
 * use app.inject() and never bind to a real port.
 */
export async function build({ dbPath = DB, logger = false } = {}) {
  const fastify = Fastify({
    logger: logger ? { level: process.env.LOG_LEVEL || 'warn' } : false,
    disableRequestLogging: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  await fastify.register(cors, { origin: true, credentials: true });

  // Serve the demo client (vanilla HTML + JS, no build step).
  // In production you'd ship the client separately; for the demo, it lives at /app.
  // GET / returns the API banner (JSON). GET /app/ returns the SPA shell.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  await fastify.register(fastifyStatic, {
    root: join(__dirname, '..', 'client'),
    prefix: '/app/',
  });
  fastify.get('/app', async (_req, reply) => reply.redirect('/app/'));

  fastify.get('/', async () => ({
    name: 'unsent-backend',
    version: '0.1.0',
    auth_mode: isAuthEnabled() ? 'clerk' : 'dev',
    endpoints: ENDPOINTS,
  }));

  fastify.get('/api/health', async () => ({ ok: true, ts: nowMs() }));

  fastify.get('/api/me', { preHandler: requireAuth }, async (req) => {
    const settings = dbGet(
      `SELECT user_id, premium, theme, onboarding_complete, created_at
       FROM settings WHERE user_id = ?`,
      [req.userId]
    );
    return {
      user_id: req.userId,
      auth_mode: req.authMode,
      clerk: req.clerkUser || null,
      settings: settings || null,
    };
  });

  // All other /api/* routes go through auth.
  fastify.addHook('preHandler', async (req, reply) => {
    const url = req.routeOptions?.url || req.url;
    if (!url.startsWith('/api/')) return;
    if (url === '/api/health' || url === '/api/ai/status' || url === '/api/me' || url === '/api/meta') return;
    return requireAuth(req, reply);
  });

  for (const plugin of [
    vents, unsent, journal, mood, affirmations, intentions, coping,
    avatar, settingsRoute, exportRoute, wipeRoute, aiRoute, statsRoute, metaRoute,
  ]) {
    await fastify.register(plugin);
  }

  // Open the DB on build so handlers can read immediately.
  openDb(dbPath);
  if (!isAuthEnabled()) {
    ensureUserSettings('local_user');
  }

  return fastify;
}

// Run only when this file is the entrypoint, not when it's imported by tests.
const isMain = import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`;
if (isMain) {
  const fastify = await build();
  if (!isAuthEnabled()) {
    fastify.log.warn('===============================================================');
    fastify.log.warn('  AUTH DISABLED — running in dev mode as single "local_user"');
    fastify.log.warn('  Set CLERK_SECRET_KEY in .env to enable real authentication.');
    fastify.log.warn('===============================================================');
  }
  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`Unsent backend listening on http://${HOST}:${PORT}`);
    fastify.log.info(`Auth: ${isAuthEnabled() ? 'Clerk' : 'dev (no CLERK_SECRET_KEY)'}`);
    fastify.log.info(`AI:   ${process.env.OPENROUTER_API_KEY ? 'OpenRouter' : process.env.GROQ_API_KEY ? 'Groq' : 'mock (no API key)'}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}
