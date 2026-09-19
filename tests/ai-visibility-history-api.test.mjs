import assert from "node:assert/strict";
import test from "node:test";

import { onRequestGet, onRequestPost } from "../functions/api/v2/ai/history.js";
import { dashboardDatabase, memoryCache, providerResponse, seedProfile } from "./dashboard-test-helpers.mjs";

function getRequest(query = "") {
  return new Request("https://preview.example/api/v2/ai/history?" + query);
}

function postRequest(body) {
  return new Request("https://preview.example/api/v2/ai/history", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function providerPayload(result, cost = 0.103) {
  return {
    status_code: 20000,
    cost,
    tasks_count: 1,
    tasks: [{
      status_code: 20000,
      cost,
      result_count: 1,
      result: [result],
    }],
  };
}

test("AI History GET reads only D1 and never calls a provider", async (context) => {
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1, { domain: "example.com" });
  await d1.prepare(`
    INSERT INTO ai_visibility_history (
      site_profile_id, platform, location_code, language_code, period,
      mentions, ai_search_volume, source, provider_fetched_at
    )
    SELECT id, 'google', 2840, 'en', '2026-09-01', 12, 320,
      'dataforseo_historical', '2026-09-19T07:00:00.000Z'
    FROM site_profiles WHERE domain = 'example.com'
  `).bind().run();

  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("GET must not call provider");
  };

  const response = await onRequestGet({
    request: getRequest("target=example.com&platform=google&location_code=2840&language_code=en"),
    env: { DB: d1 },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.historical.length, 1);
  assert.equal(payload.data.historical[0].mentions, 12);
  assert.equal(payload.meta.source, "d1");
  assert.equal(payload.meta.actual_cost_usd, 0);
  assert.equal(payload.meta.provider_requests, 0);
  assert.equal(providerCalls, 0);
});

test("AI History POST blocks a paid history request until explicitly confirmed", async (context) => {
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1, { domain: "example.com" });
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider should not run");
  };

  const response = await onRequestPost({
    request: postRequest({
      target: "example.com",
      platform: "google",
      location_code: 2840,
      language_code: "en",
      months: 12,
      series: "historical",
    }),
    env: { DB: d1, CACHE: memoryCache() },
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "LIVE_REQUEST_CONFIRMATION_REQUIRED");
  assert.equal(payload.meta.provider_requests, 0);
  assert.equal(payload.meta.actual_cost_usd, 0);
  assert.equal(providerCalls, 0);
});

test("AI History rejects unmanaged sites before any paid provider request", async (context) => {
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1, { domain: "example.com" });
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider should not run");
  };

  const response = await onRequestPost({
    request: postRequest({
      target: "rival.example",
      platform: "google",
      location_code: 2840,
      language_code: "en",
      months: 12,
      series: "historical",
      allow_live_request: true,
    }),
    env: { DB: d1, CACHE: memoryCache() },
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "MANAGED_SITE_REQUIRED");
  assert.equal(payload.meta.provider_requests, 0);
  assert.equal(providerCalls, 0);
});

test("Confirmed Historical refresh makes one provider call, persists D1 and writes cache", async (context) => {
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1, { domain: "example.com" });
  const cache = memoryCache();
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return providerResponse(providerPayload({
      items_count: 2,
      items: [
        { year: 2026, month: 8, metrics: { mentions: 10, ai_search_volume: 200 } },
        { year: 2026, month: 9, metrics: { mentions: 14, ai_search_volume: 300 } },
      ],
    }, 0.104));
  };

  const response = await onRequestPost({
    request: postRequest({
      target: "example.com",
      platform: "google",
      location_code: 2840,
      language_code: "en",
      months: 12,
      series: "historical",
      allow_live_request: true,
    }),
    env: {
      DB: d1,
      CACHE: cache,
      DATAFORSEO_LOGIN: "login",
      DATAFORSEO_PASSWORD: "password",
    },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.series, "historical");
  assert.equal(payload.meta.actual_cost_usd, 0.104);
  assert.equal(payload.meta.provider_requests, 1);
  assert.equal(providerCalls, 1);
  assert.equal(cache.writes.length, 1);

  const stored = await onRequestGet({
    request: getRequest("target=example.com&platform=google&location_code=2840&language_code=en"),
    env: { DB: d1 },
  }).then((r) => r.json());
  assert.equal(stored.data.historical.length, 2);
  assert.equal(stored.data.historical[1].mentions, 14);
});

test("Confirmed New/Lost refresh persists the net decline signal for later zero-cost reads", async (context) => {
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1, { domain: "example.com" });
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => providerResponse(providerPayload({
    items_count: 1,
    date_from: "2026-08-01",
    date_to: "2026-09-19",
    group_range: "month",
    items: [{
      date: "2026-09-01",
      new_mentions: 5,
      lost_mentions: 13,
      new_ai_search_volume: 100,
      lost_ai_search_volume: 280,
    }],
  }, 0.102));

  const response = await onRequestPost({
    request: postRequest({
      target: "example.com",
      platform: "google",
      location_code: 2840,
      language_code: "en",
      months: 6,
      series: "new_lost",
      allow_live_request: true,
    }),
    env: {
      DB: d1,
      CACHE: memoryCache(),
      DATAFORSEO_LOGIN: "login",
      DATAFORSEO_PASSWORD: "password",
    },
  });
  assert.equal(response.status, 200);

  const storedResponse = await onRequestGet({
    request: getRequest("target=example.com&platform=google&location_code=2840&language_code=en"),
    env: { DB: d1 },
  });
  const stored = await storedResponse.json();
  assert.equal(stored.data.new_lost.length, 1);
  assert.equal(stored.data.new_lost[0].net_mentions, -8);
  assert.equal(stored.data.new_lost[0].net_ai_search_volume, -180);
});
