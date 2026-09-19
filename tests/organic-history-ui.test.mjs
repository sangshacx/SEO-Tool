import assert from "node:assert/strict";
import test from "node:test";

import { buildHistoryChartPoints, historyMetricValue, organicHistoryPanelMarkup } from "../public/v2-organic-history-ui.js";

test("Organic History UI reads project and provider metrics through one chart contract", () => {
  const project={organic_traffic:20,organic_keywords:10,traffic_value:3};
  const provider={organic_traffic:40,organic_keywords:30,traffic_value_usd:5,positions:{top_10:8}};
  assert.equal(historyMetricValue(project,"traffic"),20);
  assert.equal(historyMetricValue(project,"value"),3);
  assert.equal(historyMetricValue(provider,"value"),5);
  assert.equal(historyMetricValue(provider,"top10"),8);
});

test("Organic History chart handles flat and changing series without NaN coordinates", () => {
  const flat=buildHistoryChartPoints([{period:"2026-08",organic_traffic:10},{period:"2026-09",organic_traffic:10}],"traffic");
  assert.equal(flat.rows.length,2);
  assert.ok(flat.path.startsWith("M"));
  assert.doesNotMatch(flat.path,/NaN/);

  const changing=buildHistoryChartPoints([{period:"2026-08",organic_keywords:10},{period:"2026-09",organic_keywords:20}],"keywords");
  assert.equal(changing.min,10);
  assert.equal(changing.max,20);
  assert.doesNotMatch(changing.path,/NaN/);
});

test("Organic History panel clearly separates free Project History from explicit Provider History", () => {
  const markup=organicHistoryPanelMarkup();
  assert.match(markup,/Project History 来自 SEO Pro V2/);
  assert.match(markup,/Load Project History · \$0/);
  assert.match(markup,/Load Provider History/);
  assert.match(markup,/30 天兼容缓存/);
  assert.match(markup,/允许本次付费请求/);
});
