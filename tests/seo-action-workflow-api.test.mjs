import assert from "node:assert/strict";
import test from "node:test";

import {
  onRequestGet,
  onRequestPost,
} from "../functions/api/v2/organic/action-workflow.js";
import { dashboardDatabase, seedProfile } from "./dashboard-test-helpers.mjs";
import { upsertAiPromptTracker } from "../src/v2/storage/ai-prompt-tracker.js";

const ACCESS={ "cf-access-jwt-assertion":"test-access" };

function post(body, headers={}) {
  return new Request("https://preview.example/api/v2/organic/action-workflow",{
    method:"POST",
    headers:{...ACCESS,"content-type":"application/json",...headers},
    body:JSON.stringify(body),
  });
}

test("SEO action workflow API requires Cloudflare Access", async () => {
  const {d1}=await dashboardDatabase();
  const response=await onRequestGet({
    request:new Request("https://preview.example/api/v2/organic/action-workflow?site_domain=example.com"),
    env:{DB:d1},
  });
  assert.equal(response.status,401);
  const payload=await response.json();
  assert.equal(payload.error.code,"ACCESS_AUTHENTICATION_REQUIRED");
});

test("SEO action workflow API upserts status at zero provider cost", async () => {
  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});

  const base={
    site_domain:"example.com",
    page_url:"https://www.example.com/page/#section",
    action_code:"optimize",
    query:"waterproof membrane",
    priority_score:77.5,
  };
  const first=await onRequestPost({
    request:post({...base,status:"in_progress",note:"Updated title and intro copy"}),
    env:{DB:d1},
  });
  assert.equal(first.status,200);
  const firstPayload=await first.json();
  assert.equal(firstPayload.data.status,"in_progress");
  assert.equal(firstPayload.data.page_url,"https://www.example.com/page/");
  assert.equal(firstPayload.meta.actual_cost_usd,0);
  assert.equal(firstPayload.meta.provider_requests,0);

  const second=await onRequestPost({
    request:post({...base,status:"done",priority_score:82}),
    env:{DB:d1},
  });
  assert.equal(second.status,200);
  const secondPayload=await second.json();
  assert.equal(secondPayload.data.id,firstPayload.data.id);
  assert.equal(secondPayload.data.status,"done");
  assert.equal(secondPayload.data.last_priority_score,82);
  assert.equal(secondPayload.data.note,"Updated title and intro copy");

  const list=await onRequestGet({
    request:new Request("https://preview.example/api/v2/organic/action-workflow?site_domain=example.com",{headers:ACCESS}),
    env:{DB:d1},
  });
  const listPayload=await list.json();
  assert.equal(list.status,200);
  assert.equal(listPayload.data.items.length,1);
  assert.equal(listPayload.data.items[0].status,"done");
  assert.equal(listPayload.data.items[0].note,"Updated title and intro copy");
  assert.equal(listPayload.meta.actual_cost_usd,0);
  assert.equal(listPayload.meta.provider_requests,0);
});

test("workflow API rejects external pages and invalid snooze requests", async () => {
  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});

  const external=await onRequestPost({
    request:post({
      site_domain:"example.com",
      page_url:"https://evil.example/page/",
      action_code:"recover",
      status:"done",
    }),
    env:{DB:d1},
  });
  assert.equal(external.status,400);
  assert.equal((await external.json()).error.field,"page_url");

  const snooze=await onRequestPost({
    request:post({
      site_domain:"example.com",
      page_url:"https://example.com/page/",
      action_code:"recover",
      status:"snoozed",
    }),
    env:{DB:d1},
  });
  assert.equal(snooze.status,400);
  assert.equal((await snooze.json()).error.field,"snooze_until");
});


test("workflow API accepts Potential Cannibalization architecture reviews", async () => {
  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});

  const response=await onRequestPost({
    request:post({
      site_domain:"example.com",
      page_url:"https://example.com/a/",
      action_code:"review_cannibalization",
      query:"waterproof membrane",
      status:"in_progress",
      priority_score:82,
      note:"Review intent and internal links before consolidation.",
    }),
    env:{DB:d1},
  });
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.data.action_code,"review_cannibalization");
  assert.equal(payload.data.status,"in_progress");
  assert.equal(payload.data.query,"waterproof membrane");
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
});


test("workflow API accepts AI visibility recovery actions on the managed-site homepage", async () => {
  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});

  const response=await onRequestPost({
    request:post({
      site_domain:"example.com",
      page_url:"https://example.com/",
      action_code:"ai_visibility_recovery",
      query:"AI visibility · google",
      status:"in_progress",
      priority_score:78,
      note:"Review lost mention and citation context before changing content.",
    }),
    env:{DB:d1},
  });
  const payload=await response.json();

  assert.equal(response.status,200);
  assert.equal(payload.data.action_code,"ai_visibility_recovery");
  assert.equal(payload.data.page_url,"https://example.com/");
  assert.equal(payload.data.status,"in_progress");
  assert.equal(payload.data.query,"AI visibility · google");
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);
});


test("workflow API requires and persists the Saved Prompt tracker link for AI recovery actions", async () => {
  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const prompt="Which waterproof membrane manufacturers should buyers consider?";
  const tracker=await upsertAiPromptTracker(d1,{
    siteDomain:"example.com",
    platform:"chat_gpt",
    modelName:"gpt-4.1-mini",
    prompt,
    webSearch:true,
    locationCode:2840,
    languageCode:"en",
  });

  const missing=await onRequestPost({
    request:post({
      site_domain:"example.com",
      page_url:"https://example.com/",
      action_code:"ai_prompt_recovery",
      query:prompt,
      status:"in_progress",
      priority_score:80,
    }),
    env:{DB:d1},
  });
  assert.equal(missing.status,400);
  assert.equal((await missing.json()).error.field,"tracker_id");

  const response=await onRequestPost({
    request:post({
      site_domain:"example.com",
      page_url:"https://example.com/",
      action_code:"ai_prompt_recovery",
      query:prompt,
      tracker_id:tracker.id,
      status:"in_progress",
      priority_score:80,
      note:"Review the previous cited observation before changing content.",
    }),
    env:{DB:d1},
  });
  const payload=await response.json();

  assert.equal(response.status,200);
  assert.equal(payload.data.action_code,"ai_prompt_recovery");
  assert.equal(payload.data.query,prompt);
  assert.equal(payload.data.status,"in_progress");
  assert.equal(payload.meta.actual_cost_usd,0);
  assert.equal(payload.meta.provider_requests,0);

  const link=await d1.prepare(
    "SELECT workflow_id, tracker_id FROM ai_prompt_workflow_links WHERE workflow_id = ?"
  ).bind(payload.data.id).first();
  assert.equal(Number(link.tracker_id),tracker.id);
});
