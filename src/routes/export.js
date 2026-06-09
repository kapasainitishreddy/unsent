import * as db from '../db/index.js';

export default async function (fastify) {
  fastify.get('/api/export', async (req, reply) => {
    const data = {
      exported_at: new Date().toISOString(),
      schema_version: 1,
      user_id: req.userId,
      settings:    db.get(`SELECT * FROM settings WHERE user_id = ?`, [req.userId]),
      vent_rooms:  db.all(`SELECT * FROM vent_rooms WHERE user_id = ?`, [req.userId]),
      unsent:      db.all(`SELECT * FROM unsent_messages WHERE user_id = ?`, [req.userId]),
      journal:     db.all(`SELECT * FROM journal_entries WHERE user_id = ?`, [req.userId]),
      mood:        db.all(`SELECT * FROM mood_checkins WHERE user_id = ?`, [req.userId]),
      affirmations:db.all(`SELECT * FROM affirmations WHERE user_id = ?`, [req.userId]),
      intentions:  db.all(`SELECT * FROM intentions WHERE user_id = ?`, [req.userId]),
      coping:      db.all(`SELECT * FROM coping_sessions WHERE user_id = ?`, [req.userId]),
      avatar:      db.get(`SELECT * FROM avatar_settings WHERE user_id = ?`, [req.userId]),
    };
    // strip pin hash from the export
    if (data.settings) delete data.settings.app_lock_pin_hash;
    const json = JSON.stringify(data, null, 2);
    reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="unsent-export-${Date.now()}.json"`)
      .send(json);
  });
}
