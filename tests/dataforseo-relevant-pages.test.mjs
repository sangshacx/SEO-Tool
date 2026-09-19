import assert from "node:assert/strict";
import test from "node:test";

import {
  RELEVANT_PAGES_ENDPOINT,
  fetchRelevantPages,
  normalizeRelevantPagesDomain,
} from "../src/v2/providers/dataforseo-relevant-pages.js";

test("Relevant Pages target is normalized to a root domain", () => {
  assert.equal(normalizeRelevantPagesDomain("https://WWW.Example.com/path/"), "example.com");
  assert.equal(normalizeRelevantPagesDomain("Example.com"), "example.com");
  assert.equal(normalizeRelevantPagesDomain("localhost"), null);
});

test("Relevant Pages provider requests organic-only pages and normalizes page metrics", async (context) => {
  const originalFetch=globalThis.fetch;
  context.after(()=>{globalThis.fetch=originalFetch;});
  let captured;
  globalThis.fetch=async (url,options)=>{
    captured={url,options};
    return new Response(JSON.stringify({
      status_code:20000,
      cost:0.072,
      tasks_count:1,
      tasks:[{
        status_code:20000,
        result_count:1,
        result:[{
          target:"example.com",
          total_count:30,
          items:[
            {page_address:"https://example.com/a/",metrics:{organic:{pos_1:2,pos_2_3:3,pos_4_10:5,pos_11_20:10,etv:70,count:25,estimated_paid_traffic_cost:100,is_new:4,is_up:8,is_down:3,is_lost:1}}},
            {page_address:"https://example.com/b/?x=1",metrics:{organic:{pos_1:0,pos_2_3:1,pos_4_10:2,pos_11_20:2,etv:30,count:10,estimated_paid_traffic_cost:20,is_new:1,is_up:2,is_down:2,is_lost:0}}},
          ],
        }],
      }],
    }),{headers:{"content-type":"application/json"}});
  };

  const result=await fetchRelevantPages({
    login:"login",password:"password",target:"https://www.example.com/path",
    locationCode:2840,languageCode:"en",limit:500,
  });

  assert.equal(captured.url,RELEVANT_PAGES_ENDPOINT);
  const task=JSON.parse(captured.options.body)[0];
  assert.equal(task.target,"example.com");
  assert.deepEqual(task.item_types,["organic"]);
  assert.equal(task.include_clickstream_data,false);
  assert.equal(task.historical_serp_mode,"live");
  assert.equal(task.ignore_synonyms,true);
  assert.equal(task.limit,500);
  assert.deepEqual(task.order_by,["metrics.organic.etv,desc","metrics.organic.count,desc"]);

  assert.equal(result.data.items[0].relative_url,"/a/");
  assert.equal(result.data.items[0].organic_traffic,70);
  assert.equal(result.data.items[0].organic_keywords,25);
  assert.equal(result.data.items[0].positions.top_10,10);
  assert.equal(result.data.items[0].positions.top_20,20);
  assert.equal(result.data.items[0].changes.up,8);
  assert.equal(result.data.items[0].returned_traffic_share_percent,70);
  assert.match(result.data.disclaimer,/not the whole domain/);
});
