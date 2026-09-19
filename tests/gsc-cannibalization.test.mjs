import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGscCannibalizationCandidates,
  classifyGscQueryOverlap,
} from "../src/v2/gsc/cannibalization.js";

test("potential cannibalization requires meaningful second-page impression share", () => {
  const high=classifyGscQueryOverlap({
    query:"waterproof membrane",
    pages:[
      {page_url:"https://example.com/a/",clicks:30,impressions:600,position:6},
      {page_url:"https://example.com/b/",clicks:20,impressions:400,position:9},
    ],
  });
  assert.ok(high);
  assert.equal(high.severity,"high_overlap");
  assert.equal(high.page_count,2);
  assert.equal(high.total_impressions,1000);
  assert.equal(high.primary_page.impression_share,0.6);
  assert.equal(high.competing_page.impression_share,0.4);
  assert.equal(high.action.code,"review_cannibalization");

  const weak=classifyGscQueryOverlap({
    query:"roof coating",
    pages:[
      {page_url:"https://example.com/a/",clicks:20,impressions:900,position:5},
      {page_url:"https://example.com/b/",clicks:1,impressions:100,position:20},
    ],
  });
  assert.equal(weak,null);
});

test("potential cannibalization ignores multi-URL noise outside meaningful ranking range", () => {
  const result=classifyGscQueryOverlap({
    query:"membrane installation",
    pages:[
      {page_url:"https://example.com/a/",clicks:10,impressions:500,position:8},
      {page_url:"https://example.com/b/",clicks:5,impressions:300,position:48},
    ],
  });
  assert.equal(result,null);
});

test("cannibalization candidates prioritize stronger overlap before raw impression volume", () => {
  const rows=[
    {query_text:"high overlap",page_url:"https://example.com/a/",clicks:10,impressions:350,position:8},
    {query_text:"high overlap",page_url:"https://example.com/b/",clicks:8,impressions:300,position:10},
    {query_text:"moderate overlap",page_url:"https://example.com/c/",clicks:20,impressions:800,position:6},
    {query_text:"moderate overlap",page_url:"https://example.com/d/",clicks:6,impressions:200,position:14},
    {query_text:"excluded",page_url:"https://example.com/e/",clicks:30,impressions:950,position:4},
    {query_text:"excluded",page_url:"https://example.com/f/",clicks:1,impressions:50,position:12},
  ];
  const candidates=buildGscCannibalizationCandidates(rows,{limit:10});
  assert.equal(candidates.length,2);
  assert.equal(candidates[0].query,"high overlap");
  assert.equal(candidates[0].severity,"high_overlap");
  assert.equal(candidates[1].query,"moderate overlap");
  assert.equal(candidates[1].severity,"moderate_overlap");
});
