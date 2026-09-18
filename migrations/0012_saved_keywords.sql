PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS saved_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_profile_id INTEGER NOT NULL,
  keyword_id INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_profile_id) REFERENCES site_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE,
  UNIQUE (site_profile_id, keyword_id)
);

CREATE TABLE IF NOT EXISTS saved_keyword_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_profile_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_profile_id) REFERENCES site_profiles(id) ON DELETE CASCADE,
  UNIQUE (site_profile_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS saved_keyword_tag_assignments (
  saved_keyword_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (saved_keyword_id, tag_id),
  FOREIGN KEY (saved_keyword_id) REFERENCES saved_keywords(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES saved_keyword_tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_saved_keywords_site_created
  ON saved_keywords(site_profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_keywords_keyword
  ON saved_keywords(keyword_id, site_profile_id);

CREATE INDEX IF NOT EXISTS idx_saved_keyword_tags_site_name
  ON saved_keyword_tags(site_profile_id, normalized_name);

CREATE INDEX IF NOT EXISTS idx_saved_keyword_assignments_tag
  ON saved_keyword_tag_assignments(tag_id, saved_keyword_id);
