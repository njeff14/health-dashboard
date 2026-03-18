import type Database from 'better-sqlite3'

export function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source          TEXT NOT NULL,
      synced_at       TEXT NOT NULL,
      start_date      TEXT,
      end_date        TEXT,
      records_written INTEGER DEFAULT 0,
      error           TEXT
    );

    CREATE TABLE IF NOT EXISTS oura_sleep (
      id                    TEXT PRIMARY KEY,
      day                   TEXT NOT NULL,
      bedtime_start         TEXT,
      bedtime_end           TEXT,
      total_sleep_duration  INTEGER,
      deep_sleep_duration   INTEGER,
      rem_sleep_duration    INTEGER,
      light_sleep_duration  INTEGER,
      awake_time            INTEGER,
      efficiency            INTEGER,
      latency               INTEGER,
      average_hrv           REAL,
      lowest_heart_rate     INTEGER,
      average_heart_rate    REAL,
      restless_periods      INTEGER,
      sleep_type            TEXT,
      created_at            TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oura_daily_sleep (
      id                            TEXT PRIMARY KEY,
      day                           TEXT NOT NULL UNIQUE,
      score                         INTEGER,
      contributor_deep_sleep        INTEGER,
      contributor_efficiency        INTEGER,
      contributor_latency           INTEGER,
      contributor_rem_sleep         INTEGER,
      contributor_restfulness       INTEGER,
      contributor_timing            INTEGER,
      contributor_total_sleep       INTEGER,
      created_at                    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oura_daily_readiness (
      id                                  TEXT PRIMARY KEY,
      day                                 TEXT NOT NULL UNIQUE,
      score                               INTEGER,
      temperature_deviation               REAL,
      temperature_trend_deviation         REAL,
      contributor_activity_balance        INTEGER,
      contributor_body_temperature        INTEGER,
      contributor_hrv_balance             INTEGER,
      contributor_previous_day_activity   INTEGER,
      contributor_previous_night          INTEGER,
      contributor_recovery_index          INTEGER,
      contributor_resting_heart_rate      INTEGER,
      contributor_sleep_balance           INTEGER,
      created_at                          TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oura_daily_activity (
      id                    TEXT PRIMARY KEY,
      day                   TEXT NOT NULL UNIQUE,
      score                 INTEGER,
      active_calories       INTEGER,
      total_calories        INTEGER,
      steps                 INTEGER,
      high_activity_time    INTEGER,
      medium_activity_time  INTEGER,
      low_activity_time     INTEGER,
      sedentary_time        INTEGER,
      average_met_minutes   REAL,
      created_at            TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oura_daily_stress (
      id            TEXT PRIMARY KEY,
      day           TEXT NOT NULL UNIQUE,
      stress_high   INTEGER,
      recovery_high INTEGER,
      day_summary   TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oura_tags (
      id            TEXT PRIMARY KEY,
      tag_type_code TEXT,
      custom_name   TEXT,
      tag_text      TEXT,
      start_day     TEXT NOT NULL,
      end_day       TEXT,
      start_time    TEXT,
      end_time      TEXT,
      comment       TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oura_tag_days (
      tag_id    TEXT NOT NULL REFERENCES oura_tags(id) ON DELETE CASCADE,
      day       TEXT NOT NULL,
      tag_text  TEXT NOT NULL,
      PRIMARY KEY (tag_id, day)
    );

    CREATE TABLE IF NOT EXISTS oura_daily_spo2 (
      id          TEXT PRIMARY KEY,
      day         TEXT NOT NULL UNIQUE,
      spo2_average REAL,
      breathing_disturbance_index INTEGER,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS garmin_activities (
      activity_id               INTEGER PRIMARY KEY,
      activity_name             TEXT,
      activity_type             TEXT,
      start_time_local          TEXT NOT NULL,
      start_day                 TEXT NOT NULL,
      duration_sec              REAL,
      elapsed_duration_sec      REAL,
      distance_meters           REAL,
      calories                  INTEGER,
      average_hr                REAL,
      max_hr                    INTEGER,
      aerobic_training_effect   REAL,
      anaerobic_training_effect REAL,
      training_effect_label     TEXT,
      vo2max                    REAL,
      avg_running_cadence       REAL,
      elevation_gain            REAL,
      location_name             TEXT,
      created_at                TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_oura_sleep_day           ON oura_sleep(day);
    CREATE INDEX IF NOT EXISTS idx_oura_daily_sleep_day     ON oura_daily_sleep(day);
    CREATE INDEX IF NOT EXISTS idx_oura_daily_readiness_day ON oura_daily_readiness(day);
    CREATE INDEX IF NOT EXISTS idx_oura_daily_activity_day  ON oura_daily_activity(day);
    CREATE INDEX IF NOT EXISTS idx_oura_tags_start_day      ON oura_tags(start_day);
    CREATE INDEX IF NOT EXISTS idx_oura_tag_days_day        ON oura_tag_days(day);
    CREATE INDEX IF NOT EXISTS idx_garmin_activities_day    ON garmin_activities(start_day);
    CREATE INDEX IF NOT EXISTS idx_garmin_activities_type   ON garmin_activities(activity_type);

    CREATE TABLE IF NOT EXISTS user_settings (
      key     TEXT PRIMARY KEY,
      value   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)

  // Seed default HR settings if empty
  const hasSettings = db.prepare(`SELECT COUNT(*) as c FROM user_settings WHERE key LIKE 'hr_%'`).get() as { c: number }
  if (hasSettings.c === 0) {
    const defaults: [string, string][] = [
      ['hr_max', '206'],
      ['hr_resting', '58'],
      ['hr_lthr', '183'],
      ['hr_zone_method', 'lthr'],  // 'lthr' or 'max'
    ]
    const ins = db.prepare(`INSERT OR IGNORE INTO user_settings (key, value) VALUES (?, ?)`)
    for (const [k, v] of defaults) ins.run(k, v)
  }

  // Safe column additions for existing DBs
  for (const sql of [
    `ALTER TABLE oura_tags ADD COLUMN tag_text TEXT`,
    `ALTER TABLE oura_tag_days ADD COLUMN tag_text TEXT`,
  ]) {
    try { db.exec(sql) } catch { /* column already exists */ }
  }

  // Indexes on tag_text — must run after ALTER TABLE
  for (const sql of [
    `CREATE INDEX IF NOT EXISTS idx_oura_tags_tag_text     ON oura_tags(tag_text)`,
    `CREATE INDEX IF NOT EXISTS idx_oura_tag_days_tag_text ON oura_tag_days(tag_text)`,
  ]) {
    try { db.exec(sql) } catch { /* already exists */ }
  }

  // Backfill tag_text for any existing rows
  db.exec(`
    UPDATE oura_tags SET tag_text = COALESCE(custom_name, tag_type_code) WHERE tag_text IS NULL;
    UPDATE oura_tag_days SET tag_text = (
      SELECT COALESCE(t.custom_name, t.tag_type_code) FROM oura_tags t WHERE t.id = oura_tag_days.tag_id
    ) WHERE tag_text IS NULL;
  `)
}
