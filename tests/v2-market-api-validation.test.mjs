import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMarketRequest } from "../src/v2/markets/request-market.js";
import { buildKeywordOverviewCacheKey } from "../src/v2/storage/keyword-overview.js";
import { buildKeywordIdeasCacheKey } from "../functions/api/v2/keywords/ideas.js";
import { buildSerpWeaknessCacheKey } from "../functions/api/v2/keywords/serp-weakness.js";
import { buildCompetitorSnapshotCacheKey } from "../functions/api/v2/competitors/snapshot.js";
import { buildKeywordGapCacheKey } from "../functions/api/v2/competitors/keyword-gap.js";
import { onRequestPost as keywordOverview } from "../functions/api/v2/keywords/overview.js";
import { onRequestPost as keywordIdeas } from "../functions/api/v2/keywords/ideas.js";
import { onRequestPost as serpWeakness } from "../functions/api/v2/keywords/serp-weakness.js";
import { onRequestPost as seoOpportunity } from "../functions/api/v2/keywords/opportunity.js";
import { onRequestPost as competitorSnapshot } from "../functions/api/v2/competitors/snapshot.js";
import { onRequestPost as keywordGap } from "../functions/api/v2/competitors/keyword-gap.js";

function request(body) {
  return new Request("https://preview.example/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function dbStub({ first = null, binds = [] } = {}) {
  return {
    prepare() {
      return {
        bind(...values) { binds.push(values); return this; },
        async first() { return first; },
        async run() { return { success: true }; },
      };
    },
  };
}

test("every checked-in catalog market is accepted and canonicalized", async () => {
  const catalog = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../public/data/v2-markets.json", import.meta.url), "utf8"));
  for (const location of catalog.locations) {
    for (const languageCode of location.supported_language_codes) {
      assert.deepEqual(normalizeMarketRequest({ location_code: location.location_code, language_code: languageCode }), {
        locationCode: location.location_code,
        languageCode,
      });
    }
  }
  assert.deepEqual(normalizeMarketRequest({ location_code: 2702, language_code: "ZH-cn" }), { locationCode: 2702, languageCode: "zh-CN" });
  assert.deepEqual(normalizeMarketRequest({ location_code: 2158, language_code: "zh-tw" }), { locationCode: 2158, languageCode: "zh-TW" });
});

test("unsupported combinations are rejected instead of reaching provider or cache", () => {
  assert.throws(() => normalizeMarketRequest({ location_code: 2840, language_code: "zh-CN" }), /Unsupported market/);
  assert.throws(() => normalizeMarketRequest({ location_code: 999999, language_code: "en" }), /Unsupported market/);
});

test("paid endpoint cache identities separate country and language", () => {
  const builders = [
    (locationCode, languageCode) => buildKeywordOverviewCacheKey({ keyword: "waterproof membrane", locationCode, languageCode }),
    (locationCode, languageCode) => buildKeywordIdeasCacheKey("waterproof membrane", locationCode, languageCode, 25),
    (locationCode, languageCode) => buildSerpWeaknessCacheKey("waterproof membrane", locationCode, languageCode),
    (locationCode, languageCode) => buildCompetitorSnapshotCacheKey("competitor.example", locationCode, languageCode),
    (locationCode, languageCode) => buildKeywordGapCacheKey("competitor.example", "own.example", locationCode, languageCode),
  ];
  for (const build of builders) {
    assert.equal(new Set([build(2840, "en"), build(2682, "ar"), build(2702, "zh-CN")]).size, 3);
  }
});

test("all six backend workflows accept a hyphenated catalog language without provider calls", async () => {
  const cacheKeys = [];
  const cache = {
    async get(key) {
      cacheKeys.push(key);
      if (key.includes("keyword-ideas")) return { seed_keyword: "waterproof", ideas: [] };
      if (key.includes("competitor-snapshot")) return { top_keywords: [] };
      if (key.includes("keyword-gap")) return { opportunities: [] };
      return { data: null };
    },
    async put() {},
  };
  const market = { location_code: 2702, language_code: "zh-cn" };
  const commonEnv = { CACHE: cache, DB: dbStub() };
  const calls = [
    keywordOverview({ request: request({ keyword: "waterproof", ...market }), env: commonEnv }),
    keywordIdeas({ request: request({ seed_keyword: "waterproof", limit: 25, ...market }), env: commonEnv }),
    serpWeakness({ request: request({ keyword: "waterproof", ...market }), env: commonEnv }),
    competitorSnapshot({ request: request({ domain: "competitor.example", ...market }), env: commonEnv }),
    keywordGap({ request: request({ own_domain: "own.example", competitor_domain: "competitor.example", ...market }), env: commonEnv }),
  ];
  const responses = await Promise.all(calls);
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200, 200, 200]);
  assert.equal(cacheKeys.length, 5);
  assert.equal(cacheKeys.every((key) => key.includes(":2702:zh-CN")), true);

  const opportunityBinds = [];
  const opportunity = await seoOpportunity({
    request: request({ keyword: "waterproof", ...market }),
    env: { DB: dbStub({ binds: opportunityBinds }) },
  });
  assert.equal(opportunity.status, 404);
  assert.deepEqual(opportunityBinds[0].slice(-2), ["zh-CN", 2702]);
});
