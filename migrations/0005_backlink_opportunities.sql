PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS backlink_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  own_domain TEXT NOT NULL,
  referring_domain TEXT NOT NULL,
  competitor_domains_json TEXT NOT NULL DEFAULT '[]',
  opportunity_score INTEGER CHECK (
    opportunity_score IS NULL
    OR opportunity_score BETWEEN 0 AND 100
  ),
  opportunity_label TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (
    status IN ('new', 'researching', 'outreach', 'contacted', 'won', 'rejected')
  ),
  notes TEXT NOT NULL DEFAULT '',
  first_discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(own_domain, referring_domain)
);

CREATE INDEX IF NOT EXISTS idx_backlink_opportunities_owner_status_updated
  ON backlink_opportunities(own_domain, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_backlink_opportunities_updated
  ON backlink_opportunities(updated_at DESC);
