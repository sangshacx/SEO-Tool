PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS backlink_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'dataforseo',
  source TEXT NOT NULL CHECK (source IN ('live', 'cache')),
  domain_rank REAL,
  backlinks INTEGER,
  referring_domains INTEGER,
  referring_ips INTEGER,
  dofollow_pages INTEGER,
  nofollow_share_percent REAL,
  spam_score REAL,
  broken_backlinks INTEGER,
  health_score INTEGER,
  health_grade TEXT,
  score_version TEXT,
  snapshot_at TEXT NOT NULL,
  actual_cost_usd REAL,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(domain, snapshot_at)
);

CREATE INDEX IF NOT EXISTS idx_backlink_snapshots_domain_time
  ON backlink_snapshots(domain, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_backlink_snapshots_time
  ON backlink_snapshots(snapshot_at DESC);
