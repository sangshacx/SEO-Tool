import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  COMPETITOR_INTELLIGENCE_VERSION,
  buildCompetitorSnapshotIntelligence,
} from "../src/v2/intelligence/competitor-intelligence.js";
import {
  competitorIntelligencePresentation,
} from "../public/v2-competitor-intelligence-ui.js";
import {
  COMPETITOR_GAP_ACTION_VERSION,
  buildCompetitorGapAction,
} from "../src/v2/intelligence/competitor-gap-action.js";

test("Competitor Intelligence v0.1 is deterministic and explainable", () => {
  const intelligence = buildCompetitorSnapshotIntelligence({
    domain: "competitor.example",
    organic: {
      estimated_monthly_traffic: 24000,
      ranked_keywords: 18000,
      estimated_paid_traffic_cost_usd: 8500,
      positions: { top_10: 2800 },
    },
    top_keywords: Array.from({ length: 30 }, (_, index) => ({
      keyword: "keyword " + index,
      position: index + 1,
      search_volume: 500 + index * 20,
      keyword_difficulty: 30,
      cpc_usd: 2.5,
      intent: index % 2 ? "commercial" : "transactional",
      ranking_url: "https://competitor.example/page-" + index,
    })),
  });
  assert.equal(intelligence.version, COMPETITOR_INTELLIGENCE_VERSION);
  assert.equal(intelligence.version, "competitor-intelligence-v0.1");
  assert.ok(intelligence.score >= 75);
  assert.equal(intelligence.decision.code, "high_research_value");
  assert.ok(intelligence.confidence_score >= 80);
  assert.deepEqual(Object.keys(intelligence.factors), [
    "visibility",
    "keyword_footprint",
    "commercial_signal",
    "actionability",
  ]);
  assert.equal(intelligence.weights.visibility, 0.35);
  assert.equal(intelligence.weights.keyword_footprint, 0.25);
  assert.equal(intelligence.weights.commercial_signal, 0.20);
  assert.equal(intelligence.weights.actionability, 0.20);
  assert.ok(intelligence.signals.length >= 1);
  assert.match(intelligence.disclaimer, /不代表对手真实收入/);
});

test("missing competitor metrics stay neutral and reduce confidence", () => {
  const intelligence = buildCompetitorSnapshotIntelligence({
    domain: "sparse.example",
    organic: {},
    top_keywords: [],
  });
  assert.equal(intelligence.factors.visibility, 50);
  assert.equal(intelligence.factors.keyword_footprint, 50);
  assert.equal(intelligence.factors.commercial_signal, 50);
  assert.equal(intelligence.factors.actionability, 50);
  assert.equal(intelligence.score, 50);
  assert.ok(intelligence.confidence_score < 50);
});

test("Competitor Intelligence UI presentation never turns the score into a revenue claim", () => {
  const view = competitorIntelligencePresentation({
    score: 72,
    confidence_score: 84,
    decision: { label: "值得继续研究", next_action: "验证 Keyword Gap。" },
  });
  assert.deepEqual(view, {
    score: 72,
    score_label: "72",
    decision_label: "值得继续研究",
    next_action: "验证 Keyword Gap。",
    confidence_label: "84/100",
  });
});

test("competitor snapshot API enriches cached and live results locally without another provider workflow", async () => {
  const source = await readFile(new URL("../functions/api/v2/competitors/snapshot.js", import.meta.url), "utf8");
  assert.match(source, /buildCompetitorSnapshotIntelligence/);
  assert.match(source, /enrichSnapshot\(cachedData\)/);
  assert.match(source, /enrichSnapshot\(normalizeResult/);
  assert.equal((source.match(/ranked_keywords\/live/g) || []).length >= 1, true);
});

test("Competitor Intelligence UI listens to the local snapshot event and only prefills Keyword Gap", async () => {
  const source = await readFile(new URL("../public/v2-competitor-intelligence-ui.js", import.meta.url), "utf8");
  assert.match(source, /seo-pro-v2:competitor-snapshot-ready/);
  assert.match(source, /去验证 Keyword Gap/);
  assert.match(source, /gapInput\.value = currentDomain/);
  assert.match(source, /activateTab\?\.\("gap"\)/);
  assert.doesNotMatch(source, /fetch\s*\(|submitSeoResearchRequest|requestSubmit\(|\.submit\(/);
});


test("Gap Action Brief ranks Easy Wins into a deterministic next-action shortlist", () => {
  const rows = [
    {
      keyword: "waterproof membrane supplier",
      competitor_position: 3,
      metrics: { search_volume: 1000, keyword_difficulty: 28, cpc_usd: 2.8 },
      intent: { primary: "commercial" },
      intelligence: { gap_priority: { score: 82 } },
    },
    {
      keyword: "roof waterproofing membrane",
      competitor_position: 8,
      metrics: { search_volume: 700, keyword_difficulty: 31, cpc_usd: 1.9 },
      intent: { primary: "transactional" },
      intelligence: { gap_priority: { score: 76 } },
    },
    {
      keyword: "bitumen membrane guide",
      competitor_position: 5,
      metrics: { search_volume: 400, keyword_difficulty: 22, cpc_usd: 1.2 },
      intent: { primary: "informational" },
      intelligence: { gap_priority: { score: 70 } },
    },
  ];
  const brief = buildCompetitorGapAction({
    competitor_domain: "competitor.example",
    own_domain: "own.example",
    opportunities: rows,
  });
  assert.equal(brief.version, COMPETITOR_GAP_ACTION_VERSION);
  assert.equal(brief.version, "competitor-gap-action-v0.1");
  assert.equal(brief.summary.easy_wins, 3);
  assert.equal(brief.decision.code, "attack_now");
  assert.equal(brief.top_actions.length, 3);
  assert.ok(brief.top_actions[0].action_score >= brief.top_actions[1].action_score);
  assert.match(brief.disclaimer, /不代表全部市场机会、排名概率或收入预测/);
});

test("Gap Action Brief does not overstate weak samples", () => {
  const brief = buildCompetitorGapAction({
    opportunities: [{
      keyword: "weak term",
      competitor_position: 38,
      metrics: { search_volume: 20, keyword_difficulty: 72, cpc_usd: 0.2 },
      intent: { primary: "informational" },
      intelligence: { gap_priority: { score: 32 } },
    }],
  });
  assert.equal(brief.summary.easy_wins, 0);
  assert.equal(brief.top_actions.length, 0);
  assert.equal(brief.decision.code, "monitor");
});

test("Competitor Intelligence UI renders Gap Action Brief from a local event without provider calls", async () => {
  const source = await readFile(new URL("../public/v2-competitor-intelligence-ui.js", import.meta.url), "utf8");
  assert.match(source, /seo-pro-v2:keyword-gap-ready/);
  assert.match(source, /GAP ACTION BRIEF/);
  assert.match(source, /What should I do next\?/);
  assert.match(source, /Easy Wins/);
  assert.match(source, /Top 3 优先动作/);
  assert.doesNotMatch(source, /fetch\s*\(|submitSeoResearchRequest|requestSubmit\(|\.submit\(/);
});
