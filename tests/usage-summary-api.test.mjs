import assert from "node:assert/strict";
import test from "node:test";

test("counts provider requests only when a provider task was attempted", async () => {
  const { onRequestGet } = await import("../functions/api/v2/usage/summary.js");
  let query;
  const response = await onRequestGet({
    env: {
      DB: {
        prepare: (sql) => {
          query = sql;
          return {
            first: async () => ({
              all_requests: 1,
              all_cost_usd: 0,
              today_requests: 1,
              today_cost_usd: 0,
              month_requests: 1,
              month_cost_usd: 0,
              month_cache_hits: 0,
              month_provider_requests: 0,
              month_failed_requests: 1,
            }),
          };
        },
      },
    },
  });

  assert.equal(response.status, 200);
  assert.match(query, /AND cache_hit = 0\s+AND task_count > 0\s+THEN 1 ELSE 0/);
  assert.equal((await response.json()).data.this_month.provider_requests, 0);
});
