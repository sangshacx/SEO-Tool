import assert from "node:assert/strict";
import test from "node:test";

import { ORGANIC_COMPETITORS_ENDPOINT, fetchOrganicCompetitors } from "../src/v2/providers/dataforseo-organic-competitors.js";

test("Organic Competitors uses Top 20 discovery, excludes giant generic domains, and normalizes overlap", async (context) => {
  const originalFetch=globalThis.fetch;context.after(()=>{globalThis.fetch=originalFetch;});
  let captured;
  globalThis.fetch=async(url,options)=>{
    captured={url,options};
    return new Response(JSON.stringify({
      status_code:20000,cost:0.024,tasks_count:1,
      tasks:[{status_code:20000,result_count:1,result:[{
        target:"example.com",total_count:50,items_count:3,items:[
          {domain:"example.com",avg_position:9,intersections:1000,full_domain_metrics:{organic:{count:1000,etv:10000,estimated_paid_traffic_cost:15000,pos_1:10,pos_2_3:20,pos_4_10:50}},competitor_metrics:{organic:{etv:10000}}},
          {domain:"close.example",avg_position:12,intersections:200,full_domain_metrics:{organic:{count:800,etv:9000,estimated_paid_traffic_cost:12000,pos_1:5,pos_2_3:15,pos_4_10:40}},competitor_metrics:{organic:{etv:4000}}},
          {domain:"huge.example",avg_position:18,intersections:100,full_domain_metrics:{organic:{count:10000,etv:50000,estimated_paid_traffic_cost:80000,pos_1:100,pos_2_3:200,pos_4_10:500}},competitor_metrics:{organic:{etv:3000}}},
        ],
      }]}],
    }),{headers:{"content-type":"application/json"}});
  };

  const result=await fetchOrganicCompetitors({login:"login",password:"password",target:"https://www.example.com/path",locationCode:2840,languageCode:"en"});
  assert.equal(captured.url,ORGANIC_COMPETITORS_ENDPOINT);
  const task=JSON.parse(captured.options.body)[0];
  assert.equal(task.target,"example.com");
  assert.deepEqual(task.item_types,["organic"]);
  assert.equal(task.max_rank_group,20);
  assert.equal(task.exclude_top_domains,true);
  assert.equal(task.include_clickstream_data,false);
  assert.equal(task.limit,100);
  assert.equal(result.resultCount,3);
  assert.equal(result.data.competitors.length,2);
  assert.equal(result.data.competitors[0].domain,"close.example");
  assert.equal(result.data.competitors[0].shared_keywords,200);
  assert.equal(result.data.competitors[0].relevance.keyword_similarity_percent,22.36);
  assert.equal(result.data.competitors[0].relevance.your_coverage_percent,20);
  assert.equal(result.data.competitors[0].relevance.their_overlap_percent,25);
});
