import assert from "node:assert/strict";
import test from "node:test";

import {
  discoveryDates,
  onRequestGet,
  onRequestPost,
} from "../functions/api/v2/gsc/generative-ai.js";
import { dashboardDatabase, seedProfile } from "./dashboard-test-helpers.mjs";
import { encryptSecret } from "../src/v2/security/secret-crypto.js";
import { saveGscConnection, saveGscMapping } from "../src/v2/storage/gsc-connections.js";
import {
  readGscSearchAppearanceCapabilities,
  replaceGscSearchAppearanceCapabilities,
  selectGscGenerativeAiAppearance,
} from "../src/v2/storage/gsc-search-analytics.js";

const ACCESS={"cf-access-jwt-assertion":"access-jwt","content-type":"application/json"};
const KEY=Buffer.alloc(32,8).toString("base64");

function post(body){
  return new Request("https://preview.example/api/v2/gsc/generative-ai",{
    method:"POST",
    headers:ACCESS,
    body:JSON.stringify(body),
  });
}

test("GSC appearance discovery window uses finalized data ending three days ago",()=>{
  assert.deepEqual(discoveryDates(28,new Date("2026-09-19T12:00:00Z")),{
    days:28,
    start_date:"2026-08-20",
    end_date:"2026-09-16",
  });
  assert.throws(
    ()=>discoveryDates(30,new Date("2026-09-19T12:00:00Z")),
    (error)=>error?.code==="GSC_SEARCH_APPEARANCE_WINDOW_INVALID",
  );
});

test("GSC appearance storage preserves an explicit selection only while Google still returns that raw value",async()=>{
  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const site=await d1.prepare("SELECT id FROM site_profiles WHERE domain = ?").bind("example.com").first();

  await replaceGscSearchAppearanceCapabilities(d1,{
    siteProfileId:site.id,
    property:"sc-domain:example.com",
    startDate:"2026-08-01",
    endDate:"2026-09-16",
    appearances:[
      {appearance:"AI_OVERVIEW",impressions:500,clicks:8,ctr:0.016,position:1,generative_ai_candidate:true},
      {appearance:"AMP_BLUE_LINK",impressions:900,clicks:20,ctr:0.022,position:4,generative_ai_candidate:false},
    ],
    discoveredAt:"2026-09-19T08:00:00Z",
  });
  await selectGscGenerativeAiAppearance(d1,{siteDomain:"example.com",appearance:"AI_OVERVIEW"});

  await replaceGscSearchAppearanceCapabilities(d1,{
    siteProfileId:site.id,
    property:"sc-domain:example.com",
    startDate:"2026-08-20",
    endDate:"2026-09-16",
    appearances:[
      {appearance:"AI_OVERVIEW",impressions:600,generative_ai_candidate:true},
      {appearance:"WEB_STORY",impressions:100,generative_ai_candidate:false},
    ],
    discoveredAt:"2026-09-19T09:00:00Z",
  });
  let state=await readGscSearchAppearanceCapabilities(d1,"example.com");
  assert.equal(state.selected_appearance,"AI_OVERVIEW");
  assert.equal(state.items.length,2);

  await replaceGscSearchAppearanceCapabilities(d1,{
    siteProfileId:site.id,
    property:"sc-domain:example.com",
    startDate:"2026-08-20",
    endDate:"2026-09-16",
    appearances:[{appearance:"WEB_STORY",impressions:110,generative_ai_candidate:false}],
    discoveredAt:"2026-09-19T10:00:00Z",
  });
  state=await readGscSearchAppearanceCapabilities(d1,"example.com");
  assert.equal(state.selected_appearance,null);
  assert.equal(state.items.length,1);
});

test("GSC Generative AI discovery calls Google once, stores raw appearances, and never auto-selects a candidate",async(context)=>{
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});

  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const encrypted=await encryptSecret("refresh-token",KEY);
  await saveGscConnection(d1,{ciphertext:encrypted.ciphertext,iv:encrypted.iv,version:1,scope:"readonly",tokenType:"Bearer"});
  await saveGscMapping(d1,{siteDomain:"example.com",property:"sc-domain:example.com",propertyType:"domain",permissionLevel:"siteOwner"});

  let tokenCalls=0,analyticsCalls=0,capturedBody=null;
  globalThis.fetch=async(url,options)=>{
    if(url==="https://oauth2.googleapis.com/token"){
      tokenCalls+=1;
      return new Response(JSON.stringify({access_token:"access-token",expires_in:3600,scope:"readonly",token_type:"Bearer"}),{
        headers:{"content-type":"application/json"},
      });
    }
    if(String(url).includes("/searchAnalytics/query")){
      analyticsCalls+=1;
      capturedBody=JSON.parse(options.body);
      return new Response(JSON.stringify({
        rows:[
          {keys:["AI_OVERVIEW"],clicks:5,impressions:400,ctr:0.0125,position:1},
          {keys:["AMP_BLUE_LINK"],clicks:10,impressions:800,ctr:0.0125,position:5},
        ],
      }),{headers:{"content-type":"application/json"}});
    }
    throw new Error("Unexpected fetch "+url);
  };

  const response=await onRequestPost({
    request:post({site_domain:"example.com",action:"discover",days:90}),
    env:{DB:d1,GOOGLE_OAUTH_CLIENT_ID:"client",GOOGLE_OAUTH_CLIENT_SECRET:"secret",GSC_TOKEN_ENCRYPTION_KEY:KEY},
  });
  const payload=await response.json();

  assert.equal(response.status,200);
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,1);
  assert.equal(tokenCalls,1);
  assert.equal(analyticsCalls,1);
  assert.deepEqual(capturedBody.dimensions,["searchAppearance"]);
  assert.equal(capturedBody.type,"web");
  assert.equal(payload.data.candidate_count,1);
  assert.equal(payload.data.selected_appearance,null);
  assert.equal(payload.data.sync_enabled,false);
  assert.equal(payload.data.items.length,2);
  assert.equal(payload.data.items.find((row)=>row.appearance==="AI_OVERVIEW").generative_ai_candidate,true);
});

test("GSC Generative AI selection is D1-only and only accepts a discovered raw appearance value",async(context)=>{
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("selection must not call Google");};

  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const site=await d1.prepare("SELECT id FROM site_profiles WHERE domain = ?").bind("example.com").first();
  await replaceGscSearchAppearanceCapabilities(d1,{
    siteProfileId:site.id,
    property:"sc-domain:example.com",
    startDate:"2026-08-20",
    endDate:"2026-09-16",
    appearances:[
      {appearance:"AI_OVERVIEW",impressions:500,generative_ai_candidate:true},
      {appearance:"AMP_BLUE_LINK",impressions:900,generative_ai_candidate:false},
    ],
  });

  const selected=await onRequestPost({
    request:post({site_domain:"example.com",action:"select",appearance:"AI_OVERVIEW"}),
    env:{DB:d1},
  });
  const selectedPayload=await selected.json();
  assert.equal(selected.status,200);
  assert.equal(selectedPayload.data.selected_appearance,"AI_OVERVIEW");
  assert.equal(selectedPayload.data.sync_enabled,true);
  assert.equal(selectedPayload.meta.provider_requests,0);
  assert.equal(calls,0);

  const invalid=await onRequestPost({
    request:post({site_domain:"example.com",action:"select",appearance:"UNDOCUMENTED_GUESS"}),
    env:{DB:d1},
  });
  assert.equal(invalid.status,400);
  assert.equal((await invalid.json()).error.code,"GSC_SEARCH_APPEARANCE_NOT_DISCOVERED");
  assert.equal(calls,0);

  const cleared=await onRequestPost({
    request:post({site_domain:"example.com",action:"clear"}),
    env:{DB:d1},
  });
  const clearedPayload=await cleared.json();
  assert.equal(cleared.status,200);
  assert.equal(clearedPayload.data.selected_appearance,null);
  assert.equal(clearedPayload.data.sync_enabled,false);
  assert.equal(calls,0);
});

test("GSC Generative AI capability GET reads only D1 and discovery refuses an unmapped site before Google",async(context)=>{
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("Google must not run");};

  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});

  const status=await onRequestGet({
    request:new Request("https://preview.example/api/v2/gsc/generative-ai?site_domain=example.com",{headers:{"cf-access-jwt-assertion":"access-jwt"}}),
    env:{DB:d1},
  });
  const statusPayload=await status.json();
  assert.equal(status.status,200);
  assert.equal(statusPayload.data.mapped,false);
  assert.equal(statusPayload.data.discovered,false);
  assert.equal(statusPayload.meta.provider_requests,0);

  const discover=await onRequestPost({
    request:post({site_domain:"example.com",action:"discover"}),
    env:{DB:d1},
  });
  assert.equal(discover.status,409);
  assert.equal((await discover.json()).error.code,"GSC_SITE_NOT_MAPPED");
  assert.equal(calls,0);
});
