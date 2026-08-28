PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS keyword_idea_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seed_keyword_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  requested_limit INTEGER NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  actual_cost_usd REAL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (seed_keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS keyword_idea_members (
  run_id INTEGER NOT NULL,
  keyword_id INTEGER NOT NULL,
  rank_order INTEGER NOT NULL,
  potential_score INTEGER,
  confidence_score INTEGER,
  group_label TEXT,
  PRIMARY KEY (run_id, keyword_id),
  FOREIGN KEY (run_id) REFERENCES keyword_idea_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_keyword_idea_runs_seed_fetched
  ON keyword_idea_runs(seed_keyword_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_keyword_idea_members_run_rank
  ON keyword_idea_members(run_id, rank_order);
