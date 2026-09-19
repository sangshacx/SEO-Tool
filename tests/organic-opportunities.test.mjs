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
  assert.equal(base.formula.version,"organic-opportunity-v0.2");
  assert.equal(base.opportunities[0].components.gsc_reality_points,0);
  assert.equal(base.opportunities[0].priority_score,base.opportunities[0].components.base_score);
  assert.ok(combined.opportunities[0].components.gsc_reality_points>0);
  assert.ok(combined.opportunities[0].priority_score>base.opportunities[0].priority_score);
  assert.equal(combined.opportunities[0].action.code,"recover");
  assert.equal(combined.opportunities[0].evidence.gsc_pages,true);
  assert.equal(combined.opportunities[0].metrics.gsc_impressions,500);
  assert.equal(combined.opportunities[0].confidence,"high");
});
