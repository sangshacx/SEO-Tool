import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrganicHistoryCacheKey,
  organicHistoryCacheCandidates,
  projectOrganicHistoryMonths,
} from "../src/v2/organic/organic-history-cache.js";

test("Organic History cache keys isolate target, market and history window", () => {
  const base={target:"example.com",locationCode:2840,languageCode:"en"};
  assert.notEqual(buildOrganicHistoryCacheKey({...base,months:6}),buildOrganicHistoryCacheKey({...base,months:12}));
  assert.notEqual(buildOrganicHistoryCacheKey({...base,months:12}),buildOrganicHistoryCacheKey({...base,locationCode:2682,months:12}));
});

test("deeper Provider History caches satisfy shorter history windows", () => {
  const input={target:"example.com",locationCode:2840,languageCode:"en"};
  assert.deepEqual(organicHistoryCacheCandidates({...input,months:6}).map(x=>x.months),[60,36,24,12,6]);
  assert.deepEqual(organicHistoryCacheCandidates({...input,months:24}).map(x=>x.months),[60,36,24]);
  assert.deepEqual(organicHistoryCacheCandidates({...input,months:60}).map(x=>x.months),[60]);
});

test("history projection keeps only requested months and updates date_from", () => {
  const points=Array.from({length:24},(_,index)=>({
    period:"2025-"+String(index+1).padStart(2,"0"),
    organic_traffic:index,
  }));
  const projected=projectOrganicHistoryMonths({months:24,date_from:"2025-01-01",date_to:"2026-12-31",points},6);
  assert.equal(projected.months,6);
  assert.equal(projected.points.length,6);
  assert.equal(projected.date_from,projected.points[0].period+"-01");
});
