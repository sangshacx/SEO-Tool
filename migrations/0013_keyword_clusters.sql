PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS topic_clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_profile_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'rules', 'serp_overlap')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_profile_id) REFERENCES site_profiles(id) ON DELETE CASCADE,
  UNIQUE (site_profile_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS topic_cluster_members (
  cluster_id INTEGER NOT NULL,
  saved_keyword_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('primary', 'supporting')),
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cluster_id, saved_keyword_id),
  UNIQUE (saved_keyword_id),
  FOREIGN KEY (cluster_id) REFERENCES topic_clusters(id) ON DELETE CASCADE,
  FOREIGN KEY (saved_keyword_id) REFERENCES saved_keywords(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_topic_clusters_site_updated
  ON topic_clusters(site_profile_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_topic_cluster_members_cluster_role
  ON topic_cluster_members(cluster_id, role, assigned_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_topic_cluster_one_primary
  ON topic_cluster_members(cluster_id)
  WHERE role = 'primary';
