import assert from "node:assert/strict";
import test from "node:test";

import { backlinkSnapshotCacheKey } from "../src/v2/backlinks/domain.js";
import { buildCompetitorSnapshotCacheKey } from "../src/v2/dashboard/cache-keys.js";
import { normalizeDashboardModule, normalizeDashboardScope } from "../src/v2/dashboard/contracts.js";
import { refreshDashboard } from "../src/v2/dashboard/refresh-dashboard.js";
import { readLatestDashboard, writeDashboardSnapshot } from "../src/v2/storage/site-dashboard.js";
import {
  d1For,
  dashboardDatabase,
  memoryCache,
  providerResponse,
  rankedKeywordsPayload,
  seedProfile,
} from "./dashboard-test-helpers.mjs";

const SCOPE = { site: "example.com", location_code: 2840, language_code: "en" };

function competitorData(domain, rankedKeywords = 12) {
  return {
    domain,
    organic: { ranked_keywords: rankedKeywords, estimated_monthly_traffic: 34, estimated_paid_traffic_cost_usd: 5 },
    top_keywords: [],
  };
}

function body(modules, confirmed = modules) {
  return { ...SCOPE, modules, confirmed_live_modules: confirmed };
}

async function withFetch(fetchImpl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function providerDependencies(overrides = {}) {
  return {
    fetchCompetitorSnapshot: async ({ domain }) => ({ data: competitorData(domain), task_count: 1, actual_cost_usd: 0.1 }),
    fetchKeywordGap: async () => ({ data: { opportunities: [], total_gap_keywords: 0 }, task_count: 1, actual_cost_usd: 0.1 }),
    fetchBacklinkSummary: async () => ({ data: { target: "example.com", generated_at: new Date().toISOString(), metrics: {} }, taskCount: 1, actualCostUsd: 0.1 }),
    fetchBacklinkGap: async () => ({ data: { items: [], generated_at: new Date().toISOString() }, taskCount: 1, actualCostUsd: 0.1 }),
    ...overrides,
  };
}

test("lease acquisition and authoritative backlink cache checks fail closed before providers", async () => {
  const firstDb = await dashboardDatabase();
  await seedProfile(firstDb.d1);
  let providerCalls = 0;
  const failingLeaseDb = d1For(firstDb.raw, {
    before({ method, sql }) {
      if (method === "run" && /INSERT INTO dashboard_refresh_leases/.test(sql)) throw new Error("D1 lease unavailable");
    },
  });
  const dependencies = providerDependencies({
    fetchCompetitorSnapshot: async () => { providerCalls += 1; throw new Error("provider must not run"); },
  });
  const leaseResult = await withFetch(async () => {
    providerCalls += 1;
    throw new Error("provider must not run");
  }, () => refreshDashboard({
    body: body(["organic"]),
    env: { DB: failingLeaseDb, CACHE: memoryCache(), DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" },
    dependencies,
  }));
  assert.equal(leaseResult.status, 503);
  assert.equal(leaseResult.body.error.code, "DASHBOARD_LEASE_UNAVAILABLE");
  assert.equal(leaseResult.body.meta.total_actual_cost_usd, 0);
  assert.equal(providerCalls, 0);

  const secondDb = await dashboardDatabase();
  await seedProfile(secondDb.d1);
  let snapshotReads = 0;
  const failingRecheckDb = d1For(secondDb.raw, {
    before({ method, sql }) {
      if (method === "first" && /FROM backlink_snapshots/.test(sql) && ++snapshotReads === 2) {
        throw new Error("authoritative D1 cache check failed");
      }
    },
  });
  const backlinkDependencies = providerDependencies({
    fetchBacklinkSummary: async () => { providerCalls += 1; throw new Error("provider must not run"); },
  });
  const recheckResult = await withFetch(async () => {
    providerCalls += 1;
    throw new Error("provider must not run");
  }, () => refreshDashboard({
    body: body(["backlinks"]),
    env: { DB: failingRecheckDb, CACHE: memoryCache(), DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" },
    dependencies: backlinkDependencies,
  }));
  assert.equal(recheckResult.status, 503);
  assert.equal(recheckResult.body.error.code, "DASHBOARD_CACHE_STATE_UNAVAILABLE");
  assert.equal(recheckResult.body.meta.total_actual_cost_usd, 0);
  assert.equal(providerCalls, 0);
});

test("authorization is decided before joining and a scope lease protects overlapping module sets", async () => {
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1, { competitors: ["rival.example"] });
  const cache = memoryCache();
  let providerCalls = 0;
  let releaseProvider;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const providerGate = new Promise((resolve) => { releaseProvider = resolve; });
  const dependencies = providerDependencies({
    async fetchCompetitorSnapshot({ domain }) {
      providerCalls += 1;
      markStarted();
      await providerGate;
      return { data: competitorData(domain), task_count: 1, actual_cost_usd: 0.1 };
    },
  });
  const fetchImpl = async (_url, options) => {
    providerCalls += 1;
    markStarted();
    await providerGate;
    const domain = JSON.parse(options.body)[0].target;
    return providerResponse(rankedKeywordsPayload({ domain }));
  };

  await withFetch(fetchImpl, async () => {
    const confirmed = refreshDashboard({
      body: body(["organic"]), env: { DB: d1, CACHE: cache, DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" }, dependencies,
    });
    await started;
    const unconfirmed = refreshDashboard({
      body: body(["organic"], []), env: { DB: d1, CACHE: cache, DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" }, dependencies,
    });
    const overlapping = refreshDashboard({
      body: body(["organic", "competitors"]), env: { DB: d1, CACHE: cache, DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" }, dependencies,
    });
    await Promise.resolve();
    releaseProvider();
    const [confirmedResult, unconfirmedResult, overlappingResult] = await Promise.all([confirmed, unconfirmed, overlapping]);
    assert.equal(confirmedResult.status, 200);
    assert.equal(unconfirmedResult.status, 409);
    assert.equal(unconfirmedResult.body.error.code, "LIVE_REQUEST_CONFIRMATION_REQUIRED");
    assert.equal(unconfirmedResult.body.meta.total_actual_cost_usd, 0);
    assert.equal(overlappingResult.status, 409);
    assert.equal(overlappingResult.body.error.code, "REFRESH_ALREADY_RUNNING");
    assert.equal(providerCalls, 1);
  });
});

test("a paid call longer than the original TTL renews its owned lease", async () => {
  const database = await dashboardDatabase();
  await seedProfile(database.d1);
  let renewals = 0;
  const d1 = d1For(database.raw, {
    after({ method, sql, result }) {
      if (method === "run" && /UPDATE dashboard_refresh_leases/.test(sql) && Number(result?.meta?.changes) > 0) renewals += 1;
    },
  });
  const dependencies = providerDependencies({
    leaseDurationMs: 30,
    leaseHeartbeatMs: 8,
    async fetchCompetitorSnapshot({ domain }) {
      await new Promise((resolve) => setTimeout(resolve, 70));
      return { data: competitorData(domain), task_count: 1, actual_cost_usd: 0.1 };
    },
  });
  const result = await withFetch(async (_url, options) => {
    await new Promise((resolve) => setTimeout(resolve, 70));
    return providerResponse(rankedKeywordsPayload({ domain: JSON.parse(options.body)[0].target }));
  }, () => refreshDashboard({
    body: body(["organic"]),
    env: { DB: d1, CACHE: memoryCache(), DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" },
    dependencies,
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.data.modules.organic.status, "success");
  assert.ok(renewals >= 2, `expected at least two renewals, got ${renewals}`);
});

test("lease ownership loss before provider entry records no provider attempt", async () => {
  const database = await dashboardDatabase();
  await seedProfile(database.d1);
  let stolen = false;
  let providerCalls = 0;
  const d1 = d1For(database.raw, {
    before({ method, sql }) {
      if (!stolen && method === "run" && /UPDATE dashboard_refresh_leases/.test(sql)) {
        stolen = true;
        database.raw.prepare("UPDATE dashboard_refresh_leases SET request_id = 'stolen-owner'").run();
      }
    },
  });
  const dependencies = providerDependencies({
    leaseDurationMs: 30,
    leaseHeartbeatMs: 8,
    fetchCompetitorSnapshot: ({ signal, domain }) => new Promise((resolve, reject) => {
      providerCalls += 1;
      const timer = setTimeout(() => resolve({ data: competitorData(domain), task_count: 1, actual_cost_usd: 0.1 }), 80);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
    }),
  });
  const result = await withFetch(async (_url, options) => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return providerResponse(rankedKeywordsPayload({ domain: JSON.parse(options.body)[0].target }));
  }, () => refreshDashboard({
    body: body(["organic"]),
    env: { DB: d1, CACHE: memoryCache(), DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" },
    dependencies,
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.data.modules.organic.status, "error");
  assert.equal(result.body.data.modules.organic.error.code, "REFRESH_LEASE_LOST");
  assert.equal(result.body.data.modules.organic.provider_attempts, 0);
  assert.equal(result.body.data.modules.organic.task_count, 0);
  assert.equal(result.body.data.modules.organic.actual_cost_usd, 0);
  assert.equal(result.body.meta.task_count, 0);
  assert.equal(result.body.meta.actual_cost_usd, 0);
  assert.equal(providerCalls, 0);
  assert.equal(database.raw.prepare("SELECT COUNT(*) AS count FROM api_usage").get().count, 0);
  assert.equal(database.raw.prepare("SELECT COUNT(*) AS count FROM site_dashboard_snapshots").get().count, 0);
});

test("lease ownership loss after a provider response preserves accounting but discards provider data", async () => {
  const database = await dashboardDatabase();
  await seedProfile(database.d1);
  let stolen = false;
  let providerCalls = 0;
  const cache = memoryCache();
  const d1 = d1For(database.raw, {
    before({ method, sql }) {
      if (!stolen && method === "first" && /FROM dashboard_refresh_leases/.test(sql)) {
        stolen = true;
        database.raw.prepare("UPDATE dashboard_refresh_leases SET request_id = 'stolen-owner'").run();
      }
    },
  });
  const dependencies = providerDependencies({
    async fetchCompetitorSnapshot({ domain }) {
      providerCalls += 1;
      return { data: competitorData(domain, 999), task_count: 2, actual_cost_usd: 0.42 };
    },
  });

  const result = await refreshDashboard({
    body: body(["organic"]),
    env: { DB: d1, CACHE: cache, DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" },
    dependencies,
  });

  const module = result.body.data.modules.organic;
  assert.equal(providerCalls, 1);
  assert.equal(module.status, "error");
  assert.equal(module.error.code, "REFRESH_LEASE_LOST");
  assert.equal(module.error.message, "This dashboard module could not be refreshed.");
  assert.equal(module.provider_attempts, 1);
  assert.equal(module.task_count, 2);
  assert.equal(module.actual_cost_usd, 0.42);
  assert.equal(result.body.meta.task_count, 2);
  assert.equal(result.body.meta.actual_cost_usd, 0.42);
  assert.equal(cache.writes.length, 0);
  assert.equal(database.raw.prepare("SELECT COUNT(*) AS count FROM site_dashboard_snapshots").get().count, 0);
  assert.deepEqual(
    { ...database.raw.prepare("SELECT status, task_count, actual_cost_usd FROM api_usage WHERE cache_hit = 0").get() },
    { status: "error", task_count: 2, actual_cost_usd: 0.42 },
  );
});

test("module failures are logged, isolated, and cannot discard earlier or later successes", async () => {
  const { raw, d1 } = await dashboardDatabase();
  await seedProfile(d1, { competitors: ["rival.example"] });
  const cache = memoryCache({
    [buildCompetitorSnapshotCacheKey("example.com", 2840, "en")]: { data: competitorData("example.com"), cached_at: "2026-08-31T10:00:00.000Z" },
    [buildCompetitorSnapshotCacheKey("rival.example", 2840, "en")]: { data: competitorData("rival.example"), cached_at: "2026-08-31T09:00:00.000Z" },
  });
  let backlinkCalls = 0;
  const failure = Object.assign(new Error("provider failed"), { code: "BACKLINK_PROVIDER_FAILED", actualCostUsd: 0.31, taskCount: 1 });
  const dependencies = providerDependencies({
    fetchBacklinkSummary: async () => { backlinkCalls += 1; throw failure; },
  });
  const result = await withFetch(async (url) => {
    if (url.includes("backlinks/summary")) {
      backlinkCalls += 1;
      return providerResponse({ status_code: 50000, cost: 0.31, tasks_count: 1, tasks: [{ status_code: 50000, cost: 0.31 }] });
    }
    throw new Error(`unexpected provider call ${url}`);
  }, () => refreshDashboard({
    body: body(["organic", "backlinks", "competitors"], ["backlinks"]),
    env: { DB: d1, CACHE: cache, DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" },
    dependencies,
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.data.modules.organic.status, "success");
  assert.equal(result.body.data.modules.backlinks.status, "error");
  assert.equal(result.body.data.modules.backlinks.actual_cost_usd, 0.31);
  assert.equal(result.body.data.modules.competitors.status, "success");
  assert.equal(backlinkCalls, 1);
  const latest = await readLatestDashboard(d1, SCOPE);
  assert.equal(latest.modules.organic.availability, "available");
  assert.equal(latest.modules.competitors.availability, "available");
  const logged = raw.prepare("SELECT endpoint, status, actual_cost_usd FROM api_usage WHERE cache_hit = 0 ORDER BY created_at").all();
  assert.ok(logged.some((row) => row.endpoint === "dashboard/backlinks" && row.status === "error" && row.actual_cost_usd === 0.31));
});

test("partial competitor refresh continues all attempts and retains the previous complete module", async () => {
  const { d1 } = await dashboardDatabase();
  const competitors = ["one.example", "two.example", "three.example"];
  await seedProfile(d1, { competitors });
  const scope = normalizeDashboardScope(SCOPE);
  const previousRows = competitors.map((domain, index) => ({ domain, ranked_keywords: index + 10, estimated_traffic: index + 20 }));
  await writeDashboardSnapshot(d1, scope, {
    competitors: normalizeDashboardModule("competitors", { rows: previousRows }, {
      source: "live", updated_at: "2026-08-30T12:00:00.000Z", scope,
    }),
  }, { now: () => new Date("2026-08-30T12:00:00.000Z") });
  const attempted = [];
  const dependencies = providerDependencies({
    async fetchCompetitorSnapshot({ domain }) {
      attempted.push(domain);
      if (domain === "two.example") throw Object.assign(new Error("failed"), { code: "COMPETITOR_SNAPSHOT_FAILED", actual_cost_usd: 0.2, task_count: 1 });
      return { data: competitorData(domain, 99), task_count: 1, actual_cost_usd: 0.1 };
    },
  });
  const result = await withFetch(async (_url, options) => {
    const domain = JSON.parse(options.body)[0].target;
    attempted.push(domain);
    if (domain === "two.example") return providerResponse({ status_code: 50000, cost: 0.2, tasks_count: 1, tasks: [{ status_code: 50000, cost: 0.2 }] });
    return providerResponse(rankedKeywordsPayload({ domain }));
  }, () => refreshDashboard({
    body: body(["competitors"]),
    env: { DB: d1, CACHE: memoryCache(), DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" },
    dependencies,
  }));

  assert.equal(result.body.data.modules.competitors.status, "partial_failure");
  assert.deepEqual(attempted, competitors);
  const latest = await readLatestDashboard(d1, scope);
  assert.deepEqual(latest.modules.competitors.data.rows, previousRows);
});

test("unknown per-attempt accounting stays null and every provider attempt gets its own usage row", async () => {
  const { raw, d1 } = await dashboardDatabase();
  const competitors = ["one.example", "two.example"];
  await seedProfile(d1, { competitors });
  const dependencies = providerDependencies({
    async fetchCompetitorSnapshot({ domain }) {
      return domain === "one.example"
        ? { data: competitorData(domain), task_count: 1, actual_cost_usd: 0.1 }
        : { data: competitorData(domain), task_count: null, actual_cost_usd: null };
    },
  });
  const result = await withFetch(async (_url, options) => {
    const domain = JSON.parse(options.body)[0].target;
    return providerResponse(rankedKeywordsPayload({
      domain,
      cost: domain === "one.example" ? 0.1 : null,
      taskCount: domain === "one.example" ? 1 : undefined,
    }));
  }, () => refreshDashboard({
    body: body(["competitors"]),
    env: { DB: d1, CACHE: memoryCache(), DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" },
    dependencies,
  }));

  assert.equal(result.body.data.modules.competitors.actual_cost_usd, null);
  assert.equal(result.body.data.modules.competitors.task_count, null);
  assert.equal(result.body.meta.actual_cost_usd, null);
  assert.equal(result.body.meta.total_actual_cost_usd, null);
  assert.equal(result.body.meta.task_count, null);
  const rows = raw.prepare("SELECT request_id, endpoint, task_count, actual_cost_usd FROM api_usage WHERE cache_hit = 0 ORDER BY request_id").all();
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].request_id, rows[1].request_id);
  assert.equal(rows[1].task_count, null);
  assert.equal(rows[1].actual_cost_usd, null);
});

test("usage persistence failure is surfaced as an accounting warning", async () => {
  const database = await dashboardDatabase();
  await seedProfile(database.d1);
  const d1 = d1For(database.raw, {
    before({ method, sql }) {
      if (method === "run" && /INSERT INTO api_usage/.test(sql)) throw new Error("usage D1 failed");
    },
  });
  const result = await withFetch(async (_url, options) => providerResponse(rankedKeywordsPayload({ domain: JSON.parse(options.body)[0].target })), () => refreshDashboard({
    body: body(["organic"]),
    env: { DB: d1, CACHE: memoryCache(), DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" },
    dependencies: providerDependencies(),
  }));
  assert.equal(result.status, 200);
  assert.match(result.body.warnings.join(" "), /accounting/i);
  assert.match(result.body.data.modules.organic.warning, /accounting/i);
});

test("legacy cached data with no source timestamp never becomes fresh at request time", async () => {
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1);
  const cache = memoryCache({
    [buildCompetitorSnapshotCacheKey("example.com", 2840, "en")]: competitorData("example.com"),
  });
  const result = await refreshDashboard({
    body: body(["organic"], []),
    env: { DB: d1, CACHE: cache },
    now: () => new Date("2099-01-01T00:00:00.000Z"),
    dependencies: providerDependencies(),
  });
  assert.equal(result.body.data.modules.organic.updated_at, null);
  const latest = await readLatestDashboard(d1, SCOPE);
  assert.equal(latest.modules.organic.availability, "available");
  assert.equal(latest.modules.organic.updated_at, null);
  assert.notEqual(latest.modules.organic.updated_at, "2099-01-01T00:00:00.000Z");
});

test("competitor snapshot and keyword-gap paths reject oversized declared and chunked JSON", async () => {
  const first = await dashboardDatabase();
  await seedProfile(first.d1);
  const declared = await withFetch(async () => providerResponse(rankedKeywordsPayload(), { headers: { "content-length": String((4 * 1024 * 1024) + 1) } }), () => refreshDashboard({
    body: body(["organic"]),
    env: { DB: first.d1, CACHE: memoryCache(), DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" },
  }));
  assert.equal(declared.body.data.modules.organic.status, "error");
  assert.equal(declared.body.data.modules.organic.error.code, "PROVIDER_RESPONSE_TOO_LARGE");

  const second = await dashboardDatabase();
  await seedProfile(second.d1, { competitors: ["rival.example"] });
  const oversizedPayload = JSON.stringify({ ...rankedKeywordsPayload(), padding: "x".repeat((4 * 1024 * 1024) + 1) });
  const bytes = new TextEncoder().encode(oversizedPayload);
  const chunked = await withFetch(async () => new Response(new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 65536) controller.enqueue(bytes.slice(offset, offset + 65536));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "application/json" } }), () => refreshDashboard({
    body: body(["keyword_opportunities"]),
    env: { DB: second.d1, CACHE: memoryCache(), DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" },
  }));
  assert.equal(chunked.body.data.modules.keyword_opportunities.status, "error");
  assert.equal(chunked.body.data.modules.keyword_opportunities.error.code, "PROVIDER_RESPONSE_TOO_LARGE");
});

test("cached backlink snapshots keep their source timestamp instead of refresh time", async () => {
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1);
  const cache = memoryCache({
    [backlinkSnapshotCacheKey("example.com")]: { target: "example.com", generated_at: "2026-08-01T00:00:00.000Z", metrics: { backlinks: 4 } },
  });
  const result = await refreshDashboard({
    body: body(["backlinks"], []),
    env: { DB: d1, CACHE: cache },
    now: () => new Date("2099-01-01T00:00:00.000Z"),
    dependencies: providerDependencies(),
  });
  assert.equal(result.body.data.modules.backlinks.updated_at, "2026-08-01T00:00:00.000Z");
});
