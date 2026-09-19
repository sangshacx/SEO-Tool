import assert from "node:assert/strict";
import test from "node:test";

import {
  GSC_GENERATIVE_DIMENSION_SETS,
  gscGenerativeSyncDates,
  gscSearchAppearanceFilter,
  normalizeGscGenerativeSyncRequest,
} from "../src/v2/gsc/generative-ai-sync-plan.js";
import {
  onRequestGet,
  onRequestPost,
} from "../functions/api/v2/gsc/generative-ai-sync.js";
import { dashboardDatabase, seedProfile } from "./dashboard-test-helpers.mjs";
import { encryptSecret } from "../src/v2/security/secret-crypto.js";
import { saveGscConnection, saveGscMapping } from "../src/v2/storage/gsc-connections.js";
import {
  replaceGscSearchAppearanceCapabilities,
  selectGscGenerativeAiAppearance,
} from "../src/v2/storage/gsc-search-analytics.js";

const ACCESS={"cf-access-jwt-assertion":"access-jwt","content-type":"application/json"};
const KEY=Buffer.alloc(32,7).toString("base64");

function post(body){
  return new Request("https://preview.example/api/v2/gsc/generative-ai-sync",{
    method:"POST",headers:ACCESS,body:JSON.stringify(body),
  });
}

async function seedSelectedCapability(d1,{domain="example.com",appearance="AI_OVERVIEW"}={}){
  const site=await d1.prepare("SELECT id FROM site_profiles WHERE domain = ?").bind(domain).first();
  await replaceGscSearchAppearanceCapabilities(d1,{
    siteProfileId:site.id,
    property:"sc-domain:"+domain,
    startDate:"2026-08-20",
    endDate:"2026-09-16",
    appearances:[{appearance,impressions:500,generative_ai_candidate:true}],
  });
  await selectGscGenerativeAiAppearance(d1,{siteDomain:domain,appearance});
  return site;
}

test("GSC Generative AI sync plan is manual, bounded, and uses only official report dimensions",()=>{
  const plan=normalizeGscGenerativeSyncRequest({
    target_date:"2026-09-16",
    dimension_sets:["property","page","country","device"],
    row_limit_per_set:1000,
    backfill_days:3,
  },new Date("2026-09-19T12:00:00Z"));
  assert.deepEqual(plan.dimension_sets,["property","page","country","device"]);
  assert.deepEqual(GSC_GENERATIVE_DIMENSION_SETS.page,["page"]);
  assert.deepEqual(gscGenerativeSyncDates("2026-09-16",3),["2026-09-14","2026-09-15","2026-09-16"]);
  assert.deepEqual(gscSearchAppearanceFilter("AI_OVERVIEW"),[{
    groupType:"and",
    filters:[{dimension:"searchAppearance",operator:"equals",expression:"AI_OVERVIEW"}],
  }]);
  assert.throws(
    ()=>normalizeGscGenerativeSyncRequest({target_date:"2026-09-16",dimension_sets:["query"]},new Date("2026-09-19T12:00:00Z")),
    (error)=>error?.code==="GSC_GENERATIVE_INVALID_DIMENSION_SETS",
  );
  assert.throws(
    ()=>normalizeGscGenerativeSyncRequest({target_date:"2026-09-16",backfill_days:7,row_limit_per_set:5000},new Date("2026-09-19T12:00:00Z")),
    (error)=>error?.code==="GSC_GENERATIVE_BACKFILL_ROW_LIMIT",
  );
});

test("GSC Generative AI sync requires an explicit current-property selection before any Google request",async(context)=>{
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("Google must not run");};

  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  await saveGscMapping(d1,{siteDomain:"example.com",property:"sc-domain:example.com",propertyType:"domain",permissionLevel:"siteOwner"});

  const response=await onRequestPost({
    request:post({site_domain:"example.com",target_date:"2026-09-16"}),
    env:{DB:d1},
  });
  const payload=await response.json();
  assert.equal(response.status,409);
  assert.equal(payload.error.code,"GSC_GENERATIVE_APPEARANCE_NOT_SELECTED");
  assert.equal(calls,0);
});

test("GSC Generative AI sync filters every Google request by the selected discovered appearance and stores isolated dimensions",async(context)=>{
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});

  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const encrypted=await encryptSecret("refresh-token",KEY);
  await saveGscConnection(d1,{ciphertext:encrypted.ciphertext,iv:encrypted.iv,version:1,scope:"readonly",tokenType:"Bearer"});
  await saveGscMapping(d1,{siteDomain:"example.com",property:"sc-domain:example.com",propertyType:"domain",permissionLevel:"siteOwner"});
  await seedSelectedCapability(d1);

  let tokenCalls=0,analyticsCalls=0;
  const requests=[];
  globalThis.fetch=async(url,options)=>{
    if(url==="https://oauth2.googleapis.com/token"){
      tokenCalls+=1;
      return new Response(JSON.stringify({access_token:"access-token",expires_in:3600,scope:"readonly",token_type:"Bearer"}),{
        headers:{"content-type":"application/json"},
      });
    }
    if(String(url).includes("/searchAnalytics/query")){
      analyticsCalls+=1;
      const body=JSON.parse(options.body);
      requests.push(body);
      const dimensions=body.dimensions;
      let rows;
      if(dimensions.length===0){
        rows=[{keys:[],clicks:2,impressions:100,ctr:0.02,position:1}];
      }else if(dimensions[0]==="page"){
        rows=[
          {keys:["https://example.com/a/"],clicks:1,impressions:60,ctr:1/60,position:1},
          {keys:["https://example.com/b/"],clicks:1,impressions:40,ctr:0.025,position:1},
        ];
      }else if(dimensions[0]==="country"){
        rows=[{keys:["usa"],clicks:2,impressions:100,ctr:0.02,position:1}];
      }else{
        rows=[{keys:["MOBILE"],clicks:2,impressions:100,ctr:0.02,position:1}];
      }
      return new Response(JSON.stringify({rows}),{headers:{"content-type":"application/json"}});
    }
    throw new Error("Unexpected fetch "+url);
  };

  const response=await onRequestPost({
    request:post({
      site_domain:"example.com",
      target_date:"2026-09-16",
      dimension_sets:["property","page","country","device"],
      row_limit_per_set:1000,
      backfill_days:1,
    }),
    env:{DB:d1,GOOGLE_OAUTH_CLIENT_ID:"client",GOOGLE_OAUTH_CLIENT_SECRET:"secret",GSC_TOKEN_ENCRYPTION_KEY:KEY},
  });
  const payload=await response.json();

  assert.equal(response.status,200);
  assert.equal(payload.data.status,"success");
  assert.equal(payload.data.appearance,"AI_OVERVIEW");
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,4);
  assert.equal(tokenCalls,1);
  assert.equal(analyticsCalls,4);
  assert.equal(payload.data.rows_written,5);
  for(const body of requests){
    assert.deepEqual(body.dimensionFilterGroups,[{
      groupType:"and",
      filters:[{dimension:"searchAppearance",operator:"equals",expression:"AI_OVERVIEW"}],
    }]);
    assert.equal(body.type,"web");
  }

  const stored=await d1.prepare(
    "SELECT dimension_set, COUNT(*) AS count FROM gsc_generative_ai_daily GROUP BY dimension_set ORDER BY dimension_set"
  ).bind().all();
  assert.deepEqual(stored.results.map((row)=>[row.dimension_set,Number(row.count)]),[
    ["country",1],["device",1],["page",2],["property",1],
  ]);
  assert.equal(payload.data.summary.metrics.impressions,100);
  assert.equal(payload.data.summary.metrics.clicks,2);
  assert.equal(payload.data.summary.pages.length,2);
  assert.equal(payload.data.summary.pages[0].key,"https://example.com/a/");
  assert.match(payload.data.disclaimer,/No AI traffic is inferred by subtraction/);
});

test("GSC Generative AI repeated sync is a zero-request no-op and GET reads D1 only",async(context)=>{
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});

  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const encrypted=await encryptSecret("refresh-token",KEY);
  await saveGscConnection(d1,{ciphertext:encrypted.ciphertext,iv:encrypted.iv,version:1,scope:"readonly",tokenType:"Bearer"});
  await saveGscMapping(d1,{siteDomain:"example.com",property:"sc-domain:example.com",propertyType:"domain",permissionLevel:"siteOwner"});
  await seedSelectedCapability(d1);

  globalThis.fetch=async(url,options)=>{
    if(url==="https://oauth2.googleapis.com/token"){
      return new Response(JSON.stringify({access_token:"access-token",expires_in:3600,scope:"readonly",token_type:"Bearer"}),{headers:{"content-type":"application/json"}});
    }
    if(String(url).includes("/searchAnalytics/query")){
      return new Response(JSON.stringify({rows:[{keys:[],clicks:1,impressions:10,ctr:0.1,position:1}]}),{headers:{"content-type":"application/json"}});
    }
    throw new Error("Unexpected fetch "+url);
  };

  const body={site_domain:"example.com",target_date:"2026-09-16",dimension_sets:["property"],row_limit_per_set:1000};
  const first=await onRequestPost({
    request:post(body),
    env:{DB:d1,GOOGLE_OAUTH_CLIENT_ID:"client",GOOGLE_OAUTH_CLIENT_SECRET:"secret",GSC_TOKEN_ENCRYPTION_KEY:KEY},
  });
  assert.equal(first.status,200);

  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("completed sync and GET must not call Google");};
  const second=await onRequestPost({request:post(body),env:{DB:d1}});
  const secondPayload=await second.json();
  assert.equal(second.status,200);
  assert.equal(secondPayload.meta.provider_requests,0);
  assert.deepEqual(secondPayload.data.skipped_dates,["2026-09-16"]);

  const get=await onRequestGet({
    request:new Request("https://preview.example/api/v2/gsc/generative-ai-sync?site_domain=example.com&days=28",{headers:{"cf-access-jwt-assertion":"access-jwt"}}),
    env:{DB:d1},
  });
  const getPayload=await get.json();
  assert.equal(get.status,200);
  assert.equal(getPayload.data.sync_enabled,true);
  assert.equal(getPayload.data.selected_appearance,"AI_OVERVIEW");
  assert.equal(getPayload.data.summary.metrics.impressions,10);
  assert.equal(getPayload.meta.provider_requests,0);
  assert.equal(calls,0);
});
