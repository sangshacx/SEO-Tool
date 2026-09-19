import assert from "node:assert/strict";
import test from "node:test";

import { summarizeGscGenerativeAiTrend } from "../src/v2/intelligence/gsc-generative-ai-trends.js";

function day(date,impressions,clicks=0){
  return {date,impressions,clicks,ctr:impressions?clicks/impressions:0,position:1};
}

test("GSC Generative AI trend compares two observed 7-day windows without a synthetic score",()=>{
  const rows=[
    day("2026-09-03",10,1),day("2026-09-04",10,1),day("2026-09-05",10,1),day("2026-09-06",10,1),
    day("2026-09-10",20,2),day("2026-09-11",20,2),day("2026-09-12",20,2),day("2026-09-16",20,2),
  ];
  const trend=summarizeGscGenerativeAiTrend(rows);
  assert.equal(trend.status,"ready");
  assert.equal(trend.previous.impressions,40);
  assert.equal(trend.current.impressions,80);
  assert.equal(trend.deltas.impressions,40);
  assert.equal(trend.deltas.impressions_percent,100);
  assert.equal(trend.change.code,"impressions_up");
  assert.equal(Object.hasOwn(trend,"score"),false);
  assert.match(trend.disclaimer,/do not prove/);
});

test("GSC Generative AI trend calls out gained and lost filtered visibility only with comparable coverage",()=>{
  const gained=summarizeGscGenerativeAiTrend([
    day("2026-09-03",0),day("2026-09-04",0),day("2026-09-05",0),day("2026-09-06",0),
    day("2026-09-10",5),day("2026-09-11",5),day("2026-09-12",5),day("2026-09-16",5),
  ]);
  assert.equal(gained.change.code,"visibility_gained");

  const lost=summarizeGscGenerativeAiTrend([
    day("2026-09-03",5),day("2026-09-04",5),day("2026-09-05",5),day("2026-09-06",5),
    day("2026-09-10",0),day("2026-09-11",0),day("2026-09-12",0),day("2026-09-16",0),
  ]);
  assert.equal(lost.change.code,"visibility_lost");
});

test("GSC Generative AI trend refuses to over-interpret sparse history",()=>{
  const trend=summarizeGscGenerativeAiTrend([
    day("2026-09-05",100,4),
    day("2026-09-16",20,1),
  ]);
  assert.equal(trend.status,"insufficient_coverage");
  assert.equal(trend.change.code,"insufficient_coverage");
});

test("GSC Generative AI trend reports no data cleanly",()=>{
  const trend=summarizeGscGenerativeAiTrend([]);
  assert.equal(trend.status,"no_data");
  assert.equal(trend.current,null);
  assert.equal(trend.deltas,null);
});
