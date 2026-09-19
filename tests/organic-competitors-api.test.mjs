import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost } from "../functions/api/v2/organic/competitors.js";
import { buildOrganicCompetitorsCacheKey } from "../src/v2/organic/organic-competitors-cache.js";

function request(body){return new Request("https://preview.example/api/v2/organic/competitors",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});}
function fakeDb(competitorsJson="[]"){
  return {
    prepare(sql){
      return {
        bind(){
          return {
            async first(){return String(sql).includes("SELECT competitors_json FROM site_profiles")?{competitors_json:competitorsJson}:null;},
            async run(){return {success:true};}
          };
        }
      };
    }
  };
}
function memoryCache(seed={}){const store=new Map(Object.entries(seed));return {async get(key){return store.get(key)??null;},async put(key,value){store.set(key,JSON.parse(value));},store};}

test("Organic Competitors requires explicit live confirmation", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not execute");};
  const response=await onRequestPost({request:request({target:"example.com",location_code:2840,language_code:"en"}),env:{DB:fakeDb(),CACHE:memoryCache()}});
  const payload=await response.json();
  assert.equal(response.status,409);
  assert.equal(payload.error.code,"LIVE_REQUEST_CONFIRMATION_REQUIRED");
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(calls,0);
});

test("cached competitors are enriched with saved Business Competitor labels at zero provider cost", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async()=>{throw new Error("provider must not execute");};
  const key=buildOrganicCompetitorsCacheKey({target:"example.com",locationCode:2840,languageCode:"en"});
  const cache=memoryCache({[key]:{data:{target:"example.com",competitors:[
    {domain:"business.example",shared_keywords:30},
    {domain:"seo-only.example",shared_keywords:20}
  ]},cached_at:"2026-09-19T02:00:00.000Z"}});
  const response=await onRequestPost({request:request({target:"example.com",location_code:2840,language_code:"en"}),env:{DB:fakeDb('["business.example"]'),CACHE:cache}});
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.meta.cached,true);
  assert.equal(payload.data.competitors[0].business_competitor,true);
  assert.equal(payload.data.competitors[0].competitor_type,"business_and_seo");
  assert.equal(payload.data.competitors[1].business_competitor,false);
  assert.equal(payload.meta.actual_cost_usd,0);
});
