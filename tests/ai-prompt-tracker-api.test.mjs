import assert from "node:assert/strict";
import test from "node:test";

import { onRequestGet as modelsGet } from "../functions/api/v2/ai/prompt-models.js";
import { onRequestPost as promptPost } from "../functions/api/v2/ai/prompt-test.js";
import {
  buildPromptModelsCacheKey,
  buildPromptResultCacheKey,
} from "../src/v2/ai/prompt-tracker-cache.js";
import { dashboardDatabase, seedProfile } from "./dashboard-test-helpers.mjs";
import {
  listAiPromptObservations,
  updateAiPromptTrackerStatus,
  upsertAiPromptTracker,
} from "../src/v2/storage/ai-prompt-tracker.js";

class FakeKv {
  constructor(entries = []) {
    this.map = new Map(entries);
    this.puts = [];
  }
  async get(key, type) {
    const value = this.map.get(key);
    if (value === undefined) return null;
    if (type === "json") return typeof value === "string" ? JSON.parse(value) : value;
    return value;
  }
  async put(key, value, options) {
    this.map.set(key, value);
    this.puts.push({ key, value, options });
  }
}

function getModelsRequest(platform = "chat_gpt") {
  return new Request("https://preview.example/api/v2/ai/prompt-models?platform=" + encodeURIComponent(platform));
}

function postPrompt(body) {
  return new Request("https://preview.example/api/v2/ai/prompt-test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function modelsPayload(models) {
  return {
    status_code: 20000,
    cost: 0,
    tasks_count: 1,
    tasks: [{
      status_code: 20000,
      cost: 0,
      result_count: models.length,
      result: models,
    }],
  };
}

function promptPayload({
  model = "gpt-4.1-mini-2025-04-14",
  cost = 0.0042,
  moneySpent = 0.0036,
} = {}) {
  return {
    status_code: 20000,
    cost,
    tasks_count: 1,
    tasks: [{
      status_code: 20000,
      cost,
      result_count: 1,
      result: [{
        model_name: model,
        input_tokens: 100,
        output_tokens: 180,
        reasoning_tokens: 0,
        web_search: true,
        money_spent: moneySpent,
        datetime: "2026-09-19 08:00:00 +00:00",
        items: [{
          type: "message",
          sections: [{
            type: "text",
            text: "Example.com is included and cited.",
            annotations: [{
              title: "Example source",
              url: "https://example.com/page/",
              text: "Example citation",
            }],
          }],
        }],
        fan_out_queries: ["best waterproof membrane suppliers"],
      }],
    }],
  };
}

test("Prompt Tracker cache keys hash prompt text instead of exposing it in KV keys", async () => {
  const key = await buildPromptResultCacheKey({
    target: "example.com",
    platform: "chat_gpt",
    modelName: "gpt-4.1-mini",
    prompt: "Which companies manufacture waterproof membranes?",
    webSearch: true,
    countryIsoCode: "US",
    maxOutputTokens: 1024,
  });
  assert.match(key, /^v2:ai-prompt:result:[a-f0-9]{64}$/);
  assert.equal(key.includes("waterproof"), false);

  const repeated = await buildPromptResultCacheKey({
    target: "example.com",
    platform: "chat_gpt",
    modelName: "gpt-4.1-mini",
    prompt: "Which companies manufacture waterproof membranes?",
    webSearch: true,
    countryIsoCode: "US",
    maxOutputTokens: 1024,
  });
  assert.equal(repeated, key);
});

test("Prompt model API caches the free DataForSEO model list for 24 hours", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify(modelsPayload([
      { model_name: "gpt-4.1-mini", reasoning: false, web_search_supported: true, task_post_supported: true },
    ])), { headers: { "content-type": "application/json" } });
  };

  const cache = new FakeKv();
  const first = await modelsGet({
    request: getModelsRequest(),
    env: { CACHE: cache, DATAFORSEO_LOGIN: "login", DATAFORSEO_PASSWORD: "password" },
  });
  const firstPayload = await first.json();

  assert.equal(first.status, 200);
  assert.equal(firstPayload.meta.actual_cost_usd, 0);
  assert.equal(firstPayload.meta.provider_requests, 1);
  assert.equal(cache.puts.length, 1);
  assert.equal(cache.puts[0].key, buildPromptModelsCacheKey("chat_gpt"));
  assert.equal(cache.puts[0].options.expirationTtl, 24 * 60 * 60);

  const second = await modelsGet({
    request: getModelsRequest(),
    env: { CACHE: cache, DATAFORSEO_LOGIN: "login", DATAFORSEO_PASSWORD: "password" },
  });
  const secondPayload = await second.json();

  assert.equal(second.status, 200);
  assert.equal(secondPayload.data.source, "cache");
  assert.equal(secondPayload.meta.provider_requests, 0);
  assert.equal(calls, 1);
});

test("Prompt Test cache miss never bills until Cost Guard confirmation", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("provider must not run");
  };

  const response = await promptPost({
    request: postPrompt({
      target: "example.com",
      location_code: 2840,
      language_code: "en",
      platform: "chat_gpt",
      model_name: "gpt-4.1-mini",
      prompt: "Which waterproof membrane manufacturers should buyers consider?",
      web_search: true,
    }),
    env: { CACHE: new FakeKv() },
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "LIVE_REQUEST_CONFIRMATION_REQUIRED");
  assert.equal(payload.meta.actual_cost_usd, 0);
  assert.equal(payload.meta.provider_requests, 0);
  assert.equal(calls, 0);
});

test("Confirmed Prompt Test validates models for free then makes one paid live request and caches it", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (String(url).endsWith("/models")) {
      return new Response(JSON.stringify(modelsPayload([
        { model_name: "gpt-4.1-mini", reasoning: false, web_search_supported: true, task_post_supported: true },
      ])), { headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(promptPayload()), { headers: { "content-type": "application/json" } });
  };

  const cache = new FakeKv();
  const response = await promptPost({
    request: postPrompt({
      target: "https://www.example.com/",
      location_code: 2840,
      language_code: "en",
      platform: "chat_gpt",
      model_name: "gpt-4.1-mini",
      prompt: "Which waterproof membrane manufacturers should buyers consider?",
      web_search: true,
      allow_live_request: true,
    }),
    env: {
      CACHE: cache,
      DATAFORSEO_LOGIN: "login",
      DATAFORSEO_PASSWORD: "password",
    },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.source, "provider");
  assert.equal(payload.data.target_domain, "example.com");
  assert.equal(payload.data.target_domain_mentioned, true);
  assert.equal(payload.data.target_domain_cited, true);
  assert.equal(payload.data.annotations[0].domain, "example.com");
  assert.equal(payload.meta.actual_cost_usd, 0.0042);
  assert.equal(payload.meta.provider_requests, 2);
  assert.equal(payload.meta.paid_provider_requests, 1);
  assert.equal(payload.meta.free_model_provider_requests, 1);
  assert.equal(calls.length, 2);
  assert.equal(cache.puts.length, 2);

  const liveCall = calls.find((call) => String(call.url).endsWith("/live"));
  const task = JSON.parse(liveCall.options.body)[0];
  assert.equal(task.web_search_country_iso_code, "US");
  assert.equal(task.max_output_tokens, 1024);
});

test("Prompt Test rejects a web-search-incompatible model before the paid live call", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    assert.match(String(url), /\/models$/);
    return new Response(JSON.stringify(modelsPayload([
      { model_name: "offline-model", reasoning: false, web_search_supported: false, task_post_supported: true },
    ])), { headers: { "content-type": "application/json" } });
  };

  const response = await promptPost({
    request: postPrompt({
      target: "example.com",
      location_code: 2682,
      language_code: "ar",
      platform: "chat_gpt",
      model_name: "offline-model",
      prompt: "اختبر ظهور العلامة التجارية في إجابة الذكاء الاصطناعي",
      web_search: true,
      allow_live_request: true,
    }),
    env: {
      CACHE: new FakeKv(),
      DATAFORSEO_LOGIN: "login",
      DATAFORSEO_PASSWORD: "password",
    },
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "MODEL_WEB_SEARCH_UNSUPPORTED");
  assert.equal(payload.meta.actual_cost_usd, 0);
  assert.equal(payload.meta.provider_requests, 1);
  assert.equal(calls, 1);
});

test("Prompt Test serves identical cached prompt observations at zero provider cost", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error("provider must not run"); };

  const cacheInput = {
    target: "example.com",
    platform: "chat_gpt",
    modelName: "gpt-4.1-mini",
    prompt: "Which waterproof membrane manufacturers should buyers consider?",
    webSearch: true,
    countryIsoCode: "US",
    maxOutputTokens: 1024,
  };
  const key = await buildPromptResultCacheKey(cacheInput);
  const cache = new FakeKv([[
    key,
    {
      cached_at: "2026-09-19T08:00:00.000Z",
      data: {
        platform: "chat_gpt",
        model_name: "gpt-4.1-mini",
        prompt: cacheInput.prompt,
        answer: "Cached answer",
        annotations: [],
        target_domain: "example.com",
        target_domain_mentioned: false,
        target_domain_cited: false,
      },
    },
  ]]);

  const response = await promptPost({
    request: postPrompt({
      target: "example.com",
      location_code: 2840,
      language_code: "en",
      platform: "chat_gpt",
      model_name: "gpt-4.1-mini",
      prompt: cacheInput.prompt,
      web_search: true,
    }),
    env: { CACHE: cache },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.source, "cache");
  assert.equal(payload.data.answer, "Cached answer");
  assert.equal(payload.meta.actual_cost_usd, 0);
  assert.equal(payload.meta.provider_requests, 0);
});


test("Saved Prompt Tracker live runs record exactly one lightweight D1 observation", async (context) => {
  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const tracker=await upsertAiPromptTracker(d1,{
    siteDomain:"example.com",
    name:"Supplier visibility",
    platform:"chat_gpt",
    modelName:"gpt-4.1-mini",
    prompt:"Which waterproof membrane manufacturers should buyers consider?",
    webSearch:true,
    locationCode:2840,
    languageCode:"en",
  });

  const modelKey=buildPromptModelsCacheKey("chat_gpt");
  const cache=new FakeKv([[
    modelKey,
    {
      cached_at:"2026-09-19T08:00:00.000Z",
      data:{
        platform:"chat_gpt",
        models:[{
          model_name:"gpt-4.1-mini",
          reasoning:false,
          web_search_supported:true,
          task_post_supported:true,
        }],
      },
    },
  ]]);

  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let liveCalls=0;
  globalThis.fetch=async(url)=>{
    liveCalls+=1;
    assert.match(String(url),/\/live$/);
    return new Response(JSON.stringify(promptPayload()),{
      headers:{"content-type":"application/json"},
    });
  };

  const response=await promptPost({
    request:postPrompt({
      target:"example.com",
      location_code:2840,
      language_code:"en",
      platform:"chat_gpt",
      model_name:"gpt-4.1-mini",
      prompt:"Which waterproof membrane manufacturers should buyers consider?",
      web_search:true,
      tracker_id:tracker.id,
      allow_live_request:true,
      force_refresh:true,
    }),
    env:{
      CACHE:cache,
      DB:d1,
      DATAFORSEO_LOGIN:"login",
      DATAFORSEO_PASSWORD:"password",
    },
  });
  const payload=await response.json();

  assert.equal(response.status,200);
  assert.equal(payload.meta.provider_requests,1);
  assert.equal(payload.meta.observation_recorded,true);
  assert.equal(payload.meta.tracker_id,tracker.id);
  assert.ok(payload.meta.observation_id>0);
  assert.equal(liveCalls,1);

  const observations=await listAiPromptObservations(d1,{
    siteDomain:"example.com",
    trackerId:tracker.id,
  });
  assert.equal(observations.length,1);
  assert.equal(observations[0].target_domain_mentioned,true);
  assert.equal(observations[0].target_domain_cited,true);
  assert.equal(observations[0].actual_cost_usd,0.0042);

  const cached=await promptPost({
    request:postPrompt({
      target:"example.com",
      location_code:2840,
      language_code:"en",
      platform:"chat_gpt",
      model_name:"gpt-4.1-mini",
      prompt:"Which waterproof membrane manufacturers should buyers consider?",
      web_search:true,
      tracker_id:tracker.id,
    }),
    env:{CACHE:cache,DB:d1},
  });
  const cachedPayload=await cached.json();
  assert.equal(cached.status,200);
  assert.equal(cachedPayload.meta.observation_recorded,false);
  assert.equal(cachedPayload.meta.actual_cost_usd,0);

  const observationsAfterCache=await listAiPromptObservations(d1,{
    siteDomain:"example.com",
    trackerId:tracker.id,
  });
  assert.equal(observationsAfterCache.length,1);
});

test("Paused or mismatched Prompt Trackers fail before any paid provider call", async (context) => {
  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const tracker=await upsertAiPromptTracker(d1,{
    siteDomain:"example.com",
    platform:"gemini",
    modelName:"gemini-2.5-flash",
    prompt:"Recommend waterproof membrane suppliers.",
    webSearch:true,
    locationCode:2840,
    languageCode:"en",
  });

  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not run");};

  const mismatch=await promptPost({
    request:postPrompt({
      target:"example.com",
      location_code:2840,
      language_code:"en",
      platform:"gemini",
      model_name:"gemini-2.5-flash",
      prompt:"A different prompt.",
      web_search:true,
      tracker_id:tracker.id,
      allow_live_request:true,
    }),
    env:{CACHE:new FakeKv(),DB:d1},
  });
  assert.equal(mismatch.status,409);
  assert.equal((await mismatch.json()).error.code,"TRACKER_CONFIG_MISMATCH");
  assert.equal(calls,0);

  await updateAiPromptTrackerStatus(d1,{
    siteDomain:"example.com",
    trackerId:tracker.id,
    status:"paused",
  });
  const paused=await promptPost({
    request:postPrompt({
      target:"example.com",
      location_code:2840,
      language_code:"en",
      platform:"gemini",
      model_name:"gemini-2.5-flash",
      prompt:"Recommend waterproof membrane suppliers.",
      web_search:true,
      tracker_id:tracker.id,
      allow_live_request:true,
    }),
    env:{CACHE:new FakeKv(),DB:d1},
  });
  assert.equal(paused.status,409);
  assert.equal((await paused.json()).error.code,"TRACKER_PAUSED");
  assert.equal(calls,0);
});
