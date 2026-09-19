import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrganicPagesCacheKey,
  organicPagesCacheCandidates,
  projectOrganicPagesDepth,
} from "../src/v2/organic/organic-pages-cache.js";

test("Top Pages cache keys isolate market and depth", () => {
  const base={target:"example.com",locationCode:2840,languageCode:"en"};
  assert.notEqual(buildOrganicPagesCacheKey({...base,depth:100}),buildOrganicPagesCacheKey({...base,depth:500}));
  assert.notEqual(buildOrganicPagesCacheKey({...base,depth:500}),buildOrganicPagesCacheKey({...base,locationCode:2682,depth:500}));
});

test("Top Pages cache reuses deeper results for shallower depth", () => {
  const input={target:"example.com",locationCode:2840,languageCode:"en"};
  assert.deepEqual(organicPagesCacheCandidates({...input,depth:100}).map(x=>x.depth),[1000,500,100]);
  assert.deepEqual(organicPagesCacheCandidates({...input,depth:500}).map(x=>x.depth),[1000,500]);
  assert.deepEqual(organicPagesCacheCandidates({...input,depth:1000}).map(x=>x.depth),[1000]);
});

test("Top Pages depth projection trims rows without changing total_count", () => {
  const items=Array.from({length:220},(_,i)=>({url:"https://example.com/"+i}));
  const projected=projectOrganicPagesDepth({total_count:900,returned_count:220,depth:500,items},100);
  assert.equal(projected.total_count,900);
  assert.equal(projected.returned_count,100);
  assert.equal(projected.items.length,100);
});
