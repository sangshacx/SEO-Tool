import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";

import { buildCompetitorSnapshotCacheKey } from "../src/v2/dashboard/cache-keys.js";
import { dashboardDatabase, memoryCache, seedProfile } from "./dashboard-test-helpers.mjs";

const apiUrl = new URL("../functions/api/v2/dashboard/refresh-preview.js", import.meta.url);

function request(body, headers = {}) {
  return new Request("https://preview.example/api/v2/dashboard/refresh-preview", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-access-jwt-assertion": "trusted-test-assertion",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
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

test("refresh preview is a pure provider-free classification with no usage or snapshot writes", async () => {
  const api = await import(`${apiUrl.href}?case=${crypto.randomUUID()}`);
  const { raw, d1 } = await dashboardDatabase();
  await seedProfile(d1);
  await d1.prepare(
    `INSERT INTO backlink_snapshots (
      domain, provider, source, snapshot_at
    ) VALUES (?, 'dataforseo', 'cache', ?)`,
  ).bind("example.com", "2026-08-31T11:00:00.000Z").run();
  const cache = memoryCache({
    [buildCompetitorSnapshotCacheKey("example.com", 2840, "en")]: {
      data: { domain: "example.com", organic: { ranked_keywords: 12 }, top_keywords: [] },
      cached_at: "2026-08-31T10:00:00.000Z",
    },
  });
  const env = {
    DB: d1,
    CACHE: cache,
    get DATAFORSEO_LOGIN() { throw new Error("preview touched provider credentials"); },
    get DATAFORSEO_PASSWORD() { throw new Error("preview touched provider credentials"); },
  };
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error("preview called provider"); };
  try {
    const response = await api.onRequestPost({
      request: request({
        site: "example.com",
        location_code: 2840,
        language_code: "en",
        modules: ["organic", "backlinks", "competitors", "keyword_opportunities", "backlink_opportunities"],
      }),
      env,
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.modules.organic.status, "ready");
    assert.equal(body.data.modules.organic.estimated_cost_usd, null);
    assert.equal(body.data.modules.organic.updated_at, "2026-08-31T10:00:00.000Z");
    assert.equal(body.data.modules.backlinks.status, "ready");
    assert.equal(body.data.modules.competitors.status, "skip");
    assert.equal(body.meta.preview_only, true);
    assert.equal(body.meta.actual_cost_usd, 0);
    assert.equal(body.meta.task_count, 0);
    assert.equal(providerCalls, 0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM api_usage").get().count, 0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM site_dashboard_snapshots").get().count, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refresh preview keeps a provider-free import closure and enforces Access, origin, and size limits", async () => {
  const files = await importClosure(apiUrl.pathname);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(|DATAFORSEO_(?:LOGIN|PASSWORD)|recordApiUsage|api_usage|writeDashboardSnapshot/i, file);
  }

  const api = await import(`${apiUrl.href}?case=${crypto.randomUUID()}`);
  assert.equal((await api.onRequestPost({ request: request({ modules: ["organic"] }, { "cf-access-jwt-assertion": "" }), env: {} })).status, 401);
  assert.equal((await api.onRequestPost({ request: request({ modules: ["organic"] }, { origin: "https://evil.example" }), env: {} })).status, 403);
  const oversized = request({ site: "example.com", location_code: 2840, language_code: "en", modules: ["organic"], padding: "x".repeat(64 * 1024) });
  assert.equal((await api.onRequestPost({ request: oversized, env: {} })).status, 413);
});
