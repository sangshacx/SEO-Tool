PRAGMA foreign_keys = OFF;

CREATE TABLE api_usage_new (
  request_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  operation TEXT NOT NULL,
  task_count INTEGER DEFAULT 0,
  result_count INTEGER NOT NULL DEFAULT 0,
  actual_cost_usd REAL,
  cache_hit INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0, 1)),
  status TEXT NOT NULL,
  http_status INTEGER,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO api_usage_new (
  request_id, provider, endpoint, operation, task_count, result_count,
  actual_cost_usd, cache_hit, status, http_status, duration_ms, created_at
)
SELECT
  request_id, provider, endpoint, operation, task_count, result_count,
  actual_cost_usd, cache_hit, status, http_status, duration_ms, created_at
FROM api_usage;

DROP TABLE api_usage;
ALTER TABLE api_usage_new RENAME TO api_usage;

CREATE INDEX IF NOT EXISTS idx_api_usage_created
  ON api_usage(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_usage_provider_created
  ON api_usage(provider, created_at DESC);

PRAGMA foreign_keys = ON;
