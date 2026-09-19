import assert from "node:assert/strict";
import test from "node:test";

import { summarizeSeoActionOutcome } from "../src/v2/intelligence/seo-action-outcomes.js";

const event={
  event_id:11,
  workflow_id:7,
  page_url:"https://example.com/page/",
  action_code:"optimize",
  query_text:"waterproof membrane",
  priority_score:78,
  created_at:"2026-09-10 12:00:00",
};

test("SEO action outcomes label aligned positive GSC signals as observed improvement without claiming causality", () => {
  const outcome=summarizeSeoActionOutcome({
    event,
    pre:{days:7,clicks:10,impressions:100,position:10},
    post:{days:7,clicks:16,impressions:140,position:7},
    windowDays:7,
    scope:"query_page",
  });
  assert.equal(outcome.status,"ready");
  assert.equal(outcome.change.clicks_percent,60);
  assert.equal(outcome.change.impressions_percent,40);
  assert.equal(outcome.change.position_improvement,3);
  assert.equal(outcome.observed.code,"improved");
  assert.match(outcome.disclaimer,/not proof/);
});

test("SEO action outcomes distinguish declined and mixed post-completion signals", () => {
  const declined=summarizeSeoActionOutcome({
    event,
    pre:{days:7,clicks:20,impressions:200,position:5},
    post:{days:7,clicks:10,impressions:150,position:9},
    windowDays:7,
    scope:"page",
  });
  assert.equal(declined.observed.code,"declined");

  const mixed=summarizeSeoActionOutcome({
    event,
    pre:{days:7,clicks:10,impressions:100,position:5},
    post:{days:7,clicks:13,impressions:120,position:8},
    windowDays:7,
    scope:"page",
  });
  assert.equal(mixed.observed.code,"mixed");
  assert.ok(mixed.observed.positive_signals>0);
  assert.ok(mixed.observed.negative_signals>0);
});

test("SEO action outcomes wait for enough post-completion coverage before treating the comparison as ready", () => {
  const waiting=summarizeSeoActionOutcome({
    event,
    pre:{days:7,clicks:10,impressions:100,position:8},
    post:{days:0,clicks:0,impressions:0,position:null},
    windowDays:7,
  });
  assert.equal(waiting.status,"waiting_for_post_data");
  assert.equal(waiting.observed.code,"insufficient_data");

  const collecting=summarizeSeoActionOutcome({
    event,
    pre:{days:7,clicks:10,impressions:100,position:8},
    post:{days:3,clicks:5,impressions:50,position:7},
    windowDays:7,
  });
  assert.equal(collecting.status,"collecting_post_data");

  const noBaseline=summarizeSeoActionOutcome({
    event,
    pre:{days:1,clicks:1,impressions:10,position:8},
    post:{days:7,clicks:9,impressions:90,position:6},
    windowDays:7,
  });
  assert.equal(noBaseline.status,"insufficient_baseline");
});
