import assert from "node:assert/strict";
import test from "node:test";

import {
  GSC_SEARCH_ANALYTICS_BASE,
  GSC_SITES_ENDPOINT,
  buildGscSearchAnalyticsRequest,
  listGscProperties,
  queryGscSearchAnalytics,
} from "../src/v2/providers/google-search-console.js";

test("GSC Search Analytics request enforces the official 25,000-row maximum and stable Web Search scope", () => {
  const request=buildGscSearchAnalyticsRequest({
    startDate:"2026-09-01",endDate:"2026-09-15",
    dimensions:["query","page"],rowLimit:25000,startRow:25000,
  });
  assert.equal(request.rowLimit,25000);
  assert.equal(request.startRow,25000);
  assert.equal(request.type,"web");
  assert.equal(request.dataState,"final");
  assert.deepEqual(request.dimensions,["query","page"]);
  assert.throws(()=>buildGscSearchAnalyticsRequest({startDate:"2026-09-01",endDate:"2026-09-15",rowLimit:25001}),/25,000/);
  assert.throws(()=>buildGscSearchAnalyticsRequest({startDate:"2026-09-01",endDate:"2026-09-15",dimensions:["unsupported"]}),/supported/);
});

test("GSC property listing normalizes domain and URL-prefix properties", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  let captured;
  globalThis.fetch=async(url,options)=>{
    captured={url,options};
    return new Response(JSON.stringify({siteEntry:[
      {siteUrl:"sc-domain:example.com",permissionLevel:"siteOwner"},
      {siteUrl:"https://www.example.org/",permissionLevel:"siteFullUser"},
      {siteUrl:"https://unverified.example/",permissionLevel:"siteUnverifiedUser"},
    ]}),{headers:{"content-type":"application/json"}});
  };
  const result=await listGscProperties({accessToken:"token"});
  assert.equal(captured.url,GSC_SITES_ENDPOINT);
  assert.equal(captured.options.headers.Authorization,"Bearer token");
  assert.equal(result.count,3);
  const domain=result.properties.find((row)=>row.property==="sc-domain:example.com");
  assert.equal(domain.property_type,"domain");
  assert.equal(domain.domain,"example.com");
  const prefix=result.properties.find((row)=>row.property==="https://www.example.org/");
  assert.equal(prefix.property_type,"url_prefix");
  assert.equal(prefix.domain,"example.org");
  assert.equal(result.properties.find((row)=>row.property.includes("unverified")).verified,false);
});

test("GSC Search Analytics maps dimensions to named fields and exposes pagination without inventing total rows", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  let captured;
  globalThis.fetch=async(url,options)=>{
    captured={url,options};
    return new Response(JSON.stringify({
      responseAggregationType:"byPage",
      rows:[
        {keys:["waterproof membrane","https://example.com/membrane/"],clicks:12,impressions:500,ctr:0.024,position:8.4},
        {keys:["roof coating","https://example.com/coating/"],clicks:7,impressions:200,ctr:0.035,position:11.2},
      ],
    }),{headers:{"content-type":"application/json"}});
  };
  const result=await queryGscSearchAnalytics({
    accessToken:"token",
    property:"sc-domain:example.com",
    startDate:"2026-09-01",endDate:"2026-09-15",
    dimensions:["query","page"],
    rowLimit:2,startRow:0,
  });
  assert.equal(captured.url,GSC_SEARCH_ANALYTICS_BASE+"/sc-domain%3Aexample.com/searchAnalytics/query");
  assert.deepEqual(JSON.parse(captured.options.body),{
    startDate:"2026-09-01",endDate:"2026-09-15",dimensions:["query","page"],
    type:"web",dataState:"final",rowLimit:2,startRow:0,
  });
  assert.equal(result.rows[0].query,"waterproof membrane");
  assert.equal(result.rows[0].page,"https://example.com/membrane/");
  assert.equal(result.rows[0].impressions,500);
  assert.equal(result.has_more,true);
  assert.equal(result.next_start_row,2);
  assert.equal("total_count" in result,false);
});

test("GSC provider maps Google authorization and quota errors to stable application codes", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:"quota exceeded"}}),{status:429,headers:{"content-type":"application/json"}});
  await assert.rejects(
    ()=>listGscProperties({accessToken:"token"}),
    (error)=>error.code==="GSC_QUOTA_EXCEEDED"&&error.httpStatus===429,
  );
});
