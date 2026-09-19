PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS gsc_search_analytics_daily (
  site_profile_id INTEGER NOT NULL,
  property TEXT NOT NULL,
  date TEXT NOT NULL,
  dimension_set TEXT NOT NULL CHECK (dimension_set IN ('query', 'page', 'query_page', 'country', 'device')),
  query_text TEXT NOT NULL DEFAULT '',
  page_url TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  clicks REAL NOT NULL DEFAULT 0,
  impressions REAL NOT NULL DEFAULT 0,
  ctr REAL NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_profile_id, date, dimension_set, query_text, page_url, country, device),
  FOREIGN KEY (site_profile_id) REFERENCES site_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gsc_daily_site_date_dimension
  ON gsc_search_analytics_daily(site_profile_id, date DESC, dimension_set);

CREATE INDEX IF NOT EXISTS idx_gsc_daily_query
  ON gsc_search_analytics_daily(site_profile_id, query_text, date DESC)
  WHERE query_text <> '';

CREATE INDEX IF NOT EXISTS idx_gsc_daily_page
  ON gsc_search_analytics_daily(site_profile_id, page_url, date DESC)
  WHERE page_url <> '';

CREATE TABLE IF NOT EXISTS gsc_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_profile_id INTEGER NOT NULL,
  property TEXT NOT NULL,
  target_date TEXT NOT NULL,
  dimension_sets_json TEXT NOT NULL,
  row_limit_per_set INTEGER NOT NULL,
  provider_requests INTEGER NOT NULL DEFAULT 0,
  rows_received INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,
  truncated_sets_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'error')),
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  FOREIGN KEY (site_profile_id) REFERENCES site_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gsc_sync_runs_site_date
  ON gsc_sync_runs(site_profile_id, target_date DESC, id DESC);
