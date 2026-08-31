# Cached Site Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Ahrefs-style Overview that reads cached/D1 website data for free and refreshes only explicitly selected live modules after a transparent confirmation.

**Architecture:** A normalized D1 dashboard snapshot stores independently nullable organic, backlink, competitor, opportunity, and workflow modules. A zero-cost aggregator reads existing durable/cache data; a separate guarded refresh orchestrator reuses existing provider/cache boundaries and records per-module real cost.

**Tech Stack:** Cloudflare Pages Functions, D1, KV, vanilla JavaScript ES modules, SVG trends, Node.js test runner.

**Spec:** `docs/superpowers/specs/2026-08-30-cached-site-dashboard-design.md`

## Global Constraints

- Opening Overview, changing site/market, filtering, and changing chart range must cost `$0`.
- No-data is `unavailable`, never numeric zero.
- Only explicitly selected live modules may receive `allow_live_request: true`.
- Keep old module data visible while refresh is pending or partially fails.
- Record actual task count and cost per module in D1 usage records.
- Use a single-flight lock plus a post-lock cache recheck for paid refreshes.
- Use relative/origin-relative URLs and Cloudflare bindings; never embed a deployment hostname.
- Do not implement revenue prediction, automatic refresh, Content Brief, or team permissions.

---

### Task 1: Dashboard snapshot schema, normalizer, and storage

**Files:**
- Create: `migrations/0008_site_dashboard_snapshots.sql`
- Create: `src/v2/dashboard/normalize-dashboard.js`
- Create: `src/v2/storage/site-dashboard.js`
- Modify: `wrangler.migrations.jsonc`
- Modify: `.github/workflows/cloudflare-preview-migrate.yml`
- Create: `tests/site-dashboard-migration.test.mjs`
- Create: `tests/site-dashboard-storage.test.mjs`

**Interfaces:**
- Consumes: D1 site-profile ID/domain and market scope from the global-markets subsystem.
- Produces: `normalizeDashboardModule(type, data, meta)`, `readLatestDashboard(db, scope)`, `writeDashboardSnapshot(db, scope, modules)`, `readDashboardHistory(db, scope, rangeDays)`, `acquireDashboardRefreshLease(db, key, requestId, expiresAt)`, `releaseDashboardRefreshLease(db, key, requestId)`.

- [ ] **Step 1: Write failing migration and normalizer tests for nullable modules, schema version, source, scope, and freshness.**

```js
const module = normalizeDashboardModule("organic", null, {});
assert.equal(module.availability, "unavailable");
assert.equal(module.data, null);
assert.notEqual(module.data, 0);
```

- [ ] **Step 2: Run `node --test tests/site-dashboard-migration.test.mjs tests/site-dashboard-storage.test.mjs`.**

Expected: FAIL on missing migration and modules.

- [ ] **Step 3: Create migration `0008` with site, location, language, captured time, schema version, and JSON module columns.**

```sql
CREATE TABLE IF NOT EXISTS site_dashboard_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_domain TEXT NOT NULL,
  location_code INTEGER NOT NULL,
  language_code TEXT NOT NULL,
  modules_json TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  schema_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dashboard_scope_time
ON site_dashboard_snapshots(site_domain, location_code, language_code, captured_at DESC);
CREATE TABLE IF NOT EXISTS dashboard_refresh_leases (
  lease_key TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 4: Implement storage with minimum-interval deduplication and independent module merge.**

```js
const merged = { ...previous.modules, ...successfulModules };
if (!Object.keys(successfulModules).length) return { inserted: false, previous };
```

- [ ] **Step 5: Add `0008` to tracked Preview migration configuration and run both tests.**

- [ ] **Step 6: Commit.**

```bash
git add migrations/0008_site_dashboard_snapshots.sql src/v2/dashboard/normalize-dashboard.js src/v2/storage/site-dashboard.js wrangler.migrations.jsonc .github/workflows/cloudflare-preview-migrate.yml tests/site-dashboard-*.test.mjs
git commit -m "feat: store scoped dashboard snapshots"
```

### Task 2: Zero-cost dashboard aggregator API

**Files:**
- Create: `src/v2/dashboard/aggregate-dashboard.js`
- Create: `functions/api/v2/dashboard/index.js`
- Create: `tests/site-dashboard-api.test.mjs`

**Interfaces:**
- Consumes: `readLatestDashboard()`, backlink history storage, Link Prospects D1 data, deterministic KV keys, and validated site/market query parameters.
- Produces: `GET /api/v2/dashboard` with `{scope, modules, warnings, meta}`.

- [ ] **Step 1: Write failing API tests for complete data, partial data, no data, optional cache failure, D1 failure, and proof that provider `fetch` is never called.**

```js
assert.equal(providerCalls, 0);
assert.equal(body.meta.actual_cost_usd, 0);
assert.equal(body.data.modules.organic.availability, "unavailable");
```

- [ ] **Step 2: Run `node --test tests/site-dashboard-api.test.mjs`.**

Expected: FAIL because the aggregator/API do not exist.

- [ ] **Step 3: Implement query validation and independent module reads with warning collection.**

```js
const settled = await Promise.allSettled(readers.map(reader => reader()));
return { modules: mergeAvailable(settled), warnings: collectWarnings(settled) };
```

- [ ] **Step 4: Return structured `503` only for authoritative D1 binding/read failure; keep optional module failures as warnings.**

- [ ] **Step 5: Run the API test and verify no `DATAFORSEO_*` binding is accessed.**

- [ ] **Step 6: Commit.**

```bash
git add src/v2/dashboard/aggregate-dashboard.js functions/api/v2/dashboard/index.js tests/site-dashboard-api.test.mjs
git commit -m "feat: add zero-cost dashboard API"
```

### Task 3: Dashboard view, sourced cards, tables, and routes

**Files:**
- Create: `public/v2-dashboard.js`
- Create: `public/v2-dashboard.css`
- Modify: `public/v2-shell.js`
- Modify: `public/v2.html`
- Create: `tests/v2-dashboard-view.test.mjs`
- Create: `tests/v2-dashboard-ui.test.mjs`

**Interfaces:**
- Consumes: `/api/v2/dashboard`, active site/market context, and existing hash routes.
- Produces: `renderDashboard(root, payload)`, `formatDashboardMetric(module, field)`, `dashboardDetailRoute(metric)`.

- [ ] **Step 1: Write failing pure-render and markup tests for six cards, freshness/scope, unavailable states, two trends, Top Keywords, Competitors, opportunities, and risks.**

```js
assert.equal(formatDashboardMetric({ availability: "unavailable" }, "traffic"), "尚未分析");
assert.equal(dashboardDetailRoute("referring_domains"), "#backlinks");
```

- [ ] **Step 2: Run `node --test tests/v2-dashboard-view.test.mjs tests/v2-dashboard-ui.test.mjs`.**

Expected: FAIL because dashboard assets and markup do not exist.

- [ ] **Step 3: Implement scoped metric cards and table rows using text nodes for provider-controlled values.**

- [ ] **Step 4: Implement SVG trend rendering for 30/90/180/365-day ranges and exact two-snapshot empty state.**

```js
if (points.length < 2) return { state: "empty", message: "需要至少两份快照才能显示趋势" };
```

- [ ] **Step 5: Wire card and `查看全部` actions to existing hash routes without submitting analysis forms.**

- [ ] **Step 6: Load the dashboard on site/market changes through the zero-cost endpoint only.**

- [ ] **Step 7: Run view/UI tests, compile browser scripts, and verify unique IDs.**

- [ ] **Step 8: Commit.**

```bash
git add public/v2-dashboard.js public/v2-dashboard.css public/v2-shell.js public/v2.html tests/v2-dashboard-*.test.mjs
git commit -m "feat: render sourced SEO dashboard"
```

### Task 4: Refresh manifest and confirmation preview

**Files:**
- Create: `src/v2/dashboard/refresh-manifest.js`
- Create: `functions/api/v2/dashboard/refresh-preview.js`
- Create: `tests/dashboard-refresh-preview.test.mjs`

**Interfaces:**
- Produces: `DASHBOARD_REFRESH_MODULES`, `classifyRefreshModules(cache, scope, selected)`, and `POST /api/v2/dashboard/refresh-preview`.
- Module IDs: `organic`, `backlinks`, `competitors`, `keyword_opportunities`, `backlink_opportunities`.

- [ ] **Step 1: Write failing tests for module allowlist, shared Organic/Top Keywords result, cache classification, and zero provider calls.**

```js
assert.equal(result.modules.organic.state, "cached_free");
assert.equal(result.modules.backlinks.state, "live_confirmation_required");
assert.equal(providerCalls, 0);
```

- [ ] **Step 2: Run `node --test tests/dashboard-refresh-preview.test.mjs`.**

Expected: FAIL on missing manifest/endpoint.

- [ ] **Step 3: Implement deterministic cache inspection and return `cached_free`, `live_confirmation_required`, or `not_selected`.**

- [ ] **Step 4: Include scope, current freshness, and `estimated_cost_usd: null` unless the provider supplies a stable preflight price; never fabricate an estimate.**

- [ ] **Step 5: Run the preview tests and commit.**

```bash
git add src/v2/dashboard/refresh-manifest.js functions/api/v2/dashboard/refresh-preview.js tests/dashboard-refresh-preview.test.mjs
git commit -m "feat: preview dashboard refresh cost state"
```

### Task 5: Guarded refresh orchestrator

**Files:**
- Create: `src/v2/dashboard/refresh-dashboard.js`
- Create: `functions/api/v2/dashboard/refresh.js`
- Create: `tests/dashboard-refresh-api.test.mjs`

**Interfaces:**
- Consumes: refresh manifest, existing provider/cache modules, dashboard normalizer/storage, and the D1 `dashboard_refresh_leases` functions from Task 1.
- Produces: selected-module refresh response with per-module status/cost and `total_actual_cost_usd`.

- [ ] **Step 1: Write failing tests for unconfirmed `409`, selected-only execution, cache recheck, single-flight coalescing, partial failure, cache-write failure, and real cost sum.**

```js
assert.equal(unconfirmed.status, 409);
assert.equal((await unconfirmed.json()).meta.actual_cost_usd, 0);
assert.equal(providerCalls.organic, 1);
assert.equal(providerCalls.backlinks, 0);
assert.equal(body.meta.total_actual_cost_usd, body.modules.organic.actual_cost_usd);
```

- [ ] **Step 2: Run `node --test tests/dashboard-refresh-api.test.mjs`.**

Expected: FAIL because refresh orchestration does not exist.

- [ ] **Step 3: Implement strict module allowlisting, 64 KB streamed-body limit, and confirmation validation.**

- [ ] **Step 4: Acquire a 60-second D1 refresh lease keyed by normalized scope/module set, return `409 REFRESH_ALREADY_RUNNING` when another unexpired lease exists, re-read cache after acquiring it, and release only when `request_id` still owns the lease.**

```js
const acquired = await acquireDashboardRefreshLease(env.DB, key, requestId, expiresAt);
if (!acquired) return conflict("REFRESH_ALREADY_RUNNING");
try {
  const afterLease = await classifyRefreshModules(env.CACHE, scope, selected);
  return await executeRequired(afterLease, confirmedLiveModules);
} finally {
  await releaseDashboardRefreshLease(env.DB, key, requestId);
}
```

- [ ] **Step 5: Normalize and persist every successful module independently; retain prior modules for failures.**

- [ ] **Step 6: Log each attempted provider task and return per-module actual cost plus exact total.**

- [ ] **Step 7: Run refresh tests and commit.**

```bash
git add src/v2/dashboard/refresh-dashboard.js functions/api/v2/dashboard/refresh.js tests/dashboard-refresh-api.test.mjs
git commit -m "feat: add guarded dashboard refresh"
```

### Task 6: Refresh review dialog and single-flight client

**Files:**
- Create: `public/v2-dashboard-refresh.js`
- Modify: `public/v2-dashboard.js`
- Modify: `public/v2-dashboard.css`
- Modify: `public/v2.html`
- Create: `tests/v2-dashboard-refresh-ui.test.mjs`

**Interfaces:**
- Consumes: refresh-preview and guarded-refresh APIs.
- Produces: `openRefreshReview(scope)`, `submitDashboardRefresh(selection)`, per-module result rendering, and one in-flight client promise.

- [ ] **Step 1: Write failing tests that opening the dialog calls preview only, unchecked live modules cannot execute, duplicate clicks share one promise, and all paid toggles reset after success/error.**

```js
assert.equal(liveCalls, 0);
assert.strictEqual(firstPromise, secondPromise);
assert.equal(dialog.querySelectorAll("input:checked").length, 0);
```

- [ ] **Step 2: Run `node --test tests/v2-dashboard-refresh-ui.test.mjs`.**

Expected: FAIL because the dialog module does not exist.

- [ ] **Step 3: Render accessible module checkboxes with exact cache/live state and no pre-checked paid item.**

- [ ] **Step 4: Implement one in-flight client lock, disabled buttons, result rows, actual total cost, and explicit cache-write warnings.**

- [ ] **Step 5: Refresh the zero-cost dashboard after completion and preserve old module content until replacement arrives.**

- [ ] **Step 6: Run UI tests and commit.**

```bash
git add public/v2-dashboard-refresh.js public/v2-dashboard.js public/v2-dashboard.css public/v2.html tests/v2-dashboard-refresh-ui.test.mjs
git commit -m "feat: add dashboard refresh review dialog"
```

### Task 7: Full review, migrations, and Preview validation

**Files:**
- Modify only for regression-tested Critical or Important review findings.

**Interfaces:**
- Produces: reviewed `seo-pro-v2` deployment with migrations `0007` and `0008` applied.

- [ ] **Step 1: Run complete automated verification.**

```bash
node --test tests/*.test.mjs
node --check public/v2-dashboard.js
node --check public/v2-dashboard-refresh.js
git diff --check
```

- [ ] **Step 2: Independently review cache addressing, paid authorization, single-flight behavior, partial failure, snapshot accuracy, XSS-safe rendering, routing, and portability.**

- [ ] **Step 3: Add a failing regression test before fixing every confirmed Critical or Important issue; rerun targeted and complete suites.**

- [ ] **Step 4: Atomically update `seo-pro-v2`; do not modify `main` or Production.**

- [ ] **Step 5: Verify Preview migration workflow applied `0007_site_profiles.sql` and `0008_site_dashboard_snapshots.sql` exactly once.**

- [ ] **Step 6: Record D1 cost totals, open Overview, switch site/market, change chart ranges, and open the refresh dialog.**

Expected: totals unchanged, dashboard load `$0`, paid items unchecked, no live request.

- [ ] **Step 7: Execute a cached-only refresh selection and verify every selected module reports `$0`.**

- [ ] **Step 8: If the cache lacks a module, stop at the explicit live-confirmation screen; do not authorize a live request during zero-cost acceptance.**

- [ ] **Step 9: Report remote commit SHA, full test count, both migration results, sourced dashboard modules, zero-cost verification, and Preview URL.**
