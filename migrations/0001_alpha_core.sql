PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  normalized_keyword TEXT NOT NULL,
  language_code TEXT NOT NULL,
  location_code INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(normalized_keyword, language_code, location_code)
);

CREATE TABLE IF NOT EXISTS keyword_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  search_volume INTEGER,
  keyword_difficulty INTEGER,
  cpc_usd REAL,
  competition REAL,
  competition_level TEXT,
  intent_primary TEXT,
  intent_secondary_json TEXT NOT NULL DEFAULT '[]',
  monthly_searches_json TEXT NOT NULL DEFAULT '[]',
  trend_monthly INTEGER,
  trend_quarterly INTEGER,
  trend_yearly INTEGER,
  provider_updated_at TEXT,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actual_cost_usd REAL,
  FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_usage (
  request_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  operation TEXT NOT NULL,
  task_count INTEGER NOT NULL DEFAULT 0,
  result_count INTEGER NOT NULL DEFAULT 0,
  actual_cost_usd REAL,
  cache_hit INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0, 1)),
  status TEXT NOT NULL,
  http_status INTEGER,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_keywords_lookup
  ON keywords(normalized_keyword, language_code, location_code);

CREATE INDEX IF NOT EXISTS idx_keyword_metrics_latest
  ON keyword_metrics(keyword_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_keyword_metrics_provider
  ON keyword_metrics(provider, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_usage_created
  ON api_usage(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_usage_provider_created
  ON api_usage(provider, created_at DESC);
