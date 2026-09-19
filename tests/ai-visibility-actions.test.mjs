import assert from "node:assert/strict";
import test from "node:test";

import {
  aiVisibilityRecoveryPriority,
  buildAiVisibilityRecoveryAction,
  mergeAiVisibilityActions,
} from "../src/v2/intelligence/ai-visibility-actions.js";

test("AI visibility recovery stays quiet while latest new/lost mentions are net positive", () => {
  assert.equal(buildAiVisibilityRecoveryAction({
    target:"example.com",
    platform:"google",
    historical:[
      {period:"2026-08",mentions:10,ai_search_volume:200},
      {period:"2026-09",mentions:14,ai_search_volume:260},
    ],
    newLost:[{
      date:"2026-09-01",
      new_mentions:8,
      lost_mentions:3,
      net_mentions:5,
      new_ai_search_volume:200,
      lost_ai_search_volume:60,
      net_ai_search_volume:140,
    }],
  }),null);
});

test("AI visibility recovery converts a corroborated mention decline into transparent workflow evidence", () => {
  const action=buildAiVisibilityRecoveryAction({
    target:"example.com",
    platform:"google",
    historical:[
      {period:"2026-08",mentions:20,ai_search_volume:400},
      {period:"2026-09",mentions:12,ai_search_volume:300},
    ],
    newLost:[{
      date:"2026-09-01",
      new_mentions:4,
      lost_mentions:12,
      net_mentions:-8,
      new_ai_search_volume:100,
      lost_ai_search_volume:260,
      net_ai_search_volume:-160,
    }],
  });

  assert.equal(action.action,"ai_visibility_recovery");
  assert.equal(action.page,"https://example.com/");
  assert.equal(action.workstream,"ai_visibility_recovery");
  assert.equal(action.query,"AI visibility · google");
  assert.equal(action.query_source,"dataforseo_ai_history");
  assert.equal(action.confidence,"high");
  assert.equal(action.evidence.net_mentions,-8);
  assert.equal(action.evidence.mentions_change_percent,-40);
  assert.match(action.why_now,/lost mentions 12/);
  assert.ok(action.priority_score>=50&&action.priority_score<=90);
});

test("AI visibility recovery is medium confidence when new/lost declines without a corroborating historical month", () => {
  const action=buildAiVisibilityRecoveryAction({
    target:"example.com",
    platform:"chat_gpt",
    historical:[],
    newLost:[{
      date:"2026-09-01",
      new_mentions:2,
      lost_mentions:5,
      net_mentions:-3,
      new_ai_search_volume:30,
      lost_ai_search_volume:100,
      net_ai_search_volume:-70,
    }],
  });
  assert.equal(action.confidence,"medium");
  assert.match(action.why_now,/ChatGPT/);
});

test("AI visibility priority grows with stronger loss dominance and corroborated monthly decline", () => {
  const weaker=aiVisibilityRecoveryPriority({
    historical:[{mentions:20},{mentions:19}],
    newLost:[{new_mentions:8,lost_mentions:10,net_mentions:-2}],
  });
  const stronger=aiVisibilityRecoveryPriority({
    historical:[{mentions:40},{mentions:20}],
    newLost:[{new_mentions:2,lost_mentions:14,net_mentions:-12}],
  });
  assert.ok(stronger>weaker);
});

test("AI visibility actions merge into the same bounded Decision Queue without duplicate workflow keys", () => {
  const base={
    action_queue:[{
      rank:1,
      workstream:"growth",
      page:"https://example.com/page/",
      action:"optimize",
      action_label:"Optimize",
      priority_score:60,
      query:"keyword",
    }],
  };
  const ai={
    page:"https://example.com/",
    action:"ai_visibility_recovery",
    action_label:"Recover AI visibility",
    priority_score:80,
    query:"AI visibility · google",
  };
  const merged=mergeAiVisibilityActions(base,[ai,ai]);
  assert.equal(merged.action_queue.length,2);
  assert.equal(merged.action_queue[0].action,"ai_visibility_recovery");
  assert.equal(merged.action_queue[0].rank,1);
  assert.equal(merged.supplemental_signals.ai_visibility.candidate_count,2);
});
