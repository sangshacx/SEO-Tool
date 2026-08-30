import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/v2.html", import.meta.url), "utf8");

test("renders explicit outreach intelligence controls in Backlink Gap", () => {
  for (const id of [
    "backlinkGapTopics",
    "backlinkGapCheckRelevance",
    "backlinkGapHideSkip",
    "backlinkGapOutreachSummary",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), id);
  }
  assert.match(html, /检查已选域名相关性/);
  assert.match(html, /隐藏 Skip/);
  assert.match(html, /Outreach Suitability/);
});

test("checks at most ten selected domains and merges the zero-cost result", () => {
  assert.match(html, /selectedRelevanceCheckDomains/);
  assert.match(html, /\/api\/v2\/backlinks\/relevance/);
  assert.match(html, /mergeBacklinkOutreachResults/);
  assert.match(html, /actual_cost_usd/);
  assert.match(html, /最多选择 10 个/);
});

test("discards stale relevance results after a new gap request starts", () => {
  assert.match(html, /backlinkGapGeneration/);
  assert.match(html, /const relevanceGeneration=backlinkGapGeneration/);
  assert.match(html, /relevanceGeneration!==backlinkGapGeneration/);
});

test("renders recommendation, quality, relevance, confidence, and reasons", () => {
  assert.match(html, /backlinkOutreachLabel/);
  assert.match(html, /quality_score/);
  assert.match(html, /relevance_score/);
  assert.match(html, /confidence/);
  assert.match(html, /outreach\.reasons/);
});
