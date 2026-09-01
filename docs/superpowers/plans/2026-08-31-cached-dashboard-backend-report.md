# Cached Dashboard Backend Recovery Report

## Status

Implemented the cached dashboard backend contracts on `cached-dashboard-final` without changing `public/v2-dashboard.js`, `public/v2-dashboard.css`, or `tests/v2-dashboard-view.test.mjs`.

## Delivered

- Added `0008_site_dashboard_snapshots.sql` for scoped dashboard snapshots and refresh leases.
- Added `0009_nullable_api_usage_task_count.sql` so exact unknown task counts can stay nullable.
- Added focused dashboard contract, cache-key, aggregate, refresh, and storage modules.
- Added `GET /api/v2/dashboard` with Access and same-origin enforcement, canonical scope normalization, D1/KV-only aggregation, warnings for optional failures, and exact zero-cost metadata.
- Added `POST /api/v2/dashboard/refresh` with streamed 64 KiB body enforcement, module allowlisting, duplicate rejection, provider-free review, deterministic execution order, single-flight reuse, post-lock cache rechecks, partial persistence, and exact per-module cost/task reporting.
- Updated touched competitor snapshot and keyword-gap accounting to stop fabricating task counts.
- Extended Preview migration verification for dashboard tables, migration ledger entries, and nullable `api_usage.task_count`.

## Verification

- Focused regression run:
  - `node --test tests/dashboard-refresh-api.test.mjs tests/site-dashboard-api.test.mjs tests/site-dashboard-storage.test.mjs tests/site-dashboard-migration.test.mjs tests/v2-market-api-validation.test.mjs tests/site-profiles-api.test.mjs tests/usage-summary-api.test.mjs`
  - Result: `tests 29`, `pass 29`, `fail 0`
- Full suite:
  - `node --test tests/*.test.mjs`
  - Result: `tests 172`, `pass 172`, `fail 0`, `duration_ms 2975.125114`
- Syntax:
  - `node --check` passed for every changed runtime file.
- Diff hygiene:
  - `git diff --check` passed.

## Concerns

- The workflow and verification for Preview migrations were updated, but the remote Preview migration job itself was not executed from this local environment.
