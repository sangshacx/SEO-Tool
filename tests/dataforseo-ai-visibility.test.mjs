import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_VISIBILITY_HISTORY_ENDPOINT,
  AI_VISIBILITY_MULTI_TARGET_METRICS_ENDPOINT,
  AI_VISIBILITY_NEW_LOST_ENDPOINT,
  AI_VISIBILITY_SEARCH_MENTIONS_ENDPOINT,
  AI_VISIBILITY_TARGET_METRICS_ENDPOINT,
  AI_VISIBILITY_TOP_PAGES_ENDPOINT,
  aiVisibilityHistoryDateRange,
  fetchAiVisibilityHistorical,
  fetchAiVisibilityMentionExplorer,
  fetchAiVisibilityMultiTargetMetrics,
  fetchAiVisibilityNewLost,
  fetchAiVisibilityTargetMetrics,
  fetchAiVisibilityTopMentionedPages,
} from "../src/v2/providers/dataforseo-ai-visibility.js";

function okResponse(result, { cost = 0.103, resultCount = 1 } = {}) {
  return new Response(JSON.stringify({
    status_code: 20000,
    cost,
    tasks_count: 1,
    tasks: [{
      status_code: 20000,
      cost,
      result_count: resultCount,
      result: [result],
    }],
  }), { headers: { "content-type": "application/json" } });
}

test("AI Visibility Target Metrics sends an explicit market/platform task and normalizes totals and citations", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return okResponse({
      total_count: 0,
      offset: 0,
      items_count: 0,
      aggregated_metrics: {
        location: [{ key: 2840, mentions: 12, ai_search_volume: 340 }],
        language: [{ key: "en", mentions: 12, ai_search_volume: 340 }],
        platform: [{ key: "google", mentions: 12, ai_search_volume: 340 }],
        sources_domain: [
          { key: "example-source.com", mentions: 8, ai_search_volume: 220 },
          { key: "another-source.com", mentions: 4, ai_search_volume: 120 },
        ],
        total: { mentions: 12, ai_search_volume: 340 },
      },
      items: null,
    });
  };

  const result = await fetchAiVisibilityTargetMetrics({
    login: "login",
    password: "password",
    target: "https://www.example.com/products/",
    platform: "google",
    locationCode: 2840,
    languageCode: "en",
  });

  assert.equal(captured.url, AI_VISIBILITY_TARGET_METRICS_ENDPOINT);
  const task = JSON.parse(captured.options.body)[0];
  assert.deepEqual(task.target, [{
    domain: "example.com",
    search_filter: "include",
    include_subdomains: false,
  }]);
  assert.equal(task.platform, "google");
  assert.equal(task.location_code, 2840);
  assert.equal(task.language_code, "en");
  assert.equal(task.internal_list_limit, 10);
  assert.equal(result.actualCostUsd, 0.103);
  assert.equal(result.data.target, "example.com");
  assert.equal(result.data.metrics.total.mentions, 12);
  assert.equal(result.data.metrics.total.ai_search_volume, 340);
  assert.equal(result.data.metrics.source_domains[0].key, "example-source.com");
  assert.equal(result.data.metrics.source_domains[0].mentions, 8);
});

test("AI Visibility prevents unsupported ChatGPT markets before making a paid provider call", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("fetch should not run");
  };

  await assert.rejects(
    fetchAiVisibilityTargetMetrics({
      login: "login",
      password: "password",
      target: "example.com",
      platform: "chat_gpt",
      locationCode: 2702,
      languageCode: "zh",
    }),
    (error) => error?.code === "CHATGPT_MARKET_UNSUPPORTED" && error?.httpStatus === 400,
  );
  assert.equal(calls, 0);
});

test("AI Visibility Multi-Target compares 2-10 unique normalized domains in one provider request", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return okResponse({
      total_count: 2,
      offset: 0,
      items_count: 2,
      aggregated_metrics: {
        platform: [{ key: "google", mentions: 30, ai_search_volume: 800 }],
        total: { mentions: 30, ai_search_volume: 800 },
      },
      items: [
        {
          key: "example.com",
          platform: [{ key: "google", mentions: 20, ai_search_volume: 500 }],
          sources_domain: [{ key: "source-a.com", mentions: 9, ai_search_volume: 250 }],
          total: { mentions: 20, ai_search_volume: 500 },
        },
        {
          key: "competitor.com",
          platform: [{ key: "google", mentions: 10, ai_search_volume: 300 }],
          sources_domain: [{ key: "source-b.com", mentions: 5, ai_search_volume: 180 }],
          total: { mentions: 10, ai_search_volume: 300 },
        },
      ],
    }, { resultCount: 1 });
  };

  const result = await fetchAiVisibilityMultiTargetMetrics({
    login: "login",
    password: "password",
    targets: ["https://www.example.com/", "example.com", "https://competitor.com/path"],
    platform: "google",
    locationCode: 2840,
    languageCode: "en",
  });

  assert.equal(captured.url, AI_VISIBILITY_MULTI_TARGET_METRICS_ENDPOINT);
  const task = JSON.parse(captured.options.body)[0];
  assert.equal(task.targets.length, 2);
  assert.deepEqual(task.targets.map((item) => item.key), ["example.com", "competitor.com"]);
  assert.equal(task.limit, 2);
  assert.deepEqual(result.data.targets, ["example.com", "competitor.com"]);
  assert.equal(result.data.items.length, 2);
  assert.equal(result.data.items[0].metrics.total.mentions, 20);
  assert.equal(result.data.aggregate_metrics.total.mentions, 30);
});

test("AI Visibility Top Mentioned Pages uses the new endpoint and normalizes page-level citation evidence", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return okResponse({
      total_count: 2,
      offset: 0,
      items_count: 2,
      aggregated_metrics: {
        total: { mentions: 18, ai_search_volume: 460 },
      },
      items: [
        {
          page: "https://example.com/a/",
          platform: [{ key: "google", mentions: 12, ai_search_volume: 300 }],
          sources_domain: [
            { key: "source-a.com", mentions: 10, ai_search_volume: 250 },
          ],
          total: { mentions: 12, ai_search_volume: 300 },
        },
        {
          page: "https://example.com/b/",
          platform: [{ key: "google", mentions: 6, ai_search_volume: 160 }],
          sources_domain: [
            { key: "source-b.com", mentions: 4, ai_search_volume: 120 },
          ],
          total: { mentions: 6, ai_search_volume: 160 },
        },
      ],
    }, { resultCount: 1 });
  };

  const result = await fetchAiVisibilityTopMentionedPages({
    login: "login",
    password: "password",
    target: "example.com",
    platform: "google",
    locationCode: 2840,
    languageCode: "en",
    limit: 25,
  });

  assert.equal(captured.url, AI_VISIBILITY_TOP_PAGES_ENDPOINT);
  const task = JSON.parse(captured.options.body)[0];
  assert.equal(task.links_scope, "sources");
  assert.equal(task.limit, 25);
  assert.deepEqual(task.order_by, ["total.mentions,desc", "total.ai_search_volume,desc"]);
  assert.equal(result.data.items.length, 2);
  assert.equal(result.data.items[0].page, "https://example.com/a/");
  assert.equal(result.data.items[0].mentions, 12);
  assert.equal(result.data.items[0].source_domains[0].key, "source-a.com");
});

test("AI Visibility surfaces provider errors with actual spend metadata", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    status_code: 20000,
    tasks_count: 1,
    tasks: [{
      status_code: 40501,
      status_message: "provider failure",
      cost: 0.1,
      result: [],
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });

  await assert.rejects(
    fetchAiVisibilityTargetMetrics({
      login: "login",
      password: "password",
      target: "example.com",
      platform: "google",
      locationCode: 2840,
      languageCode: "en",
    }),
    (error) =>
      error?.code === "PROVIDER_REQUEST_FAILED" &&
      error?.providerStatus === 40501 &&
      error?.actualCostUsd === 0.1,
  );
});


test("AI Visibility History clamps the requested date range to DataForSEO history availability", () => {
  assert.deepEqual(
    aiVisibilityHistoryDateRange(12, new Date("2026-09-19T00:00:00Z")),
    { dateFrom: "2025-10-01", dateTo: "2026-09-19" },
  );
  assert.deepEqual(
    aiVisibilityHistoryDateRange(0, new Date("2026-09-19T00:00:00Z")),
    { dateFrom: "2025-08-01", dateTo: "2026-09-19" },
  );
});

test("AI Visibility Historical returns normalized monthly mention and AI search-volume changes", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return okResponse({
      items_count: 3,
      items: [
        { year: 2026, month: 7, metrics: { mentions: 10, ai_search_volume: 200 } },
        { year: 2026, month: 8, metrics: { mentions: 15, ai_search_volume: 260 } },
        { year: 2026, month: 9, metrics: { mentions: 12, ai_search_volume: 300 } },
      ],
    }, { cost: 0.103, resultCount: 1 });
  };

  const result = await fetchAiVisibilityHistorical({
    login: "login",
    password: "password",
    target: "example.com",
    platform: "google",
    locationCode: 2840,
    languageCode: "en",
    months: 12,
    now: new Date("2026-09-19T00:00:00Z"),
  });

  assert.equal(captured.url, AI_VISIBILITY_HISTORY_ENDPOINT);
  const task=JSON.parse(captured.options.body)[0];
  assert.equal(task.date_from, "2025-10-01");
  assert.equal(task.date_to, "2026-09-19");
  assert.equal(task.platform, "google");
  assert.equal(result.data.points.length, 3);
  assert.equal(result.data.points[1].change.mentions_percent, 50);
  assert.equal(result.data.points[1].change.ai_search_volume_percent, 30);
  assert.equal(result.data.points[2].change.mentions_percent, -20);
});

test("AI Visibility New/Lost returns net monthly visibility changes for Decision Intelligence evidence", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return okResponse({
      items_count: 2,
      date_from: "2026-08-01",
      date_to: "2026-09-19",
      group_range: "month",
      items: [
        {
          date: "2026-08-01",
          new_mentions: 12,
          lost_mentions: 4,
          new_ai_search_volume: 300,
          lost_ai_search_volume: 80,
        },
        {
          date: "2026-09-01",
          new_mentions: 5,
          lost_mentions: 11,
          new_ai_search_volume: 120,
          lost_ai_search_volume: 260,
        },
      ],
    }, { cost: 0.102, resultCount: 1 });
  };

  const result = await fetchAiVisibilityNewLost({
    login: "login",
    password: "password",
    target: "example.com",
    platform: "google",
    locationCode: 2840,
    languageCode: "en",
    months: 6,
    now: new Date("2026-09-19T00:00:00Z"),
  });

  assert.equal(captured.url, AI_VISIBILITY_NEW_LOST_ENDPOINT);
  const task=JSON.parse(captured.options.body)[0];
  assert.equal(task.group_range, "month");
  assert.equal(result.data.points[0].net_mentions, 8);
  assert.equal(result.data.points[0].net_ai_search_volume, 220);
  assert.equal(result.data.points[1].net_mentions, -6);
  assert.equal(result.data.points[1].net_ai_search_volume, -140);
});


test("AI Citation Explorer requests source-scoped mentions and bounds long response content", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let captured;
  const longAnswer="A".repeat(4500);
  const longSnippet="S".repeat(800);
  globalThis.fetch=async(url,options)=>{
    captured={url,options};
    return okResponse({
      total_count:1,
      current_offset:0,
      search_after_token:"next-token",
      items_count:1,
      items:[{
        platform:"google",
        model_name:"google_ai_overview",
        location_code:2840,
        language_code:"en",
        question:"best waterproof membrane supplier",
        answer:longAnswer,
        sources:[
          {
            rank:1,
            title:"Example source",
            domain:"www.example.com".replace(/^www\./,""),
            url:"https://example.com/page/",
            snippet:longSnippet,
            source_name:"Example",
          },
          {
            rank:2,
            title:"Other source",
            domain:"other.example",
            url:"https://other.example/article",
            snippet:"Supporting source",
          },
        ],
        ai_search_volume:120,
        monthly_searches:[{year:2026,month:8,search_volume:100},{year:2026,month:9,search_volume:120}],
        first_response_at:"2026-08-01 00:00:00 +00:00",
        last_response_at:"2026-09-19 00:00:00 +00:00",
        is_web_search_based:true,
      }],
    },{cost:0.103,resultCount:1});
  };

  const result=await fetchAiVisibilityMentionExplorer({
    login:"login",
    password:"password",
    target:"https://www.example.com/",
    platform:"google",
    locationCode:2840,
    languageCode:"en",
    limit:25,
  });

  assert.equal(captured.url,AI_VISIBILITY_SEARCH_MENTIONS_ENDPOINT);
  const task=JSON.parse(captured.options.body)[0];
  assert.deepEqual(task.target,[{
    domain:"example.com",
    search_filter:"include",
    search_scope:["sources"],
    include_subdomains:true,
  }]);
  assert.equal(task.limit,25);
  assert.deepEqual(task.order_by,["ai_search_volume,desc"]);
  assert.equal(result.data.items.length,1);
  assert.equal(result.data.items[0].question,"best waterproof membrane supplier");
  assert.equal(result.data.items[0].target_source_count,1);
  assert.ok(result.data.items[0].answer_excerpt.length<=4001);
  assert.ok(result.data.items[0].sources[0].snippet.length<=601);
  assert.equal(result.data.items[0].ai_search_volume,120);
  assert.equal(result.data.search_after_token,"next-token");
});

test("AI Citation Explorer rejects unsupported depths before provider billing", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("provider should not run");};

  await assert.rejects(
    fetchAiVisibilityMentionExplorer({
      login:"login",
      password:"password",
      target:"example.com",
      platform:"google",
      locationCode:2840,
      languageCode:"en",
      limit:100,
    }),
    (error)=>error?.code==="INVALID_PROVIDER_LIMIT"&&error?.httpStatus===400,
  );
  assert.equal(calls,0);
});
