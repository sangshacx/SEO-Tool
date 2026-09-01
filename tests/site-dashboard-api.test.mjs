import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { buildCompetitorSnapshotCacheKey, buildKeywordGapCacheKey } from "../src/v2/dashboard/cache-keys.js";
import { backlinkGapCacheKey } from "../src/v2/backlinks/domain.js";
import { normalizeDashboardModule, normalizeDashboardScope } from "../src/v2/dashboard/contracts.js";
import { writeDashboardSnapshot } from "../src/v2/storage/site-dashboard.js";
import { seedProfile } from "./dashboard-test-helpers.mjs";

const apiUrl = new URL("../functions/api/v2/dashboard/index.js", import.meta.url);

function request(query = "", headers = {}) {
  return new Request(`https://preview.example/api/v2/dashboard${query}`, {
    headers: {
      "cf-access-jwt-assertion": "trusted-test-assertion",
      ...headers,
    },
  });
}

function cache(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    async get(key, type) {
      const value = values.get(key);
      return type === "json" && typeof value === "string" ? JSON.parse(value) : value ?? null;
    },
    async put(key, value) {
      values.set(key, value);
    },
  };
}

function d1For(database) {
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        bind(...values) {
          return {
            async all() { return { results: statement.all(...values) }; },
            async first() { return statement.get(...values) ?? null; },
            async run() {
              const result = statement.run(...values);
              return { success: true, meta: { changes: result.changes } };
            },
          };
        },
      };
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

async function dashboardEnv() {
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
  return { raw: db, env: { DB: d1For(db), CACHE: cache() } };
}

async function importClosure(entry) {
  const seen = new Set();
  async function visit(file) {
    const absolute = resolve(file);
    if (seen.has(absolute)) return;
    seen.add(absolute);
    const source = await readFile(absolute, "utf8");
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g)) {
      if (!match[1].startsWith(".")) continue;
      let target = resolve(dirname(absolute), match[1]);
      if (!extname(target)) target += ".js";
      await visit(target);
    }
  }
  await visit(entry);
  return seen;
}

test("GET aggregates cached dashboard data with zero-cost metadata, canonical scope, prospect counts, and optional freshness warnings", async () => {
  const { onRequest, onRequestGet } = await import(apiUrl.href + `?case=${crypto.randomUUID()}`);
  const { env } = await dashboardEnv();
  const scope = normalizeDashboardScope({ domain: "blog.example.com", location_code: 2840, language_code: "EN" });
  await env.DB.prepare("INSERT INTO site_profiles (domain, label, location_code, location_name, country_iso_code, language_code, language_name, include_subdomains, competitors_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(scope.domain, "Example", scope.location_code, scope.location_name, scope.country_iso_code, scope.language_code, scope.language_name, 0, JSON.stringify(["rival.example"]))
    .run();

  await env.DB.prepare("INSERT INTO backlink_snapshots (domain, provider, source, domain_rank, backlinks, referring_domains, referring_ips, dofollow_pages, nofollow_share_percent, spam_score, broken_backlinks, health_score, health_grade, score_version, snapshot_at, actual_cost_usd) VALUES (?, 'dataforseo', 'cache', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(scope.domain, 48, 301, 44, 9, 200, 10, 1, 5, 80, "A", "v1", "2026-08-31T11:00:00.000Z", 0)
    .run();

  for (const [domain, status, competitorDomainsJson, reasonsJson, risksJson] of [
    ["prospect-one.example", "new", "[\"rival.example\"]", "[\"good topical fit\"]", "[\"manual review\"]"],
    ["prospect-two.example", "researching", "{broken", "{broken", "{broken"],
  ]) {
    await env.DB.prepare(
      `INSERT INTO backlink_opportunities (
        own_domain, referring_domain, competitor_domains_json, opportunity_score, opportunity_label, status, notes,
        quality_score, relevance_score, outreach_recommendation, outreach_confidence, outreach_reasons_json,
        outreach_risk_types_json, relevance_checked_at, first_discovered_at, last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(scope.domain, domain, competitorDomainsJson, 80, "High", status, "", 70, 65, "research_first", 80, reasonsJson, risksJson, null, "2026-08-29T00:00:00.000Z", "2026-08-31T00:00:00.000Z", "2026-08-31T00:00:00.000Z", `2026-08-31T0${status === "new" ? 1 : 2}:00:00.000Z`)
      .run();
  }

  await writeDashboardSnapshot(env.DB, scope, {
    organic: normalizeDashboardModule("organic", {
      organic_keywords: 123,
      organic_traffic: 456,
      traffic_value: 78.9,
    }, { source: "d1", updated_at: "2026-08-31T12:00:00.000Z", scope }),
    top_keywords: normalizeDashboardModule("top_keywords", {
      rows: [{ keyword: "waterproof membrane", position: 3, search_volume: 880, estimated_traffic: 30, keyword_difficulty: 12, cpc_usd: 1.2, ranking_url: "https://example.com/page" }],
    }, { source: "d1", updated_at: "2026-08-31T12:00:00.000Z", scope }),
  }, { now: () => new Date("2026-08-31T12:00:00.000Z") });

  env.CACHE = cache({
    [buildCompetitorSnapshotCacheKey("rival.example", scope.location_code, scope.language_code)]: JSON.stringify({
      data: {
        domain: "rival.example",
        organic: { ranked_keywords: 210, estimated_monthly_traffic: 999, estimated_paid_traffic_cost_usd: 12 },
        top_keywords: [],
      },
      cached_at: "not-an-iso",
    }),
    [buildKeywordGapCacheKey("rival.example", scope.domain, scope.location_code, scope.language_code)]: { total_gap_keywords: 18, opportunities: [{ keyword: "roof coating", intelligence: { gap_priority: { score: 77 } } }] },
    [await backlinkGapCacheKey({ ownDomain: scope.domain, competitors: ["rival.example"], limit: 25, offset: 0 })]: { pagination: { total_count: 7 }, items: [{ domain: "link-source.example" }] },
  });

  const response = await onRequestGet({
    request: request("?site=https://blog.example.com/path&location_code=2840&language_code=EN"),
    env,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.scope.site, "example.com");
  assert.equal(body.meta.actual_cost_usd, 0);
  assert.equal(body.meta.task_count, 0);
  assert.equal(body.meta.provider_requests, 0);
  assert.equal(body.data.modules.organic.data.organic_traffic, 456);
  assert.equal(body.data.modules.competitors.availability, "available");
  assert.equal(body.data.modules.competitors.data.rows[0].domain, "rival.example");
  assert.equal(body.data.modules.competitors.updated_at, null);
  assert.equal(body.data.modules.workflow.data.total_count, 2);
  assert.equal(body.data.modules.workflow.data.pending_count, 2);
  assert.equal(body.data.modules.workflow.data.status_counts.new, 1);
  assert.equal(body.data.modules.workflow.data.status_counts.researching, 1);
  const brokenProspect = body.data.modules.backlink_opportunities.data.items.find((item) => item.referring_domain === "prospect-two.example");
  assert.deepEqual(brokenProspect.competitor_domains, []);
  assert.deepEqual(brokenProspect.outreach_reasons, []);
  assert.equal(body.data.modules.backlink_history.updated_at, "2026-08-31T11:00:00.000Z");
  assert.match(body.data.warnings.join(" "), /freshness/i);

  const method = await onRequest({ request: new Request("https://preview.example/api/v2/dashboard", { method: "POST", headers: { "cf-access-jwt-assertion": "trusted-test-assertion" } }), env });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET, OPTIONS");
});

test("GET keeps Backlink Gap distinct from saved prospects and enriches truthful competitor and loss data", async () => {
  const { onRequestGet } = await import(apiUrl.href + `?case=${crypto.randomUUID()}`);
  const { env } = await dashboardEnv();
  const scope = normalizeDashboardScope({ domain: "example.com", location_code: 2840, language_code: "en" });
  await env.DB.prepare("INSERT INTO site_profiles (domain, label, location_code, location_name, country_iso_code, language_code, language_name, include_subdomains, competitors_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(scope.domain, "Example", scope.location_code, scope.location_name, scope.country_iso_code, scope.language_code, scope.language_name, 0, JSON.stringify(["rival.example"]))
    .run();
  for (const [backlinks, domains, at] of [[100, 20, "2026-08-01T00:00:00.000Z"], [80, 15, "2026-08-31T00:00:00.000Z"]]) {
    await env.DB.prepare(
      `INSERT INTO backlink_snapshots (
        domain, provider, source, backlinks, referring_domains, snapshot_at
      ) VALUES (?, 'dataforseo', 'cache', ?, ?, ?)`,
    ).bind(scope.domain, backlinks, domains, at).run();
  }
  await env.DB.prepare(
    `INSERT INTO backlink_opportunities (
      own_domain, referring_domain, competitor_domains_json, opportunity_score, opportunity_label,
      status, notes, first_discovered_at, last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, 70, 'High', 'new', '', ?, ?, ?, ?)`,
  ).bind(scope.domain, "saved-prospect.example", "[\"rival.example\"]", "2026-08-20T00:00:00.000Z", "2026-08-31T00:00:00.000Z", "2026-08-20T00:00:00.000Z", "2026-08-31T00:00:00.000Z").run();

  await writeDashboardSnapshot(env.DB, scope, {
    competitors: normalizeDashboardModule("competitors", {
      rows: [{ domain: "rival.example", shared_keywords: 999, estimated_traffic: 45 }],
    }, { source: "live", updated_at: "2026-08-30T00:00:00.000Z", scope }),
    backlink_gap: normalizeDashboardModule("backlink_gap", {
      rows: [{ domain: "gap-source.example", competitor_domain: "rival.example", opportunity_score: 88 }],
    }, { source: "live", updated_at: "2026-08-29T00:00:00.000Z", scope }),
  }, { now: () => new Date("2026-08-30T00:00:00.000Z") });

  env.CACHE = cache({
    [buildCompetitorSnapshotCacheKey("rival.example", 2840, "en")]: {
      data: { domain: "rival.example", organic: { ranked_keywords: 321, estimated_monthly_traffic: 654 }, top_keywords: [] },
      cached_at: "2026-08-31T10:00:00.000Z",
    },
    [buildKeywordGapCacheKey("rival.example", "example.com", 2840, "en")]: {
      total_gap_keywords: 18,
      opportunities: [{ keyword: "gap keyword" }],
      cached_at: "2026-08-31T09:00:00.000Z",
    },
    [await backlinkGapCacheKey({ ownDomain: "example.com", competitors: ["rival.example"], limit: 25, offset: 0 })]: {
      pagination: { total_count: 7 },
      items: [{ domain: "gap-source.example" }],
      cached_at: "2026-08-31T08:00:00.000Z",
    },
  });

  const response = await onRequestGet({ request: request("?site=example.com&location_code=2840&language_code=en"), env });
  const payload = await response.json();
  const { modules } = payload.data;
  assert.equal(response.status, 200);
  assert.deepEqual(modules.backlink_gap.data.rows.map((row) => row.domain), ["gap-source.example"]);
  assert.deepEqual(modules.backlink_opportunities.data.items.map((row) => row.referring_domain), ["saved-prospect.example"]);
  const competitor = modules.competitors.data.rows[0];
  assert.equal(competitor.shared_keywords, null);
  assert.equal(competitor.ranked_keywords, 321);
  assert.equal(competitor.competitor_only_keywords, 18);
  assert.equal(competitor.keyword_gap, 18);
  assert.equal(competitor.backlink_gap, 7);
  assert.equal(competitor.provenance.keyword_gap.updated_at, "2026-08-31T09:00:00.000Z");
  assert.equal(competitor.provenance.backlink_gap.updated_at, "2026-08-31T08:00:00.000Z");
  assert.equal(modules.competitors.updated_at, "2026-08-31T08:00:00.000Z");
  assert.ok(modules.backlink_history.data.alerts.some((alert) => alert.code === "BACKLINKS_LOST"));
});

test("GET preserves durable competitor metrics and provenance when deterministic caches are partial or absent", async (t) => {
  const scope = normalizeDashboardScope({ domain: "example.com", location_code: 2840, language_code: "en" });
  const storedAt = "2026-08-30T00:00:00.000Z";
  const storedRow = {
    domain: "rival.example",
    ranked_keywords: 777,
    estimated_traffic: 888,
    competitor_only_keywords: 10,
    keyword_gap: 9,
    backlink_gap: 4,
    provenance: {
      ranked_keywords: { source: "live", updated_at: storedAt },
      keyword_gap: { source: "live", updated_at: storedAt },
      backlink_gap: { source: "live", updated_at: storedAt },
    },
  };
  const keywordKey = buildKeywordGapCacheKey("rival.example", scope.domain, scope.location_code, scope.language_code);
  const backlinkKey = await backlinkGapCacheKey({ ownDomain: scope.domain, competitors: ["rival.example"], limit: 25, offset: 0 });
  const cases = [
    {
      name: "no deterministic cache",
      seed: {},
      expected: storedRow,
      updatedAt: storedAt,
    },
    {
      name: "keyword-gap cache only",
      seed: {
        [keywordKey]: { total_gap_keywords: 18, opportunities: [], cached_at: "2026-08-31T09:00:00.000Z" },
      },
      expected: {
        ...storedRow,
        competitor_only_keywords: 18,
        keyword_gap: 18,
        provenance: {
          ...storedRow.provenance,
          keyword_gap: { source: "kv_cache", updated_at: "2026-08-31T09:00:00.000Z" },
        },
      },
      updatedAt: storedAt,
    },
    {
      name: "backlink-gap cache only",
      seed: {
        [backlinkKey]: { pagination: { total_count: 7 }, items: [], cached_at: "2026-08-31T08:00:00.000Z" },
      },
      expected: {
        ...storedRow,
        backlink_gap: 7,
        provenance: {
          ...storedRow.provenance,
          backlink_gap: { source: "kv_cache", updated_at: "2026-08-31T08:00:00.000Z" },
        },
      },
      updatedAt: storedAt,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const { onRequestGet } = await import(apiUrl.href + `?case=${crypto.randomUUID()}`);
      const { env } = await dashboardEnv();
      await seedProfile(env.DB, { competitors: ["rival.example"] });
      await writeDashboardSnapshot(env.DB, scope, {
        competitors: normalizeDashboardModule("competitors", { rows: [storedRow] }, {
          source: "live", updated_at: storedAt, scope,
        }),
      }, { now: () => new Date(storedAt) });
      env.CACHE = cache(testCase.seed);

      const response = await onRequestGet({ request: request("?site=example.com&location_code=2840&language_code=en"), env });
      const payload = await response.json();
      const module = payload.data.modules.competitors;
      const competitor = module.data.rows[0];

      assert.equal(response.status, 200);
      assert.deepEqual(competitor, { ...testCase.expected, shared_keywords: null });
      assert.equal(module.updated_at, testCase.updatedAt);
    });
  }
});

test("empty durable workflow data has unknown freshness instead of Unix epoch freshness", async () => {
  const { onRequestGet } = await import(apiUrl.href + `?case=${crypto.randomUUID()}`);
  const { env } = await dashboardEnv();
  await seedProfile(env.DB);
  const response = await onRequestGet({ request: request("?site=example.com&location_code=2840&language_code=en"), env });
  const payload = await response.json();
  assert.equal(payload.data.modules.backlink_opportunities.updated_at, null);
  assert.equal(payload.data.modules.workflow.updated_at, null);
  assert.notEqual(payload.data.modules.workflow.updated_at, "1970-01-01T00:00:00.000Z");
});

test("GET requires Access, rejects cross-origin requests, and returns structured 503 only for authoritative D1 failure", async () => {
  const { onRequest, onRequestGet, onRequestOptions } = await import(apiUrl.href + `?case=${crypto.randomUUID()}`);
  assert.equal((await onRequest({ request: request("?site=example.com", { "cf-access-jwt-assertion": "" }), env: { DB: {} } })).status, 401);
  assert.equal((await onRequest({ request: request("?site=example.com", { origin: "https://evil.example" }), env: { DB: {} } })).status, 403);
  assert.equal((await onRequest({ request: request("?site=example.com", { "sec-fetch-site": "cross-site" }), env: { DB: {} } })).status, 403);
  assert.equal((await onRequestOptions({ request: request("?site=example.com") })).status, 204);

  const missing = await onRequestGet({ request: request("?site=example.com"), env: {} });
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error.code, "BINDING_MISSING");

  const broken = await onRequestGet({
    request: request("?site=example.com"),
    env: {
      DB: {
        prepare() {
          throw new Error("db offline");
        },
      },
      CACHE: cache(),
    },
  });
  assert.equal(broken.status, 503);
  assert.equal((await broken.json()).error.code, "DASHBOARD_UNAVAILABLE");
});

test("dashboard GET import closure stays free of providers, credentials, usage logging, and network calls", async () => {
  const files = await importClosure(new URL(apiUrl).pathname);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(|DATAFORSEO_(?:LOGIN|PASSWORD)|recordApiUsage|api_usage/i, file);
  }
});
