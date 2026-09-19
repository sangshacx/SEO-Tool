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
  linkAiPromptWorkflow,
  readAiPromptWorkflowOutcomes,
} from "../src/v2/storage/ai-prompt-tracker.js";
import { upsertSeoActionWorkflow } from "../src/v2/storage/seo-action-workflow.js";

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


test("Saved Prompt list calculates mention rate, citation rate, cumulative spend and latest signal change from D1 only", async () => {
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const tracker=await upsertAiPromptTracker(d1,{
    siteDomain:"example.com",
    name:"Trend prompt",
    platform:"chat_gpt",
    modelName:"gpt-4.1-mini",
    prompt:"Which waterproofing manufacturers are commonly recommended?",
    webSearch:true,
    locationCode:2840,
    languageCode:"en",
  });

  await recordAiPromptObservation(d1,{
    siteDomain:"example.com",
    trackerId:tracker.id,
    observedAt:"2026-09-18T08:00:00.000Z",
    actualCostUsd:0.004,
    result:{
      model_name:"gpt-4.1-mini",
      target_domain_mentioned:true,
      target_domain_cited:true,
      annotations:[{domain:"example.com"}],
      input_tokens:100,
      output_tokens:200,
    },
  });
  await recordAiPromptObservation(d1,{
    siteDomain:"example.com",
    trackerId:tracker.id,
    observedAt:"2026-09-19T08:00:00.000Z",
    actualCostUsd:0.005,
    result:{
      model_name:"gpt-4.1-mini",
      target_domain_mentioned:true,
      target_domain_cited:false,
      annotations:[{domain:"industry.example"}],
      input_tokens:120,
      output_tokens:220,
    },
  });

  const [row]=await listAiPromptTrackers(d1,{
    siteDomain:"example.com",
    locationCode:2840,
    languageCode:"en",
  });

  assert.equal(row.observation_count,2);
  assert.equal(row.trend.mention_observation_count,2);
  assert.equal(row.trend.citation_observation_count,1);
  assert.equal(row.trend.mention_rate_percent,100);
  assert.equal(row.trend.citation_rate_percent,50);
  assert.equal(row.trend.total_actual_cost_usd,0.009);
  assert.equal(row.trend.change.code,"citation_lost");
  assert.equal(row.trend.change.kind,"negative");
  assert.equal(row.trend.latest_observed_at,"2026-09-19T08:00:00.000Z");
  assert.equal(row.trend.previous_observed_at,"2026-09-18T08:00:00.000Z");
});


test("AI Prompt workflow link resolves the correct tracker and validates post-completion citation recovery from D1", async () => {
  const {raw,d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const prompt="Which waterproof membrane manufacturers should buyers consider?";
  const tracker=await upsertAiPromptTracker(d1,{
    siteDomain:"example.com",
    name:"Supplier recovery",
    platform:"chat_gpt",
    modelName:"gpt-4.1-mini",
    prompt,
    webSearch:true,
    locationCode:2840,
    languageCode:"en",
  });

  await recordAiPromptObservation(d1,{
    siteDomain:"example.com",
    trackerId:tracker.id,
    observedAt:"2026-09-18T08:00:00.000Z",
    actualCostUsd:0.004,
    result:{
      model_name:"gpt-4.1-mini",
      target_domain_mentioned:true,
      target_domain_cited:false,
      annotations:[{domain:"industry.example"}],
    },
  });

  const workflow=await upsertSeoActionWorkflow(d1,{
    site_domain:"example.com",
    page_url:"https://example.com/",
    action_code:"ai_prompt_recovery",
    query:prompt,
    status:"done",
    note:"Updated source evidence.",
    snooze_until:null,
    priority_score:80,
  });
  await linkAiPromptWorkflow(d1,{
    siteDomain:"example.com",
    workflowId:workflow.id,
    trackerId:tracker.id,
  });
  raw.prepare(
    "UPDATE seo_action_workflow_events SET created_at = '2026-09-19 08:00:00' WHERE workflow_id = ? AND to_status = 'done'"
  ).run(workflow.id);

  let outcomes=await readAiPromptWorkflowOutcomes(d1,{siteDomain:"example.com"});
  assert.equal(outcomes.length,1);
  assert.equal(outcomes[0].tracker_id,tracker.id);
  assert.equal(outcomes[0].status,"waiting_for_post_observation");
  assert.equal(outcomes[0].baseline.target_domain_cited,false);

  await recordAiPromptObservation(d1,{
    siteDomain:"example.com",
    trackerId:tracker.id,
    observedAt:"2026-09-20T08:00:00.000Z",
    actualCostUsd:0.005,
    result:{
      model_name:"gpt-4.1-mini",
      target_domain_mentioned:true,
      target_domain_cited:true,
      annotations:[{domain:"example.com"}],
    },
  });

  outcomes=await readAiPromptWorkflowOutcomes(d1,{siteDomain:"example.com"});
  assert.equal(outcomes.length,1);
  assert.equal(outcomes[0].status,"ready");
  assert.equal(outcomes[0].observed.code,"citation_recovered");
  assert.equal(outcomes[0].after.target_domain_cited,true);
  assert.equal(outcomes[0].after.actual_cost_usd,0.005);
});

test("AI Prompt workflow links reject cross-site tracker ids", async () => {
  const {d1}=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  await seedProfile(d1,{domain:"other.com"});
  const tracker=await upsertAiPromptTracker(d1,{
    siteDomain:"other.com",
    platform:"gemini",
    modelName:"gemini-2.5-flash",
    prompt:"Recommend suppliers.",
    webSearch:true,
    locationCode:2840,
    languageCode:"en",
  });
  const workflow=await upsertSeoActionWorkflow(d1,{
    site_domain:"example.com",
    page_url:"https://example.com/",
    action_code:"ai_prompt_recovery",
    query:"Recommend suppliers.",
    status:"in_progress",
    note:"",
    snooze_until:null,
    priority_score:70,
  });

  await assert.rejects(
    linkAiPromptWorkflow(d1,{
      siteDomain:"example.com",
      workflowId:workflow.id,
      trackerId:tracker.id,
    }),
    (error)=>error?.code==="TRACKER_NOT_FOUND",
  );
});
