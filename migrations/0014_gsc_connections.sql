PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS gsc_connections (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  refresh_token_ciphertext TEXT NOT NULL,
  refresh_token_iv TEXT NOT NULL,
  encryption_version INTEGER NOT NULL DEFAULT 1 CHECK (encryption_version = 1),
  scope TEXT NOT NULL,
  token_type TEXT,
  connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gsc_site_mappings (
  site_profile_id INTEGER PRIMARY KEY,
  property TEXT NOT NULL UNIQUE,
  property_type TEXT NOT NULL CHECK (property_type IN ('domain', 'url_prefix')),
  permission_level TEXT,
  mapped_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_profile_id) REFERENCES site_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gsc_site_mappings_property
  ON gsc_site_mappings(property);
