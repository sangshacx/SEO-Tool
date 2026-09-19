import assert from "node:assert/strict";
import test from "node:test";

import { summarizeGscGenerativeWorkflowOutcome } from "../src/v2/intelligence/gsc-generative-ai-outcomes.js";

const event={
  event_id:11,workflow_id:7,action_code:"gsc_generative_recovery",
  page_url:"https://example.com/",created_at:"2026-09-19 08:00:00",
};
const link={property:"sc-domain:example.com",appearance_value:"AI_OVERVIEW"};

test("GSC Generative workflow outcome waits for post data using the linked raw appearance",()=>{
  const outcome=summarizeGscGenerativeWorkflowOutcome({
    event,link,
    pre:{days:7,impressions:0,clicks:0},
    post:{days:0,impressions:0,clicks:0},
  });
  assert.equal(outcome.status,"waiting_for_post_data");
  assert.equal(outcome.appearance,"AI_OVERVIEW");
  assert.equal(outcome.scope,"property_global");
  assert.equal(outcome.observed.code,"waiting_for_post_data");
});

test("GSC Generative workflow outcome reports first-party filtered visibility recovery",()=>{
  const outcome=summarizeGscGenerativeWorkflowOutcome({
    event,link,
    pre:{days:7,impressions:0,clicks:0},
    post:{days:7,impressions:240,clicks:8},
  });
  assert.equal(outcome.status,"ready");
  assert.equal(outcome.observed.code,"visibility_recovered");
  assert.equal(outcome.observed.kind,"positive");
  assert.equal(outcome.change.impressions,240);
  assert.match(outcome.disclaimer,/does not prove/);
});

test("GSC Generative workflow outcome remains descriptive for increases, decreases and sparse coverage",()=>{
  const increased=summarizeGscGenerativeWorkflowOutcome({
    event,link,pre:{days:7,impressions:100,clicks:2},post:{days:7,impressions:180,clicks:3},
  });
  assert.equal(increased.observed.code,"impressions_up");
  assert.equal(increased.change.impressions_percent,80);

  const decreased=summarizeGscGenerativeWorkflowOutcome({
    event,link,pre:{days:7,impressions:100,clicks:2},post:{days:7,impressions:40,clicks:1},
  });
  assert.equal(decreased.observed.code,"impressions_down");

  const sparse=summarizeGscGenerativeWorkflowOutcome({
    event,link,pre:{days:3,impressions:100,clicks:2},post:{days:7,impressions:200,clicks:3},
  });
  assert.equal(sparse.status,"insufficient_baseline");
  assert.equal(sparse.observed.code,"insufficient_baseline");
});
