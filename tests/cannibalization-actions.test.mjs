import assert from "node:assert/strict";
import test from "node:test";

import {
  cannibalizationReviewPriority,
  mergeCannibalizationActions,
} from "../src/v2/intelligence/cannibalization-actions.js";

const candidate={
  query:"waterproof membrane",
  severity:"high_overlap",
  page_count:2,
  total_impressions:1200,
  primary_page:{
    page_url:"https://example.com/a/",
    position:7,
    impression_share:0.58,
  },
  competing_page:{
    page_url:"https://example.com/b/",
    position:9,
    impression_share:0.42,
  },
};

test("cannibalization review priority is deterministic architecture triage, not a probability", () => {
  assert.equal(cannibalizationReviewPriority(candidate),86);
  assert.ok(cannibalizationReviewPriority({...candidate,severity:"moderate_overlap"}) < 86);
  assert.ok(cannibalizationReviewPriority({...candidate,total_impressions:200}) < 86);
});

test("GSC overlap becomes a separate architecture task without mutating page opportunity actions", () => {
  const base={
    action_queue:[{
      rank:1,
      workstream:"recovery",
      page:"https://example.com/a/",
      action:"recover",
      action_label:"Recover",
      priority_score:92,
      confidence:"high",
      query:"ranking loss",
      query_source:"gsc_query_page",
      why_now:"Clicks declined.",
      evidence:null,
    }],
    next_best_action:null,
    opportunities:[{
      url:"https://example.com/a/",
      action:{code:"recover",label:"Recover"},
      priority_score:92,
    }],
  };

  const data=mergeCannibalizationActions(base,[candidate],{limit:25});
  assert.equal(data.opportunities[0].action.code,"recover");
  assert.equal(data.action_queue.length,2);
  assert.equal(data.action_queue[0].action,"recover");
  const architecture=data.action_queue.find((item)=>item.action==="review_cannibalization");
  assert.ok(architecture);
  assert.equal(architecture.workstream,"architecture");
  assert.equal(architecture.page,"https://example.com/a/");
  assert.equal(architecture.query,"waterproof membrane");
  assert.equal(architecture.query_source,"gsc_query_page");
  assert.equal(architecture.evidence.competing_page,"https://example.com/b/");
  assert.match(architecture.why_now,/not an automatic merge recommendation/);
  assert.match(data.supplemental_signals.cannibalization.disclaimer,/not proof/);
});

test("duplicate overlap review tasks are removed by page action and query identity", () => {
  const data=mergeCannibalizationActions({action_queue:[]},[candidate,candidate],{limit:25});
  assert.equal(data.action_queue.length,1);
  assert.equal(data.action_queue[0].rank,1);
});
