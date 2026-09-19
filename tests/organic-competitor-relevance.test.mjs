import assert from "node:assert/strict";
import test from "node:test";

import { buildOrganicCompetitorRelevance } from "../src/v2/intelligence/organic-competitor-relevance.js";

test("Keyword Similarity is normalized by both domains while coverage remains directional", () => {
  const relevance=buildOrganicCompetitorRelevance({sharedKeywords:200,targetKeywords:1000,competitorKeywords:800});
  assert.equal(relevance.keyword_similarity_percent,22.36);
  assert.equal(relevance.your_coverage_percent,20);
  assert.equal(relevance.their_overlap_percent,25);
  assert.match(relevance.formula,/sqrt/);
});

test("missing domain-size metrics stay unknown instead of becoming zero", () => {
  const relevance=buildOrganicCompetitorRelevance({sharedKeywords:20,targetKeywords:null,competitorKeywords:100});
  assert.equal(relevance.keyword_similarity_percent,null);
  assert.equal(relevance.your_coverage_percent,null);
  assert.equal(relevance.their_overlap_percent,20);
});
