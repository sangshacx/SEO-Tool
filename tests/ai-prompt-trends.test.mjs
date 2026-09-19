import assert from "node:assert/strict";
import test from "node:test";

import { summarizeAiPromptTrend } from "../src/v2/intelligence/ai-prompt-trends.js";

test("Prompt trend reports rates and actual cumulative spend without inventing a score", () => {
  const trend = summarizeAiPromptTrend({
    observationCount: 4,
    mentionObservationCount: 3,
    citationObservationCount: 2,
    totalActualCostUsd: 0.014321,
    latest: {
      observed_at: "2026-09-19T08:00:00.000Z",
      target_domain_mentioned: true,
      target_domain_cited: true,
    },
    previous: {
      observed_at: "2026-09-18T08:00:00.000Z",
      target_domain_mentioned: true,
      target_domain_cited: false,
    },
  });

  assert.equal(trend.observation_count, 4);
  assert.equal(trend.mention_rate_percent, 75);
  assert.equal(trend.citation_rate_percent, 50);
  assert.equal(trend.total_actual_cost_usd, 0.014321);
  assert.equal(trend.change.code, "citation_gained");
  assert.equal(Object.hasOwn(trend, "score"), false);
  assert.match(trend.disclaimer, /descriptive/);
});

test("Prompt trend prioritizes citation loss over unchanged mention state", () => {
  const trend = summarizeAiPromptTrend({
    observationCount: 2,
    mentionObservationCount: 2,
    citationObservationCount: 1,
    latest: {
      target_domain_mentioned: true,
      target_domain_cited: false,
    },
    previous: {
      target_domain_mentioned: true,
      target_domain_cited: true,
    },
  });
  assert.deepEqual(trend.change, {
    code: "citation_lost",
    label: "Citation lost",
    kind: "negative",
  });
});

test("Prompt trend detects mention gains and losses when citation state is unchanged", () => {
  const gained = summarizeAiPromptTrend({
    observationCount: 2,
    mentionObservationCount: 1,
    citationObservationCount: 0,
    latest: { target_domain_mentioned: true, target_domain_cited: false },
    previous: { target_domain_mentioned: false, target_domain_cited: false },
  });
  const lost = summarizeAiPromptTrend({
    observationCount: 2,
    mentionObservationCount: 1,
    citationObservationCount: 0,
    latest: { target_domain_mentioned: false, target_domain_cited: false },
    previous: { target_domain_mentioned: true, target_domain_cited: false },
  });

  assert.equal(gained.change.code, "mention_gained");
  assert.equal(lost.change.code, "mention_lost");
});

test("Prompt trend distinguishes no data, first observation and stable repeated observations", () => {
  assert.equal(summarizeAiPromptTrend().change.code, "no_data");
  assert.equal(summarizeAiPromptTrend({
    observationCount: 1,
    latest: { target_domain_mentioned: false, target_domain_cited: false },
  }).change.code, "first_observation");
  assert.equal(summarizeAiPromptTrend({
    observationCount: 2,
    latest: { target_domain_mentioned: true, target_domain_cited: true },
    previous: { target_domain_mentioned: true, target_domain_cited: true },
  }).change.code, "stable");
});
