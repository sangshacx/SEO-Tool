import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  DASHBOARD_SCHEMA_VERSION,
  normalizeDashboardModule,
  normalizeDashboardScope,
} from "../src/v2/dashboard/contracts.js";
import {
  acquireDashboardRefreshLease,
  readDashboardHistory,
  readLatestDashboard,
  releaseDashboardRefreshLease,
  renewDashboardRefreshLease,
  ownsDashboardRefreshLease,
  writeDashboardSnapshot,
} from "../src/v2/storage/site-dashboard.js";

function d1For(database) {
  let inBatch = false;
  let batchChain = Promise.resolve();
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        bind(...values) {
          const bound = {
            _sql: sql,
            async all() { return { results: statement.all(...values) }; },
            async first() { return statement.get(...values) ?? null; },
            async run() {
              const result = statement.run(...values);
              return { success: true, meta: { changes: result.changes } };
            },
          };
          return bound;
        },
      };
    },
    batch: async (statements) => {
      const operation = batchChain.catch(() => {}).then(async () => {
        inBatch = true;
        database.exec("BEGIN");
        try {
          const results = [];
          for (const statement of statements) {
            results.push(/^\s*SELECT/i.test(statement._sql)
              ? await statement.all()
              : await statement.run());
          }
          database.exec("COMMIT");
          return results;
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        } finally {
          inBatch = false;
        }
      });
      batchChain = operation;
      return operation;
    },
    get inBatch() {
      return inBatch;
    },
  };
}

async function dashboardDb() {
  const db = new DatabaseSync(":memory:");
  for (const file of [
    "0001_alpha_core.sql",
    "0004_backlink_history.sql",
    "0005_backlink_opportunities.sql",
    "0006_backlink_outreach_intelligence.sql",
    "0007_site_profiles.sql",
    "0008_site_dashboard_snapshots.sql",
    "0009_nullable_api_usage_task_count.sql",
    "0010_atomic_dashboard_modules.sql",
  ]) {
    db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  return { raw: db, d1: d1For(db) };
}

test("normalizes dashboard scope and module contracts, including safe __proto__ data", () => {
  const scope = normalizeDashboardScope({
    domain: "https://blog.example.com/path",
    location_code: 2840,
    language_code: "EN",
  });
  assert.deepEqual(scope, {
    domain: "example.com",
    site: "example.com",
    location_code: 2840,
    location_name: "United States",
    country_iso_code: "US",
    language_code: "en",
    language_name: "English",
  });

  const module = normalizeDashboardModule("organic", JSON.parse('{"__proto__":{"preserved":true},"organic_traffic":0}'), {
    source: "d1",
    updated_at: "2026-08-31T12:00:00.000Z",
    scope,
  });
  assert.equal(module.availability, "available");
  assert.equal(module.schema_version, DASHBOARD_SCHEMA_VERSION);
  assert.equal(module.updated_at, "2026-08-31T12:00:00.000Z");
  assert.equal(Object.keys(module.data).includes("__proto__"), true);
  assert.deepEqual(module.data.__proto__, { preserved: true });

  const unavailable = normalizeDashboardModule("organic", null, { scope });
  assert.equal(unavailable.availability, "unavailable");
  assert.equal(unavailable.data, null);

  assert.throws(() => normalizeDashboardModule("organic", { x: 1 }, {
    source: "unknown",
    updated_at: "2026-08-31T12:00:00.000Z",
    scope,
  }), /source/i);
  assert.throws(() => normalizeDashboardModule("organic", { padding: "x".repeat(70 * 1024) }, {
    source: "d1",
    updated_at: "2026-08-31T12:00:00.000Z",
    scope,
  }), /64/i);
});

test("writes partial dashboard merges, deduplicates identical results for fifteen minutes, and keeps capture times monotonic", async () => {
  const { raw, d1 } = await dashboardDb();
  const scope = normalizeDashboardScope({ domain: "example.com", location_code: 2840, language_code: "en" });

  const organic = normalizeDashboardModule("organic", {
    organic_keywords: 10,
    organic_traffic: 100,
    traffic_value: 12.5,
  }, { source: "live", updated_at: "2026-08-31T12:00:00.000Z", scope });
  const backlinks = normalizeDashboardModule("backlinks", {
    domain_rank: 40,
    backlinks: 200,
    referring_domains: 25,
  }, { source: "live", updated_at: "2026-08-31T12:05:00.000Z", scope });

  const first = await writeDashboardSnapshot(d1, scope, { organic }, { now: () => new Date("2026-08-31T12:10:00.000Z") });
  assert.equal(first.inserted, true);

  const second = await writeDashboardSnapshot(d1, scope, { backlinks }, { now: () => new Date("2026-08-31T12:10:00.000Z") });
  assert.equal(second.inserted, true);

  const deduped = await writeDashboardSnapshot(d1, scope, { backlinks }, { now: () => new Date("2026-08-31T12:20:00.000Z") });
  assert.equal(deduped.inserted, false);
  assert.equal(deduped.deduped, true);

  const delayed = await writeDashboardSnapshot(d1, scope, { backlinks }, { now: () => new Date("2026-08-31T12:31:00.000Z") });
  assert.equal(delayed.inserted, true);

  const latest = await readLatestDashboard(d1, scope);
  assert.equal(latest.modules.organic.availability, "available");
  assert.equal(latest.modules.backlinks.availability, "available");
  assert.ok(Date.parse(latest.captured_at) > Date.parse(first.captured_at));

  const count = raw.prepare("SELECT COUNT(*) AS count FROM site_dashboard_snapshots").get().count;
  assert.equal(count, 3);
});

test("serializes concurrent partial writes so no module update is lost and history reads are scoped", async () => {
  const { d1 } = await dashboardDb();
  const scope = normalizeDashboardScope({ domain: "https://www.example.com", location_code: 2840, language_code: "en" });

  const organic = normalizeDashboardModule("organic", {
    organic_keywords: 11,
    organic_traffic: 101,
    traffic_value: 13,
  }, { source: "live", updated_at: "2026-08-31T12:00:00.000Z", scope });
  const backlinks = normalizeDashboardModule("backlinks", {
    domain_rank: 41,
    backlinks: 201,
    referring_domains: 26,
  }, { source: "live", updated_at: "2026-08-31T12:01:00.000Z", scope });

  await Promise.all([
    writeDashboardSnapshot(d1, scope, { organic }, { now: () => new Date("2026-08-31T12:10:00.000Z") }),
    writeDashboardSnapshot(d1, scope, { backlinks }, { now: () => new Date("2026-08-31T12:10:00.000Z") }),
  ]);

  const latest = await readLatestDashboard(d1, scope);
  assert.equal(latest.modules.organic.availability, "available");
  assert.equal(latest.modules.backlinks.availability, "available");

  const history = await readDashboardHistory(d1, scope, 365);
  assert.ok(history.organic.length >= 1);
  assert.ok(history.backlinks.length >= 1);
});

test("cross-isolate partial writes atomically retain every module for one scope", async () => {
  const { d1 } = await dashboardDb();
  const scope = normalizeDashboardScope({ domain: "example.com", location_code: 2840, language_code: "en" });
  const organic = normalizeDashboardModule("organic", { organic_keywords: 12 }, {
    source: "live", updated_at: "2026-08-31T12:00:00.000Z", scope,
  });
  const backlinks = normalizeDashboardModule("backlinks", { backlinks: 34 }, {
    source: "live", updated_at: "2026-08-31T12:01:00.000Z", scope,
  });
  const moduleUrl = new URL("../src/v2/storage/site-dashboard.js", import.meta.url);
  const [isolateA, isolateB] = await Promise.all([
    import(`${moduleUrl.href}?isolate=${crypto.randomUUID()}`),
    import(`${moduleUrl.href}?isolate=${crypto.randomUUID()}`),
  ]);

  await Promise.all([
    isolateA.writeDashboardSnapshot(d1, scope, { organic }, { now: () => new Date("2026-08-31T12:10:00.000Z") }),
    isolateB.writeDashboardSnapshot(d1, scope, { backlinks }, { now: () => new Date("2026-08-31T12:10:00.000Z") }),
  ]);

  const latest = await readLatestDashboard(d1, scope);
  assert.equal(latest.modules.organic.data.organic_keywords, 12);
  assert.equal(latest.modules.backlinks.data.backlinks, 34);
});

test("a malformed newest snapshot falls back to the two most recent valid snapshots", async () => {
  const { raw, d1 } = await dashboardDb();
  const scope = normalizeDashboardScope({ domain: "example.com", location_code: 2840, language_code: "en" });
  const moduleAt = (keywords, updatedAt) => normalizeDashboardModule("organic", { organic_keywords: keywords }, {
    source: "d1", updated_at: updatedAt, scope,
  });
  const insert = raw.prepare(
    `INSERT INTO site_dashboard_snapshots
      (site_domain, location_code, language_code, modules_json, captured_at, schema_version)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insert.run(scope.domain, scope.location_code, scope.language_code, JSON.stringify({ organic: moduleAt(10, "2026-08-31T10:00:00.000Z") }), "2026-08-31T10:00:00.000Z", DASHBOARD_SCHEMA_VERSION);
  insert.run(scope.domain, scope.location_code, scope.language_code, JSON.stringify({ organic: moduleAt(20, "2026-08-31T11:00:00.000Z") }), "2026-08-31T11:00:00.000Z", DASHBOARD_SCHEMA_VERSION);
  insert.run(scope.domain, scope.location_code, scope.language_code, "{broken", "2026-08-31T12:00:00.000Z", DASHBOARD_SCHEMA_VERSION);

  const latest = await readLatestDashboard(d1, scope);
  assert.equal(latest.modules.organic.data.organic_keywords, 20);
  assert.equal(latest.modules.organic.previous.organic_keywords, 10);
  assert.equal(latest.captured_at, "2026-08-31T11:00:00.000Z");
  assert.match(latest.warnings.join(" "), /ignored/i);
});

test("acquires, refreshes, and releases scoped dashboard leases safely", async () => {
  const { d1 } = await dashboardDb();
  const now = "2026-08-31T12:00:00.000Z";
  assert.equal(await acquireDashboardRefreshLease(d1, "scope:organic", "req-1", "2026-08-31T12:01:00.000Z", now), true);
  assert.equal(await acquireDashboardRefreshLease(d1, "scope:organic", "req-2", "2026-08-31T12:02:00.000Z", now), false);
  assert.equal(await releaseDashboardRefreshLease(d1, "scope:organic", "req-2"), false);
  assert.equal(await releaseDashboardRefreshLease(d1, "scope:organic", "req-1"), true);
  assert.equal(await acquireDashboardRefreshLease(d1, "scope:organic", "req-3", "2026-08-31T12:03:00.000Z", "2026-08-31T12:02:00.000Z"), true);
  assert.equal(await renewDashboardRefreshLease(d1, "scope:organic", "req-2", "2026-08-31T12:04:00.000Z", "2026-08-31T12:02:30.000Z"), false);
  assert.equal(await renewDashboardRefreshLease(d1, "scope:organic", "req-3", "2026-08-31T12:04:00.000Z", "2026-08-31T12:02:30.000Z"), true);
  assert.equal(await ownsDashboardRefreshLease(d1, "scope:organic", "req-3", "2026-08-31T12:03:30.000Z"), true);
  assert.equal(await ownsDashboardRefreshLease(d1, "scope:organic", "req-3", "2026-08-31T12:04:01.000Z"), false);
});
