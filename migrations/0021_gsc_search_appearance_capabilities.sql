PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS gsc_search_appearance_capabilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_profile_id INTEGER NOT NULL,
  property TEXT NOT NULL,
  appearance_value TEXT NOT NULL,
  clicks REAL NOT NULL DEFAULT 0,
  impressions REAL NOT NULL DEFAULT 0,
  ctr REAL NOT NULL DEFAULT 0,
  position REAL,
  generative_ai_candidate INTEGER NOT NULL DEFAULT 0 CHECK (generative_ai_candidate IN (0, 1)),
  selected_for_generative_ai INTEGER NOT NULL DEFAULT 0 CHECK (selected_for_generative_ai IN (0, 1)),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_profile_id) REFERENCES site_profiles(id) ON DELETE CASCADE,
  UNIQUE (site_profile_id, appearance_value)
);

CREATE INDEX IF NOT EXISTS idx_gsc_search_appearance_site
  ON gsc_search_appearance_capabilities(site_profile_id, selected_for_generative_ai DESC, impressions DESC);
