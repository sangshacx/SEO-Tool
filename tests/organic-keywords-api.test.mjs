import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost } from "../functions/api/v2/organic/keywords.js";
import { buildOrganicKeywordsCacheKey } from "../src/v2/organic/organic-keywords-cache.js";

function request(body) {
  return new Request("https://preview.example/api/v2/organic/keywords", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function fakeDb() {
  return {
    prepare() {
      return {
        bind() {
          return { async run() { return { success: true }; } };
        },
      };
    },
  };
}

function memoryCache(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    async get(key) { return store.get(key) ?? null; },
    async put(key, value) { store.set(key, JSON.parse(value)); },
    store,
  };
}

test("Organic Keywords API returns 409 with exact zero cost and no provider call when cache is absent", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error("provider must not execute"); };

  const response = await onRequestPost({
    request: request({
      target: "example.com",
      location_code: 2840,
      language_code: "en",
      depth: 500,
    }),
    env: { DB: fakeDb(), CACHE: memoryCache() },
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "LIVE_REQUEST_CONFIRMATION_REQUIRED");
  assert.equal(payload.meta.actual_cost_usd, 0);
  assert.equal(payload.meta.provider_requests, 0);
  assert.equal(providerCalls, 0);
});

test("Organic Keywords API reuses a 1000-row cache for 100-row requests at zero cost", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error("provider must not execute"); };

  const rows = Array.from({ length: 300 }, (_, index) => ({ keyword: "keyword " + index }));
  const key = buildOrganicKeywordsCacheKey({
    target: "example.com",
    locationCode: 2840,
    languageCode: "en",
    historicalSerpMode: "live",
    depth: 1000,
  });
  const cache = memoryCache({
    [key]: {
      data: {
        target: "example.com",
        target_type: "domain",
        depth: 1000,
        total_count: 5000,
        returned_count: rows.length,
        items: rows,
      },
      cached_at: "2026-09-19T01:00:00.000Z",
    },
  });

  const response = await onRequestPost({
    request: request({
      target: "example.com",
      location_code: 2840,
      language_code: "en",
      depth: 100,
    }),
    env: { DB: fakeDb(), CACHE: cache },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.meta.cached, true);
  assert.equal(payload.meta.cached_from_depth, 1000);
  assert.equal(payload.meta.actual_cost_usd, 0);
  assert.equal(payload.data.depth, 100);
  assert.equal(payload.data.items.length, 100);
  assert.equal(payload.data.total_count, 5000);
  assert.equal(providerCalls, 0);
});

test("Organic Keywords API performs one confirmed live request and stores the exact depth", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({
      status_code: 20000,
      cost: 0.024,
      tasks_count: 1,
      tasks: [{
        status_code: 20000,
        result_count: 1,
        result: [{
          total_count: 1,
          metrics: { organic: { count: 1, etv: 10, pos_1: 1 } },
          items: [{
            keyword_data: {
              keyword: "waterproof membrane",
              keyword_info: { search_volume: 1000 },
              keyword_properties: { keyword_difficulty: 20 },
              search_intent_info: { main_intent: "commercial", foreign_intent: [] },
              serp_info: { serp_item_types: ["organic"] },
            },
            ranked_serp_element: {
              is_lost: false,
              serp_item: {
                rank_group: 1,
                rank_absolute: 1,
                etv: 10,
                url: "https://example.com/",
                rank_changes: { previous_rank_absolute: 2, is_up: true, is_new: false, is_down: false },
              },
            },
          }],
        }],
      }],
    }), { headers: { "content-type": "application/json" } });
  };

  const cache = memoryCache();
  const response = await onRequestPost({
    request: request({
      target: "https://example.com/",
      location_code: 2840,
      language_code: "en",
      depth: 100,
      allow_live_request: true,
    }),
    env: {
      DB: fakeDb(),
      CACHE: cache,
      DATAFORSEO_LOGIN: "login",
      DATAFORSEO_PASSWORD: "password",
    },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.meta.cached, false);
  assert.equal(payload.meta.provider_requests, 1);
  assert.equal(payload.meta.actual_cost_usd, 0.024);
  assert.equal(payload.data.target_type, "url");
  assert.equal(payload.data.items[0].movement.absolute_delta, 1);
  assert.equal(providerCalls, 1);
  assert.equal(cache.store.size, 1);
});
