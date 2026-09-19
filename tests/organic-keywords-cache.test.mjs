import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrganicKeywordsCacheKey,
  organicKeywordsCacheCandidates,
  projectOrganicKeywordsDepth,
} from "../src/v2/organic/organic-keywords-cache.js";

test("organic keyword cache keys isolate target, market, mode and depth", () => {
  const base = {
    target: "example.com",
    locationCode: 2840,
    languageCode: "en",
    historicalSerpMode: "live",
  };
  assert.notEqual(
    buildOrganicKeywordsCacheKey({ ...base, depth: 100 }),
    buildOrganicKeywordsCacheKey({ ...base, depth: 500 }),
  );
  assert.notEqual(
    buildOrganicKeywordsCacheKey({ ...base, depth: 500 }),
    buildOrganicKeywordsCacheKey({ ...base, locationCode: 2682, depth: 500 }),
  );
  assert.notEqual(
    buildOrganicKeywordsCacheKey({ ...base, depth: 500 }),
    buildOrganicKeywordsCacheKey({ ...base, historicalSerpMode: "all", depth: 500 }),
  );
});

test("a deeper cache can satisfy shallower requests, but never the reverse", () => {
  const input = {
    target: "example.com",
    locationCode: 2840,
    languageCode: "en",
    historicalSerpMode: "live",
  };
  assert.deepEqual(organicKeywordsCacheCandidates({ ...input, depth: 100 }).map((row) => row.depth), [1000, 500, 100]);
  assert.deepEqual(organicKeywordsCacheCandidates({ ...input, depth: 500 }).map((row) => row.depth), [1000, 500]);
  assert.deepEqual(organicKeywordsCacheCandidates({ ...input, depth: 1000 }).map((row) => row.depth), [1000]);
});

test("depth projection keeps aggregate totals while trimming only returned rows", () => {
  const rows = Array.from({ length: 600 }, (_, index) => ({ keyword: "keyword " + index }));
  const projected = projectOrganicKeywordsDepth({
    total_count: 5000,
    returned_count: 600,
    depth: 1000,
    items: rows,
  }, 100);
  assert.equal(projected.total_count, 5000);
  assert.equal(projected.depth, 100);
  assert.equal(projected.returned_count, 100);
  assert.equal(projected.items.length, 100);
});
