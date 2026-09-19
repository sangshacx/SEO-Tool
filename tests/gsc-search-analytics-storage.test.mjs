import assert from "node:assert/strict";
import test from "node:test";
import { dashboardDatabase, seedProfile } from "./dashboard-test-helpers.mjs";
import { replaceGscAnalyticsPartition } from "../src/v2/storage/gsc-search-analytics.js";

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
