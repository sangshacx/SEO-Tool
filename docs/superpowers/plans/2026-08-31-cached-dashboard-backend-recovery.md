# Cached Dashboard Backend Recovery Plan

Implement the backend of `docs/superpowers/specs/2026-08-30-cached-site-dashboard-design.md` with the following reviewed final contracts.

## Snapshot storage

- Add migrations `0008_site_dashboard_snapshots.sql` and `0009_nullable_api_usage_task_count.sql`, focused contract/storage modules, tests, and Preview workflow verification.
- Eight independently nullable modules scoped by canonical root domain and market. Available modules require supported source and canonical ISO freshness.
- Enforce 64 KiB UTF-8 before write and before parse; retain `__proto__` safely.
- Atomic partial merges, monotonic capture time, 15-minute identical-result dedup, no lost concurrent modules.

## Zero-cost GET

- `GET /api/v2/dashboard` uses Access/same-origin, canonical scope, D1/KV only, and exact zero cost/task metadata. Its import closure cannot reach network/provider/credentials/usage logging.
- Optional failures warn and remain unavailable; total D1 failure is 503.
- Timestamped competitor `{data,cached_at}` envelopes with legacy compatibility and explicit no-freshness warning.
- Normalize prospect JSON arrays; list max 500 but compute total/pending/six-status counts with separate aggregate query. Never fabricate prospect freshness.
- Backlink history provider freshness is `snapshot_at`; malformed optional cache freshness cannot abort the aggregate.

## Guarded refresh

- `POST /api/v2/dashboard/refresh`: Access/same-origin, cumulative streamed 64 KiB, exact five-module allowlist, duplicates rejected, deterministic order.
- Provider-free review; unconfirmed live modules return 409 and exact zero cost. Only selected modules execute.
- Process single-flight plus post-lock cache recheck. Every adapter enforces live authorization immediately before provider after its final cache read, covering cache→cache→miss.
- Independent partial persistence, prior-data retention, exact per-module cache/task/cost/write/time facts. Confirmed pre-provider tasks=0, unknown=null, observed arrays exact; never default to 1.
- Accumulate multi-competitor tasks/known costs even if a later call fails. Log known cost even with null task count; single-flight joiners do not duplicate usage.
- Real `Allow: POST, OPTIONS`; `keyword_opportunities` may be `skip/NO_PROVIDER`.
- Update touched competitor snapshot/keyword-gap accounting to remove fabricated task counts.

## Required regressions

Cover migration/schema, partial/concurrent storage, identical interval, unavailable versus zero, zero-cost import closure, optional corrupt cache, >500 counts, invalid freshness, envelopes, review/409, selected-only live execution, cache races in both directions, cache-write failure, multi-competitor partial accounting, nullable task logging, Access/same-origin, 405 header and request limits.

Run focused tests, syntax checks, `git diff --check`, then `node --test tests/*.test.mjs`. Commit and report exact results. Do not alter the new `public/v2-dashboard.*` UI files or dispatch subagents.
