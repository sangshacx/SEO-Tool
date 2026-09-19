import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet } from "../functions/api/v2/gsc/intelligence.js";
import { dashboardDatabase, seedProfile } from "./dashboard-test-helpers.mjs";
import { replaceGscAnalyticsPartition } from "../src/v2/storage/gsc-search-analytics.js";

const ACCESS={"cf-access-jwt-assertion":"access-jwt"};

test("GSC intelligence reads D1 only, reports coverage and recomputes weighted metrics", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  let fetchCalls=0;globalThis.fetch=async()=>{fetchCalls+=1;throw new Error("must not call Google");};
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const site=await d1.prepare("SELECT id FROM site_profiles WHERE domain = ?").bind("example.com").first();

  for(const [date,clicks,impressions,position] of [
    ["2026-09-15",10,100,8],
    ["2026-09-16",20,200,6],
    ["2026-09-17",30,300,4],
  ]){
    await replaceGscAnalyticsPartition(d1,{
      siteProfileId:site.id,property:"sc-domain:example.com",date,dimensionSet:"query",
      rows:[{query:"waterproof membrane",clicks,impressions,ctr:clicks/impressions,position}],
    });
  }

  const response=await onRequestGet({
    request:new Request("https://preview.example/api/v2/gsc/intelligence?site_domain=example.com&view=queries&days=7",{headers:ACCESS}),
    env:{DB:d1},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.meta.source,"d1");
  assert.equal(payload.meta.provider_requests,0);
  assert.equal(fetchCalls,0);
  assert.equal(payload.data.latest_date,"2026-09-17");
  assert.equal(payload.data.coverage.current_days,3);
  assert.equal(payload.data.coverage.requested_days,7);
  assert.equal(payload.data.summary.comparison_complete,false);
  assert.equal(payload.data.rows[0].clicks,60);
  assert.equal(payload.data.rows[0].impressions,600);
  assert.equal(Math.round(payload.data.rows[0].position*100)/100,5.33);
});

test("GSC intelligence returns an empty D1 state before the first sync", async () => {
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const response=await onRequestGet({
    request:new Request("https://preview.example/api/v2/gsc/intelligence?site_domain=example.com&view=pages&days=28",{headers:ACCESS}),
    env:{DB:d1},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.data.latest_date,null);
  assert.deepEqual(payload.data.rows,[]);
  assert.equal(payload.data.summary.current_days,0);
});
