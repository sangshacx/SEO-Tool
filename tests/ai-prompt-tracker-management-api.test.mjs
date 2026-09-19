import assert from "node:assert/strict";
import test from "node:test";

import {
  onRequestGet,
  onRequestPost,
} from "../functions/api/v2/ai/prompt-tracker.js";
import { dashboardDatabase, seedProfile } from "./dashboard-test-helpers.mjs";
import { recordAiPromptObservation } from "../src/v2/storage/ai-prompt-tracker.js";

const ACCESS={"cf-access-jwt-assertion":"test-access"};

function get(query){
  return new Request("https://preview.example/api/v2/ai/prompt-tracker?"+query,{headers:ACCESS});
}

function post(body){
  return new Request("https://preview.example/api/v2/ai/prompt-tracker",{
    method:"POST",
    headers:{...ACCESS,"content-type":"application/json"},
    body:JSON.stringify(body),
  });
}

test("Prompt Tracker management API requires Cloudflare Access", async () => {
  const {d1}=await dashboardDatabase();
  const response=await onRequestGet({
    request:new Request("https://preview.example/api/v2/ai/prompt-tracker?target=example.com&location_code=2840&language_code=en"),
    env:{DB:d1},
  });
  assert.equal(response.status,401);
  assert.equal((await response.json()).error.code,"ACCESS_AUTHENTICATION_REQUIRED");
});

test("Prompt Tracker API saves and lists managed-site prompts at zero provider cost", async () => {
  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});

  const saved=await onRequestPost({
    request:post({
      target:"example.com",
      location_code:2840,
      language_code:"en",
      action:"save",
      name:"Supplier prompt",
      platform:"chat_gpt",
      model_name:"gpt-4.1-mini",
      prompt:"Which waterproof membrane manufacturers should buyers consider?",
      web_search:true,
    }),
    env:{DB:d1},
  });
  const savedPayload=await saved.json();

  assert.equal(saved.status,200);
  assert.equal(savedPayload.data.name,"Supplier prompt");
  assert.equal(savedPayload.data.status,"active");
  assert.equal(savedPayload.meta.actual_cost_usd,0);
  assert.equal(savedPayload.meta.provider_requests,0);

  const list=await onRequestGet({
    request:get("target=example.com&location_code=2840&language_code=en"),
    env:{DB:d1},
  });
  const listPayload=await list.json();

  assert.equal(list.status,200);
  assert.equal(listPayload.data.items.length,1);
  assert.equal(listPayload.data.items[0].platform,"chat_gpt");
  assert.equal(listPayload.data.items[0].observation_count,0);
  assert.equal(listPayload.meta.source,"d1");
});

test("Prompt Tracker API pauses and resumes a saved prompt without external requests", async () => {
  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});

  const savedPayload=await onRequestPost({
    request:post({
      target:"example.com",
      location_code:2840,
      language_code:"en",
      platform:"perplexity",
      model_name:"sonar",
      prompt:"Best waterproof membrane suppliers?",
      web_search:true,
    }),
    env:{DB:d1},
  }).then((response)=>response.json());

  const paused=await onRequestPost({
    request:post({
      target:"example.com",
      location_code:2840,
      language_code:"en",
      action:"status",
      tracker_id:savedPayload.data.id,
      status:"paused",
    }),
    env:{DB:d1},
  });
  assert.equal(paused.status,200);
  assert.equal((await paused.json()).data.status,"paused");

  const resumed=await onRequestPost({
    request:post({
      target:"example.com",
      location_code:2840,
      language_code:"en",
      action:"status",
      tracker_id:savedPayload.data.id,
      status:"active",
    }),
    env:{DB:d1},
  });
  assert.equal(resumed.status,200);
  assert.equal((await resumed.json()).data.status,"active");
});

test("Prompt Tracker API exposes lightweight observation history from D1", async () => {
  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});

  const savedPayload=await onRequestPost({
    request:post({
      target:"example.com",
      location_code:2840,
      language_code:"en",
      platform:"gemini",
      model_name:"gemini-2.5-flash",
      prompt:"Recommend waterproofing manufacturers.",
      web_search:true,
    }),
    env:{DB:d1},
  }).then((response)=>response.json());

  await recordAiPromptObservation(d1,{
    siteDomain:"example.com",
    trackerId:savedPayload.data.id,
    observedAt:"2026-09-19T08:10:00.000Z",
    actualCostUsd:0.003,
    result:{
      model_name:"gemini-2.5-flash",
      target_domain_mentioned:true,
      target_domain_cited:false,
      annotations:[{domain:"industry.example"}],
      fan_out_queries:[],
      input_tokens:100,
      output_tokens:200,
    },
  });

  const response=await onRequestGet({
    request:get("target=example.com&location_code=2840&language_code=en&tracker_id="+savedPayload.data.id),
    env:{DB:d1},
  });
  const payload=await response.json();

  assert.equal(response.status,200);
  assert.equal(payload.data.observations.length,1);
  assert.equal(payload.data.observations[0].target_domain_mentioned,true);
  assert.equal(payload.data.observations[0].target_domain_cited,false);
  assert.deepEqual(payload.data.observations[0].citation_domains,["industry.example"]);
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
});

test("Prompt Tracker rejects unsaved competitor domains", async () => {
  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const response=await onRequestPost({
    request:post({
      target:"rival.example",
      location_code:2840,
      language_code:"en",
      platform:"chat_gpt",
      model_name:"gpt-4.1-mini",
      prompt:"Test prompt",
      web_search:true,
    }),
    env:{DB:d1},
  });
  const payload=await response.json();
  assert.equal(response.status,409);
  assert.equal(payload.error.code,"MANAGED_SITE_REQUIRED");
});
