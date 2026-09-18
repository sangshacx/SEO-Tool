PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS serp_competitor_snapshots (
  id TEXT PRIMARY KEY,
  keyword_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  search_engine_domain TEXT,
  checked_at TEXT,
  serp_features_json TEXT NOT NULL DEFAULT '[]',
  actual_cost_usd REAL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS serp_competitor_pages (
  snapshot_id TEXT NOT NULL,
  organic_position INTEGER NOT NULL,
  absolute_position INTEGER,
  domain TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  breadcrumb TEXT,
  website_name TEXT,
  is_featured_snippet INTEGER NOT NULL DEFAULT 0 CHECK (is_featured_snippet IN (0, 1)),
  is_web_story INTEGER NOT NULL DEFAULT 0 CHECK (is_web_story IN (0, 1)),
  PRIMARY KEY (snapshot_id, organic_position),
  FOREIGN KEY (snapshot_id) REFERENCES serp_competitor_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_serp_competitor_snapshot_keyword_latest
  ON serp_competitor_snapshots(keyword_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_serp_competitor_pages_domain
  ON serp_competitor_pages(domain, organic_position);
