import assert from "node:assert/strict";
import test from "node:test";

async function loadApi() {
  try {
    return await import("../functions/api/v2/backlinks/relevance.js");
  } catch {
    return {};
  }
}

function request(body) {
  return new Request("https://preview.example/api/v2/backlinks/relevance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function cache(initial = {}) {
  const values = new Map(Object.entries(initial));
  const puts = [];
  return {
    values,
    puts,
    async get(key, type) {
      const value = values.get(key);
      return type === "json" && value ? JSON.parse(value) : value ?? null;
    },
    async put(key, value, options) {
      puts.push({ key, value, options });
      values.set(key, value);
    },
  };
}

test("validates domains, topic count, batch size, and storage binding", async () => {
  const { onRequestPost } = await loadApi();
  assert.equal(typeof onRequestPost, "function");
  const cases = [
    [{ domains: ["example.com"], topics: ["waterproofing"] }, {}, 503, "BINDING_MISSING"],
    [{ domains: ["bad domain"], topics: ["waterproofing"] }, { CACHE: cache() }, 400, "INVALID_DOMAINS"],
    [{ domains: [], topics: ["waterproofing"] }, { CACHE: cache() }, 400, "INVALID_DOMAINS"],
    [{ domains: Array.from({ length: 11 }, (_, index) => `site-${index}.com`), topics: ["waterproofing"] }, { CACHE: cache() }, 400, "INVALID_DOMAINS"],
    [{ domains: ["example.com"], topics: [] }, { CACHE: cache() }, 400, "INVALID_TOPICS"],
    [{ domains: ["example.com"], topics: Array.from({ length: 11 }, (_, index) => `topic-${index}`) }, { CACHE: cache() }, 400, "INVALID_TOPICS"],
  ];

  for (const [body, env, status, code] of cases) {
    const response = await onRequestPost({ request: request(body), env });
    assert.equal(response.status, status, code);
    assert.equal((await response.json()).error.code, code);
  }
});

test("reclassifies cached public evidence for new topics without fetching again", async () => {
  const { onRequestPost, relevanceCacheKey } = await loadApi();
  assert.equal(typeof relevanceCacheKey, "function");
  const key = await relevanceCacheKey("construction-journal.com");
  const store = cache({
    [key]: JSON.stringify({
      domain: "construction-journal.com",
      title: "Waterproofing and roofing journal",
      description: "Construction materials and building products",
      text: "Membranes, coatings and insulation",
      fetched_at: "2026-08-29T00:00:00.000Z",
    }),
  });
  let calls = 0;
  const response = await onRequestPost({
    request: request({
      domains: ["construction-journal.com"],
      topics: ["waterproofing"],
      items: [{ domain: "construction-journal.com", metrics: { strongest_rank: 75, total_backlinks: 30, average_spam_score: 3 } }],
    }),
    env: { CACHE: store },
    data: { fetchImpl: async () => { calls += 1; throw new Error("should not fetch"); } },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls, 0);
  assert.equal(body.data.items[0].cached, true);
  assert.equal(Object.hasOwn(body.data.items[0], "evidence"), false);
  assert.ok(body.data.items[0].relevance.score >= 70);
  assert.equal(body.data.items[0].outreach.recommendation, "research_first");
  assert.ok(body.data.items[0].outreach.quality_score >= 70);
  assert.equal(body.meta.actual_cost_usd, 0);
});

test("fetches uncached domains independently and stores bounded raw evidence for seven days", async () => {
  const { onRequestPost } = await loadApi();
  const store = cache();
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url.includes("offline.example")) throw new Error("network unavailable");
    return new Response("<!doctype html><title>Construction materials</title><meta name=\"description\" content=\"Waterproof membrane technical resources\"><main>Roofing and waterproofing products</main>", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };
  const response = await onRequestPost({
    request: request({ domains: ["industry.example", "offline.example"], topics: ["waterproofing"] }),
    env: { CACHE: store },
    data: { fetchImpl },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(requested.length, 2);
  assert.equal(body.data.items.length, 2);
  assert.equal(body.data.items.find((item) => item.domain === "offline.example").relevance.evidence_status, "unavailable");
  assert.equal(store.puts.length, 2);
  assert.ok(store.puts.every((put) => put.options.expirationTtl === 7 * 24 * 60 * 60));
  assert.equal(body.meta.actual_cost_usd, 0);
});

test("rejects IP literals and revalidates every manual redirect", async () => {
  const { fetchPublicSiteEvidence } = await loadApi();
  assert.equal(typeof fetchPublicSiteEvidence, "function");
  await assert.rejects(
    () => fetchPublicSiteEvidence("127.0.0.1", async () => new Response("never")),
    /unsafe/i,
  );
  let calls = 0;
  await assert.rejects(
    () => fetchPublicSiteEvidence("safe.example", async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { Location: "http://localhost/private" } });
    }),
    /unsafe/i,
  );
  assert.equal(calls, 1);
});

test("rejects non-html and stops buffering oversized public pages", async () => {
  const { fetchPublicSiteEvidence } = await loadApi();
  await assert.rejects(
    () => fetchPublicSiteEvidence("file.example", async () => new Response("pdf", { headers: { "Content-Type": "application/pdf" } })),
    /html/i,
  );
  const oversized = "x".repeat((256 * 1024) + 1);
  await assert.rejects(
    () => fetchPublicSiteEvidence("huge.example", async () => new Response(oversized, { headers: { "Content-Type": "text/html" } })),
    /large/i,
  );
});

test("rejects oversized streamed request bodies and unsupported methods", async () => {
  const { onRequestPost, onRequestGet } = await loadApi();
  const oversized = new Request("https://preview.example/api/v2/backlinks/relevance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat((64 * 1024) + 1) }),
  });
  assert.equal(oversized.headers.has("content-length"), false);
  const response = await onRequestPost({ request: oversized, env: { CACHE: cache() } });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "PAYLOAD_TOO_LARGE");

  const unsupported = onRequestGet();
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("Allow"), "POST");
});
