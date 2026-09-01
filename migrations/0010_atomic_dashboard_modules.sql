CREATE TABLE IF NOT EXISTS site_dashboard_modules (
  site_domain TEXT NOT NULL,
  location_code INTEGER NOT NULL,
  language_code TEXT NOT NULL,
  module_id TEXT NOT NULL,
  module_json TEXT NOT NULL,
  updated_at TEXT,
  schema_version TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (site_domain, location_code, language_code, module_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_modules_scope
  ON site_dashboard_modules(site_domain, location_code, language_code);

INSERT INTO site_dashboard_modules
SELECT site_domain, location_code, language_code, 'organic',
  json_extract(modules_json, '$.organic'), json_extract(modules_json, '$.organic.updated_at'), schema_version, 1
FROM site_dashboard_snapshots WHERE json_valid(modules_json) AND json_type(modules_json, '$.organic') = 'object'
ORDER BY captured_at ASC, id ASC
ON CONFLICT(site_domain, location_code, language_code, module_id) DO UPDATE SET module_json=excluded.module_json, updated_at=excluded.updated_at, schema_version=excluded.schema_version, revision=site_dashboard_modules.revision+1;

INSERT INTO site_dashboard_modules
SELECT site_domain, location_code, language_code, 'top_keywords',
  json_extract(modules_json, '$.top_keywords'), json_extract(modules_json, '$.top_keywords.updated_at'), schema_version, 1
FROM site_dashboard_snapshots WHERE json_valid(modules_json) AND json_type(modules_json, '$.top_keywords') = 'object'
ORDER BY captured_at ASC, id ASC
ON CONFLICT(site_domain, location_code, language_code, module_id) DO UPDATE SET module_json=excluded.module_json, updated_at=excluded.updated_at, schema_version=excluded.schema_version, revision=site_dashboard_modules.revision+1;

INSERT INTO site_dashboard_modules
SELECT site_domain, location_code, language_code, 'backlinks',
  json_extract(modules_json, '$.backlinks'), json_extract(modules_json, '$.backlinks.updated_at'), schema_version, 1
FROM site_dashboard_snapshots WHERE json_valid(modules_json) AND json_type(modules_json, '$.backlinks') = 'object'
ORDER BY captured_at ASC, id ASC
ON CONFLICT(site_domain, location_code, language_code, module_id) DO UPDATE SET module_json=excluded.module_json, updated_at=excluded.updated_at, schema_version=excluded.schema_version, revision=site_dashboard_modules.revision+1;

INSERT INTO site_dashboard_modules
SELECT site_domain, location_code, language_code, 'backlink_history',
  json_extract(modules_json, '$.backlink_history'), json_extract(modules_json, '$.backlink_history.updated_at'), schema_version, 1
FROM site_dashboard_snapshots WHERE json_valid(modules_json) AND json_type(modules_json, '$.backlink_history') = 'object'
ORDER BY captured_at ASC, id ASC
ON CONFLICT(site_domain, location_code, language_code, module_id) DO UPDATE SET module_json=excluded.module_json, updated_at=excluded.updated_at, schema_version=excluded.schema_version, revision=site_dashboard_modules.revision+1;

INSERT INTO site_dashboard_modules
SELECT site_domain, location_code, language_code, 'competitors',
  json_extract(modules_json, '$.competitors'), json_extract(modules_json, '$.competitors.updated_at'), schema_version, 1
FROM site_dashboard_snapshots WHERE json_valid(modules_json) AND json_type(modules_json, '$.competitors') = 'object'
ORDER BY captured_at ASC, id ASC
ON CONFLICT(site_domain, location_code, language_code, module_id) DO UPDATE SET module_json=excluded.module_json, updated_at=excluded.updated_at, schema_version=excluded.schema_version, revision=site_dashboard_modules.revision+1;

INSERT INTO site_dashboard_modules
SELECT site_domain, location_code, language_code, 'keyword_opportunities',
  json_extract(modules_json, '$.keyword_opportunities'), json_extract(modules_json, '$.keyword_opportunities.updated_at'), schema_version, 1
FROM site_dashboard_snapshots WHERE json_valid(modules_json) AND json_type(modules_json, '$.keyword_opportunities') = 'object'
ORDER BY captured_at ASC, id ASC
ON CONFLICT(site_domain, location_code, language_code, module_id) DO UPDATE SET module_json=excluded.module_json, updated_at=excluded.updated_at, schema_version=excluded.schema_version, revision=site_dashboard_modules.revision+1;

INSERT INTO site_dashboard_modules
SELECT site_domain, location_code, language_code, 'backlink_gap',
  json_extract(modules_json, '$.backlink_gap'), json_extract(modules_json, '$.backlink_gap.updated_at'), schema_version, 1
FROM site_dashboard_snapshots WHERE json_valid(modules_json) AND json_type(modules_json, '$.backlink_gap') = 'object'
ORDER BY captured_at ASC, id ASC
ON CONFLICT(site_domain, location_code, language_code, module_id) DO UPDATE SET module_json=excluded.module_json, updated_at=excluded.updated_at, schema_version=excluded.schema_version, revision=site_dashboard_modules.revision+1;

INSERT INTO site_dashboard_modules
SELECT site_domain, location_code, language_code, 'backlink_opportunities',
  json_extract(modules_json, '$.backlink_opportunities'), json_extract(modules_json, '$.backlink_opportunities.updated_at'), schema_version, 1
FROM site_dashboard_snapshots WHERE json_valid(modules_json) AND json_type(modules_json, '$.backlink_opportunities') = 'object'
ORDER BY captured_at ASC, id ASC
ON CONFLICT(site_domain, location_code, language_code, module_id) DO UPDATE SET module_json=excluded.module_json, updated_at=excluded.updated_at, schema_version=excluded.schema_version, revision=site_dashboard_modules.revision+1;

INSERT INTO site_dashboard_modules
SELECT site_domain, location_code, language_code, 'workflow',
  json_extract(modules_json, '$.workflow'), json_extract(modules_json, '$.workflow.updated_at'), schema_version, 1
FROM site_dashboard_snapshots WHERE json_valid(modules_json) AND json_type(modules_json, '$.workflow') = 'object'
ORDER BY captured_at ASC, id ASC
ON CONFLICT(site_domain, location_code, language_code, module_id) DO UPDATE SET module_json=excluded.module_json, updated_at=excluded.updated_at, schema_version=excluded.schema_version, revision=site_dashboard_modules.revision+1;
