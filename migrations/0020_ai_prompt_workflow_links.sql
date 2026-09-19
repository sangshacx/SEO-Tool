PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_prompt_workflow_links (
  workflow_id INTEGER PRIMARY KEY,
  tracker_id INTEGER NOT NULL,
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workflow_id) REFERENCES seo_action_workflow(id) ON DELETE CASCADE,
  FOREIGN KEY (tracker_id) REFERENCES ai_prompt_trackers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_workflow_links_tracker
  ON ai_prompt_workflow_links(tracker_id, updated_at DESC);
