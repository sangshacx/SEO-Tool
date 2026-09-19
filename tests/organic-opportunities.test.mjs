import assert from "node:assert/strict";
import test from "node:test";

import { buildOrganicOpportunities, keywordQuickWinPoints } from "../src/v2/intelligence/organic-opportunities.js";

test("Quick Win points only reward cached rankings in positions 4-20", () => {
  assert.equal(keywordQuickWinPoints({position:3,search_volume:1000,keyword_difficulty:20}),0);
  assert.ok(keywordQuickWinPoints({position:6,search_volume:1000,keyword_difficulty:20}) > keywordQuickWinPoints({position:16,search_volume:1000,keyword_difficulty:20}));
  assert.ok(keywordQuickWinPoints({position:8,search_volume:1000,keyword_difficulty:20}) > keywordQuickWinPoints({position:8,search_volume:30,keyword_difficulty:80}));
});

test("Opportunity Center prioritizes recoverable and quick-win pages with transparent components", () => {
  const data=buildOrganicOpportunities({
    target:"example.com",
    sources:{organic_keywords:{available:true},top_pages:{available:true}},
    pageRows:[
      {url:"https://example.com/risk/",organic_traffic:300,organic_keywords:20,positions:{top_10:4},changes:{up:1,down:6,lost:2}},
      {url:"https://example.com/win/",organic_traffic:120,organic_keywords:15,positions:{top_10:5},changes:{up:2,down:1,lost:0}},
    ],
    keywordRows:[
      {keyword:"money term",ranking_url:"https://example.com/win/",position:7,search_volume:1000,keyword_difficulty:25,estimated_traffic:30,intent:{primary:"commercial"}},
      {keyword:"support term",ranking_url:"https://example.com/win/",position:14,search_volume:300,keyword_difficulty:40,estimated_traffic:10,intent:{primary:"informational"}},
    ],
  });
  assert.equal(data.ready,true);
  assert.equal(data.opportunities[0].url,"https://example.com/risk/");
  assert.equal(data.opportunities[0].action.code,"reclaim");
  const win=data.opportunities.find((row)=>row.url==="https://example.com/win/");
  assert.equal(win.action.code,"optimize");
  assert.equal(win.metrics.quick_win_keywords,2);
  assert.equal(win.metrics.commercial_quick_wins,1);
  assert.ok(win.components.quick_win_points > 0);
  assert.ok(win.components.business_intent_points > 0);
  assert.match(data.formula.priority_score,/capped at 100/);
});

test("Opportunity Center can synthesize page opportunities from Organic Keywords when Top Pages cache is missing", () => {
  const data=buildOrganicOpportunities({
    target:"example.com",
    sources:{organic_keywords:{available:true},top_pages:null},
    keywordRows:[
      {keyword:"term",ranking_url:"https://example.com/page/",position:8,search_volume:500,keyword_difficulty:30,estimated_traffic:20,intent:{primary:"commercial"}},
    ],
  });
  assert.equal(data.opportunities.length,1);
  assert.equal(data.opportunities[0].action.code,"optimize");
  assert.equal(data.opportunities[0].confidence,"low");
  assert.equal(data.opportunities[0].metrics.organic_keywords,null);
  assert.equal(data.opportunities[0].metrics.sampled_keywords,1);
});


test("GSC page reality is an additive adjustment and never changes the no-GSC base score", () => {
  const input={
    target:"example.com",
    sources:{top_pages:{available:true}},
    pageRows:[{url:"https://example.com/page/",organic_traffic:50,organic_keywords:5,positions:{top_10:1},changes:{up:0,down:0,lost:0}}],
  };
  const base=buildOrganicOpportunities(input);
  const combined=buildOrganicOpportunities({
    ...input,
    sources:{top_pages:{available:true},gsc_pages:{available:true}},
    gscPageRows:[{
      primary_key:"https://example.com/page/",
      clicks:10,
      impressions:500,
      position:8,
      previous_clicks:20,
      previous_impressions:400,
      change:{clicks_percent:-50},
    }],
  });
  assert.equal(base.formula.version,"organic-opportunity-v0.3");
  assert.equal(base.opportunities[0].components.gsc_reality_points,0);
  assert.equal(base.opportunities[0].priority_score,base.opportunities[0].components.base_score);
  assert.ok(combined.opportunities[0].components.gsc_reality_points>0);
  assert.ok(combined.opportunities[0].priority_score>base.opportunities[0].priority_score);
  assert.equal(combined.opportunities[0].action.code,"recover");
  assert.equal(combined.opportunities[0].evidence.gsc_pages,true);
  assert.equal(combined.opportunities[0].metrics.gsc_impressions,500);
  assert.equal(combined.opportunities[0].confidence,"high");
});


test("Query+Page GSC opportunities match same-page DataForSEO keyword evidence and drive the next query", () => {
  const data=buildOrganicOpportunities({
    target:"example.com",
    sources:{
      organic_keywords:{available:true},
      top_pages:{available:true},
      gsc_pages:{available:true},
    },
    pageRows:[
      {url:"https://example.com/page/",organic_traffic:80,organic_keywords:12,positions:{top_10:3},changes:{up:0,down:0,lost:0}},
    ],
    keywordRows:[
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
      {
        keyword:"different page keyword",
        ranking_url:"https://example.com/other/",
        position:8,
        search_volume:1000,
        keyword_difficulty:15,
        estimated_traffic:30,
        intent:{primary:"transactional"},
      },
    ],
    gscQueryPageRows:[
      {
        primary_key:"waterproof membrane supplier",
        secondary_key:"https://example.com/page/",
        clicks:6,
        impressions:420,
        position:9,
        previous_clicks:8,
        previous_impressions:360,
        change:{clicks_percent:-25},
        action:{code:"quick_win",label:"Quick Win"},
      },
      {
        primary_key:"different page keyword",
        secondary_key:"https://example.com/page/",
        clicks:3,
        impressions:220,
        position:12,
        previous_clicks:3,
        previous_impressions:200,
        change:{clicks_percent:0},
      },
    ],
  });

  const page=data.opportunities.find((row)=>row.url==="https://example.com/page/");
  assert.ok(page);
  assert.equal(page.action.code,"recover");
  assert.equal(page.metrics.gsc_query_opportunities,2);
  assert.equal(page.metrics.gsc_query_recoveries,1);
  assert.equal(page.gsc_query_opportunities[0].keyword,"waterproof membrane supplier");
  assert.equal(page.gsc_query_opportunities[0].provider_match,true);
  assert.equal(page.gsc_query_opportunities[0].search_volume,500);
  assert.equal(page.gsc_query_opportunities[0].keyword_difficulty,28);
  assert.equal(page.gsc_query_opportunities[0].intent,"commercial");

  const crossPage=page.gsc_query_opportunities.find((row)=>row.keyword==="different page keyword");
  assert.equal(crossPage.provider_match,false);
  assert.equal(crossPage.search_volume,null);
  assert.equal(page.evidence.gsc_pages,true);
  assert.ok(page.components.gsc_reality_points>0);
  assert.equal(page.next_best_action.query,"waterproof membrane supplier");
  assert.equal(page.next_best_action.query_source,"gsc_query_page");
  assert.equal(data.next_best_action.page,"https://example.com/page/");
  assert.match(page.next_best_action.why_now,/GSC impressions 420/);
});


test("Next Best Action falls back to the strongest DataForSEO quick win when no GSC Query+Page evidence exists", () => {
  const data=buildOrganicOpportunities({
    target:"example.com",
    sources:{organic_keywords:{available:true},top_pages:{available:true}},
    pageRows:[
      {url:"https://example.com/page/",organic_traffic:90,organic_keywords:10,positions:{top_10:3},changes:{up:0,down:0,lost:0}},
    ],
    keywordRows:[
      {
        keyword:"strong quick win",
        ranking_url:"https://example.com/page/",
        position:7,
        search_volume:1000,
        keyword_difficulty:20,
        estimated_traffic:20,
        intent:{primary:"commercial"},
      },
      {
        keyword:"weaker quick win",
        ranking_url:"https://example.com/page/",
        position:17,
        search_volume:100,
        keyword_difficulty:50,
        estimated_traffic:4,
        intent:{primary:"informational"},
      },
    ],
  });
  const page=data.opportunities[0];
  assert.equal(page.next_best_action.query,"strong quick win");
  assert.equal(page.next_best_action.query_source,"dataforseo_cache");
  assert.equal(page.next_best_action.evidence.search_volume,1000);
  assert.equal(page.next_best_action.evidence.keyword_difficulty,20);
  assert.match(page.next_best_action.why_now,/volume 1000/);
});
