import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAiVisibilityCacheKey,
  onRequestPost,
} from "../functions/api/v2/ai/visibility.js";

class FakeKv {
  constructor(entries = []) {
    this.map = new Map(entries);
    this.puts = [];
  }

  async get(key, type) {
    const value = this.map.get(key);
    if (value === undefined) return null;
    if (type === "json") return typeof value === "string" ? JSON.parse(value) : value;
    return value;
  }

  async put(key, value, options) {
    this.map.set(key, value);
    this.puts.push({ key, value, options });
  }
}

class FakeDb {
  constructor() {
    this.runs = [];
  }

  prepare(sql) {
    return {
      bind: (...args) => ({
        run: async () => {
          this.runs.push({ sql, args });
          return { meta: { changes: 1 } };
        },
      }),
    };
  }
}

function request(body) {
  return new Request("https://preview.example/api/v2/ai/visibility", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function providerResponse({
  mentions = 12,
  aiSearchVolume = 340,
  cost = 0.103,
} = {}) {
  return new Response(JSON.stringify({
    status_code: 20000,
    cost,
    tasks_count: 1,
    tasks: [{
      status_code: 20000,
      cost,
      result_count: 1,
      result: [{
        total_count: 0,
        offset: 0,
        items_count: 0,
        aggregated_metrics: {
          platform: [{ key: "google", mentions, ai_search_volume: aiSearchVolume }],
          sources_domain: [{ key: "source.example", mentions: 8, ai_search_volume: 220 }],
          total: { mentions, ai_search_volume: aiSearchVolume },
        },
        items: null,
      }],
    }],
  }), { headers: { "content-type": "application/json" } });
}

test("AI Visibility API returns cached evidence at zero provider cost", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error("provider must not be called"); };

  const cacheInput = {
    target: "example.com",
    platform: "google",
    locationCode: 2840,
    languageCode: "en",
    view: "target",
  };
  const key = buildAiVisibilityCacheKey(cacheInput);
  const cache = new FakeKv([[
    key,
    {
      cached_at: "2026-09-19T00:00:00.000Z",
      data: {
        target: "example.com",
        platform: "google",
        metrics: { total: { mentions: 9, ai_search_volume: 200 } },
      },
    },
  ]]);

  const response = await onRequestPost({
    request: request({
      target: "example.com",
      platform: "google",
      location_code: 2840,
      language_code: "en",
    }),
    env: { CACHE: cache, DB: new FakeDb() },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.source, "cache");
  assert.equal(payload.data.metrics.total.mentions, 9);
  assert.equal(payload.meta.cached, true);
  assert.equal(payload.meta.actual_cost_usd, 0);
  assert.equal(payload.meta.provider_requests, 0);
});

test("AI Visibility API never starts a paid request from a cache miss without explicit confirmation", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return providerResponse();
  };

  const response = await onRequestPost({
    request: request({
      target: "example.com",
      platform: "google",
      location_code: 2840,
      language_code: "en",
    }),
    env: { CACHE: new FakeKv(), DB: new FakeDb() },
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "LIVE_REQUEST_CONFIRMATION_REQUIRED");
  assert.equal(payload.meta.actual_cost_usd, 0);
  assert.equal(payload.meta.provider_requests, 0);
  assert.equal(providerCalls, 0);
});

test("AI Visibility API confirmed live request calls DataForSEO once and writes the 14-day cache", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return providerResponse({ mentions: 15, aiSearchVolume: 480, cost: 0.107 });
  };

  const cache = new FakeKv();
  const db = new FakeDb();
  const response = await onRequestPost({
    request: request({
      target: "https://www.example.com/path",
      platform: "google",
      location_code: 2840,
      language_code: "en",
      allow_live_request: true,
    }),
    env: {
      CACHE: cache,
      DB: db,
      DATAFORSEO_LOGIN: "login",
      DATAFORSEO_PASSWORD: "password",
    },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.source, "provider");
  assert.equal(payload.data.target, "example.com");
  assert.equal(payload.data.metrics.total.mentions, 15);
  assert.equal(payload.meta.cached, false);
  assert.equal(payload.meta.actual_cost_usd, 0.107);
  assert.equal(payload.meta.provider_requests, 1);
  assert.equal(payload.meta.cache_ttl_days, 14);
  assert.equal(providerCalls, 1);
  assert.equal(cache.puts.length, 1);
  assert.equal(cache.puts[0].options.expirationTtl, 14 * 24 * 60 * 60);
  assert.ok(db.runs.length >= 1);
});

test("AI Visibility force refresh ignores an existing cache but still requires paid-request confirmation", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return providerResponse();
  };

  const cacheInput = {
    target: "example.com",
    platform: "google",
    locationCode: 2840,
    languageCode: "en",
    view: "target",
  };
  const cache = new FakeKv([[
    buildAiVisibilityCacheKey(cacheInput),
    { data: { target: "example.com", metrics: { total: { mentions: 99 } } } },
  ]]);

  const response = await onRequestPost({
    request: request({
      target: "example.com",
      platform: "google",
      location_code: 2840,
      language_code: "en",
      force_refresh: true,
    }),
    env: { CACHE: cache, DB: new FakeDb() },
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "LIVE_REQUEST_CONFIRMATION_REQUIRED");
  assert.equal(payload.meta.force_refresh, true);
  assert.equal(providerCalls, 0);
});
