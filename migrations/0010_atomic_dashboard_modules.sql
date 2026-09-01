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

INSERT INTO site_dashboard_modules (
  site_domain, location_code, language_code, module_id, module_json, updated_at, schema_version
)
SELECT
  site_domain,
  location_code,
  language_code,
  module_id,
  json_extract(modules_json, '$.' || module_id),
  json_extract(modules_json, '$.' || module_id || '.updated_at'),
  schema_version
FROM site_dashboard_snapshots
CROSS JOIN (
  SELECT 'organic' AS module_id UNION ALL
  SELECT 'top_keywords' UNION ALL
  SELECT 'backlinks' UNION ALL
  SELECT 'backlink_history' UNION ALL
  SELECT 'competitors' UNION ALL
  SELECT 'keyword_opportunities' UNION ALL
  SELECT 'backlink_gap' UNION ALL
  SELECT 'backlink_opportunities' UNION ALL
  SELECT 'workflow'
)
WHERE json_valid(modules_json)
  AND json_type(modules_json, '$.' || module_id) = 'object'
ORDER BY captured_at ASC, id ASC
ON CONFLICT(site_domain, location_code, language_code, module_id) DO UPDATE SET
  module_json = excluded.module_json,
  updated_at = excluded.updated_at,
  schema_version = excluded.schema_version,
  revision = site_dashboard_modules.revision + 1;
