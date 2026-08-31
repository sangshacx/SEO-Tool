# Global Keyword Markets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add searchable global country/language selection and D1-backed per-site market profiles shared by every keyword and competitor workflow.

**Architecture:** A checked-in provider catalog supplies valid locations and languages without a paid browser request. A D1 `site_profiles` table and zero-cost Pages Function own durable profiles, while a focused browser market-context module updates existing forms without submitting them.

**Tech Stack:** Cloudflare Pages Functions, D1, vanilla JavaScript ES modules, static JSON, Node.js test runner.

**Spec:** `docs/superpowers/specs/2026-08-30-global-keyword-markets-design.md`

## Global Constraints

- Switching site, country, or language must never submit a form or call DataForSEO.
- Site-profile API responses must report `actual_cost_usd: 0`.
- Keep backend defaults `location_code: 2840` and `language_code: "en"` for older clients.
- Use relative or origin-relative application URLs; do not embed a Pages hostname.
- Persist durable site profiles in D1; use local storage only for migration and temporary fallback.
- Preserve every current Cost Guard and cache-key boundary.
- Do not modify Content Brief behavior.

---

### Task 1: Provider market catalog

**Files:**
- Create: `src/v2/markets/catalog.js`
- Create: `public/data/v2-markets.json`
- Create: `tests/v2-market-catalog.test.mjs`

**Interfaces:**
- Produces: `MARKET_CATALOG_VERSION`, `findLocation(code)`, `findLanguage(code)`, `isSupportedMarket(locationCode, languageCode)`, `pinnedLocations()`.
- Consumes: checked-in location and language records generated from official provider metadata.

- [ ] **Step 1: Write failing catalog tests.**

```js
import { findLocation, findLanguage, pinnedLocations } from "../src/v2/markets/catalog.js";
assert.equal(findLocation(2840).country_iso_code, "US");
assert.equal(findLanguage("ar").language_name, "Arabic");
assert.equal(new Set(pinnedLocations().map(x => x.location_code)).size, pinnedLocations().length);
```

- [ ] **Step 2: Run `node --test tests/v2-market-catalog.test.mjs`.**

Expected: FAIL because `src/v2/markets/catalog.js` does not exist.

- [ ] **Step 3: Implement the immutable catalog helpers and generated public JSON.**

```js
export function findLocation(code) {
  return LOCATIONS.find(item => item.location_code === Number(code)) ?? null;
}
export function isSupportedMarket(locationCode, languageCode) {
  return Boolean(findLocation(locationCode) && findLanguage(languageCode));
}
```

- [ ] **Step 4: Run the catalog test and verify every public JSON record matches the module record.**

Run: `node --test tests/v2-market-catalog.test.mjs`

- [ ] **Step 5: Commit.**

```bash
git add src/v2/markets/catalog.js public/data/v2-markets.json tests/v2-market-catalog.test.mjs
git commit -m "feat: add global keyword market catalog"
```

### Task 2: D1 site-profile schema and storage

**Files:**
- Create: `migrations/0007_site_profiles.sql`
- Create: `src/v2/storage/site-profiles.js`
- Modify: `wrangler.migrations.jsonc`
- Modify: `.github/workflows/cloudflare-preview-migrate.yml`
- Create: `tests/site-profiles-migration.test.mjs`
- Create: `tests/site-profiles-storage.test.mjs`

**Interfaces:**
- Consumes: `isSupportedMarket()` from Task 1.
- Produces: `normalizeSiteProfile(input)`, `listSiteProfiles(db)`, `upsertSiteProfile(db, profile)`, `deleteSiteProfile(db, domain)`, `exportSiteProfiles(db)`.

- [ ] **Step 1: Write failing migration and storage tests.**

```js
assert.match(sql, /CREATE TABLE IF NOT EXISTS site_profiles/);
assert.match(sql, /UNIQUE\s*\(domain\)/i);
const saved = await upsertSiteProfile(db, { domain: "example.com", location_code: 2682, language_code: "ar" });
assert.equal(saved.language_code, "ar");
```

- [ ] **Step 2: Run `node --test tests/site-profiles-migration.test.mjs tests/site-profiles-storage.test.mjs`.**

Expected: FAIL on missing migration and module.

- [ ] **Step 3: Add migration `0007` with the exact constrained fields.**

```sql
CREATE TABLE IF NOT EXISTS site_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  location_code INTEGER NOT NULL DEFAULT 2840,
  location_name TEXT NOT NULL DEFAULT 'United States',
  country_iso_code TEXT NOT NULL DEFAULT 'US',
  language_code TEXT NOT NULL DEFAULT 'en',
  language_name TEXT NOT NULL DEFAULT 'English',
  include_subdomains INTEGER NOT NULL DEFAULT 0 CHECK (include_subdomains IN (0,1)),
  competitors_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 4: Implement normalization and D1 statements, including maximum five competitors and final-profile deletion protection.**

```js
if (competitors.length > 5) throw new SiteProfileError("TOO_MANY_COMPETITORS", 400);
const count = await db.prepare("SELECT COUNT(*) AS count FROM site_profiles").first();
if (Number(count.count) <= 1) throw new SiteProfileError("LAST_PROFILE", 409);
```

- [ ] **Step 5: Update tracked Preview migration configuration to include `0007_site_profiles.sql`.**

- [ ] **Step 6: Run both tests and execute the migration against an in-memory SQLite-compatible test database.**

Run: `node --test tests/site-profiles-migration.test.mjs tests/site-profiles-storage.test.mjs`

- [ ] **Step 7: Commit.**

```bash
git add migrations/0007_site_profiles.sql src/v2/storage/site-profiles.js wrangler.migrations.jsonc .github/workflows/cloudflare-preview-migrate.yml tests/site-profiles-*.test.mjs
git commit -m "feat: persist site market profiles"
```

### Task 3: Zero-cost site-profile API

**Files:**
- Create: `functions/api/v2/sites/index.js`
- Create: `tests/site-profiles-api.test.mjs`

**Interfaces:**
- Consumes: Task 2 storage functions and `env.DB`.
- Produces: `GET`, `POST`, `PATCH`, and `DELETE` handlers at `/api/v2/sites`; JSON export through `GET ?format=export`.

- [ ] **Step 1: Write failing request tests for list, upsert, update, delete, export, 64 KB body limit, invalid market, and missing binding.**

```js
const response = await onRequestPost({ request: jsonRequest({ domain: "example.com", location_code: 2682, language_code: "ar" }), env });
assert.equal(response.status, 200);
assert.equal((await response.json()).meta.actual_cost_usd, 0);
assert.equal(providerCalls, 0);
```

- [ ] **Step 2: Run `node --test tests/site-profiles-api.test.mjs`.**

Expected: FAIL because the Pages Function does not exist.

- [ ] **Step 3: Implement method routing, streaming body-size enforcement, structured errors, and zero-cost metadata.**

```js
return json({ ok: true, data, meta: { actual_cost_usd: 0, provider_requests: 0 } });
```

- [ ] **Step 4: Verify no code path reads provider credentials or calls `fetch`.**

Run: `node --test tests/site-profiles-api.test.mjs`

- [ ] **Step 5: Commit.**

```bash
git add functions/api/v2/sites/index.js tests/site-profiles-api.test.mjs
git commit -m "feat: add zero-cost site profile API"
```

### Task 4: Shared browser market context and searchable selectors

**Files:**
- Create: `public/v2-market-context.js`
- Create: `public/v2-market-selector.css`
- Modify: `public/v2-shell.js`
- Modify: `public/v2.html`
- Create: `tests/v2-market-context.test.mjs`
- Create: `tests/v2-market-ui.test.mjs`

**Interfaces:**
- Consumes: `/data/v2-markets.json` and `/api/v2/sites`.
- Produces: `createMarketContext(initial)`, `marketRequestFields(context)`, `applyMarketToRoot(root, market)`, and header/site-management controls.

- [ ] **Step 1: Write failing pure-context and markup tests.**

```js
const context = createMarketContext({ location_code: 2682, language_code: "ar" });
assert.deepEqual(marketRequestFields(context), { location_code: 2682, language_code: "ar" });
assert.equal(submitEvents, 0);
```

- [ ] **Step 2: Run `node --test tests/v2-market-context.test.mjs tests/v2-market-ui.test.mjs`.**

Expected: FAIL on missing context module and controls.

- [ ] **Step 3: Implement catalog loading, searchable datalist/combobox behavior, pinned options, context subscriptions, and site-specific defaults.**

```js
export function marketRequestFields(context) {
  const market = context.get();
  return { location_code: market.location_code, language_code: market.language_code };
}
```

- [ ] **Step 4: Replace local-only site loading with D1-first loading and explicit synchronization warning fallback.**

- [ ] **Step 5: Add site competitor inputs capped at five and a JSON export action.**

- [ ] **Step 6: Run both UI tests and verify static IDs remain unique.**

- [ ] **Step 7: Commit.**

```bash
git add public/v2-market-context.js public/v2-market-selector.css public/v2-shell.js public/v2.html tests/v2-market-*.test.mjs
git commit -m "feat: add shared global market selector"
```

### Task 5: Wire every keyword and competitor request to active market

**Files:**
- Modify: `public/v2.html`
- Modify: `public/v2-shell.js`
- Create: `tests/v2-market-request-wiring.test.mjs`

**Interfaces:**
- Consumes: `marketRequestFields()` from Task 4.
- Affects: Keyword Overview, Ideas, SERP Weakness, SEO Opportunity, Competitor Snapshot, and Keyword Gap requests.

- [ ] **Step 1: Write a failing source/behavior test that enumerates all six endpoint paths and rejects browser-side `language_code:"en"`.**

```js
for (const endpoint of expectedEndpoints) assert.equal(captured[endpoint].location_code, 2682);
assert.doesNotMatch(browserSource, /language_code\s*:\s*["']en["']/);
```

- [ ] **Step 2: Run `node --test tests/v2-market-request-wiring.test.mjs`.**

Expected: FAIL because current browser requests hard-code English.

- [ ] **Step 3: Build each request body from the active market fields and keep existing endpoint-specific fields unchanged.**

- [ ] **Step 4: Verify switching market changes request construction but does not invoke `fetch` until a user submits an existing form.**

- [ ] **Step 5: Run all market tests and existing keyword/competitor tests.**

Run: `node --test tests/v2-market-*.test.mjs tests/*keyword*.test.mjs`

- [ ] **Step 6: Commit.**

```bash
git add public/v2.html public/v2-shell.js tests/v2-market-request-wiring.test.mjs
git commit -m "feat: apply active market to SEO research"
```

### Task 6: Regression, migration, review, and Preview validation

**Files:**
- Modify only when a confirmed Critical or Important defect requires a regression fix.

**Interfaces:**
- Produces: reviewed `seo-pro-v2` commit, applied Preview migration `0007`, and verified zero-cost Preview behavior.

- [ ] **Step 1: Run the complete suite.**

Run: `node --test tests/*.test.mjs`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run syntax, duplicate-ID, portability, and diff checks.**

```bash
node --check public/v2-market-context.js
node --check public/v2-shell.js
git diff --check
```

- [ ] **Step 3: Request independent review of the complete diff and fix every confirmed Critical or Important issue with a failing regression test first.**

- [ ] **Step 4: Atomically push the reviewed tree to `seo-pro-v2` without changing `main`.**

- [ ] **Step 5: Wait for the tracked Preview workflow to apply `0007_site_profiles.sql` and verify the table/columns through the workflow result.**

- [ ] **Step 6: Verify Preview with two site profiles and two different markets; do not submit a keyword or competitor form.**

Expected: changing site/market issues only zero-cost site-profile/catalog requests, all paid controls remain unchecked, and D1 usage totals are unchanged.

- [ ] **Step 7: Report remote commit SHA, full test count, migration result, Preview URL, and cost totals before/after.**

