// SQLite schema for Unsent — 11 tables from the brief's "Data Models" section.
// All ids are TEXT (uuid v4) so the client can mint them offline without a roundtrip.
// `created_at`/`updated_at` are unix epoch ms (INTEGER) for cheap sort/index.
//
// Privacy posture: nothing leaves this DB. No telemetry, no analytics rows.
// Tables are intentionally narrow — we keep only what the user explicitly writes.

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;            -- concurrent reads, single writer
PRAGMA foreign_keys = ON;             -- enforce referential integrity
PRAGMA synchronous = NORMAL;          -- safe with WAL, faster than FULL
PRAGMA busy_timeout = 5000;           -- 5s wait if another conn holds the lock
PRAGMA temp_store = MEMORY;           -- temp tables in RAM

-- ============================================================
-- 01. settings — one row per install (we default to "local_user")
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  user_id              TEXT PRIMARY KEY,
  app_lock_enabled     INTEGER NOT NULL DEFAULT 0,    -- 0|1
  app_lock_pin_hash    TEXT,                         -- argon2id; null if disabled
  theme                TEXT NOT NULL DEFAULT 'dark', -- 'dark' | 'light' | 'system'
  voice_save_enabled   INTEGER NOT NULL DEFAULT 0,    -- privacy: OFF by default
  cloud_transcription  INTEGER NOT NULL DEFAULT 0,    -- explicit opt-in only
  cloud_sync_enabled   INTEGER NOT NULL DEFAULT 0,    -- future: encrypted Supabase
  onboarding_complete  INTEGER NOT NULL DEFAULT 0,    -- 0|1
  default_avatar_id    TEXT,
  premium              INTEGER NOT NULL DEFAULT 0,    -- 0|1
  free_vent_count      INTEGER NOT NULL DEFAULT 0,    -- today
  free_vent_reset_at   INTEGER,                      -- ms when daily counter resets
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

-- ============================================================
-- 02. vent_rooms — text + voice (we don't store voice; only meta)
-- ============================================================
CREATE TABLE IF NOT EXISTS vent_rooms (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  title           TEXT,                                -- user-set or auto from first 6 words
  body            TEXT NOT NULL,
  mood_at_vent    TEXT,                                -- the mood they picked
  avatar_id       TEXT,                                -- which symbolic listener
  intent          TEXT,                                -- 'release' | 'rewrite' | 'save' | 'journal' | 'breathe' | 'delete'
  released        INTEGER NOT NULL DEFAULT 0,          -- 0|1 — released (paper dissolving)
  saved_as_journal INTEGER NOT NULL DEFAULT 0,         -- 0|1 — promoted to journal
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES settings(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_vents_user_created ON vent_rooms(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vents_user_intent  ON vent_rooms(user_id, intent);

-- ============================================================
-- 03. unsent_messages — structured unsent texts (8 use-case shapes)
-- ============================================================
CREATE TABLE IF NOT EXISTS unsent_messages (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  shape           TEXT NOT NULL,                       -- 'breakup'|'angry'|'work'|'family'|'friend'|'missing'|'closure'|'apology'|'boundary'
  body            TEXT NOT NULL,
  rewritten_body  TEXT,                                -- calmer rewrite (optional)
  outcome         TEXT,                                -- 'private'|'deleted'|'rewritten'|'journal'|'boundary'|'self_compassion'
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES settings(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_unsent_user_created ON unsent_messages(user_id, created_at DESC);

-- ============================================================
-- 04. journal_entries — AI-reflected & freeform
-- ============================================================
CREATE TABLE IF NOT EXISTS journal_entries (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'free',       -- 'free'|'reflection'|'gratitude'|'shadow'|'cbt'|'future_self'
  prompt          TEXT,                                -- the prompt the AI or user picked
  body            TEXT NOT NULL,
  ai_reflection   TEXT,                                -- optional AI response
  mood_at_write   TEXT,
  vent_id         TEXT,                                -- if promoted from a vent
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES settings(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_journal_user_created ON journal_entries(user_id, created_at DESC);

-- ============================================================
-- 05. mood_checkins — daily mood log
-- ============================================================
CREATE TABLE IF NOT EXISTS mood_checkins (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  mood            TEXT NOT NULL,                       -- one of 12: calm, angry, hurt, lonely, anxious, stressed, sad, hopeful, tired, confused, grateful, …custom
  intensity       INTEGER NOT NULL,                    -- 1..10
  triggers        TEXT,                                -- JSON array of tags
  notes           TEXT,
  logged_for_day  TEXT NOT NULL,                       -- YYYY-MM-DD (local)
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES settings(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mood_user_day  ON mood_checkins(user_id, logged_for_day DESC);
CREATE INDEX IF NOT EXISTS idx_mood_user_time ON mood_checkins(user_id, created_at DESC);

-- ============================================================
-- 06. affirmations — favorites + custom + AI-generated
-- ============================================================
CREATE TABLE IF NOT EXISTS affirmations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  text            TEXT NOT NULL,
  source          TEXT NOT NULL,                       -- 'preset'|'ai'|'custom'
  mood_filter     TEXT,                                -- e.g. 'anxious' — what mood it fits
  category        TEXT,                                -- 'morning'|'night'|'breakup'|'anxiety'|'self_worth'|'work'|'loneliness'|'general'
  favorited       INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES settings(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_aff_user_fav   ON affirmations(user_id, favorited, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aff_user_mood  ON affirmations(user_id, mood_filter);

-- ============================================================
-- 07. intentions — daily intention / future-self / vision board
-- ============================================================
CREATE TABLE IF NOT EXISTS intentions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  kind            TEXT NOT NULL,                       -- 'daily'|'future_self'|'vision_board'|'goal'|'action'
  title           TEXT,
  body            TEXT NOT NULL,
  image_data_url  TEXT,                                -- vision-board image (base64; small)
  active          INTEGER NOT NULL DEFAULT 1,          -- soft-delete flag
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES settings(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_int_user_kind ON intentions(user_id, kind, created_at DESC);

-- ============================================================
-- 08. coping_sessions — what tool, how long, helpful?
-- ============================================================
CREATE TABLE IF NOT EXISTS coping_sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  tool            TEXT NOT NULL,
  duration_sec    INTEGER NOT NULL,                    -- actual time spent
  completed       INTEGER NOT NULL DEFAULT 0,
  helpful_score   INTEGER,
  logged_for_day  TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES settings(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_coping_user_time ON coping_sessions(user_id, created_at DESC);

-- ============================================================
-- 09b. gratitude_entries — Gratitude Garden (free, accumulating)
-- ============================================================
CREATE TABLE IF NOT EXISTS gratitude_entries (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  text        TEXT NOT NULL,
  tag         TEXT NOT NULL DEFAULT 'moment',    -- person | moment | thing | self | other
  mood_id     TEXT,                                -- optional link to the mood at the time
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES settings(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_grat_user_created ON gratitude_entries(user_id, created_at DESC);

-- ============================================================
-- 09. avatar_settings — the symbolic listener (one per user is the MVP)
-- ============================================================
CREATE TABLE IF NOT EXISTS avatar_settings (
  user_id         TEXT PRIMARY KEY,
  preset_id       TEXT,                                -- 'luna'|'kai'|'noor'|'asher'|'mira'|'wren' or null if photo-derived
  skin_tone       TEXT,
  hair_style      TEXT,
  hair_color      TEXT,
  outfit          TEXT,
  glasses         TEXT,
  expression      TEXT NOT NULL DEFAULT 'calm',
  source          TEXT NOT NULL DEFAULT 'preset',      -- 'preset'|'photo_symbolic' — 'realistic' is FORBIDDEN
  photo_phash     TEXT,                                -- perceptual hash; never raw photo
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES settings(user_id) ON DELETE CASCADE
);

-- ============================================================
-- 10. safety_flags — when crisis check fires
-- ============================================================
CREATE TABLE IF NOT EXISTS safety_flags (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  category        TEXT NOT NULL,                       -- 'self_harm'|'suicide'|'harm_others'|'abuse'|'immediate_danger'
  trigger_text    TEXT,                                -- what the user said (truncated, hashed)
  response_kind   TEXT NOT NULL,
  resources       TEXT,                                -- JSON array
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES settings(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_safety_user_time ON safety_flags(user_id, created_at DESC);

-- ============================================================
-- 11. deleted_log — minimal audit trail (counts only, not content)
-- ============================================================
CREATE TABLE IF NOT EXISTS deleted_log (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  what            TEXT NOT NULL,
  how             TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES settings(user_id) ON DELETE CASCADE
);

-- ============================================================
-- Convenience views
-- ============================================================
CREATE VIEW IF NOT EXISTS v_mood_week AS
  SELECT user_id, created_at, logged_for_day, mood, intensity
    FROM mood_checkins
   WHERE created_at >= (CAST(strftime('%s','now') AS INTEGER) * 1000) - (7 * 24 * 60 * 60 * 1000);
`;

export const SEED_SQL = `
INSERT OR IGNORE INTO settings (user_id, created_at, updated_at)
VALUES ('local_user', $now, $now);

INSERT OR IGNORE INTO avatar_settings (
  user_id, preset_id, skin_tone, hair_style, hair_color, outfit, glasses, expression, source, created_at, updated_at
) VALUES (
  'local_user', 'luna', '#fce8d8', 'short', '#5b3a29',
  'soft_sweater', 'none', 'calm', 'preset', $now, $now
);
`;
