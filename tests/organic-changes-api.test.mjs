import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost } from "../functions/api/v2/organic/changes.js";
import { buildOrganicKeywordsCacheKey } from "../src/v2/organic/organic-keywords-cache.js";

function request(body){return new Request("https://preview.example/api/v2/organic/changes",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});}
function fakeDb(){return {prepare(){return {bind(){return {async run(){return {success:true};}};}};}};}
function memoryCache(seed={}){const store=new Map(Object.entries(seed));return {async get(key){return store.get(key)??null;},async put(key,value){store.set(key,JSON.parse(value));},store};}

test("Position Changes requires confirmation and uses a distinct all-mode cache", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not execute");};
  const response=await onRequestPost({request:request({target:"example.com",location_code:2840,language_code:"en",depth:500}),env:{DB:fakeDb(),CACHE:memoryCache()}});
  const payload=await response.json();
  assert.equal(response.status,409);
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(calls,0);
});

test("Position Changes reuses a deeper historical_serp_mode=all cache", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async()=>{throw new Error("provider must not execute");};
  const key=buildOrganicKeywordsCacheKey({target:"example.com",locationCode:2840,languageCode:"en",historicalSerpMode:"all",depth:1000});
  const cache=memoryCache({[key]:{data:{target:"example.com",depth:1000,organic:{changes:{new:10,up:20,down:5,lost:3}},items:[{keyword:"lost keyword",movement:{is_lost:true}}]},cached_at:"2026-09-19T02:00:00.000Z"}});
  const response=await onRequestPost({request:request({target:"example.com",location_code:2840,language_code:"en",depth:100}),env:{DB:fakeDb(),CACHE:cache}});
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.meta.cached,true);
  assert.equal(payload.meta.cached_from_depth,1000);
  assert.equal(payload.data.items[0].change.code,"lost");
  assert.equal(payload.data.change_summary.aggregate.lost,3);
});
