import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost as comparePost } from "../functions/api/v2/ai/compare.js";
import { onRequestPost as pagesPost } from "../functions/api/v2/ai/pages.js";
import { onRequestPost as mentionsPost } from "../functions/api/v2/ai/mentions.js";
import { buildAiVisibilityCacheKey } from "../src/v2/ai/ai-visibility-cache.js";

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

class FakeDb {
  constructor() { this.runs = []; }
  prepare(sql) {
    return {
      bind: (...args) => ({
        run: async () => {
          this.runs.push({ sql, args });
          return { meta: { changes: 1 } };
        },
      }),
    };
  }
}

function request(path, body) {
  return new Request("https://preview.example" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function okProvider(result, cost = 0.11) {
  return new Response(JSON.stringify({
    status_code: 20000,
    cost,
    tasks_count: 1,
    tasks: [{
      status_code: 20000,
      cost,
      result_count: 1,
      result: [result],
    }],
  }), { headers: { "content-type": "application/json" } });
}

test("AI compare API cache miss requires confirmation and does not call the provider", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("provider should not be called");
  };

  const response = await comparePost({
    request: request("/api/v2/ai/compare", {
      targets: ["example.com", "competitor.com"],
      platform: "google",
      location_code: 2840,
      language_code: "en",
    }),
    env: { CACHE: new FakeKv(), DB: new FakeDb() },
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "LIVE_REQUEST_CONFIRMATION_REQUIRED");
  assert.equal(payload.meta.provider_requests, 0);
  assert.equal(calls, 0);
});

test("AI compare API confirmed request normalizes duplicate domains and caches one multi-target result", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return okProvider({
      total_count: 2,
      offset: 0,
      items_count: 2,
      aggregated_metrics: { total: { mentions: 30, ai_search_volume: 800 } },
      items: [
        { key: "example.com", total: { mentions: 20, ai_search_volume: 500 } },
        { key: "competitor.com", total: { mentions: 10, ai_search_volume: 300 } },
      ],
    }, 0.112);
  };

  const cache = new FakeKv();
  const response = await comparePost({
    request: request("/api/v2/ai/compare", {
      targets: ["https://www.example.com/", "example.com", "competitor.com"],
      platform: "google",
      location_code: 2840,
      language_code: "en",
      allow_live_request: true,
    }),
    env: {
      CACHE: cache,
      DB: new FakeDb(),
      DATAFORSEO_LOGIN: "login",
      DATAFORSEO_PASSWORD: "password",
    },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.items.length, 2);
  assert.equal(payload.data.source, "provider");
  assert.equal(payload.meta.actual_cost_usd, 0.112);
  assert.equal(cache.puts.length, 1);
  const task = JSON.parse(captured.options.body)[0];
  assert.equal(task.targets.length, 2);
  assert.deepEqual(task.targets.map((item) => item.key), ["example.com", "competitor.com"]);
});

test("Top mentioned pages API returns cache without provider usage", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error("provider must not be called"); };

  const key = buildAiVisibilityCacheKey({
    target: "example.com",
    platform: "google",
    locationCode: 2840,
    languageCode: "en",
    view: "pages",
    limit: 25,
  });
  const cache = new FakeKv([[
    key,
    {
      cached_at: "2026-09-19T00:00:00.000Z",
      data: {
        target: "example.com",
        items: [{ page: "https://example.com/a/", mentions: 7, ai_search_volume: 180 }],
      },
    },
  ]]);

  const response = await pagesPost({
    request: request("/api/v2/ai/pages", {
      target: "example.com",
      platform: "google",
      location_code: 2840,
      language_code: "en",
      limit: 25,
    }),
    env: { CACHE: cache, DB: new FakeDb() },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.source, "cache");
  assert.equal(payload.data.items[0].mentions, 7);
  assert.equal(payload.meta.actual_cost_usd, 0);
  assert.equal(payload.meta.provider_requests, 0);
});

test("Top mentioned pages API confirmed request uses bounded depth and writes cache", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return okProvider({
      total_count: 1,
      offset: 0,
      items_count: 1,
      aggregated_metrics: { total: { mentions: 8, ai_search_volume: 240 } },
      items: [{
        page: "https://example.com/a/",
        sources_domain: [{ key: "source.example", mentions: 6, ai_search_volume: 190 }],
        total: { mentions: 8, ai_search_volume: 240 },
      }],
    }, 0.104);
  };

  const cache = new FakeKv();
  const response = await pagesPost({
    request: request("/api/v2/ai/pages", {
      target: "example.com",
      platform: "google",
      location_code: 2840,
      language_code: "en",
      limit: 25,
      allow_live_request: true,
    }),
    env: {
      CACHE: cache,
      DB: new FakeDb(),
      DATAFORSEO_LOGIN: "login",
      DATAFORSEO_PASSWORD: "password",
    },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.items[0].page, "https://example.com/a/");
  assert.equal(payload.data.items[0].source_domains[0].key, "source.example");
  assert.equal(payload.meta.provider_requests, 1);
  assert.equal(cache.puts.length, 1);
  const task = JSON.parse(captured.options.body)[0];
  assert.equal(task.limit, 25);
  assert.equal(task.links_scope, "sources");
});


test("AI Citation Explorer cache miss stays zero-cost until explicitly confirmed", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("provider should not run");};

  const response=await mentionsPost({
    request:request("/api/v2/ai/mentions",{
      target:"example.com",
      platform:"google",
      location_code:2840,
      language_code:"en",
      limit:25,
    }),
    env:{CACHE:new FakeKv(),DB:new FakeDb()},
  });
  const payload=await response.json();

  assert.equal(response.status,409);
  assert.equal(payload.error.code,"LIVE_REQUEST_CONFIRMATION_REQUIRED");
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
  assert.equal(calls,0);
});

test("AI Citation Explorer confirmed request caches bounded question and citation evidence", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let captured;
  globalThis.fetch=async(url,options)=>{
    captured={url,options};
    return okProvider({
      total_count:1,
      current_offset:0,
      search_after_token:null,
      items_count:1,
      items:[{
        platform:"google",
        model_name:"google_ai_overview",
        location_code:2840,
        language_code:"en",
        question:"which waterproof membrane lasts longest",
        answer:"A concise answer with a cited manufacturer page.",
        sources:[{
          rank:1,
          title:"Example waterproofing guide",
          domain:"example.com",
          url:"https://example.com/guide/",
          snippet:"A relevant source.",
          source_name:"Example",
        }],
        ai_search_volume:90,
        first_response_at:"2026-08-01 00:00:00 +00:00",
        last_response_at:"2026-09-19 00:00:00 +00:00",
        is_web_search_based:true,
      }],
    },0.103);
  };

  const cache=new FakeKv();
  const response=await mentionsPost({
    request:request("/api/v2/ai/mentions",{
      target:"example.com",
      platform:"google",
      location_code:2840,
      language_code:"en",
      limit:25,
      allow_live_request:true,
    }),
    env:{
      CACHE:cache,
      DB:new FakeDb(),
      DATAFORSEO_LOGIN:"login",
      DATAFORSEO_PASSWORD:"password",
    },
  });
  const payload=await response.json();

  assert.equal(response.status,200);
  assert.equal(payload.ok,true);
  assert.equal(payload.data.source,"provider");
  assert.equal(payload.data.items[0].question,"which waterproof membrane lasts longest");
  assert.equal(payload.data.items[0].sources[0].domain,"example.com");
  assert.equal(payload.data.items[0].target_source_count,1);
  assert.equal(payload.meta.actual_cost_usd,0.103);
  assert.equal(payload.meta.provider_requests,1);
  assert.equal(cache.puts.length,1);
  const task=JSON.parse(captured.options.body)[0];
  assert.deepEqual(task.target[0].search_scope,["sources"]);
  assert.equal(task.limit,25);
});

test("AI Citation Explorer serves a compatible cache at zero provider cost", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async()=>{throw new Error("provider must not run");};

  const key=buildAiVisibilityCacheKey({
    target:"example.com",
    platform:"google",
    locationCode:2840,
    languageCode:"en",
    view:"citations",
    limit:25,
  });
  const cache=new FakeKv([[
    key,
    {
      cached_at:"2026-09-19T00:00:00.000Z",
      data:{
        target:"example.com",
        items:[{
          question:"cached question",
          answer_excerpt:"cached answer",
          sources:[{domain:"example.com",url:"https://example.com/"}],
          ai_search_volume:50,
        }],
      },
    },
  ]]);

  const response=await mentionsPost({
    request:request("/api/v2/ai/mentions",{
      target:"example.com",
      platform:"google",
      location_code:2840,
      language_code:"en",
      limit:25,
    }),
    env:{CACHE:cache,DB:new FakeDb()},
  });
  const payload=await response.json();

  assert.equal(response.status,200);
  assert.equal(payload.data.source,"cache");
  assert.equal(payload.data.items[0].question,"cached question");
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
});
