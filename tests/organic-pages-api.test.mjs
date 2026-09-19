import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost } from "../functions/api/v2/organic/pages.js";
import { buildOrganicPagesCacheKey } from "../src/v2/organic/organic-pages-cache.js";

function request(body){
  return new Request("https://preview.example/api/v2/organic/pages",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
}
function fakeDb(){
  return {prepare(){return {bind(){return {async run(){return {success:true};}};}};}};
}
function memoryCache(seed={}){
  const store=new Map(Object.entries(seed));
  return {async get(key){return store.get(key)??null;},async put(key,value){store.set(key,JSON.parse(value));},store};
}

test("Top Pages API requires explicit live confirmation on a cache miss", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not execute");};
  const response=await onRequestPost({request:request({target:"example.com",location_code:2840,language_code:"en",depth:500}),env:{DB:fakeDb(),CACHE:memoryCache()}});
  const payload=await response.json();
  assert.equal(response.status,409);
  assert.equal(payload.error.code,"LIVE_REQUEST_CONFIRMATION_REQUIRED");
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
  assert.equal(calls,0);
});

test("Top Pages API reuses a deeper cache at zero cost", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not execute");};
  const items=Array.from({length:180},(_,i)=>({url:"https://example.com/"+i}));
  const key=buildOrganicPagesCacheKey({target:"example.com",locationCode:2840,languageCode:"en",depth:1000});
  const cache=memoryCache({[key]:{data:{target:"example.com",depth:1000,total_count:500,returned_count:180,items},cached_at:"2026-09-19T02:00:00.000Z"}});
  const response=await onRequestPost({request:request({target:"example.com",location_code:2840,language_code:"en",depth:100}),env:{DB:fakeDb(),CACHE:cache}});
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.meta.cached,true);
  assert.equal(payload.meta.cached_from_depth,1000);
  assert.equal(payload.data.items.length,100);
  assert.equal(payload.data.total_count,500);
  assert.equal(calls,0);
});

test("Top Pages API performs one confirmed request and caches it", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{
    calls+=1;
    return new Response(JSON.stringify({
      status_code:20000,cost:0.024,tasks_count:1,
      tasks:[{status_code:20000,result_count:1,result:[{target:"example.com",total_count:1,items:[{page_address:"https://example.com/a/",metrics:{organic:{etv:10,count:5,pos_1:1,pos_2_3:1,pos_4_10:1,pos_11_20:1,is_new:1,is_up:2,is_down:0,is_lost:0}}}]}]}],
    }),{headers:{"content-type":"application/json"}});
  };
  const cache=memoryCache();
  const response=await onRequestPost({
    request:request({target:"https://www.example.com/path",location_code:2840,language_code:"en",depth:100,allow_live_request:true}),
    env:{DB:fakeDb(),CACHE:cache,DATAFORSEO_LOGIN:"login",DATAFORSEO_PASSWORD:"password"},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.meta.cached,false);
  assert.equal(payload.meta.actual_cost_usd,0.024);
  assert.equal(payload.data.target,"example.com");
  assert.equal(payload.data.items[0].positions.top_10,3);
  assert.equal(calls,1);
  assert.equal(cache.store.size,1);
});
