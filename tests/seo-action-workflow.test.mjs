import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { applyDecisionWorkflow } from "../src/v2/intelligence/decision-workflow.js";
import {
  getSeoActionWorkflowStats,
  listSeoActionWorkflow,
  listSeoActionWorkflowEvents,
  readSeoActionOutcomes,
  upsertSeoActionWorkflow,
} from "../src/v2/storage/seo-action-workflow.js";
import { d1For } from "./dashboard-test-helpers.mjs";

async function workflowDb() {
  const raw = new DatabaseSync(":memory:");
  for (const file of ["0007_site_profiles.sql", "0015_gsc_search_analytics.sql", "0016_seo_action_workflow.sql", "0017_seo_action_workflow_events.sql"]) {
    raw.exec(await readFile(new URL("../migrations/" + file, import.meta.url), "utf8"));
  }
  const d1=d1For(raw);
  await d1.prepare(`
    INSERT INTO site_profiles (
      domain,label,location_code,location_name,country_iso_code,
      language_code,language_name,include_subdomains,competitors_json
    ) VALUES ('example.com','Example',2840,'United States','US','en','English',0,'[]')
  `).bind().run();
  return {raw,d1};
}

test("SEO action workflow migration enforces scoped unique decisions and supported statuses", async () => {
  const {raw}=await workflowDb();
  const columns=raw.prepare("SELECT name FROM pragma_table_info('seo_action_workflow') ORDER BY cid").all().map(row=>row.name);
  assert.deepEqual(columns,[
    "id","site_profile_id","page_url","action_code","query_text","status","note","snooze_until",
    "last_priority_score","first_seen_at","last_seen_at","created_at","updated_at",
  ]);
  const indexes=raw.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND tbl_name='seo_action_workflow' ORDER BY name").all().map(row=>row.name);
  assert.ok(indexes.includes("idx_seo_action_workflow_site_page"));
  assert.ok(indexes.includes("idx_seo_action_workflow_site_status"));

  const eventColumns=raw.prepare("SELECT name FROM pragma_table_info('seo_action_workflow_events') ORDER BY cid").all().map(row=>row.name);
  assert.deepEqual(eventColumns,[
    "id","site_profile_id","workflow_id","page_url","action_code","query_text","from_status","to_status",
    "note_snapshot","snooze_until","priority_score","created_at",
  ]);
  const eventIndexes=raw.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND tbl_name='seo_action_workflow_events' ORDER BY name").all().map(row=>row.name);
  assert.ok(eventIndexes.includes("idx_seo_action_events_site_created"));
  assert.ok(eventIndexes.includes("idx_seo_action_events_workflow_created"));
});

test("workflow storage upserts the same page/action/query instead of duplicating it", async () => {
  const {d1}=await workflowDb();
  const base={
    site_domain:"example.com",
    page_url:"https://example.com/page/",
    action_code:"optimize",
    query:"waterproof membrane",
    note:"",
    snooze_until:null,
    priority_score:77,
  };
  const first=await upsertSeoActionWorkflow(d1,{...base,status:"in_progress"});
  const second=await upsertSeoActionWorkflow(d1,{...base,status:"done",priority_score:81});
  const items=await listSeoActionWorkflow(d1,"example.com");
  assert.equal(items.length,1);
  assert.equal(first.id,second.id);
  assert.equal(items[0].status,"done");
  assert.equal(items[0].last_priority_score,81);
  assert.equal(items[0].query,"waterproof membrane");

  const events=await listSeoActionWorkflowEvents(d1,"example.com");
  assert.equal(events.length,2);
  assert.equal(events[0].from_status,"in_progress");
  assert.equal(events[0].to_status,"done");
  assert.equal(events[0].priority_score,81);
  assert.equal(events[1].from_status,null);
  assert.equal(events[1].to_status,"in_progress");
});

test("workflow suppression backfills Top 5 from deeper actionable candidates", () => {
  const rawData={
    action_queue:Array.from({length:7},(_,index)=>({
      rank:index+1,
      page:"https://example.com/page-"+(index+1)+"/",
      action:index===0?"recover":"optimize",
      action_label:index===0?"Recover":"Optimize",
      priority_score:90-index,
      confidence:"high",
      query:"query "+(index+1),
      query_source:"gsc_query_page",
      why_now:"reason "+(index+1),
      evidence:null,
    })),
    next_best_action:null,
  };
  const future="2099-01-01T00:00:00.000Z";
  const workflow=[
    {page_url:"https://example.com/page-1/",action_code:"recover",query:"query 1",status:"done",note:"finished",snooze_until:null,updated_at:"2026-09-19T00:00:00.000Z"},
    {page_url:"https://example.com/page-2/",action_code:"optimize",query:"query 2",status:"snoozed",note:"later",snooze_until:future,updated_at:"2026-09-19T00:00:00.000Z"},
    {page_url:"https://example.com/page-3/",action_code:"optimize",query:"query 3",status:"in_progress",note:"working",snooze_until:null,updated_at:"2026-09-19T00:00:00.000Z"},
  ];
  const data=applyDecisionWorkflow(rawData,workflow,new Date("2026-09-19T00:00:00.000Z"));
  assert.equal(data.action_queue.length,5);
  assert.deepEqual(data.action_queue.map(item=>item.page),[
    "https://example.com/page-3/",
    "https://example.com/page-4/",
    "https://example.com/page-5/",
    "https://example.com/page-6/",
    "https://example.com/page-7/",
  ]);
  assert.equal(data.next_best_action.page,"https://example.com/page-3/");
  assert.equal(data.next_best_action.workflow.status,"in_progress");
  assert.equal(data.workflow_summary.done,1);
  assert.equal(data.workflow_summary.snoozed,1);
  assert.equal(data.workflow_summary.suppressed,2);
  assert.equal(data.workflow_summary.active,5);
  assert.equal(data.workflow_summary.active_candidates,5);
  assert.equal(data.action_queue.length,5);
});

test("expired snooze returns to the active queue without rewriting D1", () => {
  const rawData={
    action_queue:[{
      rank:1,page:"https://example.com/page/",action:"optimize",action_label:"Optimize",
      priority_score:60,confidence:"medium",query:"term",query_source:"dataforseo_cache",why_now:"reason",evidence:null,
    }],
  };
  const data=applyDecisionWorkflow(rawData,[{
    page_url:"https://example.com/page/",
    action_code:"optimize",
    query:"term",
    status:"snoozed",
    snooze_until:"2026-09-10T00:00:00.000Z",
    note:"",
  }],new Date("2026-09-19T00:00:00.000Z"));
  assert.equal(data.action_queue.length,1);
  assert.equal(data.action_queue[0].workflow.status,"new");
  assert.equal(data.action_queue[0].workflow.persisted_status,"snoozed");
  assert.equal(data.action_queue[0].workflow.snooze_expired,true);
  assert.equal(data.workflow_summary.suppressed,0);
});


test("full Opportunity rows retain suppressed workflow state so Done or Snoozed actions can be reopened", () => {
  const rawData={
    action_queue:[{
      rank:1,page:"https://example.com/page/",action:"optimize",action_label:"Optimize",
      priority_score:70,confidence:"high",query:"term",query_source:"dataforseo_cache",why_now:"reason",evidence:null,
    }],
    opportunities:[{
      url:"https://example.com/page/",
      action:{code:"optimize",label:"Optimize"},
      priority_score:70,
      next_best_action:{
        page:"https://example.com/page/",
        action:"optimize",
        action_label:"Optimize",
        priority_score:70,
        query:"term",
        query_source:"dataforseo_cache",
        why_now:"reason",
        evidence:null,
      },
    }],
  };
  const data=applyDecisionWorkflow(rawData,[{
    page_url:"https://example.com/page/",
    action_code:"optimize",
    query:"term",
    status:"done",
    note:"implemented",
    snooze_until:null,
    updated_at:"2026-09-19T00:00:00.000Z",
  }],new Date("2026-09-19T00:00:00.000Z"));

  assert.equal(data.action_queue.length,0);
  assert.equal(data.next_best_action,null);
  assert.equal(data.opportunities[0].workflow.status,"done");
  assert.equal(data.opportunities[0].workflow.suppressed,true);
  assert.equal(data.opportunities[0].workflow.note,"implemented");
});


test("repeating the exact same workflow state does not create duplicate activity", async () => {
  const {d1}=await workflowDb();
  const input={
    site_domain:"example.com",
    page_url:"https://example.com/page/",
    action_code:"recover",
    query:"ranking loss",
    status:"in_progress",
    note:"",
    snooze_until:null,
    priority_score:66,
  };
  await upsertSeoActionWorkflow(d1,input);
  await upsertSeoActionWorkflow(d1,input);
  const events=await listSeoActionWorkflowEvents(d1,"example.com");
  assert.equal(events.length,1);
  assert.equal(events[0].from_status,null);
  assert.equal(events[0].to_status,"in_progress");
});

test("workflow activity is site-scoped and returns newest events first", async () => {
  const {d1}=await workflowDb();
  await d1.prepare(`
    INSERT INTO site_profiles (
      domain,label,location_code,location_name,country_iso_code,
      language_code,language_name,include_subdomains,competitors_json
    ) VALUES ('other.example','Other',2840,'United States','US','en','English',0,'[]')
  `).bind().run();

  await upsertSeoActionWorkflow(d1,{
    site_domain:"example.com",page_url:"https://example.com/a/",action_code:"optimize",query:"a",
    status:"in_progress",note:"",snooze_until:null,priority_score:50,
  });
  await upsertSeoActionWorkflow(d1,{
    site_domain:"example.com",page_url:"https://example.com/b/",action_code:"recover",query:"b",
    status:"done",note:"",snooze_until:null,priority_score:70,
  });
  await upsertSeoActionWorkflow(d1,{
    site_domain:"other.example",page_url:"https://other.example/x/",action_code:"protect",query:"x",
    status:"done",note:"",snooze_until:null,priority_score:80,
  });

  const events=await listSeoActionWorkflowEvents(d1,"example.com",{limit:10});
  assert.equal(events.length,2);
  assert.equal(events[0].page_url,"https://example.com/b/");
  assert.equal(events[1].page_url,"https://example.com/a/");
  assert.ok(events.every(event=>event.site_domain==="example.com"));
});


test("workflow execution stats summarize current states and recent transitions", async () => {
  const {d1}=await workflowDb();
  const action=async(page,action,query,status,score)=>upsertSeoActionWorkflow(d1,{
    site_domain:"example.com",
    page_url:"https://example.com/"+page+"/",
    action_code:action,
    query,
    status,
    note:"",
    snooze_until:status==="snoozed"?"2099-01-01T00:00:00.000Z":null,
    priority_score:score,
  });

  await action("a","optimize","a","in_progress",60);
  await action("a","optimize","a","done",70);
  await action("b","recover","b","in_progress",80);
  await action("c","protect","c","snoozed",50);
  await action("d","scale","d","new",40);

  const stats=await getSeoActionWorkflowStats(d1,"example.com");
  assert.deepEqual(stats.current,{
    new:1,
    in_progress:1,
    done:1,
    snoozed:1,
    total:4,
  });
  assert.equal(stats.last_7_days.started,2);
  assert.equal(stats.last_7_days.completed,1);
  assert.equal(stats.last_7_days.snoozed,1);
  assert.equal(stats.last_7_days.reopened,0);
  assert.equal(stats.last_7_days.events,5);
  assert.equal(stats.last_30_days.completed,1);
});


test("completed SEO actions compare exact Query+Page GSC windows before and after completion", async () => {
  const {raw,d1}=await workflowDb();
  await upsertSeoActionWorkflow(d1,{
    site_domain:"example.com",
    page_url:"https://example.com/outcome/",
    action_code:"optimize",
    query:"waterproof membrane",
    status:"done",
    note:"published title and copy changes",
    snooze_until:null,
    priority_score:78,
  });
  raw.prepare("UPDATE seo_action_workflow_events SET created_at = '2026-09-10 12:00:00' WHERE to_status = 'done'").run();

  const insert=raw.prepare(`
    INSERT INTO gsc_search_analytics_daily (
      site_profile_id,property,date,dimension_set,query_text,page_url,country,device,
      clicks,impressions,ctr,position,synced_at
    ) VALUES (1,'sc-domain:example.com',?,'query_page','waterproof membrane','https://example.com/outcome/','','',?,?,?,?,?)
  `);
  for(let day=3;day<=9;day++){
    const date="2026-09-"+String(day).padStart(2,"0");
    insert.run(date,1,10,0.1,10,"2026-09-19T00:00:00.000Z");
  }
  for(let day=11;day<=17;day++){
    const date="2026-09-"+String(day).padStart(2,"0");
    insert.run(date,2,15,2/15,7,"2026-09-19T00:00:00.000Z");
  }

  const outcomes=await readSeoActionOutcomes(d1,"example.com",{limit:10,windowDays:7});
  assert.equal(outcomes.length,1);
  const outcome=outcomes[0];
  assert.equal(outcome.scope,"query_page");
  assert.equal(outcome.status,"ready");
  assert.equal(outcome.coverage.before_days,7);
  assert.equal(outcome.coverage.after_days,7);
  assert.equal(outcome.before.clicks,7);
  assert.equal(outcome.after.clicks,14);
  assert.equal(outcome.before.impressions,70);
  assert.equal(outcome.after.impressions,105);
  assert.equal(outcome.change.clicks_percent,100);
  assert.equal(outcome.change.position_improvement,3);
  assert.equal(outcome.observed.code,"improved");
});

test("completed query actions explicitly fall back to page-level GSC only when Query+Page data is absent", async () => {
  const {raw,d1}=await workflowDb();
  await upsertSeoActionWorkflow(d1,{
    site_domain:"example.com",
    page_url:"https://example.com/fallback/",
    action_code:"recover",
    query:"missing query dimension",
    status:"done",
    note:"",
    snooze_until:null,
    priority_score:70,
  });
  raw.prepare("UPDATE seo_action_workflow_events SET created_at = '2026-09-10 12:00:00' WHERE to_status = 'done'").run();

  const insert=raw.prepare(`
    INSERT INTO gsc_search_analytics_daily (
      site_profile_id,property,date,dimension_set,query_text,page_url,country,device,
      clicks,impressions,ctr,position,synced_at
    ) VALUES (1,'sc-domain:example.com',?,'page','','https://example.com/fallback/','','',?,?,?,?,?)
  `);
  for(let day=3;day<=9;day++){
    insert.run("2026-09-"+String(day).padStart(2,"0"),1,20,0.05,12,"2026-09-19T00:00:00.000Z");
  }
  for(let day=11;day<=17;day++){
    insert.run("2026-09-"+String(day).padStart(2,"0"),2,25,0.08,9,"2026-09-19T00:00:00.000Z");
  }

  const [outcome]=await readSeoActionOutcomes(d1,"example.com",{limit:10,windowDays:7});
  assert.equal(outcome.scope,"page_fallback");
  assert.equal(outcome.status,"ready");
  assert.equal(outcome.coverage.before_days,7);
  assert.equal(outcome.coverage.after_days,7);
  assert.equal(outcome.observed.code,"improved");
});
