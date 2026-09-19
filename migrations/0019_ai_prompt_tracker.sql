PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_prompt_trackers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_profile_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL CHECK (platform IN ('chat_gpt', 'claude', 'gemini', 'perplexity')),
  model_name TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  web_search INTEGER NOT NULL DEFAULT 1 CHECK (web_search IN (0, 1)),
  location_code INTEGER NOT NULL,
  language_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_profile_id) REFERENCES site_profiles(id) ON DELETE CASCADE,
  UNIQUE (
    site_profile_id, platform, model_name, prompt_text,
    web_search, location_code, language_code
  )
);

CREATE TABLE IF NOT EXISTS ai_prompt_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracker_id INTEGER NOT NULL,
  model_name TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  provider_datetime TEXT,
  target_domain_mentioned INTEGER CHECK (target_domain_mentioned IN (0, 1) OR target_domain_mentioned IS NULL),
  target_domain_cited INTEGER CHECK (target_domain_cited IN (0, 1) OR target_domain_cited IS NULL),
  citation_count INTEGER NOT NULL DEFAULT 0,
  citation_domains_json TEXT NOT NULL DEFAULT '[]',
  fan_out_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  actual_cost_usd REAL,
  model_money_spent_usd REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tracker_id) REFERENCES ai_prompt_trackers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_trackers_site_status
  ON ai_prompt_trackers(site_profile_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_observations_tracker_observed
  ON ai_prompt_observations(tracker_id, observed_at DESC);
