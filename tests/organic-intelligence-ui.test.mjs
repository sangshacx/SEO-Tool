import assert from "node:assert/strict";
import test from "node:test";
import { filterOrganicKeywordRows, formatOrganicMovement, organicTargetMode } from "../public/v2-organic-intelligence.js";

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
