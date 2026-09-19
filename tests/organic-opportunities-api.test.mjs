import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost } from "../functions/api/v2/organic/opportunities.js";
import { buildOrganicKeywordsCacheKey } from "../src/v2/organic/organic-keywords-cache.js";
import { buildOrganicPagesCacheKey } from "../src/v2/organic/organic-pages-cache.js";
import { dashboardDatabase, memoryCache, seedProfile } from "./dashboard-test-helpers.mjs";
import { replaceGscAnalyticsPartition, replaceGscSearchAppearanceCapabilities, selectGscGenerativeAiAppearance } from "../src/v2/storage/gsc-search-analytics.js";
import { replaceGscGenerativeAiPartition } from "../src/v2/storage/gsc-generative-ai.js";
import { saveGscMapping } from "../src/v2/storage/gsc-connections.js";
import { upsertSeoActionWorkflow } from "../src/v2/storage/seo-action-workflow.js";
import { persistAiVisibilityHistorical, persistAiVisibilityNewLost } from "../src/v2/storage/ai-visibility.js";
import { linkAiPromptWorkflow, recordAiPromptObservation, upsertAiPromptTracker } from "../src/v2/storage/ai-prompt-tracker.js";

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


test("Opportunity API returns ready post-completion GSC outcomes from D1 at zero provider cost", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not execute");};

  const {raw,d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  await upsertSeoActionWorkflow(d1,{
    site_domain:"example.com",
    page_url:"https://example.com/outcome/",
    action_code:"optimize",
    query:"waterproof membrane",
    status:"done",
    note:"implemented",
    snooze_until:null,
    priority_score:80,
  });
  raw.prepare("UPDATE seo_action_workflow_events SET created_at = '2026-09-10 12:00:00' WHERE to_status = 'done'").run();

  const insert=raw.prepare(`
    INSERT INTO gsc_search_analytics_daily (
      site_profile_id,property,date,dimension_set,query_text,page_url,country,device,
      clicks,impressions,ctr,position,synced_at
    ) VALUES (1,'sc-domain:example.com',?,'query_page','waterproof membrane','https://example.com/outcome/','','',?,?,?,?,?)
  `);
  for(let day=3;day<=9;day++){
    insert.run("2026-09-"+String(day).padStart(2,"0"),1,10,0.1,10,"2026-09-19T00:00:00.000Z");
  }
  for(let day=11;day<=17;day++){
    insert.run("2026-09-"+String(day).padStart(2,"0"),2,15,2/15,7,"2026-09-19T00:00:00.000Z");
  }

  const response=await onRequestPost({
    request:request({target:"example.com",location_code:2840,language_code:"en"}),
    env:{DB:d1,CACHE:memoryCache()},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
  assert.equal(calls,0);
  assert.equal(payload.data.workflow_outcomes.length,1);
  const outcome=payload.data.workflow_outcomes[0];
  assert.equal(outcome.status,"ready");
  assert.equal(outcome.scope,"query_page");
  assert.equal(outcome.observed.code,"improved");
  assert.equal(outcome.coverage.before_days,7);
  assert.equal(outcome.coverage.after_days,7);
  assert.equal(outcome.change.position_improvement,3);
  assert.match(outcome.disclaimer,/not proof/);
});


test("Opportunity API adds Potential Cannibalization as a separate zero-cost architecture task", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not execute");};

  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const site=await d1.prepare("SELECT id FROM site_profiles WHERE domain = ?").bind("example.com").first();

  for(const date of ["2026-09-15","2026-09-16","2026-09-17"]){
    await replaceGscAnalyticsPartition(d1,{
      siteProfileId:site.id,
      property:"sc-domain:example.com",
      date,
      dimensionSet:"query_page",
      rows:[
        {query:"waterproof membrane",page:"https://example.com/a/",clicks:10,impressions:200,ctr:0.05,position:6},
        {query:"waterproof membrane",page:"https://example.com/b/",clicks:6,impressions:140,ctr:6/140,position:9},
      ],
    });
  }

  const pagesKey=buildOrganicPagesCacheKey({
    target:"example.com",locationCode:2840,languageCode:"en",depth:500,
  });
  const cache=memoryCache({
    [pagesKey]:{
      data:{items:[{
        url:"https://example.com/a/",
        organic_traffic:50,
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
  assert.equal(payload.data.gsc_overlap_summary.candidate_count,1);
  assert.equal(payload.data.opportunities.find((row)=>row.url==="https://example.com/a/").action.code,"recover");

  const architecture=payload.data.action_queue.find((item)=>item.action==="review_cannibalization");
  assert.ok(architecture);
  assert.equal(architecture.workstream,"architecture");
  assert.equal(architecture.query,"waterproof membrane");
  assert.equal(architecture.evidence.competing_page,"https://example.com/b/");
  assert.match(payload.data.supplemental_signals.cannibalization.disclaimer,/not proof/);
});


test("Opportunity API adds stored AI mention losses as a zero-cost recovery action without provider calls", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not execute");};

  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  await persistAiVisibilityHistorical({
    db:d1,
    target:"example.com",
    platform:"google",
    locationCode:2840,
    languageCode:"en",
    providerFetchedAt:"2026-09-19T07:00:00.000Z",
    points:[
      {period:"2026-08",mentions:20,ai_search_volume:400},
      {period:"2026-09",mentions:12,ai_search_volume:300},
    ],
  });
  await persistAiVisibilityNewLost({
    db:d1,
    target:"example.com",
    platform:"google",
    locationCode:2840,
    languageCode:"en",
    providerFetchedAt:"2026-09-19T07:00:00.000Z",
    points:[{
      date:"2026-09-01",
      new_mentions:4,
      lost_mentions:12,
      new_ai_search_volume:100,
      lost_ai_search_volume:260,
    }],
  });

  const response=await onRequestPost({
    request:request({target:"example.com",location_code:2840,language_code:"en"}),
    env:{DB:d1,CACHE:memoryCache()},
  });
  const payload=await response.json();

  assert.equal(response.status,200);
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
  assert.equal(calls,0);
  assert.equal(payload.data.sources.ai_visibility.available,true);
  assert.equal(payload.data.ai_visibility_summary.candidate_count,1);
  assert.equal(payload.data.ai_visibility_summary.source,"d1");
  const ai=payload.data.action_queue.find((item)=>item.action==="ai_visibility_recovery");
  assert.ok(ai);
  assert.equal(ai.page,"https://example.com/");
  assert.equal(ai.query,"AI visibility · google");
  assert.equal(ai.query_source,"dataforseo_ai_history");
  assert.equal(ai.evidence.net_mentions,-8);
  assert.match(payload.data.supplemental_signals.ai_visibility.disclaimer,/does not prove/);
});

test("Opportunity API keeps positive AI visibility history descriptive and does not create an AI task", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async()=>{throw new Error("provider must not execute");};

  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  await persistAiVisibilityHistorical({
    db:d1,target:"example.com",platform:"google",locationCode:2840,languageCode:"en",
    points:[
      {period:"2026-08",mentions:10,ai_search_volume:200},
      {period:"2026-09",mentions:16,ai_search_volume:320},
    ],
  });
  await persistAiVisibilityNewLost({
    db:d1,target:"example.com",platform:"google",locationCode:2840,languageCode:"en",
    points:[{
      date:"2026-09-01",new_mentions:9,lost_mentions:3,
      new_ai_search_volume:220,lost_ai_search_volume:80,
    }],
  });

  const response=await onRequestPost({
    request:request({target:"example.com",location_code:2840,language_code:"en"}),
    env:{DB:d1,CACHE:memoryCache()},
  });
  const payload=await response.json();

  assert.equal(response.status,200);
  assert.equal(payload.data.sources.ai_visibility.available,true);
  assert.equal(payload.data.ai_visibility_summary.candidate_count,0);
  assert.equal(payload.data.action_queue.some((item)=>item.action==="ai_visibility_recovery"),false);
});


test("Opportunity API converts a repeated Saved Prompt citation loss into a zero-cost recovery action", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not execute");};

  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const tracker=await upsertAiPromptTracker(d1,{
    siteDomain:"example.com",
    name:"Supplier recommendations",
    platform:"chat_gpt",
    modelName:"gpt-4.1-mini",
    prompt:"Which waterproof membrane manufacturers should buyers consider?",
    webSearch:true,
    locationCode:2840,
    languageCode:"en",
  });
  await recordAiPromptObservation(d1,{
    siteDomain:"example.com",
    trackerId:tracker.id,
    observedAt:"2026-09-18T08:00:00.000Z",
    actualCostUsd:0.004,
    result:{
      model_name:"gpt-4.1-mini",
      target_domain_mentioned:true,
      target_domain_cited:true,
      annotations:[{domain:"example.com"}],
    },
  });
  await recordAiPromptObservation(d1,{
    siteDomain:"example.com",
    trackerId:tracker.id,
    observedAt:"2026-09-19T08:00:00.000Z",
    actualCostUsd:0.005,
    result:{
      model_name:"gpt-4.1-mini",
      target_domain_mentioned:true,
      target_domain_cited:false,
      annotations:[{domain:"industry.example"}],
    },
  });

  const response=await onRequestPost({
    request:request({target:"example.com",location_code:2840,language_code:"en"}),
    env:{DB:d1,CACHE:memoryCache()},
  });
  const payload=await response.json();

  assert.equal(response.status,200);
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
  assert.equal(calls,0);
  assert.equal(payload.data.sources.ai_prompt_tracker.available,true);
  assert.equal(payload.data.sources.ai_prompt_tracker.tracked_prompts,1);
  assert.equal(payload.data.sources.ai_prompt_tracker.observed_prompts,1);
  assert.equal(payload.data.ai_prompt_tracker_summary.candidate_count,1);
  assert.equal(payload.data.ai_prompt_tracker_summary.total_observations,2);
  assert.equal(payload.data.ai_prompt_tracker_summary.total_actual_cost_usd,0.009);

  const action=payload.data.action_queue.find((item)=>item.action==="ai_prompt_recovery");
  assert.ok(action);
  assert.equal(action.query_source,"ai_prompt_tracker_d1");
  assert.equal(action.evidence.tracker_id,tracker.id);
  assert.equal(action.evidence.change_code,"citation_lost");
  assert.equal(action.page,"https://example.com/");
  assert.match(payload.data.supplemental_signals.ai_prompt_tracker.disclaimer,/not proof/);
});

test("Opportunity API does not create Prompt recovery from a single observation", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async()=>{throw new Error("provider must not execute");};

  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const tracker=await upsertAiPromptTracker(d1,{
    siteDomain:"example.com",
    platform:"gemini",
    modelName:"gemini-2.5-flash",
    prompt:"Recommend waterproofing suppliers.",
    webSearch:true,
    locationCode:2840,
    languageCode:"en",
  });
  await recordAiPromptObservation(d1,{
    siteDomain:"example.com",
    trackerId:tracker.id,
    result:{
      model_name:"gemini-2.5-flash",
      target_domain_mentioned:false,
      target_domain_cited:false,
      annotations:[],
    },
  });

  const response=await onRequestPost({
    request:request({target:"example.com",location_code:2840,language_code:"en"}),
    env:{DB:d1,CACHE:memoryCache()},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.data.sources.ai_prompt_tracker.available,true);
  assert.equal(payload.data.ai_prompt_tracker_summary.candidate_count,0);
  assert.equal(payload.data.action_queue.some((item)=>item.action==="ai_prompt_recovery"),false);
});


test("Opportunity API returns AI-native Prompt outcomes separately from GSC outcomes at zero read cost", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not execute");};

  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const prompt="Which waterproof membrane manufacturers should buyers consider?";
  const tracker=await upsertAiPromptTracker(d1,{
    siteDomain:"example.com",
    name:"Supplier recovery outcome",
    platform:"chat_gpt",
    modelName:"gpt-4.1-mini",
    prompt,
    webSearch:true,
    locationCode:2840,
    languageCode:"en",
  });

  await recordAiPromptObservation(d1,{
    siteDomain:"example.com",
    trackerId:tracker.id,
    observedAt:"2026-09-18T08:00:00.000Z",
    actualCostUsd:0.004,
    result:{
      model_name:"gpt-4.1-mini",
      target_domain_mentioned:true,
      target_domain_cited:false,
      annotations:[{domain:"industry.example"}],
    },
  });

  const workflow=await upsertSeoActionWorkflow(d1,{
    site_domain:"example.com",
    page_url:"https://example.com/",
    action_code:"ai_prompt_recovery",
    query:prompt,
    status:"done",
    note:"Improved citation-worthy source evidence.",
    snooze_until:null,
    priority_score:80,
  });
  await linkAiPromptWorkflow(d1,{
    siteDomain:"example.com",
    workflowId:workflow.id,
    trackerId:tracker.id,
  });
  await d1.prepare(
    "UPDATE seo_action_workflow_events SET created_at = '2026-09-19 08:00:00' WHERE workflow_id = ? AND to_status = 'done'"
  ).bind(workflow.id).run();

  await recordAiPromptObservation(d1,{
    siteDomain:"example.com",
    trackerId:tracker.id,
    observedAt:"2026-09-20T08:00:00.000Z",
    actualCostUsd:0.005,
    result:{
      model_name:"gpt-4.1-mini",
      target_domain_mentioned:true,
      target_domain_cited:true,
      annotations:[{domain:"example.com"}],
    },
  });

  const response=await onRequestPost({
    request:request({target:"example.com",location_code:2840,language_code:"en"}),
    env:{DB:d1,CACHE:memoryCache()},
  });
  const payload=await response.json();

  assert.equal(response.status,200);
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
  assert.equal(calls,0);
  assert.equal(payload.data.workflow_outcomes.some((item)=>item.action_code==="ai_prompt_recovery"),false);
  assert.equal(payload.data.ai_prompt_workflow_outcomes.length,1);
  assert.equal(payload.data.ai_prompt_workflow_outcomes[0].tracker_id,tracker.id);
  assert.equal(payload.data.ai_prompt_workflow_outcomes[0].observed.code,"citation_recovered");
  assert.equal(payload.data.ai_prompt_workflow_outcome_summary.total,1);
  assert.equal(payload.data.ai_prompt_workflow_outcome_summary.ready,1);
  assert.equal(payload.data.ai_prompt_workflow_outcome_summary.recovered,1);
  assert.equal(payload.data.ai_prompt_workflow_outcome_summary.regressed,0);
  assert.equal(payload.data.ai_prompt_workflow_outcome_summary.actual_cost_usd,0);
});


test("Opportunity API creates a conservative property-global GSC Generative recovery review from comparable first-party loss", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("provider must not execute");};

  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  await saveGscMapping(d1,{siteDomain:"example.com",property:"sc-domain:example.com",propertyType:"domain",permissionLevel:"siteOwner"});
  const site=await d1.prepare("SELECT id FROM site_profiles WHERE domain = ?").bind("example.com").first();
  await replaceGscSearchAppearanceCapabilities(d1,{
    siteProfileId:site.id,
    property:"sc-domain:example.com",
    startDate:"2026-08-20",
    endDate:"2026-09-16",
    appearances:[{appearance:"AI_OVERVIEW",impressions:600,generative_ai_candidate:true}],
  });
  await selectGscGenerativeAiAppearance(d1,{siteDomain:"example.com",appearance:"AI_OVERVIEW"});

  const history=[
    ["2026-09-03",150,3],["2026-09-04",150,3],["2026-09-05",150,3],["2026-09-06",150,3],
    ["2026-09-10",0,0],["2026-09-11",0,0],["2026-09-12",0,0],["2026-09-16",0,0],
  ];
  for(const [date,impressions,clicks] of history){
    await replaceGscGenerativeAiPartition(d1,{
      siteProfileId:site.id,
      property:"sc-domain:example.com",
      appearance:"AI_OVERVIEW",
      date,
      dimensionSet:"property",
      rows:[{impressions,clicks,ctr:impressions?clicks/impressions:0,position:1}],
    });
  }

  const response=await onRequestPost({
    request:request({target:"example.com",location_code:2682,language_code:"ar"}),
    env:{DB:d1,CACHE:memoryCache()},
  });
  const payload=await response.json();

  assert.equal(response.status,200);
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
  assert.equal(calls,0);
  assert.equal(payload.data.sources.gsc_generative_ai.available,true);
  assert.equal(payload.data.sources.gsc_generative_ai.scope,"property_global");
  assert.equal(payload.data.gsc_generative_ai_summary.candidate_count,1);
  assert.equal(payload.data.gsc_generative_ai_summary.appearance,"AI_OVERVIEW");
  const action=payload.data.action_queue.find((item)=>item.action==="gsc_generative_recovery");
  assert.ok(action);
  assert.equal(action.query_source,"gsc_generative_ai_d1");
  assert.equal(action.evidence.scope,"property_global");
  assert.equal(action.evidence.previous_impressions,600);
  assert.equal(action.evidence.current_impressions,0);
  assert.match(action.why_now,/not the currently selected market/);
  assert.match(payload.data.supplemental_signals.gsc_generative_ai.disclaimer,/not causal claims/);
});

test("Opportunity API keeps sparse or low-volume GSC Generative changes out of the Action Queue", async () => {
  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  await saveGscMapping(d1,{siteDomain:"example.com",property:"sc-domain:example.com",propertyType:"domain",permissionLevel:"siteOwner"});
  const site=await d1.prepare("SELECT id FROM site_profiles WHERE domain = ?").bind("example.com").first();
  await replaceGscSearchAppearanceCapabilities(d1,{
    siteProfileId:site.id,
    property:"sc-domain:example.com",
    startDate:"2026-08-20",
    endDate:"2026-09-16",
    appearances:[{appearance:"AI_OVERVIEW",impressions:40,generative_ai_candidate:true}],
  });
  await selectGscGenerativeAiAppearance(d1,{siteDomain:"example.com",appearance:"AI_OVERVIEW"});
  for(const [date,impressions] of [["2026-09-05",40],["2026-09-16",0]]){
    await replaceGscGenerativeAiPartition(d1,{
      siteProfileId:site.id,property:"sc-domain:example.com",appearance:"AI_OVERVIEW",
      date,dimensionSet:"property",rows:[{impressions,clicks:0,ctr:0,position:1}],
    });
  }

  const response=await onRequestPost({
    request:request({target:"example.com",location_code:2840,language_code:"en"}),
    env:{DB:d1,CACHE:memoryCache()},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.data.sources.gsc_generative_ai.available,true);
  assert.equal(payload.data.gsc_generative_ai_summary.candidate_count,0);
  assert.equal(payload.data.action_queue.some((item)=>item.action==="gsc_generative_recovery"),false);
});
