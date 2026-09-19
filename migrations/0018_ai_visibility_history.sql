PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_visibility_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_profile_id INTEGER NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('google', 'chat_gpt')),
  location_code INTEGER NOT NULL,
  language_code TEXT NOT NULL,
  period TEXT NOT NULL,
  mentions INTEGER,
  ai_search_volume INTEGER,
  source TEXT NOT NULL DEFAULT 'dataforseo_historical',
  provider_fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_profile_id) REFERENCES site_profiles(id) ON DELETE CASCADE,
  UNIQUE (site_profile_id, platform, location_code, language_code, period, source)
);

CREATE TABLE IF NOT EXISTS ai_visibility_new_lost (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_profile_id INTEGER NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('google', 'chat_gpt')),
  location_code INTEGER NOT NULL,
  language_code TEXT NOT NULL,
  period TEXT NOT NULL,
  new_mentions INTEGER NOT NULL DEFAULT 0,
  lost_mentions INTEGER NOT NULL DEFAULT 0,
  new_ai_search_volume INTEGER NOT NULL DEFAULT 0,
  lost_ai_search_volume INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'dataforseo_new_lost',
  provider_fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_profile_id) REFERENCES site_profiles(id) ON DELETE CASCADE,
  UNIQUE (site_profile_id, platform, location_code, language_code, period, source)
);

CREATE INDEX IF NOT EXISTS idx_ai_visibility_history_scope_period
  ON ai_visibility_history(site_profile_id, platform, location_code, language_code, period DESC);

CREATE INDEX IF NOT EXISTS idx_ai_visibility_new_lost_scope_period
  ON ai_visibility_new_lost(site_profile_id, platform, location_code, language_code, period DESC);
