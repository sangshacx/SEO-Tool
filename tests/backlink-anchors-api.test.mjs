import assert from "node:assert/strict";
import test from "node:test";

async function loadApi() {
  try {
    return await import("../functions/api/v2/backlinks/anchors.js");
  } catch {
    return {};
  }
}

function postRequest(body) {
  return new Request("https://preview.example/api/v2/backlinks/anchors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("requires explicit confirmation when the requested anchor page is not cached", async () => {
  const { onRequestPost } = await loadApi();
  assert.equal(typeof onRequestPost, "function");
  let requestedKey;
  const response = await onRequestPost({
    request: postRequest({
      domain: "great-ocean-waterproof.com",
      keyword: "waterproof membrane",
      limit: 25,
      offset: 0,
      sort: "backlinks",
      status: "live",
      allow_live_request: false,
    }),
    env: {
      CACHE: { get: async (key) => { requestedKey = key; return null; } },
      DB: {},
    },
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "LIVE_REQUEST_CONFIRMATION_REQUIRED");
  assert.equal(body.meta.actual_cost_usd, 0);
  assert.equal(requestedKey, "v2:backlink-anchors:v1:great-ocean-waterproof.com:subdomains:live:25:0:backlinks");
});

test("reclassifies cached anchors for the requested keyword and records a zero-cost hit", async () => {
  const { onRequestPost } = await loadApi();
  let usageValues;
  const response = await onRequestPost({
    request: postRequest({
      domain: "great-ocean-waterproof.com",
      keyword: "waterproof membrane",
      limit: 25,
      offset: 0,
      sort: "backlinks",
      status: "live",
      allow_live_request: false,
    }),
    env: {
      CACHE: {
        get: async () => ({
          target: "great-ocean-waterproof.com",
          pagination: { total_count: 1, items_count: 1, limit: 25, offset: 0, page: 1 },
          items: [{ anchor: "Waterproof Membrane", backlinks: 4, referring_pages: 4, referring_pages_nofollow: 1 }],
        }),
      },
      DB: {
        prepare: () => ({
          bind: (...values) => ({
            run: async () => { usageValues = values; },
          }),
        }),
      },
    },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.items[0].classification.code, "exact");
  assert.equal(body.data.summary.exact_partial_share_percent, 100);
  assert.equal(body.meta.cached, true);
  assert.equal(body.meta.actual_cost_usd, 0);
  assert.equal(usageValues[3], "backlink_anchors");
  assert.equal(usageValues[5], 1);
  assert.equal(usageValues[6], 0);
  assert.equal(usageValues[7], 1);
});

test("rejects invalid anchor query parameters before reading cache", async () => {
  const { onRequestPost } = await loadApi();
  const cases = [
    [{ domain: "not a domain" }, "VALIDATION_ERROR"],
    [{ domain: "example.com", keyword: "x".repeat(201) }, "INVALID_KEYWORD"],
    [{ domain: "example.com", limit: 10 }, "INVALID_LIMIT"],
    [{ domain: "example.com", limit: 25, offset: 1 }, "INVALID_OFFSET"],
    [{ domain: "example.com", sort: "unknown" }, "INVALID_SORT"],
    [{ domain: "example.com", status: "all" }, "INVALID_STATUS"],
  ];
  for (const [input, expectedCode] of cases) {
    let cacheRead = false;
    const response = await onRequestPost({
      request: postRequest(input),
      env: {
        CACHE: { get: async () => { cacheRead = true; return null; } },
        DB: {},
      },
    });
    const body = await response.json();
    assert.equal(response.status, 400, expectedCode);
    assert.equal(body.error.code, expectedCode);
    assert.equal(cacheRead, false);
  }
});

test("stores raw provider anchors once and classifies only the response", async (context) => {
  const { onRequestPost } = await loadApi();
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    status_code: 20000,
    cost: 0.02012,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [{
      status_code: 20000,
      cost: 0.02012,
      result_count: 1,
      result: [{
        target: "great-ocean-waterproof.com",
        total_count: 1,
        items_count: 1,
        items: [{
          type: "backlinks_anchor",
          anchor: "waterproof membrane",
          rank: 30,
          backlinks: 6,
          first_seen: "2026-08-01 00:00:00 +00:00",
          lost_date: null,
          backlinks_spam_score: 4,
          broken_backlinks: 0,
          broken_pages: 0,
          referring_domains: 5,
          referring_domains_nofollow: 1,
          referring_main_domains: 5,
          referring_main_domains_nofollow: 1,
          referring_ips: 5,
          referring_subnets: 5,
          referring_pages: 6,
          referring_pages_nofollow: 1,
          referring_links_tld: { com: 6 },
          referring_links_types: { anchor: 6 },
          referring_links_attributes: { nofollow: 1 },
          referring_links_platform_types: { cms: 6 },
          referring_links_semantic_locations: { article: 6 },
          referring_links_countries: { US: 6 },
        }],
      }],
    }],
  }));
  let cachedValue;
  let usageValues;
  const response = await onRequestPost({
    request: postRequest({
      domain: "great-ocean-waterproof.com",
      keyword: "waterproof membrane",
      limit: 25,
      offset: 0,
      sort: "backlinks",
      status: "live",
      allow_live_request: true,
    }),
    env: {
      DATAFORSEO_LOGIN: "login",
      DATAFORSEO_PASSWORD: "password",
      CACHE: {
        get: async () => null,
        put: async (_key, value) => { cachedValue = JSON.parse(value); },
      },
      DB: {
        prepare: () => ({
          bind: (...values) => ({ run: async () => { usageValues = values; } }),
        }),
      },
    },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.items[0].classification.code, "exact");
  assert.equal(body.meta.cached, false);
  assert.equal(body.meta.actual_cost_usd, 0.02012);
  assert.equal(cachedValue.classification_keyword, undefined);
  assert.equal(cachedValue.items[0].classification, undefined);
  assert.equal(usageValues[3], "backlink_anchors");
  assert.equal(usageValues[6], 0.02012);
  assert.equal(usageValues[7], 0);
});

test("returns structured errors for unsupported methods, bindings, and malformed JSON", async () => {
  const { onRequestGet, onRequestPost } = await loadApi();
  assert.equal(typeof onRequestGet, "function");
  const getResponse = onRequestGet();
  assert.equal(getResponse.status, 405);

  const missingBindings = await onRequestPost({
    request: postRequest({ domain: "example.com" }),
    env: {},
  });
  assert.equal(missingBindings.status, 503);
  assert.equal((await missingBindings.json()).error.code, "BINDINGS_MISSING");

  const invalidJson = await onRequestPost({
    request: new Request("https://preview.example/api/v2/backlinks/anchors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{broken",
    }),
    env: { CACHE: {}, DB: {} },
  });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).error.code, "INVALID_JSON");
});

test("records provider failures and returns a safe error response", async (context) => {
  const { onRequestPost } = await loadApi();
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  context.after(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  });
  console.error = () => {};
  globalThis.fetch = async () => new Response(JSON.stringify({
    status_code: 50000,
    cost: 0.02,
    tasks_count: 1,
    tasks_error: 1,
    tasks: [{ status_code: 50000, cost: 0.02, result_count: 0, result: [] }],
  }), { status: 500 });
  let usageValues;
  const response = await onRequestPost({
    request: postRequest({
      domain: "example.com",
      limit: 25,
      offset: 0,
      sort: "backlinks",
      status: "live",
      allow_live_request: true,
    }),
    env: {
      DATAFORSEO_LOGIN: "login",
      DATAFORSEO_PASSWORD: "password",
      CACHE: { get: async () => null, put: async () => {} },
      DB: {
        prepare: () => ({
          bind: (...values) => ({ run: async () => { usageValues = values; } }),
        }),
      },
    },
  });
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.error.code, "PROVIDER_REQUEST_FAILED");
  assert.equal(body.error.message, "Anchor data could not be loaded.");
  assert.equal(usageValues[3], "backlink_anchors");
  assert.equal(usageValues[6], 0.02);
  assert.equal(usageValues[8], "error");
});
