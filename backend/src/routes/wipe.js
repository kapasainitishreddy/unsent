import * as db from '../db/index.js';
import { uuid, nowMs, logDelete } from '../util.js';

export default async function (fastify) {
  fastify.post('/api/wipe', async (req, reply) => {
    // The wipe is hardcoded to require the literal word "DELETE" in the body.
    const confirm = (req.body || {}).confirm;
    if (confirm !== 'DELETE') {
      return reply.code(400).send({ error: 'confirmation_required', message: 'Send { "confirm": "DELETE" } to wipe all data.' });
    }
    logDelete(db, { userId: req.userId, what: 'all', how: 'wipe_all' });

    const tables = ['vent_rooms','unsent_messages','journal_entries','mood_checkins','affirmations','intentions','coping_sessions','safety_flags','gratitude_entries','no_contact','heartbreak_items','timed_letters'];
    for (const t of tables) db.run(`DELETE FROM ${t} WHERE user_id = ?`, [req.userId]);

    // Reset settings to defaults, but keep the user_id and the wipe log
    db.run(
      `UPDATE settings SET
        app_lock_enabled = 0, app_lock_pin_hash = NULL, theme = 'dark',
        voice_save_enabled = 0, cloud_transcription = 0, cloud_sync_enabled = 0,
        onboarding_complete = 0, default_avatar_id = NULL,
        premium = 0, free_vent_count = 0, free_vent_reset_at = ?,
        updated_at = ? WHERE user_id = ?`,
      [nowMs(), nowMs(), req.userId]
    );

    // Reset avatar to default Luna
    db.run(
      `UPDATE avatar_settings SET preset_id='luna', skin_tone='#fce8d8', hair_style='short', hair_color='#5b3a29',
        outfit='soft_sweater', glasses='none', expression='calm', source='preset', photo_phash=NULL,
        updated_at = ? WHERE user_id = ?`,
      [nowMs(), req.userId]
    );

    return { ok: true, wiped: tables };
  });
}
