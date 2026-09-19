import assert from "node:assert/strict";
import test from "node:test";

import {
  RANKED_KEYWORDS_ENDPOINT,
  fetchRankedKeywords,
  normalizeRankedKeywordsTarget,
} from "../src/v2/providers/dataforseo-ranked-keywords.js";

test("normalizes domain and exact URL targets without confusing the two scopes", () => {
  assert.deepEqual(normalizeRankedKeywordsTarget("WWW.Example.COM"), {
    target: "example.com",
    target_type: "domain",
  });
  assert.deepEqual(normalizeRankedKeywordsTarget("https://Example.com/page/?a=1#section"), {
    target: "https://example.com/page/?a=1",
    target_type: "url",
  });
  assert.equal(normalizeRankedKeywordsTarget("localhost"), null);
});

test("ranked keywords provider requests organic live data and normalizes movement semantics", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let captured;

  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({
      status_code: 20000,
      cost: 0.072,
      tasks_count: 1,
      tasks: [{
        status_code: 20000,
        cost: 0.072,
        result_count: 1,
        result: [{
          total_count: 1200,
          metrics: {
            organic: {
              count: 1200,
              etv: 1000,
              estimated_paid_traffic_cost: 2500,
              pos_1: 10,
              pos_2_3: 20,
              pos_4_10: 70,
              pos_11_20: 100,
              pos_21_30: 100,
              pos_31_40: 100,
              pos_41_50: 100,
              pos_51_60: 100,
              pos_61_70: 100,
              pos_71_80: 100,
              pos_81_90: 100,
              pos_91_100: 100,
              is_new: 14,
              is_up: 40,
              is_down: 19,
              is_lost: 0,
            },
          },
          items: [{
            keyword_data: {
              keyword: "waterproof membrane",
              keyword_info: {
                search_volume: 6600,
                cpc: 2.4,
                competition: 0.55,
                competition_level: "MEDIUM",
                last_updated_time: "2026-09-01 00:00:00 +00:00",
              },
              keyword_properties: { keyword_difficulty: 34 },
              search_intent_info: { main_intent: "commercial", foreign_intent: ["transactional"] },
              serp_info: {
                serp_item_types: ["organic", "people_also_ask", "ai_overview"],
                last_updated_time: "2026-09-12 00:00:00 +00:00",
                previous_updated_time: "2026-09-05 00:00:00 +00:00",
              },
            },
            ranked_serp_element: {
              is_lost: false,
              last_updated_time: "2026-09-12 00:00:00 +00:00",
              previous_updated_time: "2026-09-05 00:00:00 +00:00",
              serp_item: {
                rank_group: 8,
                rank_absolute: 9,
                url: "https://example.com/membrane/",
                title: "Waterproof Membrane",
                relative_url: "/membrane/",
                etv: 310,
                estimated_paid_traffic_cost: 744,
                rank_changes: {
                  previous_rank_absolute: 14,
                  is_new: false,
                  is_up: true,
                  is_down: false,
                },
              },
            },
          }],
        }],
      }],
    }), { headers: { "content-type": "application/json" } });
  };

  const result = await fetchRankedKeywords({
    login: "login",
    password: "password",
    target: "example.com",
    locationCode: 2840,
    languageCode: "en",
    limit: 500,
  });

  assert.equal(captured.url, RANKED_KEYWORDS_ENDPOINT);
  const task = JSON.parse(captured.options.body)[0];
  assert.equal(task.target, "example.com");
  assert.equal(task.historical_serp_mode, "live");
  assert.deepEqual(task.item_types, ["organic"]);
  assert.equal(task.include_clickstream_data, false);
  assert.equal(task.load_rank_absolute, true);
  assert.equal(task.limit, 500);

  assert.equal(result.actualCostUsd, 0.072);
  assert.equal(result.data.organic.positions.top_10, 100);
  assert.equal(result.data.items[0].position, 8);
  assert.equal(result.data.items[0].absolute_position, 9);
  assert.equal(result.data.items[0].movement.previous_absolute_position, 14);
  assert.equal(result.data.items[0].movement.absolute_delta, 5);
  assert.equal(result.data.items[0].movement.is_up, true);
  assert.equal(result.data.items[0].traffic_share_percent, 31);
  assert.deepEqual(result.data.items[0].serp_features, ["organic", "people_also_ask", "ai_overview"]);
  assert.match(result.data.disclaimer, /rank_group/);
});
