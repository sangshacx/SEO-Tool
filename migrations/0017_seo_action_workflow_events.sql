PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS seo_action_workflow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_profile_id INTEGER NOT NULL,
  workflow_id INTEGER NOT NULL,
  page_url TEXT NOT NULL,
  action_code TEXT NOT NULL,
  query_text TEXT NOT NULL DEFAULT '',
  from_status TEXT CHECK (
    from_status IS NULL OR from_status IN ('new', 'in_progress', 'done', 'snoozed')
  ),
  to_status TEXT NOT NULL CHECK (
    to_status IN ('new', 'in_progress', 'done', 'snoozed')
  ),
  note_snapshot TEXT NOT NULL DEFAULT '',
  snooze_until TEXT,
  priority_score REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_profile_id) REFERENCES site_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES seo_action_workflow(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_seo_action_events_site_created
  ON seo_action_workflow_events(site_profile_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_seo_action_events_workflow_created
  ON seo_action_workflow_events(workflow_id, created_at DESC, id DESC);
