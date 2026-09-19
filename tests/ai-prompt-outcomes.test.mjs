import assert from "node:assert/strict";
import test from "node:test";

import { summarizeAiPromptWorkflowOutcome } from "../src/v2/intelligence/ai-prompt-outcomes.js";

const event={workflow_id:4,event_id:9,query_text:"Which suppliers?",created_at:"2026-09-19 08:00:00"};
const tracker={id:7,name:"Supplier prompt",prompt:"Which suppliers?",platform:"chat_gpt",model_name:"gpt-4.1-mini"};

test("AI Prompt outcome waits for a post-completion Prompt Test instead of using GSC", () => {
  const outcome=summarizeAiPromptWorkflowOutcome({
    event,
    tracker,
    baseline:{observed_at:"2026-09-19T07:00:00Z",target_domain_mentioned:true,target_domain_cited:false,citation_count:2},
    post:null,
  });
  assert.equal(outcome.status,"waiting_for_post_observation");
  assert.equal(outcome.observed.code,"waiting");
  assert.equal(outcome.baseline.target_domain_cited,false);
  assert.equal(outcome.after,null);
});

test("AI Prompt outcome reports citation recovery from the next saved observation", () => {
  const outcome=summarizeAiPromptWorkflowOutcome({
    event,
    tracker,
    baseline:{observed_at:"2026-09-19T07:00:00Z",target_domain_mentioned:true,target_domain_cited:false,citation_count:1},
    post:{observed_at:"2026-09-20T08:00:00Z",target_domain_mentioned:true,target_domain_cited:true,citation_count:3,actual_cost_usd:0.004},
  });
  assert.equal(outcome.status,"ready");
  assert.equal(outcome.observed.code,"citation_recovered");
  assert.equal(outcome.observed.kind,"positive");
  assert.equal(outcome.after.target_domain_cited,true);
  assert.match(outcome.disclaimer,/does not prove/);
});

test("AI Prompt outcome can report mention recovery or a later regression without causal claims", () => {
  const mention=summarizeAiPromptWorkflowOutcome({
    event,tracker,
    baseline:{target_domain_mentioned:false,target_domain_cited:false},
    post:{target_domain_mentioned:true,target_domain_cited:false},
  });
  assert.equal(mention.observed.code,"mention_recovered");

  const lost=summarizeAiPromptWorkflowOutcome({
    event,tracker,
    baseline:{target_domain_mentioned:true,target_domain_cited:true},
    post:{target_domain_mentioned:true,target_domain_cited:false},
  });
  assert.equal(lost.observed.code,"citation_lost");
});

test("AI Prompt outcome distinguishes missing baseline from waiting for future evidence", () => {
  const outcome=summarizeAiPromptWorkflowOutcome({event,tracker,baseline:null,post:null});
  assert.equal(outcome.status,"insufficient_baseline");
  assert.equal(outcome.observed.code,"insufficient_baseline");
});
