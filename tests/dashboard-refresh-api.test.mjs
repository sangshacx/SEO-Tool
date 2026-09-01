import assert from "node:assert/strict";
import test from "node:test";

import { buildCompetitorSnapshotCacheKey } from "../src/v2/dashboard/cache-keys.js";
import { dashboardDatabase, memoryCache, seedProfile } from "./dashboard-test-helpers.mjs";

const apiUrl = new URL("../functions/api/v2/dashboard/refresh.js", import.meta.url);

function request(body, headers = {}) {
  return new Request("https://preview.example/api/v2/dashboard/refresh", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-access-jwt-assertion": "trusted-test-assertion",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function loadApi(dependencies) {
  const key = `case-${crypto.randomUUID()}`;
  globalThis.__DASHBOARD_REFRESH_DEPS_FOR_TESTS__ = dependencies;
  try {
    return await import(`${apiUrl.href}?${key}`);
  } finally {
    delete globalThis.__DASHBOARD_REFRESH_DEPS_FOR_TESTS__;
  }
}

test("refresh API enforces Access, same-origin, JSON object bodies, the exact allowlist, duplicates, and request limits", async () => {
  const api = await loadApi({});

  assert.equal((await api.onRequest({ request: request({ modules: ["organic"] }, { "cf-access-jwt-assertion": "" }), env: {} })).status, 401);
  assert.equal((await api.onRequest({ request: request({ modules: ["organic"] }, { origin: "https://evil.example" }), env: {} })).status, 403);
  assert.equal((await api.onRequest({ request: request({ modules: ["organic"] }, { "sec-fetch-site": "cross-site" }), env: {} })).status, 403);
  assert.equal((await api.onRequestOptions({ request: request({ modules: ["organic"] }) })).status, 204);

  const invalidJson = await api.onRequestPost({ request: request("{broken"), env: {} });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).error.code, "INVALID_JSON");

  const invalidShape = await api.onRequestPost({ request: request(["organic"]), env: {} });
  assert.equal(invalidShape.status, 400);
  assert.equal((await invalidShape.json()).error.code, "INVALID_BODY");

  const duplicate = await api.onRequestPost({ request: request({ site: "example.com", location_code: 2840, language_code: "en", modules: ["organic", "organic"] }), env: {} });
  assert.equal(duplicate.status, 400);
  assert.equal((await duplicate.json()).error.code, "DUPLICATE_MODULE");

  const invalidModule = await api.onRequestPost({ request: request({ site: "example.com", location_code: 2840, language_code: "en", modules: ["organic", "bad"] }), env: {} });
  assert.equal(invalidModule.status, 400);
  assert.equal((await invalidModule.json()).error.code, "INVALID_MODULE");

  const unselectedConfirmation = await api.onRequestPost({ request: request({ site: "example.com", location_code: 2840, language_code: "en", modules: ["organic"], confirmed_live_modules: ["backlinks"] }), env: {} });
  assert.equal(unselectedConfirmation.status, 400);
  assert.equal((await unselectedConfirmation.json()).error.code, "INVALID_LIVE_CONFIRMATION");

  const duplicateConfirmation = await api.onRequestPost({ request: request({ site: "example.com", location_code: 2840, language_code: "en", modules: ["organic"], confirmed_live_modules: ["organic", "organic"] }), env: {} });
  assert.equal(duplicateConfirmation.status, 400);
  assert.equal((await duplicateConfirmation.json()).error.code, "INVALID_LIVE_CONFIRMATION");

  const oversized = new Request("https://preview.example/api/v2/dashboard/refresh", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-access-jwt-assertion": "trusted-test-assertion",
    },
    body: JSON.stringify({ site: "example.com", location_code: 2840, language_code: "en", modules: ["organic"], padding: "x".repeat((64 * 1024) + 1) }),
  });
  assert.equal((await api.onRequestPost({ request: oversized, env: {} })).status, 413);

  const method = await api.onRequest({ request: new Request("https://preview.example/api/v2/dashboard/refresh", { method: "GET", headers: { "cf-access-jwt-assertion": "trusted-test-assertion" } }), env: {} });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "POST, OPTIONS");
});

test("refresh performs a provider-free review and returns 409 with exact zero cost for unconfirmed live modules", async () => {
  let providerCalls = 0;
  const api = await loadApi({
    async fetchCompetitorSnapshot() { providerCalls += 1; throw new Error("must not execute"); },
  });
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1);

  const response = await api.onRequestPost({
    request: request({ site: "example.com", location_code: 2840, language_code: "en", modules: ["organic"] }),
    env: { DB: d1, CACHE: memoryCache() },
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "LIVE_REQUEST_CONFIRMATION_REQUIRED");
  assert.equal(body.meta.actual_cost_usd, 0);
  assert.equal(body.meta.total_actual_cost_usd, 0);
  assert.equal(body.data.modules.organic.task_count, 0);
  assert.equal(providerCalls, 0);
});

test("refresh endpoint exercises the real cached orchestrator without provider calls", async () => {
  let providerCalls = 0;
  const api = await loadApi({
    async fetchCompetitorSnapshot() { providerCalls += 1; throw new Error("must not execute"); },
  });
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1);
  const cache = memoryCache({
    [buildCompetitorSnapshotCacheKey("example.com", 2840, "en")]: {
      data: { domain: "example.com", organic: { ranked_keywords: 12 }, top_keywords: [] },
      cached_at: "2026-08-31T10:00:00.000Z",
    },
  });

  const response = await api.onRequestPost({
    request: request({
      site: "example.com",
      location_code: 2840,
      language_code: "en",
      modules: ["organic"],
    }),
    env: { DB: d1, CACHE: cache },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.modules.organic.status, "success");
  assert.equal(payload.data.modules.organic.cached, true);
  assert.equal(payload.meta.total_actual_cost_usd, 0);
  assert.equal(providerCalls, 0);
});
