PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS gsc_generative_workflow_links (
  workflow_id INTEGER PRIMARY KEY,
  site_profile_id INTEGER NOT NULL,
  property TEXT NOT NULL,
  appearance_value TEXT NOT NULL,
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workflow_id) REFERENCES seo_action_workflow(id) ON DELETE CASCADE,
  FOREIGN KEY (site_profile_id) REFERENCES site_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gsc_generative_workflow_links_site
  ON gsc_generative_workflow_links(site_profile_id, updated_at DESC);
