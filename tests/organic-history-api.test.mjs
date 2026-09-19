import assert from "node:assert/strict";
import test from "node:test";

import { onRequestGet, onRequestPost } from "../functions/api/v2/organic/history.js";
import { buildOrganicHistoryCacheKey } from "../src/v2/organic/organic-history-cache.js";
import { recordManagedOrganicSnapshot } from "../src/v2/storage/organic-history.js";
import { dashboardDatabase, memoryCache, seedProfile } from "./dashboard-test-helpers.mjs";

function postRequest(body){
  return new Request("https://preview.example/api/v2/organic/history",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
}

test("Project History GET is D1-only and zero-cost", async () => {
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  await recordManagedOrganicSnapshot({
    db:d1,target:"example.com",targetType:"domain",locationCode:2840,languageCode:"en",
    data:{organic:{ranked_keywords:10,estimated_monthly_traffic:20,estimated_paid_traffic_cost_usd:3}},
    capturedAt:"2026-09-19T01:00:00.000Z",
  });
  const response=await onRequestGet({
    request:new Request("https://preview.example/api/v2/organic/history?target=example.com&location_code=2840&language_code=en&days=0"),
    env:{DB:d1},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
  assert.equal(payload.data.points.length,1);
  assert.equal(payload.data.summary.latest.organic_keywords,10);
});

test("Provider History returns 409 and exact zero cost when no cache exists and paid access is not confirmed", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not execute");};
  const { d1 }=await dashboardDatabase();
  const response=await onRequestPost({
    request:postRequest({target:"example.com",location_code:2840,language_code:"en",months:12}),
    env:{DB:d1,CACHE:memoryCache()},
  });
  const payload=await response.json();
  assert.equal(response.status,409);
  assert.equal(payload.error.code,"LIVE_REQUEST_CONFIRMATION_REQUIRED");
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
  assert.equal(calls,0);
});

test("Provider History reuses a deeper cache at zero cost", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async()=>{throw new Error("provider must not execute");};
  const { d1 }=await dashboardDatabase();
  const key=buildOrganicHistoryCacheKey({target:"example.com",locationCode:2840,languageCode:"en",months:60});
  const points=Array.from({length:24},(_,index)=>({period:"2025-"+String(index+1).padStart(2,"0"),organic_keywords:index+1}));
  const cache=memoryCache({[key]:{data:{target:"example.com",months:60,date_from:"2021-10-01",date_to:"2026-09-19",points},cached_at:"2026-09-19T02:00:00.000Z"}});
  const response=await onRequestPost({
    request:postRequest({target:"example.com",location_code:2840,language_code:"en",months:12}),
    env:{DB:d1,CACHE:cache},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.meta.cached,true);
  assert.equal(payload.meta.cached_from_months,60);
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.data.points.length,12);
});

test("confirmed Provider History performs one paid request and caches the monthly result", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{
    calls+=1;
    return new Response(JSON.stringify({
      status_code:20000,cost:0.12,tasks_count:1,
      tasks:[{status_code:20000,result_count:1,result:[{target:"example.com",total_count:1,items_count:1,items:[{year:2026,month:9,metrics:{organic:{count:12,etv:34,estimated_paid_traffic_cost:5,pos_1:1,pos_2_3:2,pos_4_10:3,pos_11_20:4,is_new:2,is_up:3,is_down:1,is_lost:1}}}]}]}],
    }),{headers:{"content-type":"application/json"}});
  };
  const { d1 }=await dashboardDatabase();
  const cache=memoryCache();
  const response=await onRequestPost({
    request:postRequest({target:"example.com",location_code:2840,language_code:"en",months:6,allow_live_request:true}),
    env:{DB:d1,CACHE:cache,DATAFORSEO_LOGIN:"login",DATAFORSEO_PASSWORD:"password"},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.meta.cached,false);
  assert.equal(payload.meta.actual_cost_usd,0.12);
  assert.equal(payload.meta.provider_requests,1);
  assert.equal(payload.data.points[0].positions.top_10,6);
  assert.equal(calls,1);
  assert.equal(cache.writes.length,1);
});
