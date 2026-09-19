import assert from "node:assert/strict";
import test from "node:test";

import { dashboardDatabase, seedProfile } from "./dashboard-test-helpers.mjs";
import {
  getAiPromptTracker,
  listAiPromptObservations,
  listAiPromptTrackers,
  recordAiPromptObservation,
  updateAiPromptTrackerStatus,
  upsertAiPromptTracker,
} from "../src/v2/storage/ai-prompt-tracker.js";

test("Custom Prompt Tracker saves one managed-site prompt definition and deduplicates identical configs", async () => {
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});

  const first=await upsertAiPromptTracker(d1,{
    siteDomain:"example.com",
    name:"Supplier recommendation",
    platform:"chat_gpt",
    modelName:"gpt-4.1-mini",
    prompt:"Which waterproof membrane manufacturers should buyers consider?",
    webSearch:true,
    locationCode:2840,
    languageCode:"en",
  });
  const second=await upsertAiPromptTracker(d1,{
    siteDomain:"example.com",
    name:"Supplier recommendation updated",
    platform:"chat_gpt",
    modelName:"gpt-4.1-mini",
    prompt:"Which waterproof membrane manufacturers should buyers consider?",
    webSearch:true,
    locationCode:2840,
    languageCode:"en",
  });

  assert.equal(first.id,second.id);
  assert.equal(second.name,"Supplier recommendation updated");

  const rows=await listAiPromptTrackers(d1,{
    siteDomain:"example.com",
    locationCode:2840,
    languageCode:"en",
  });
  assert.equal(rows.length,1);
  assert.equal(rows[0].observation_count,0);
  assert.equal(rows[0].latest_observation,null);
});

test("Custom Prompt Tracker persists lightweight live observations without storing full answers", async () => {
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const tracker=await upsertAiPromptTracker(d1,{
    siteDomain:"example.com",
    name:"Brand visibility",
    platform:"gemini",
    modelName:"gemini-2.5-flash",
    prompt:"Recommend waterproof membrane manufacturers.",
    webSearch:true,
    locationCode:2682,
    languageCode:"ar",
  });

  const observed=await recordAiPromptObservation(d1,{
    siteDomain:"example.com",
    trackerId:tracker.id,
    observedAt:"2026-09-19T08:00:00.000Z",
    actualCostUsd:0.0042,
    result:{
      model_name:"gemini-2.5-flash",
      datetime:"2026-09-19 08:00:00 +00:00",
      target_domain_mentioned:true,
      target_domain_cited:true,
      annotations:[
        {domain:"example.com",url:"https://example.com/a/"},
        {domain:"industry.example",url:"https://industry.example/a"},
        {domain:"example.com",url:"https://example.com/b/"},
      ],
      fan_out_queries:["supplier","manufacturer"],
      input_tokens:120,
      output_tokens:260,
      model_money_spent_usd:0.0035,
      answer:"This full answer must never be stored in the observation table.",
    },
  });

  assert.equal(observed.tracker_id,tracker.id);

  const rows=await listAiPromptObservations(d1,{
    siteDomain:"example.com",
    trackerId:tracker.id,
  });
  assert.equal(rows.length,1);
  assert.equal(rows[0].target_domain_mentioned,true);
  assert.equal(rows[0].target_domain_cited,true);
  assert.equal(rows[0].citation_count,3);
  assert.deepEqual(rows[0].citation_domains,["example.com","industry.example"]);
  assert.equal(rows[0].fan_out_count,2);
  assert.equal(rows[0].actual_cost_usd,0.0042);
  assert.equal(Object.hasOwn(rows[0],"answer"),false);

  const trackers=await listAiPromptTrackers(d1,{siteDomain:"example.com"});
  assert.equal(trackers[0].observation_count,1);
  assert.equal(trackers[0].latest_observation.target_domain_cited,true);
});

test("Custom Prompt Tracker status changes are site-scoped", async () => {
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  await seedProfile(d1,{domain:"other.com"});
  const tracker=await upsertAiPromptTracker(d1,{
    siteDomain:"example.com",
    platform:"perplexity",
    modelName:"sonar",
    prompt:"Best waterproof membrane suppliers?",
    webSearch:true,
    locationCode:2840,
    languageCode:"en",
  });

  const paused=await updateAiPromptTrackerStatus(d1,{
    siteDomain:"example.com",
    trackerId:tracker.id,
    status:"paused",
  });
  assert.equal(paused.status,"paused");

  const missing=await getAiPromptTracker(d1,{
    siteDomain:"other.com",
    trackerId:tracker.id,
  });
  assert.equal(missing,null);

  const active=await listAiPromptTrackers(d1,{
    siteDomain:"example.com",
    includePaused:false,
  });
  assert.equal(active.length,0);
});
