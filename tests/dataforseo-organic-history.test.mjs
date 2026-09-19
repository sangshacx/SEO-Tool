import assert from "node:assert/strict";
import test from "node:test";

import {
  ORGANIC_HISTORY_ENDPOINT,
  fetchOrganicHistory,
  normalizeOrganicHistoryDomain,
  organicHistoryDateRange,
} from "../src/v2/providers/dataforseo-organic-history.js";

test("Organic History normalizes root domains and calculates inclusive monthly ranges", () => {
  assert.equal(normalizeOrganicHistoryDomain("https://WWW.Example.com/path/"), "example.com");
  assert.equal(normalizeOrganicHistoryDomain("Example.com"), "example.com");
  assert.equal(normalizeOrganicHistoryDomain("localhost"), null);
  assert.deepEqual(
    organicHistoryDateRange(12, new Date("2026-09-19T08:00:00.000Z")),
    { dateFrom: "2025-10-01", dateTo: "2026-09-19" },
  );
});

test("Historical Rank Overview provider uses explicit monthly history settings and normalizes points", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let captured;
  globalThis.fetch=async(url,options)=>{
    captured={url,options};
    return new Response(JSON.stringify({
      status_code:20000,cost:0.12,tasks_count:1,
      tasks:[{status_code:20000,result_count:1,result:[{
        target:"example.com",total_count:2,items_count:2,items:[
          {year:2026,month:9,metrics:{organic:{count:120,etv:240,estimated_paid_traffic_cost:300,pos_1:2,pos_2_3:3,pos_4_10:5,pos_11_20:10,is_new:20,is_up:30,is_down:8,is_lost:4}}},
          {year:2026,month:8,metrics:{organic:{count:100,etv:200,estimated_paid_traffic_cost:250,pos_1:1,pos_2_3:2,pos_4_10:4,pos_11_20:8,is_new:15,is_up:20,is_down:9,is_lost:5}}},
        ],
      }]}],
    }),{headers:{"content-type":"application/json"}});
  };

  const result=await fetchOrganicHistory({
    login:"login",password:"password",target:"example.com",
    locationCode:2840,languageCode:"en",months:12,
    now:new Date("2026-09-19T08:00:00.000Z"),
  });

  assert.equal(captured.url,ORGANIC_HISTORY_ENDPOINT);
  const task=JSON.parse(captured.options.body)[0];
  assert.equal(task.target,"example.com");
  assert.equal(task.date_from,"2025-10-01");
  assert.equal(task.date_to,"2026-09-19");
  assert.equal(task.correlate,true);
  assert.equal(task.ignore_synonyms,true);
  assert.equal(task.include_clickstream_data,false);

  assert.equal(result.actualCostUsd,0.12);
  assert.equal(result.resultCount,2);
  assert.deepEqual(result.data.points.map((p)=>p.period),["2026-08","2026-09"]);
  assert.equal(result.data.points[1].organic_keywords,120);
  assert.equal(result.data.points[1].organic_traffic,240);
  assert.equal(result.data.points[1].positions.top_10,10);
  assert.equal(result.data.points[1].month_over_month.organic_traffic_percent,20);
});
