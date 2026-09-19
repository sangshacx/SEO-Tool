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


test("Opportunity Center exposes a unified transparent Next Best Action card", () => {
  const markup=organicOpportunityPanelMarkup();
  assert.match(markup,/#1 NEXT BEST ACTION/);
  assert.match(markup,/data-v2-next-best-action-score/);
  assert.match(markup,/data-v2-next-best-action-page/);
  assert.match(markup,/data-v2-next-best-action-query/);
  assert.match(markup,/data-v2-next-best-action-source/);
  assert.match(markup,/Open Page Keywords/);
  assert.match(markup,/Research Recommended Query/);
  assert.match(opportunityUiSource,/next_best_action/);
  assert.match(opportunityUiSource,/gsc_query_page/);
  assert.match(opportunityUiSource,/dataforseo_cache/);
});


test("Opportunity Center renders a Top 5 actionable queue separately from the full page table", () => {
  const markup=organicOpportunityPanelMarkup();
  assert.match(markup,/TOP ACTION QUEUE/);
  assert.match(markup,/data-v2-action-queue-count/);
  assert.match(markup,/data-v2-action-queue-body/);
  assert.match(markup,/Monitor 已排除/);
  assert.match(opportunityUiSource,/action_queue/);
  assert.match(opportunityUiSource,/v2-action-queue-workstream/);
  assert.match(opportunityUiSource,/data-v2-opportunity-page/);
  assert.match(opportunityUiSource,/data-v2-opportunity-keyword/);
});


test("Opportunity Center exposes zero-cost persistent workflow controls without live-provider flags", () => {
  const markup=organicOpportunityPanelMarkup();
  assert.match(markup,/<th>Workflow<\/th>/);
  assert.match(opportunityUiSource,/\/api\/v2\/organic\/action-workflow/);
  assert.match(opportunityUiSource,/data-v2-workflow-status/);
  assert.match(opportunityUiSource,/Start/);
  assert.match(opportunityUiSource,/Snooze 7d/);
  assert.match(opportunityUiSource,/Reopen/);
  assert.match(opportunityUiSource,/7\*86400000/);
  assert.match(opportunityUiSource,/只写 D1，本次费用 \$0/);
  assert.doesNotMatch(opportunityUiSource,/allow_live_request/);
  assert.doesNotMatch(opportunityUiSource,/provider_requests\s*:/);
});
