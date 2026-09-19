import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet as startConnect } from "../functions/api/v2/gsc/connect/start.js";
import { onRequestGet as oauthCallback } from "../functions/api/v2/gsc/connect/callback.js";
import { onRequestGet as getStatus } from "../functions/api/v2/gsc/status.js";
import { onRequestGet as getProperties } from "../functions/api/v2/gsc/properties.js";
import { onRequestPost as saveMapping } from "../functions/api/v2/gsc/mappings.js";
import { onRequestPost as disconnect } from "../functions/api/v2/gsc/disconnect.js";
import { dashboardDatabase, memoryCache, seedProfile } from "./dashboard-test-helpers.mjs";

const ACCESS={"cf-access-jwt-assertion":"access-jwt"};
const KEY=Buffer.alloc(32,7).toString("base64");

function jsonRequest(url,body){return new Request(url,{method:"POST",headers:{...ACCESS,"content-type":"application/json","sec-fetch-site":"same-origin"},body:JSON.stringify(body)});}

test("GSC OAuth API connects, encrypts, lists, maps and disconnects without exposing refresh tokens", async (context) => {
  const originalFetch=globalThis.fetch; context.after(()=>{globalThis.fetch=originalFetch;});
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const cache=memoryCache();
  const env={DB:d1,CACHE:cache,GOOGLE_OAUTH_CLIENT_ID:"client-id",GOOGLE_OAUTH_CLIENT_SECRET:"client-secret",GOOGLE_OAUTH_REDIRECT_URI:"https://preview.example/api/v2/gsc/connect/callback",GSC_TOKEN_ENCRYPTION_KEY:KEY};

  const start=await startConnect({request:new Request("https://preview.example/api/v2/gsc/connect/start",{headers:{...ACCESS,"sec-fetch-site":"same-origin"}}),env});
  assert.equal(start.status,302);
  const auth=new URL(start.headers.get("location"));
  const state=auth.searchParams.get("state");
  assert.equal(auth.searchParams.get("access_type"),"offline");
  assert.ok(state);

  globalThis.fetch=async(url,options)=>{
    if(url==="https://oauth2.googleapis.com/token"){
      const form=new URLSearchParams(options.body);
      if(form.get("grant_type")==="authorization_code") return new Response(JSON.stringify({access_token:"access-1",refresh_token:"plain-refresh-token",expires_in:3600,scope:"https://www.googleapis.com/auth/webmasters.readonly",token_type:"Bearer"}),{headers:{"content-type":"application/json"}});
      return new Response(JSON.stringify({access_token:"access-2",expires_in:3600,scope:"https://www.googleapis.com/auth/webmasters.readonly",token_type:"Bearer"}),{headers:{"content-type":"application/json"}});
    }
    if(url==="https://www.googleapis.com/webmasters/v3/sites") return new Response(JSON.stringify({siteEntry:[{siteUrl:"sc-domain:example.com",permissionLevel:"siteOwner"},{siteUrl:"sc-domain:rival.example",permissionLevel:"siteOwner"}]}),{headers:{"content-type":"application/json"}});
    if(url==="https://oauth2.googleapis.com/revoke") return new Response(null,{status:200});
    throw new Error("Unexpected fetch "+url);
  };

  const callback=await oauthCallback({request:new Request("https://preview.example/api/v2/gsc/connect/callback?state="+state+"&code=google-code",{headers:{...ACCESS,"sec-fetch-site":"cross-site"}}),env});
  assert.equal(callback.status,302);
  assert.match(callback.headers.get("location"),/gsc=connected/);
  const row=await d1.prepare("SELECT refresh_token_ciphertext FROM gsc_connections WHERE id = 1").bind().first();
  assert.ok(row.refresh_token_ciphertext);
  assert.doesNotMatch(row.refresh_token_ciphertext,/plain-refresh-token/);

  const replay=await oauthCallback({request:new Request("https://preview.example/api/v2/gsc/connect/callback?state="+state+"&code=again",{headers:{...ACCESS,"sec-fetch-site":"cross-site"}}),env});
  assert.equal(replay.status,400);

  const status=await getStatus({request:new Request("https://preview.example/api/v2/gsc/status",{headers:ACCESS}),env});
  const statusPayload=await status.json();
  assert.equal(statusPayload.data.connected,true);
  assert.equal(JSON.stringify(statusPayload).includes("plain-refresh-token"),false);

  const properties=await getProperties({request:new Request("https://preview.example/api/v2/gsc/properties",{headers:ACCESS}),env});
  const propertiesPayload=await properties.json();
  assert.equal(properties.status,200);
  assert.equal(propertiesPayload.data.properties.length,2);
  assert.equal(propertiesPayload.meta.actual_cost_usd,0);

  const mismatch=await saveMapping({request:jsonRequest("https://preview.example/api/v2/gsc/mappings",{site_domain:"example.com",property:"sc-domain:rival.example"}),env});
  assert.equal(mismatch.status,409);
  assert.equal((await mismatch.json()).error.code,"GSC_PROPERTY_SITE_MISMATCH");

  const mapped=await saveMapping({request:jsonRequest("https://preview.example/api/v2/gsc/mappings",{site_domain:"example.com",property:"sc-domain:example.com"}),env});
  const mappedPayload=await mapped.json();
  assert.equal(mapped.status,200);
  assert.equal(mappedPayload.data.site_domain,"example.com");
  assert.equal(mappedPayload.data.property,"sc-domain:example.com");

  const disconnected=await disconnect({request:new Request("https://preview.example/api/v2/gsc/disconnect",{method:"POST",headers:{...ACCESS,"sec-fetch-site":"same-origin"}}),env});
  const disconnectedPayload=await disconnected.json();
  assert.equal(disconnected.status,200);
  assert.equal(disconnectedPayload.data.connected,false);
  assert.equal(await d1.prepare("SELECT id FROM gsc_connections WHERE id = 1").bind().first(),null);
  assert.equal(await d1.prepare("SELECT site_profile_id FROM gsc_site_mappings LIMIT 1").bind().first(),null);
});

test("GSC connection endpoints require Cloudflare Access", async () => {
  const { d1 }=await dashboardDatabase();
  const response=await getStatus({request:new Request("https://preview.example/api/v2/gsc/status"),env:{DB:d1}});
  assert.equal(response.status,401);
  assert.equal((await response.json()).error.code,"ACCESS_AUTHENTICATION_REQUIRED");
});
