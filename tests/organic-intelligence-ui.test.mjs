import assert from "node:assert/strict";
import test from "node:test";
import { filterOrganicChangeRows, filterOrganicCompetitorRows, filterOrganicKeywordRows, filterOrganicPageRows, formatOrganicMovement, organicTargetMode } from "../public/v2-organic-intelligence.js";

test("Organic Intelligence distinguishes own-site URLs from competitor targets", () => {
  assert.equal(organicTargetMode("great-ocean-waterproof.com", "great-ocean-waterproof.com"), "own");
  assert.equal(organicTargetMode("https://great-ocean-waterproof.com/page/", "great-ocean-waterproof.com"), "own");
  assert.equal(organicTargetMode("yuruwaterproof.com", "great-ocean-waterproof.com"), "competitor");
});

test("Organic Intelligence filters locally without requiring another API request", () => {
  const rows = [
    { keyword:"waterproof membrane", position:8, search_volume:1000, keyword_difficulty:25, intent:{primary:"commercial"}, movement:{is_up:true,absolute_delta:4}, ranking_url:"https://example.com/a" },
    { keyword:"roof coating", position:33, search_volume:90, keyword_difficulty:55, intent:{primary:"informational"}, movement:{is_down:true,absolute_delta:-3}, ranking_url:"https://example.com/b" },
  ];
  assert.deepEqual(filterOrganicKeywordRows(rows,{position:"4-10",intent:"commercial",maxKd:"35"},"own").map((row)=>row.keyword),["waterproof membrane"]);
  assert.deepEqual(filterOrganicKeywordRows(rows,{movement:"down"},"own").map((row)=>row.keyword),["roof coating"]);
  assert.deepEqual(filterOrganicKeywordRows(rows,{action:"quick_win"},"own").map((row)=>row.keyword),["waterproof membrane"]);
});

test("movement labels keep absolute SERP change separate from organic position", () => {
  assert.deepEqual(formatOrganicMovement({movement:{is_up:true,absolute_delta:5}}),{code:"up",label:"Improved",delta:5});
  assert.deepEqual(formatOrganicMovement({movement:{is_lost:true}}),{code:"lost",label:"Lost",delta:null});
});


test("Top Pages filters locally and respects own-site page actions", () => {
  const rows = [
    { url:"https://example.com/winner/", relative_url:"/winner/", organic_keywords:20, positions:{top_10:12,top_20:14}, changes:{up:1,down:1,lost:0} },
    { url:"https://example.com/risk/", relative_url:"/risk/", organic_keywords:20, positions:{top_10:4,top_20:8}, changes:{up:1,down:6,lost:0} },
  ];
  assert.deepEqual(filterOrganicPageRows(rows,{query:"winner"},"own").map((row)=>row.relative_url),["/winner/"]);
  assert.deepEqual(filterOrganicPageRows(rows,{action:"at_risk"},"own").map((row)=>row.relative_url),["/risk/"]);
});


test("Position Changes filters by change type and action without another provider request", () => {
  const rows = [
    { keyword:"winner", position:8, movement:{is_up:true,absolute_delta:4}, change:{code:"improved",label:"Improved"} },
    { keyword:"decliner", position:9, movement:{is_down:true,absolute_delta:-3}, change:{code:"declined",label:"Declined"} },
    { keyword:"lost", movement:{is_lost:true}, change:{code:"lost",label:"Lost"} },
  ];
  assert.deepEqual(filterOrganicChangeRows(rows,{change:"declined"},"own").map((row)=>row.keyword),["decliner"]);
  assert.deepEqual(filterOrganicChangeRows(rows,{action:"recover"},"own").map((row)=>row.keyword),["decliner"]);
  assert.deepEqual(filterOrganicChangeRows(rows,{action:"reclaim"},"own").map((row)=>row.keyword),["lost"]);
});


test("Organic Competitors filters by domain, saved business type, and transparent similarity", () => {
  const rows = [
    { domain:"business.example", business_competitor:true, relevance:{keyword_similarity_percent:42.5} },
    { domain:"seo-only.example", business_competitor:false, relevance:{keyword_similarity_percent:18.2} },
  ];
  assert.deepEqual(filterOrganicCompetitorRows(rows,{type:"business"}).map((row)=>row.domain),["business.example"]);
  assert.deepEqual(filterOrganicCompetitorRows(rows,{type:"seo"}).map((row)=>row.domain),["seo-only.example"]);
  assert.deepEqual(filterOrganicCompetitorRows(rows,{minSimilarity:"30"}).map((row)=>row.domain),["business.example"]);
  assert.deepEqual(filterOrganicCompetitorRows(rows,{query:"seo-only"}).map((row)=>row.domain),["seo-only.example"]);
});
