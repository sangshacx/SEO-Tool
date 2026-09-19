import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { organicOpportunityPanelMarkup, summarizeOpportunityCounts } from "../public/v2-organic-opportunity-ui.js";

const opportunityUiSource = await readFile(new URL("../public/v2-organic-opportunity-ui.js", import.meta.url), "utf8");

test("Opportunity Center UI keeps the decision layer explicitly cache-only", () => {
  const markup=organicOpportunityPanelMarkup();
  assert.match(markup,/Opportunity Center/);
  assert.match(markup,/固定 \$0/);
  assert.match(markup,/Recalculate · \$0/);
  assert.match(markup,/Organic Keywords/);
  assert.match(markup,/Top Pages/);
  assert.doesNotMatch(markup,/allow_live_request/);
});

test("Opportunity Center summary groups recovery and growth actions without hiding raw engine actions", () => {
  const counts=summarizeOpportunityCounts({summary:{total_pages:8,action_counts:{optimize:3,recover:1,reclaim:1,scale:2,protect:1}}});
  assert.deepEqual(counts,{total:8,optimize:3,recover:2,growth:3});
});


test("Opportunity Center surfaces optional GSC evidence and its score adjustment", () => {
  const markup=organicOpportunityPanelMarkup();
  assert.match(markup,/data-v2-opportunity-source="gsc_pages"/);
  assert.match(markup,/Open GSC Performance/);
  assert.match(markup,/GSC Reality/);
  assert.match(markup,/没有 GSC 时保持原基础分/);
});


test("Opportunity Center distinguishes DataForSEO and real GSC query quick wins", () => {
  const markup=organicOpportunityPanelMarkup();
  assert.match(markup,/GSC Performance/);
  assert.match(opportunityUiSource,/DFS /);
  assert.match(opportunityUiSource,/GSC /);
  assert.match(opportunityUiSource,/gsc_query_opportunities/);
  assert.match(opportunityUiSource,/provider_match/);
  assert.match(opportunityUiSource,/Research QW/);
});
