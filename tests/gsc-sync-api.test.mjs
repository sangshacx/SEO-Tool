import assert from "node:assert/strict";
import test from "node:test";
import { onRequestPost } from "../functions/api/v2/gsc/sync.js";
import { dashboardDatabase, seedProfile } from "./dashboard-test-helpers.mjs";
import { encryptSecret } from "../src/v2/security/secret-crypto.js";
import { saveGscConnection, saveGscMapping } from "../src/v2/storage/gsc-connections.js";

const ACCESS={"cf-access-jwt-assertion":"access-jwt","content-type":"application/json"};
const KEY=Buffer.alloc(32,9).toString("base64");

test("GSC sync refreshes access once, stores finalized daily dimensions and reports truncation honestly", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const encrypted=await encryptSecret("refresh-token",KEY);
  await saveGscConnection(d1,{ciphertext:encrypted.ciphertext,iv:encrypted.iv,version:1,scope:"readonly",tokenType:"Bearer"});
  await saveGscMapping(d1,{siteDomain:"example.com",property:"sc-domain:example.com",propertyType:"domain",permissionLevel:"siteOwner"});

  let tokenCalls=0,analyticsCalls=0;
  globalThis.fetch=async(url,options)=>{
    if(url==="https://oauth2.googleapis.com/token"){
      tokenCalls+=1;
      return new Response(JSON.stringify({access_token:"access-token",expires_in:3600,scope:"readonly",token_type:"Bearer"}),{headers:{"content-type":"application/json"}});
    }
    if(String(url).includes("/searchAnalytics/query")){
      analyticsCalls+=1;
      const request=JSON.parse(options.body);
      const dimensions=request.dimensions;
      const rows=dimensions[0]==="query"
        ? [{keys:["waterproof membrane"],clicks:10,impressions:100,ctr:0.1,position:6}]
        : [{keys:["https://example.com/page/"],clicks:20,impressions:200,ctr:0.1,position:4}];
      return new Response(JSON.stringify({rows}),{headers:{"content-type":"application/json"}});
    }
    throw new Error("Unexpected fetch "+url);
  };

  const response=await onRequestPost({
    request:new Request("https://preview.example/api/v2/gsc/sync",{method:"POST",headers:ACCESS,body:JSON.stringify({
      site_domain:"example.com",
      target_date:"2026-09-16",
      dimension_sets:["query","page"],
      row_limit_per_set:1000,
    })}),
    env:{DB:d1,GOOGLE_OAUTH_CLIENT_ID:"client",GOOGLE_OAUTH_CLIENT_SECRET:"secret",GSC_TOKEN_ENCRYPTION_KEY:KEY},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.data.status,"success");
  assert.equal(payload.data.rows_written,2);
  assert.deepEqual(payload.data.truncated_sets,[]);
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,2);
  assert.equal(tokenCalls,1);
  assert.equal(analyticsCalls,2);

  const stored=await d1.prepare("SELECT dimension_set, query_text, page_url FROM gsc_search_analytics_daily ORDER BY dimension_set").bind().all();
  assert.equal(stored.results.length,2);
  assert.deepEqual(stored.results.map((row)=>row.dimension_set),["page","query"]);

  const run=await d1.prepare("SELECT status, rows_written, provider_requests FROM gsc_sync_runs ORDER BY id DESC LIMIT 1").bind().first();
  assert.equal(run.status,"success");
  assert.equal(Number(run.rows_written),2);
  assert.equal(Number(run.provider_requests),2);
});

test("GSC sync refuses an unmapped managed site before any Google request", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;globalThis.fetch=async()=>{calls+=1;throw new Error("must not call Google");};
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const response=await onRequestPost({
    request:new Request("https://preview.example/api/v2/gsc/sync",{method:"POST",headers:ACCESS,body:JSON.stringify({site_domain:"example.com"})}),
    env:{DB:d1},
  });
  const payload=await response.json();
  assert.equal(response.status,409);
  assert.equal(payload.error.code,"GSC_SITE_NOT_MAPPED");
  assert.equal(calls,0);
});
