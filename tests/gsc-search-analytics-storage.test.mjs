import assert from "node:assert/strict";
import test from "node:test";
import { dashboardDatabase, seedProfile } from "./dashboard-test-helpers.mjs";
import { completedGscSyncDates, recordGscSyncRun, replaceGscAnalyticsPartition } from "../src/v2/storage/gsc-search-analytics.js";

test("GSC analytics partition replacement removes stale rows and writes JSON batches atomically", async () => {
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const site=await d1.prepare("SELECT id FROM site_profiles WHERE domain = ?").bind("example.com").first();

  const first=Array.from({length:520},(_,index)=>({
    query:"query "+index,
    clicks:index,
    impressions:index+10,
    ctr:0.1,
    position:8,
  }));
  const saved=await replaceGscAnalyticsPartition(d1,{
    siteProfileId:site.id,
    property:"sc-domain:example.com",
    date:"2026-09-16",
    dimensionSet:"query",
    rows:first,
    syncedAt:"2026-09-19T02:00:00.000Z",
  });
  assert.equal(saved.rows_written,520);
  assert.equal(saved.statements,4);
  const count1=await d1.prepare("SELECT COUNT(*) AS count FROM gsc_search_analytics_daily WHERE site_profile_id = ? AND date = ? AND dimension_set = ?").bind(site.id,"2026-09-16","query").first();
  assert.equal(Number(count1.count),520);

  await replaceGscAnalyticsPartition(d1,{
    siteProfileId:site.id,
    property:"sc-domain:example.com",
    date:"2026-09-16",
    dimensionSet:"query",
    rows:[{query:"replacement",clicks:1,impressions:2,ctr:0.5,position:3}],
  });
  const rows=await d1.prepare("SELECT query_text, clicks FROM gsc_search_analytics_daily WHERE site_profile_id = ? AND date = ? AND dimension_set = ?").bind(site.id,"2026-09-16","query").all();
  assert.deepEqual(rows.results.map((row)=>row.query_text),["replacement"]);
});


test("completed GSC sync dates require all requested sets at an equal or deeper row cap", async () => {
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const site=await d1.prepare("SELECT id FROM site_profiles WHERE domain = ?").bind("example.com").first();
  const base={
    site_profile_id:site.id,
    property:"sc-domain:example.com",
    dimension_sets:["query","page","query_page"],
    provider_requests:3,
    rows_received:30,
    rows_written:30,
    truncated_sets:[],
    status:"success",
    error_code:null,
    started_at:"2026-09-19T01:00:00.000Z",
    completed_at:"2026-09-19T01:01:00.000Z",
  };
  await recordGscSyncRun(d1,{...base,target_date:"2026-09-15",row_limit_per_set:1000});
  await recordGscSyncRun(d1,{...base,target_date:"2026-09-16",row_limit_per_set:2500,dimension_sets:["query","page"]});
  const completed=await completedGscSyncDates(d1,{
    siteProfileId:site.id,
    dates:["2026-09-15","2026-09-16"],
    dimensionSets:["query","page","query_page"],
    minimumRowLimit:1000,
  });
  assert.deepEqual([...completed],["2026-09-15"]);

  const deeper=await completedGscSyncDates(d1,{
    siteProfileId:site.id,
    dates:["2026-09-15"],
    dimensionSets:["query","page","query_page"],
    minimumRowLimit:2500,
  });
  assert.equal(deeper.size,0);
});
