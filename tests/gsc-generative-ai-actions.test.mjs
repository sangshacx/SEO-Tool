import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGscGenerativeAiRecoveryAction,
  mergeGscGenerativeAiActions,
} from "../src/v2/intelligence/gsc-generative-ai-actions.js";

function summary(overrides={}){
  return {
    appearance:"AI_OVERVIEW",
    latest_date:"2026-09-16",
    pages:[{key:"https://example.com/guide/",impressions:120,clicks:4}],
    trend:{
      status:"ready",
      comparison_days:7,
      current:{coverage_days:7,impressions:0,clicks:0},
      previous:{coverage_days:7,impressions:600,clicks:12},
      deltas:{impressions:-600,impressions_percent:-100,clicks:-12},
      change:{code:"visibility_lost",label:"Filtered visibility disappeared",kind:"negative"},
    },
    ...overrides,
  };
}

test("first-party GSC filtered visibility disappearance creates a transparent recovery review",()=>{
  const action=buildGscGenerativeAiRecoveryAction({
    target:"example.com",
    selectedAppearance:"AI_OVERVIEW",
    summary:summary(),
  });
  assert.equal(action.action,"gsc_generative_recovery");
  assert.equal(action.workstream,"gsc_generative_recovery");
  assert.equal(action.query_source,"gsc_generative_ai_d1");
  assert.equal(action.page,"https://example.com/");
  assert.equal(action.evidence.previous_impressions,600);
  assert.equal(action.evidence.current_impressions,0);
  assert.equal(action.evidence.top_page,"https://example.com/guide/");
  assert.equal(action.confidence,"high");
  assert.ok(action.priority_score>=80);
  assert.match(action.why_now,/does not establish causality/);
});

test("major first-party filtered decline requires at least 100 baseline impressions and 50 percent loss",()=>{
  const action=buildGscGenerativeAiRecoveryAction({
    target:"example.com",
    summary:summary({
      trend:{
        status:"ready",
        comparison_days:7,
        current:{coverage_days:6,impressions:200,clicks:5},
        previous:{coverage_days:6,impressions:500,clicks:10},
        deltas:{impressions:-300,impressions_percent:-60,clicks:-5},
        change:{code:"impressions_down",label:"Filtered impressions decreased",kind:"negative"},
      },
    }),
  });
  assert.equal(action.action_label,"Review major first-party AI visibility decline");
  assert.equal(action.evidence.impressions_delta_percent,-60);

  const lowVolume=buildGscGenerativeAiRecoveryAction({
    target:"example.com",
    summary:summary({
      trend:{
        status:"ready",
        current:{coverage_days:7,impressions:10,clicks:0},
        previous:{coverage_days:7,impressions:40,clicks:1},
        deltas:{impressions:-30,impressions_percent:-75,clicks:-1},
        change:{code:"impressions_down"},
      },
    }),
  });
  assert.equal(lowVolume,null);
});

test("first-party GSC Generative AI review stays quiet for insufficient coverage, gains, stable or small declines",()=>{
  assert.equal(buildGscGenerativeAiRecoveryAction({
    target:"example.com",
    summary:summary({trend:{status:"insufficient_coverage",change:{code:"visibility_lost"}}}),
  }),null);
  assert.equal(buildGscGenerativeAiRecoveryAction({
    target:"example.com",
    summary:summary({trend:{
      status:"ready",current:{coverage_days:7,impressions:700},previous:{coverage_days:7,impressions:500},
      deltas:{impressions:200,impressions_percent:40},change:{code:"impressions_up"},
    }}),
  }),null);
  assert.equal(buildGscGenerativeAiRecoveryAction({
    target:"example.com",
    summary:summary({trend:{
      status:"ready",current:{coverage_days:7,impressions:400},previous:{coverage_days:7,impressions:500},
      deltas:{impressions:-100,impressions_percent:-20},change:{code:"impressions_down"},
    }}),
  }),null);
});

test("GSC Generative AI recovery merges into the shared queue without duplicates",()=>{
  const action=buildGscGenerativeAiRecoveryAction({target:"example.com",summary:summary()});
  const merged=mergeGscGenerativeAiActions({
    action_queue:[{rank:1,page:"https://example.com/page/",action:"optimize",query:"keyword",priority_score:65}],
  },[action,action]);
  assert.equal(merged.action_queue.length,2);
  assert.equal(merged.action_queue[0].action,"gsc_generative_recovery");
  assert.equal(merged.supplemental_signals.gsc_generative_ai.candidate_count,2);
  assert.match(merged.supplemental_signals.gsc_generative_ai.disclaimer,/not causal claims/);
});
