PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS gsc_generative_ai_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_profile_id INTEGER NOT NULL,
  property TEXT NOT NULL,
  appearance_value TEXT NOT NULL,
  date TEXT NOT NULL,
  dimension_set TEXT NOT NULL CHECK (dimension_set IN ('property','page','country','device')),
  page_url TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  clicks REAL NOT NULL DEFAULT 0,
  impressions REAL NOT NULL DEFAULT 0,
  ctr REAL NOT NULL DEFAULT 0,
  position REAL,
  synced_at TEXT NOT NULL,
  FOREIGN KEY (site_profile_id) REFERENCES site_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gsc_generative_ai_daily_site_date
  ON gsc_generative_ai_daily(site_profile_id, date DESC, dimension_set);

CREATE INDEX IF NOT EXISTS idx_gsc_generative_ai_daily_page
  ON gsc_generative_ai_daily(site_profile_id, page_url, date DESC);

CREATE TABLE IF NOT EXISTS gsc_generative_ai_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_profile_id INTEGER NOT NULL,
  property TEXT NOT NULL,
  appearance_value TEXT NOT NULL,
  target_date TEXT NOT NULL,
  dimension_sets_json TEXT NOT NULL,
  row_limit_per_set INTEGER NOT NULL,
  provider_requests INTEGER NOT NULL DEFAULT 0,
  rows_received INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,
  truncated_sets_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('success','partial','error')),
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_profile_id) REFERENCES site_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gsc_generative_ai_sync_site_date
  ON gsc_generative_ai_sync_runs(site_profile_id, target_date DESC, id DESC);
