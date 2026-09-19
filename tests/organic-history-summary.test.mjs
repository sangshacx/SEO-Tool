import assert from "node:assert/strict";
import test from "node:test";

import { summarizeOrganicHistory } from "../src/v2/organic/organic-history.js";

test("Organic History summary separates latest values from first-to-last change", () => {
  const summary=summarizeOrganicHistory([
    {captured_at:"2026-01-01T00:00:00.000Z",organic_keywords:100,organic_traffic:200,traffic_value:50},
    {captured_at:"2026-02-01T00:00:00.000Z",organic_keywords:120,organic_traffic:260,traffic_value:75},
  ]);
  assert.equal(summary.points,2);
  assert.equal(summary.latest.organic_keywords,120);
  assert.equal(summary.latest.organic_traffic,260);
  assert.equal(summary.change.organic_keywords_percent,20);
  assert.equal(summary.change.organic_traffic_percent,30);
  assert.equal(summary.change.traffic_value_percent,50);
});

test("single-point history has latest values but no change baseline", () => {
  const summary=summarizeOrganicHistory([{period:"2026-09",organic_keywords:20,organic_traffic:40,traffic_value_usd:5,positions:{top_10:8}}]);
  assert.equal(summary.points,1);
  assert.equal(summary.latest.top_10,8);
  assert.equal(summary.change,null);
});
