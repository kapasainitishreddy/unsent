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

const PORT  = parseInt(process.env.PORT  || '4000', 10);
const HOST  = process.env.HOST  || '127.0.0.1';
const DB    = process.env.DB_PATH || './data/unsent.db';

const fastify = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  disableRequestLogging: true,
  bodyLimit: 5 * 1024 * 1024,   // 5 MB — enough for a vision-board image
});

await fastify.register(cors, { origin: true, credentials: true });

// ----------------------------------------------------------------------
// Public (unauthenticated) routes
// ----------------------------------------------------------------------

fastify.get('/', async () => ({
  name: 'unsent-backend',
  version: '0.1.0',
  auth_mode: isAuthEnabled() ? 'clerk' : 'dev',
  endpoints: [
    'GET    /',
    'GET    /api/health',
    'GET    /api/me                          (auth)',
    'GET    /api/home                        (auth)',
    'GET    /api/settings',           'PATCH /api/settings                          (auth)',
    'GET    /api/avatar',             'PATCH /api/avatar                            (auth)',
    'GET    /api/vents',              'POST   /api/vents                            (auth)',
    'GET    /api/vents/:id',          'PATCH  /api/vents/:id',     'DELETE /api/vents/:id   (auth)',
    'GET    /api/unsent',             'POST   /api/unsent                           (auth)',
    'PATCH  /api/unsent/:id',         'DELETE /api/unsent/:id                       (auth)',
    'GET    /api/journal',            'POST   /api/journal                          (auth)',
    'PATCH  /api/journal/:id',        'DELETE /api/journal/:id                      (auth)',
    'GET    /api/mood',               'POST   /api/mood',          'DELETE /api/mood/:id   (auth)',
    'GET    /api/affirmations',       'POST   /api/affirmations',  'PATCH  /api/affirmations/:id',  'DELETE /api/affirmations/:id   (auth)',
    'POST   /api/affirmations/seed-presets                                            (auth)',
    'GET    /api/intentions',         'POST   /api/intentions',    'PATCH  /api/intentions/:id',    'DELETE /api/intentions/:id     (auth)',
    'GET    /api/coping',             'POST   /api/coping                            (auth)',
    'GET    /api/export                                                         (auth)',
    'POST   /api/wipe                                                          (auth)',
    'POST   /api/ai/companion                                                    (auth)',
    'POST   /api/ai/crisis-check                                                 (auth)',
    'GET    /api/ai/status',
  ],
}));

fastify.get('/api/health', async () => ({ ok: true, ts: nowMs() }));

// ----------------------------------------------------------------------
// Authenticated routes — every /api/* except /api/health goes through this
// preHandler. It resolves req.userId and req.authMode for the handlers.
// ----------------------------------------------------------------------

// Per-route /api/me — handy for the client to confirm a token is valid
// and learn the current user id (Clerk id in prod, 'local_user' in dev).
fastify.get('/api/me', { preHandler: requireAuth }, async (req) => {
  const settings = dbGet(`SELECT user_id, premium, theme, onboarding_complete, created_at FROM settings WHERE user_id = ?`, [req.userId]);
  return {
    user_id: req.userId,
    auth_mode: req.authMode,            // 'clerk' or 'dev'
    clerk: req.clerkUser || null,
    settings: settings || null,
  };
});

// All other /api/* routes go through auth.
fastify.addHook('preHandler', async (req, reply) => {
  const url = req.routeOptions?.url || req.url;
  if (!url.startsWith('/api/')) return;
  if (url === '/api/health' || url === '/api/ai/status' || url === '/api/me') return;
  return requireAuth(req, reply);
});

// ----------------------------------------------------------------------
// Mount domain routes
// ----------------------------------------------------------------------
for (const plugin of [vents, unsent, journal, mood, affirmations, intentions, coping, avatar, settingsRoute, exportRoute, wipeRoute, aiRoute, statsRoute]) {
  await fastify.register(plugin);
}

// ----------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------

// Open DB and seed the dev user row (only used in dev mode; in Clerk mode
// rows are created lazily on first authenticated request).
openDb(DB);

if (!isAuthEnabled()) {
  fastify.log.warn('===============================================================');
  fastify.log.warn('  AUTH DISABLED — running in dev mode as single "local_user"');
  fastify.log.warn('  Set CLERK_SECRET_KEY in .env to enable real authentication.');
  fastify.log.warn('===============================================================');
  ensureUserSettings('local_user');

  // Lazy seed: if the dev user has zero affirmations, POST the seed route
  // *from inside* the server after listen resolves. We do it by calling the
  // handler directly so we don't race the HTTP listener.
  fastify.addHook('onListen', async () => {
    const count = dbGet(`SELECT COUNT(*) AS n FROM affirmations WHERE user_id = ?`, ['local_user']).n;
    if (count > 0) return;
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/affirmations/seed-presets`, { method: 'POST' });
      const j = await r.json();
      fastify.log.info({ added: j.added }, 'seeded preset affirmations (dev mode)');
    } catch (e) {
      fastify.log.warn({ err: e.message }, 'preset seed skipped — call POST /api/affirmations/seed-presets manually');
    }
  });
}

try {
  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`Unsent backend listening on http://${HOST}:${PORT}`);
  fastify.log.info(`Auth: ${isAuthEnabled() ? 'Clerk' : 'dev (no CLERK_SECRET_KEY)'}`);
  fastify.log.info(`AI:   ${process.env.OPENROUTER_API_KEY ? 'OpenRouter' : process.env.GROQ_API_KEY ? 'Groq' : 'mock (no API key)'}`);
  fastify.log.info(`DB:   ${DB}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
