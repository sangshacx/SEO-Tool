import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost } from "../functions/api/v2/organic/opportunities.js";
import { buildOrganicKeywordsCacheKey } from "../src/v2/organic/organic-keywords-cache.js";
import { buildOrganicPagesCacheKey } from "../src/v2/organic/organic-pages-cache.js";
import { dashboardDatabase, memoryCache, seedProfile } from "./dashboard-test-helpers.mjs";
import { replaceGscAnalyticsPartition } from "../src/v2/storage/gsc-search-analytics.js";
import { upsertSeoActionWorkflow } from "../src/v2/storage/seo-action-workflow.js";

function request(body){
  return new Request("https://preview.example/api/v2/organic/opportunities",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
}

test("Opportunity Center is strictly cache-only and returns missing source guidance at exact zero cost", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not execute");};
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const response=await onRequestPost({
    request:request({target:"example.com",location_code:2840,language_code:"en"}),
    env:{DB:d1,CACHE:memoryCache()},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.data.ready,false);
  assert.deepEqual(payload.data.missing_sources,["organic_keywords","top_pages"]);
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
  assert.equal(calls,0);
});

test("Opportunity Center reads the deepest compatible keyword and page caches without provider calls", async () => {
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const keywordKey=buildOrganicKeywordsCacheKey({target:"example.com",locationCode:2840,languageCode:"en",historicalSerpMode:"live",depth:1000});
  const pagesKey=buildOrganicPagesCacheKey({target:"example.com",locationCode:2840,languageCode:"en",depth:500});
  const cache=memoryCache({
    [keywordKey]:{data:{items:[{keyword:"term",ranking_url:"https://example.com/page/",position:8,search_volume:500,keyword_difficulty:30,estimated_traffic:20,intent:{primary:"commercial"}}]},cached_at:"2026-09-19T01:00:00.000Z"},
    [pagesKey]:{data:{items:[{url:"https://example.com/page/",organic_traffic:100,organic_keywords:10,positions:{top_10:2},changes:{up:1,down:0,lost:0}}]},cached_at:"2026-09-19T01:05:00.000Z"},
  });
  const response=await onRequestPost({
    request:request({target:"example.com",location_code:2840,language_code:"en"}),
    env:{DB:d1,CACHE:cache},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.data.ready,true);
  assert.equal(payload.data.sources.organic_keywords.depth,1000);
  assert.equal(payload.data.sources.top_pages.depth,500);
  assert.equal(payload.data.opportunities[0].action.code,"optimize");
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
});

test("Opportunity Center rejects arbitrary competitor domains so own-site actions are not misapplied", async () => {
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const response=await onRequestPost({
    request:request({target:"rival.example",location_code:2840,language_code:"en"}),
    env:{DB:d1,CACHE:memoryCache()},
  });
  const payload=await response.json();
  assert.equal(response.status,409);
  assert.equal(payload.error.code,"MANAGED_SITE_REQUIRED");
  assert.equal(payload.meta.actual_cost_usd,0);
});


test("Opportunity Center fuses stored GSC pages at zero provider cost", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not execute");};

  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const site=await d1.prepare("SELECT id FROM site_profiles WHERE domain = ?").bind("example.com").first();
  await replaceGscAnalyticsPartition(d1,{
    siteProfileId:site.id,
    property:"sc-domain:example.com",
    date:"2026-09-16",
    dimensionSet:"page",
    rows:[{page:"https://example.com/page/",clicks:10,impressions:500,ctr:0.02,position:8}],
  });

  const pagesKey=buildOrganicPagesCacheKey({target:"example.com",locationCode:2840,languageCode:"en",depth:500});
  const cache=memoryCache({
    [pagesKey]:{data:{items:[{url:"https://example.com/page/",organic_traffic:50,organic_keywords:5,positions:{top_10:1},changes:{up:0,down:0,lost:0}}]},cached_at:"2026-09-19T01:05:00.000Z"},
  });
  const response=await onRequestPost({
    request:request({target:"example.com",location_code:2840,language_code:"en"}),
    env:{DB:d1,CACHE:cache},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.data.sources.gsc_pages.available,true);
  assert.equal(payload.data.sources.gsc_pages.latest_date,"2026-09-16");
  assert.equal(payload.data.opportunities[0].evidence.gsc_pages,true);
  assert.ok(payload.data.opportunities[0].components.gsc_reality_points>0);
  assert.equal(payload.data.opportunities[0].action.code,"ctr_opportunity");
  assert.equal(payload.meta.source,"cache_d1_only");
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
  assert.equal(calls,0);
});


test("Opportunity API joins stored GSC Query+Page rows with same-page DataForSEO metrics without provider calls", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not execute");};

  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const site=await d1.prepare("SELECT id FROM site_profiles WHERE domain = ?").bind("example.com").first();
  await replaceGscAnalyticsPartition(d1,{
    siteProfileId:site.id,
    property:"sc-domain:example.com",
    date:"2026-09-16",
    dimensionSet:"query_page",
    rows:[
      {
        query:"waterproof membrane supplier",
        page:"https://example.com/page/",
        clicks:6,
        impressions:420,
        ctr:6/420,
        position:9,
      },
    ],
  });

  const keywordKey=buildOrganicKeywordsCacheKey({
    target:"example.com",
    locationCode:2840,
    languageCode:"en",
    historicalSerpMode:"live",
    depth:1000,
  });
  const pagesKey=buildOrganicPagesCacheKey({
    target:"example.com",
    locationCode:2840,
    languageCode:"en",
    depth:500,
  });
  const cache=memoryCache({
    [keywordKey]:{
      data:{items:[
        {
          keyword:"waterproof membrane supplier",
          ranking_url:"https://example.com/page/",
          position:18,
          search_volume:500,
          keyword_difficulty:28,
          estimated_traffic:5,
          cpc_usd:2.4,
          intent:{primary:"commercial"},
        },
      ]},
      cached_at:"2026-09-19T01:00:00.000Z",
    },
    [pagesKey]:{
      data:{items:[
        {
          url:"https://example.com/page/",
          organic_traffic:80,
          organic_keywords:12,
          positions:{top_10:3},
          changes:{up:0,down:0,lost:0},
        },
      ]},
      cached_at:"2026-09-19T01:05:00.000Z",
    },
  });

  const response=await onRequestPost({
    request:request({target:"example.com",location_code:2840,language_code:"en"}),
    env:{DB:d1,CACHE:cache},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.meta.source,"cache_d1_only");
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
  assert.equal(calls,0);
  assert.equal(payload.data.formula.version,"organic-opportunity-v0.4");
  assert.equal(payload.data.sources.gsc_pages.available,true);
  assert.equal(payload.data.sources.gsc_pages.query_page_rows,1);
  assert.ok(Array.isArray(payload.data.action_queue));
  assert.equal(payload.data.action_queue[0].page,"https://example.com/page/");
  assert.equal(payload.data.action_queue[0].action,"ctr_opportunity");
  assert.equal(payload.data.next_best_action.page,"https://example.com/page/");

  const page=payload.data.opportunities.find((row)=>row.url==="https://example.com/page/");
  assert.ok(page);
  assert.equal(page.action.code,"ctr_opportunity");
  assert.equal(page.metrics.gsc_query_opportunities,1);
  assert.equal(page.gsc_query_opportunities[0].keyword,"waterproof membrane supplier");
  assert.equal(page.gsc_query_opportunities[0].provider_match,true);
  assert.equal(page.gsc_query_opportunities[0].search_volume,500);
  assert.equal(page.gsc_query_opportunities[0].keyword_difficulty,28);
});


test("Opportunity API returns recent D1 workflow activity without any provider request", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not execute");};

  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const base={
    site_domain:"example.com",
    page_url:"https://example.com/history/",
    action_code:"recover",
    query:"lost ranking query",
    note:"",
    snooze_until:null,
    priority_score:72,
  };
  await upsertSeoActionWorkflow(d1,{...base,status:"in_progress"});
  await upsertSeoActionWorkflow(d1,{...base,status:"done",priority_score:78});

  const pagesKey=buildOrganicPagesCacheKey({
    target:"example.com",locationCode:2840,languageCode:"en",depth:500,
  });
  const cache=memoryCache({
    [pagesKey]:{
      data:{items:[{
        url:"https://example.com/page/",
        organic_traffic:40,
        organic_keywords:10,
        positions:{top_10:2},
        changes:{up:0,down:3,lost:0},
      }]},
      cached_at:"2026-09-19T01:05:00.000Z",
    },
  });

  const response=await onRequestPost({
    request:request({target:"example.com",location_code:2840,language_code:"en"}),
    env:{DB:d1,CACHE:cache},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
  assert.equal(calls,0);
  assert.equal(payload.data.workflow_summary.activity_count,2);
  assert.equal(payload.data.workflow_activity.length,2);
  assert.equal(payload.data.workflow_activity[0].from_status,"in_progress");
  assert.equal(payload.data.workflow_activity[0].to_status,"done");
  assert.equal(payload.data.workflow_activity[0].priority_score,78);
  assert.equal(payload.data.workflow_activity[1].from_status,null);
  assert.equal(payload.data.workflow_activity[1].to_status,"in_progress");
  assert.equal(payload.data.workflow_stats.current.done,1);
  assert.equal(payload.data.workflow_stats.current.total,1);
  assert.equal(payload.data.workflow_stats.last_7_days.started,1);
  assert.equal(payload.data.workflow_stats.last_7_days.completed,1);
  assert.equal(payload.data.workflow_stats.last_30_days.completed,1);
});
