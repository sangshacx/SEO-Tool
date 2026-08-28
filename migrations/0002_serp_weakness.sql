PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS serp_weakness_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword_id INTEGER NOT NULL,
  score_version TEXT NOT NULL,
  ranking_weakness INTEGER,
  organic_click_opportunity INTEGER,
  confidence_score INTEGER NOT NULL,
  decision_code TEXT NOT NULL,
  serp_features_json TEXT NOT NULL DEFAULT '[]',
  penalized_features_json TEXT NOT NULL DEFAULT '[]',
  average_referring_domains REAL,
  average_page_rank REAL,
  average_main_domain_rank REAL,
  serp_results_count TEXT,
  serp_updated_at TEXT,
  backlinks_updated_at TEXT,
  actual_cost_usd REAL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_serp_weakness_keyword_latest
  ON serp_weakness_snapshots(keyword_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_serp_weakness_score
  ON serp_weakness_snapshots(ranking_weakness DESC, fetched_at DESC);
