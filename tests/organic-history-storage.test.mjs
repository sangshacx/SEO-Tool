import assert from "node:assert/strict";
import test from "node:test";

import { dashboardDatabase, seedProfile } from "./dashboard-test-helpers.mjs";
import { recordManagedOrganicSnapshot } from "../src/v2/storage/organic-history.js";
import { readDashboardHistory } from "../src/v2/storage/site-dashboard.js";

test("managed root-domain Organic Keywords live requests create Project History snapshots", async () => {
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  const result=await recordManagedOrganicSnapshot({
    db:d1,target:"example.com",targetType:"domain",locationCode:2840,languageCode:"en",
    data:{organic:{ranked_keywords:120,estimated_monthly_traffic:340,estimated_paid_traffic_cost_usd:78},update_window:{last_updated_at:"2026-09-18T00:00:00.000Z"}},
    capturedAt:"2026-09-19T01:00:00.000Z",
  });
  assert.equal(result.inserted,true);

  const history=await readDashboardHistory(d1,{domain:"example.com",location_code:2840,language_code:"en"},0);
  assert.equal(history.organic.length,1);
  assert.equal(history.organic[0].organic_keywords,120);
  assert.equal(history.organic[0].organic_traffic,340);
  assert.equal(history.organic[0].traffic_value,78);
});

test("unmanaged domains and page-level targets do not pollute Project History", async () => {
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  assert.deepEqual(
    await recordManagedOrganicSnapshot({db:d1,target:"rival.example",targetType:"domain",locationCode:2840,languageCode:"en",data:{},capturedAt:"2026-09-19T01:00:00.000Z"}),
    {inserted:false,reason:"unmanaged_site"},
  );
  assert.deepEqual(
    await recordManagedOrganicSnapshot({db:d1,target:"https://example.com/page/",targetType:"url",locationCode:2840,languageCode:"en",data:{},capturedAt:"2026-09-19T01:00:00.000Z"}),
    {inserted:false,reason:"unsupported_target"},
  );
});
