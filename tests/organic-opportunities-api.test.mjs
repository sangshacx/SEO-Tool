import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost } from "../functions/api/v2/organic/opportunities.js";
import { buildOrganicKeywordsCacheKey } from "../src/v2/organic/organic-keywords-cache.js";
import { buildOrganicPagesCacheKey } from "../src/v2/organic/organic-pages-cache.js";
import { dashboardDatabase, memoryCache, seedProfile } from "./dashboard-test-helpers.mjs";

function request(body){
  return new Request("https://preview.example/api/v2/organic/opportunities",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
}

test("Opportunity Center is strictly cache-only and returns missing source guidance at exact zero cost", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not execute");};
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const response=await onRequestPost({
    request:request({target:"example.com",location_code:2840,language_code:"en"}),
    env:{DB:d1,CACHE:memoryCache()},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.data.ready,false);
  assert.deepEqual(payload.data.missing_sources,["organic_keywords","top_pages"]);
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
  assert.equal(calls,0);
});

test("Opportunity Center reads the deepest compatible keyword and page caches without provider calls", async () => {
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const keywordKey=buildOrganicKeywordsCacheKey({target:"example.com",locationCode:2840,languageCode:"en",historicalSerpMode:"live",depth:1000});
  const pagesKey=buildOrganicPagesCacheKey({target:"example.com",locationCode:2840,languageCode:"en",depth:500});
  const cache=memoryCache({
    [keywordKey]:{data:{items:[{keyword:"term",ranking_url:"https://example.com/page/",position:8,search_volume:500,keyword_difficulty:30,estimated_traffic:20,intent:{primary:"commercial"}}]},cached_at:"2026-09-19T01:00:00.000Z"},
    [pagesKey]:{data:{items:[{url:"https://example.com/page/",organic_traffic:100,organic_keywords:10,positions:{top_10:2},changes:{up:1,down:0,lost:0}}]},cached_at:"2026-09-19T01:05:00.000Z"},
  });
  const response=await onRequestPost({
    request:request({target:"example.com",location_code:2840,language_code:"en"}),
    env:{DB:d1,CACHE:cache},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.data.ready,true);
  assert.equal(payload.data.sources.organic_keywords.depth,1000);
  assert.equal(payload.data.sources.top_pages.depth,500);
  assert.equal(payload.data.opportunities[0].action.code,"optimize");
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
});

test("Opportunity Center rejects arbitrary competitor domains so own-site actions are not misapplied", async () => {
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const response=await onRequestPost({
    request:request({target:"rival.example",location_code:2840,language_code:"en"}),
    env:{DB:d1,CACHE:memoryCache()},
  });
  const payload=await response.json();
  assert.equal(response.status,409);
  assert.equal(payload.error.code,"MANAGED_SITE_REQUIRED");
  assert.equal(payload.meta.actual_cost_usd,0);
});
