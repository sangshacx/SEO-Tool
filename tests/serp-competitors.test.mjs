import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { normalizeSerpCompetitors } from "../src/v2/providers/dataforseo-serp-competitors.js";
import { onRequestPost } from "../functions/api/v2/keywords/serp-competitors.js";

function request(body) {
  return new Request("https://preview.example/api/v2/keywords/serp-competitors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function statement(sql, db) {
  return {
    sql,
    args: [],
    bind(...args) { this.args = args; return this; },
    async first() {
      if (sql.includes("JOIN serp_competitor_snapshots")) return db.cachedSnapshot ?? null;
      if (sql.includes("INSERT INTO keywords")) return { id: 9 };
      return null;
    },
    async all() {
      if (sql.includes("FROM serp_competitor_pages")) return { results: db.cachedPages ?? [] };
      return { results: [] };
    },
    async run() {
      db.runs.push({ sql, args: this.args });
      return { success: true };
    },
  };
}

function dbStub({ cachedSnapshot = null, cachedPages = [] } = {}) {
  const db = {
    cachedSnapshot,
    cachedPages,
    runs: [],
    batches: [],
    prepare(sql) { return statement(sql, db); },
    async batch(statements) {
      db.batches.push(statements.map((item) => ({ sql: item.sql, args: item.args })));
      return statements.map(() => ({ success: true }));
    },
  };
  return db;
}

test("normalizes only real organic Top 10 result pages", () => {
  const data = normalizeSerpCompetitors({
    keyword: "waterproof membrane",
    location_code: 2840,
    language_code: "en",
    se_domain: "google.com",
    datetime: "2026-09-18 05:00:00 +00:00",
    item_types: ["organic", "people_also_ask"],
    items: [
      { type: "people_also_ask", rank_group: 1, title: "Question" },
      { type: "organic", rank_group: 2, rank_absolute: 4, domain: "b.example", url: "https://b.example/page", title: "B" },
      { type: "organic", rank_group: 1, rank_absolute: 1, domain: "a.example", url: "https://a.example/page", title: "A", is_featured_snippet: true },
    ],
  }, "waterproof membrane");

  assert.equal(data.items.length, 2);
  assert.deepEqual(data.items.map((item) => item.domain), ["a.example", "b.example"]);
  assert.deepEqual(data.items.map((item) => item.position), [1, 2]);
  assert.equal(data.items[0].is_featured_snippet, true);
  assert.deepEqual(data.serp_features, ["organic", "people_also_ask"]);
});

test("Top 10 SERP Cost Guard returns 409 on D1 miss without a provider request", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider must not be called");
  };

  try {
    const response = await onRequestPost({
      request: request({
        keyword: "waterproof membrane",
        location_code: 2840,
        language_code: "en",
        allow_live_request: false,
      }),
      env: { DB: dbStub() },
    });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.error.code, "LIVE_REQUEST_CONFIRMATION_REQUIRED");
    assert.equal(body.meta.actual_cost_usd, 0);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicit Top 10 SERP live request uses depth 10, persists normalized pages, and logs returned cost", async () => {
  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_url, init) => {
    providerBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      status_code: 20000,
      tasks_count: 1,
      cost: 0.003,
      tasks: [{
        status_code: 20000,
        result_count: 1,
        result: [{
          keyword: "waterproof membrane",
          location_code: 2840,
          language_code: "en",
          se_domain: "google.com",
          datetime: "2026-09-18 05:00:00 +00:00",
          item_types: ["organic"],
          items: [
            { type: "organic", rank_group: 1, rank_absolute: 1, domain: "one.example", url: "https://one.example/a", title: "One" },
            { type: "organic", rank_group: 2, rank_absolute: 2, domain: "two.example", url: "https://two.example/b", title: "Two" },
          ],
        }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const db = dbStub();
    const response = await onRequestPost({
      request: request({
        keyword: "waterproof membrane",
        location_code: 2840,
        language_code: "en",
        allow_live_request: true,
      }),
      env: {
        DB: db,
        DATAFORSEO_LOGIN: "configured-login",
        DATAFORSEO_PASSWORD: "configured-password",
      },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(providerBody.length, 1);
    assert.equal(providerBody[0].depth, 10);
    assert.equal(providerBody[0].location_code, 2840);
    assert.equal(providerBody[0].language_code, "en");
    assert.equal(body.data.items.length, 2);
    assert.equal(body.meta.actual_cost_usd, 0.003);
    assert.equal(db.batches.length, 1);
    assert.equal(db.batches[0].length, 3);
    assert.ok(db.runs.some((entry) => entry.sql.includes("INSERT INTO api_usage")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fresh D1 Top 10 snapshot is reused at zero provider cost", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error("provider must not be called"); };

  try {
    const db = dbStub({
      cachedSnapshot: {
        id: "snap-1",
        keyword: "waterproof membrane",
        provider: "dataforseo",
        search_engine_domain: "google.com",
        checked_at: "2026-09-18 05:00:00 +00:00",
        serp_features_json: '["organic"]',
        actual_cost_usd: 0.003,
        fetched_at: "2026-09-18 05:00:00",
      },
      cachedPages: [{
        organic_position: 1,
        absolute_position: 1,
        domain: "one.example",
        url: "https://one.example/a",
        title: "One",
        description: null,
        breadcrumb: null,
        website_name: null,
        is_featured_snippet: 0,
        is_web_story: 0,
      }],
    });
    const response = await onRequestPost({
      request: request({
        keyword: "waterproof membrane",
        location_code: 2840,
        language_code: "en",
      }),
      env: { DB: db },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.meta.cached, true);
    assert.equal(body.meta.actual_cost_usd, 0);
    assert.equal(body.data.items[0].domain, "one.example");
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SERP competitor migration creates normalized D1 snapshot and page tables", async () => {
  const sql = await readFile(new URL("../migrations/0011_serp_competitor_pages.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS serp_competitor_snapshots/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS serp_competitor_pages/);
  assert.match(sql, /FOREIGN KEY \(keyword_id\) REFERENCES keywords\(id\)/);
  assert.match(sql, /PRIMARY KEY \(snapshot_id, organic_position\)/);
});


test("Top 10 SERP UI requires an explicit paid confirmation on cache miss", async () => {
  const html = await readFile(new URL("../public/v2.html", import.meta.url), "utf8");
  const shell = await readFile(new URL("../public/v2-shell.js", import.meta.url), "utf8");
  assert.match(shell, /serpCompetitors: "\/api\/v2\/keywords\/serp-competitors"/);
  assert.match(html, /id="serpCompetitorsBtn"/);
  assert.match(html, /data-v2-market-research="serpCompetitors"/);
  assert.match(html, /id="serpCompetitorsAllowPaid"/);
  assert.match(html, /LIVE_REQUEST_CONFIRMATION_REQUIRED/);
  assert.match(html, /allow_live_request:allow\.checked/);
  assert.match(html, /id="serpCompetitorsBody"/);
  assert.match(html, /真实 Google 自然结果页面/);
});
