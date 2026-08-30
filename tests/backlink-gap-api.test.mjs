import assert from "node:assert/strict";
import test from "node:test";

async function loadApi() {
  try {
    return await import("../functions/api/v2/backlinks/gap.js");
  } catch {
    return {};
  }
}

function postRequest(body) {
  return new Request("https://preview.example/api/v2/backlinks/gap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("canonicalizes competitors and requires confirmation on a cache miss", async () => {
  const { onRequestPost } = await loadApi();
  assert.equal(typeof onRequestPost, "function");
  let requestedKey;
  const response = await onRequestPost({
    request: postRequest({
      own_domain: "own-site.com",
      competitor_domains: ["Competitor-B.com", "competitor-a.com", "competitor-b.com"],
      limit: 25,
      offset: 0,
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
  assert.equal(requestedKey, "v2:backlink-gap:v2:907f55792d2fabe1b6d5a3bf1980a385421edd7963ffb08d04dcbea1a5eb79ae");
});

test("keeps a maximum-length valid domain combination within the KV key limit", async () => {
  const { backlinkGapCacheKey, isValidBacklinkDomain } = await import("../src/v2/backlinks/domain.js");
  const domain = (character, tld) => [
    character.repeat(63),
    character.repeat(63),
    character.repeat(63),
    character.repeat(57),
    tld,
  ].join(".");
  const ownDomain = domain("a", "com");
  const competitors = [domain("b", "net"), domain("c", "org"), domain("d", "io")];
  assert.equal(isValidBacklinkDomain(ownDomain), true);
  assert.equal(competitors.every(isValidBacklinkDomain), true);

  const key = await backlinkGapCacheKey({ ownDomain, competitors, limit: 100, offset: 19900 });

  assert.match(key, /^v2:backlink-gap:v2:[a-f0-9]{64}$/);
  assert.ok(new TextEncoder().encode(key).byteLength <= 512);
});

test("returns a cached opportunity page and records a zero-cost hit", async () => {
  const { onRequestPost } = await loadApi();
  let usageValues;
  const cached = {
    own_domain: "own-site.com",
    competitor_domains: ["competitor-a.com"],
    pagination: { total_count: 1, items_count: 1, limit: 25, offset: 0, page: 1 },
    summary: { returned_domains: 1 },
    items: [{
      domain: "industry-journal.com",
      metrics: { strongest_rank: 74, total_backlinks: 20, average_spam_score: 4, nofollow_share_percent: 10, broken_share_percent: 0 },
      opportunity: { score: 80 },
    }],
  };
  const response = await onRequestPost({
    request: postRequest({
      own_domain: "own-site.com",
      competitor_domains: ["competitor-a.com"],
      limit: 25,
      offset: 0,
      allow_live_request: false,
    }),
    env: {
      CACHE: { get: async () => cached },
      DB: {
        prepare: () => ({
          bind: (...values) => ({ run: async () => { usageValues = values; } }),
        }),
      },
    },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.items[0].domain, "industry-journal.com");
  assert.ok(body.data.items[0].outreach.quality_score >= 70);
  assert.equal(body.data.items[0].outreach.recommendation, "research_first");
  assert.equal(body.meta.cached, true);
  assert.equal(body.meta.actual_cost_usd, 0);
  assert.equal(usageValues[3], "backlink_gap");
  assert.equal(usageValues[5], 1);
  assert.equal(usageValues[6], 0);
  assert.equal(usageValues[7], 1);
});

test("returns a structured 503 when the cache cannot be read", async (context) => {
  const { onRequestPost } = await loadApi();
  const originalError = console.error;
  context.after(() => { console.error = originalError; });
  console.error = () => {};
  const response = await onRequestPost({
    request: postRequest({
      own_domain: "own-site.com",
      competitor_domains: ["competitor-a.com"],
      allow_live_request: false,
    }),
    env: {
      CACHE: { get: async () => { throw new Error("KV unavailable"); } },
      DB: { prepare: () => ({ bind: () => ({ run: async () => {} }) }) },
    },
  });

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "CACHE_UNAVAILABLE");
});

test("rejects invalid gap inputs before reading cache", async () => {
  const { onRequestPost } = await loadApi();
  const cases = [
    [{ own_domain: "not a domain", competitor_domains: ["a.com"] }, "VALIDATION_ERROR"],
    [{ own_domain: "own.com", competitor_domains: [] }, "INVALID_COMPETITORS"],
    [{ own_domain: "own.com", competitor_domains: ["a.com", "b.com", "c.com", "d.com"] }, "INVALID_COMPETITORS"],
    [{ own_domain: "own.com", competitor_domains: ["own.com"] }, "INVALID_COMPETITORS"],
    [{ own_domain: "own.com", competitor_domains: ["not a domain"] }, "INVALID_COMPETITORS"],
    [{ own_domain: "own.com", competitor_domains: ["a.com"], limit: 10 }, "INVALID_LIMIT"],
    [{ own_domain: "own.com", competitor_domains: ["a.com"], limit: 25, offset: 1 }, "INVALID_OFFSET"],
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

test("rejects an oversized streamed request body without relying on Content-Length", async () => {
  const { onRequestPost } = await loadApi();
  const request = new Request("https://preview.example/api/v2/backlinks/gap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat((64 * 1024) + 1) }),
  });
  assert.equal(request.headers.has("content-length"), false);

  const response = await onRequestPost({
    request,
    env: { CACHE: {}, DB: {} },
  });

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "PAYLOAD_TOO_LARGE");
});

test("stores a paid provider result and records its actual cost", async (context) => {
  const { onRequestPost } = await loadApi();
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    status_code: 20000,
    cost: 0.02015,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [{
      status_code: 20000,
      cost: 0.02015,
      result_count: 1,
      result: [{
        targets: { "1": "competitor-a.com" },
        total_count: 1,
        items_count: 1,
        items: [{
          domain_intersection: {
            "1": { target: "source.com", rank: 70, backlinks: 8, referring_pages: 8, referring_pages_nofollow: 1, backlinks_spam_score: 5, broken_backlinks: 0 },
          },
        }],
      }],
    }],
  }));
  let cachedValue;
  let usageValues;
  const response = await onRequestPost({
    request: postRequest({
      own_domain: "own-site.com",
      competitor_domains: ["competitor-a.com"],
      limit: 25,
      offset: 0,
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
        prepare: () => ({ bind: (...values) => ({ run: async () => { usageValues = values; } }) }),
      },
    },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.items[0].domain, "source.com");
  assert.equal(body.meta.cached, false);
  assert.equal(body.meta.actual_cost_usd, 0.02015);
  assert.equal(cachedValue.items[0].opportunity.version, "backlink-gap-v0.1");
  assert.equal(usageValues[3], "backlink_gap");
  assert.equal(usageValues[6], 0.02015);
  assert.equal(usageValues[7], 0);
});

test("returns a paid provider result when the cache write fails", async (context) => {
  const { onRequestPost } = await loadApi();
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  context.after(() => { globalThis.fetch = originalFetch; });
  context.after(() => { console.error = originalError; });
  console.error = () => {};
  globalThis.fetch = async () => new Response(JSON.stringify({
    status_code: 20000,
    cost: 0.02015,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [{
      status_code: 20000,
      cost: 0.02015,
      result_count: 1,
      result: [{
        targets: { "1": "competitor-a.com" },
        total_count: 1,
        items_count: 1,
        items: [{
          domain_intersection: {
            "1": { target: "source.com", rank: 70, backlinks: 8, referring_pages: 8, referring_pages_nofollow: 1, backlinks_spam_score: 5, broken_backlinks: 0 },
          },
        }],
      }],
    }],
  }));
  let usageValues;
  const response = await onRequestPost({
    request: postRequest({
      own_domain: "own-site.com",
      competitor_domains: ["competitor-a.com"],
      limit: 25,
      offset: 0,
      allow_live_request: true,
    }),
    env: {
      DATAFORSEO_LOGIN: "login",
      DATAFORSEO_PASSWORD: "password",
      CACHE: {
        get: async () => null,
        put: async () => { throw new Error("KV write unavailable"); },
      },
      DB: {
        prepare: () => ({ bind: (...values) => ({ run: async () => { usageValues = values; } }) }),
      },
    },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.items[0].domain, "source.com");
  assert.equal(body.meta.cached, false);
  assert.equal(body.meta.cache_stored, false);
  assert.equal(body.meta.actual_cost_usd, 0.02015);
  assert.equal(usageValues[6], 0.02015);
});

test("returns structured method, binding, and JSON errors", async () => {
  const { onRequestGet, onRequestPost } = await loadApi();
  assert.equal(typeof onRequestGet, "function");
  assert.equal(onRequestGet().status, 405);

  const missingBindings = await onRequestPost({
    request: postRequest({ own_domain: "own.com", competitor_domains: ["a.com"] }),
    env: {},
  });
  assert.equal(missingBindings.status, 503);
  assert.equal((await missingBindings.json()).error.code, "BINDINGS_MISSING");

  const invalidJson = await onRequestPost({
    request: new Request("https://preview.example/api/v2/backlinks/gap", { method: "POST", body: "{broken" }),
    env: { CACHE: {}, DB: {} },
  });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).error.code, "INVALID_JSON");
});
