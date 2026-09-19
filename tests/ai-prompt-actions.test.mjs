import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAiPromptRecoveryAction,
  mergeAiPromptRecoveryActions,
} from "../src/v2/intelligence/ai-prompt-actions.js";

function tracker(overrides={}) {
  return {
    id: 7,
    name: "Supplier prompt",
    status: "active",
    platform: "chat_gpt",
    model_name: "gpt-4.1-mini",
    prompt: "Which waterproof membrane manufacturers should buyers consider?",
    trend: {
      observation_count: 4,
      mention_rate_percent: 75,
      citation_rate_percent: 50,
      total_actual_cost_usd: 0.016,
      latest_observed_at: "2026-09-19T08:00:00.000Z",
      previous_observed_at: "2026-09-18T08:00:00.000Z",
      change: { code: "citation_lost", label: "Citation lost", kind: "negative" },
    },
    ...overrides,
  };
}

test("Tracked Prompt citation loss becomes a transparent zero-cost recovery candidate", () => {
  const action=buildAiPromptRecoveryAction({
    target:"example.com",
    tracker:tracker(),
  });

  assert.equal(action.action,"ai_prompt_recovery");
  assert.equal(action.workstream,"ai_prompt_recovery");
  assert.equal(action.page,"https://example.com/");
  assert.equal(action.query_source,"ai_prompt_tracker_d1");
  assert.equal(action.query,"Which waterproof membrane manufacturers should buyers consider?");
  assert.equal(action.evidence.tracker_id,7);
  assert.equal(action.evidence.change_code,"citation_lost");
  assert.equal(action.confidence,"high");
  assert.ok(action.priority_score>=76);
  assert.match(action.why_now,/lost the target-domain citation/);
});

test("Tracked Prompt mention loss can create a medium-confidence candidate after exactly two observations", () => {
  const action=buildAiPromptRecoveryAction({
    target:"example.com",
    tracker:tracker({
      trend:{
        observation_count:2,
        mention_rate_percent:50,
        citation_rate_percent:0,
        total_actual_cost_usd:0.008,
        change:{code:"mention_lost",label:"Mention lost",kind:"negative"},
      },
    }),
  });
  assert.equal(action.action_label,"Review lost AI mention");
  assert.equal(action.confidence,"medium");
  assert.equal(action.priority_score,68);
});

test("Tracked Prompt recovery stays quiet for positive/stable, paused, or insufficient histories", () => {
  assert.equal(buildAiPromptRecoveryAction({
    target:"example.com",
    tracker:tracker({trend:{observation_count:4,change:{code:"citation_gained"}}}),
  }),null);
  assert.equal(buildAiPromptRecoveryAction({
    target:"example.com",
    tracker:tracker({status:"paused"}),
  }),null);
  assert.equal(buildAiPromptRecoveryAction({
    target:"example.com",
    tracker:tracker({trend:{observation_count:1,change:{code:"citation_lost"}}}),
  }),null);
});

test("Tracked Prompt recovery merges into the shared bounded queue without duplicate keys", () => {
  const promptAction=buildAiPromptRecoveryAction({target:"example.com",tracker:tracker()});
  const merged=mergeAiPromptRecoveryActions({
    action_queue:[{
      rank:1,
      page:"https://example.com/page/",
      action:"optimize",
      query:"keyword",
      priority_score:60,
    }],
  },[promptAction,promptAction]);

  assert.equal(merged.action_queue.length,2);
  assert.equal(merged.action_queue[0].action,"ai_prompt_recovery");
  assert.equal(merged.action_queue[0].rank,1);
  assert.equal(merged.supplemental_signals.ai_prompt_tracker.candidate_count,2);
});
