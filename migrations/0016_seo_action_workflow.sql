PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS seo_action_workflow (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_profile_id INTEGER NOT NULL,
  page_url TEXT NOT NULL,
  action_code TEXT NOT NULL,
  query_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (
    status IN ('new', 'in_progress', 'done', 'snoozed')
  ),
  note TEXT NOT NULL DEFAULT '',
  snooze_until TEXT,
  last_priority_score REAL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_profile_id) REFERENCES site_profiles(id) ON DELETE CASCADE,
  UNIQUE (site_profile_id, page_url, action_code, query_text)
);

CREATE INDEX IF NOT EXISTS idx_seo_action_workflow_site_status
  ON seo_action_workflow(site_profile_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_seo_action_workflow_site_page
  ON seo_action_workflow(site_profile_id, page_url, updated_at DESC);
