PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS site_dashboard_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_domain TEXT NOT NULL,
  location_code INTEGER NOT NULL,
  language_code TEXT NOT NULL,
  modules_json TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  schema_version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dashboard_scope_time
  ON site_dashboard_snapshots(site_domain, location_code, language_code, captured_at DESC);

CREATE TABLE IF NOT EXISTS dashboard_refresh_leases (
  lease_key TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
