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


test("Decision Queue distinguishes visible Top 5 from active candidates and hidden workflow items", () => {
  const markup=organicOpportunityPanelMarkup();
  assert.match(markup,/data-v2-action-queue-count/);
  assert.match(markup,/data-v2-action-queue-candidates/);
  assert.match(markup,/data-v2-action-queue-hidden/);
  assert.match(markup,/active candidates/);
  assert.match(markup,/hidden/);
  assert.match(opportunityUiSource,/workflow_summary\?\.active_candidates/);
  assert.match(opportunityUiSource,/workflow_summary\?\.suppressed/);
});


test("Opportunity Center renders recent D1 workflow activity without another external request", () => {
  const markup=organicOpportunityPanelMarkup();
  assert.match(markup,/RECENT WORKFLOW ACTIVITY/);
  assert.match(markup,/data-v2-workflow-activity-count/);
  assert.match(markup,/data-v2-workflow-activity-body/);
  assert.match(markup,/D1 only · \$0/);
  assert.match(opportunityUiSource,/workflow_activity/);
  assert.match(opportunityUiSource,/event\.from_status/);
  assert.match(opportunityUiSource,/event\.to_status/);
  assert.match(opportunityUiSource,/from\+" → "\+to/);
  assert.match(opportunityUiSource,/v2-workflow-transition/);
  assert.match(opportunityUiSource,/events\.slice\(0,10\)/);
});


test("Opportunity Center shows zero-cost SEO workflow execution statistics", () => {
  const markup=organicOpportunityPanelMarkup();
  assert.match(markup,/Completed · 7d/);
  assert.match(markup,/Started · 7d/);
  assert.match(markup,/In Progress/);
  assert.match(markup,/Snoozed/);
  assert.match(markup,/Completed · 30d/);
  for(const key of ["completed_7d","started_7d","in_progress","snoozed","completed_30d"]){
    assert.match(markup,new RegExp('data-v2-workflow-stat="'+key+'"'));
  }
  assert.match(opportunityUiSource,/workflow_stats/);
  assert.match(opportunityUiSource,/last_7_days/);
  assert.match(opportunityUiSource,/last_30_days/);
});


test("Workflow tasks support editable notes and preserve notes on ordinary status changes", () => {
  const markup=organicOpportunityPanelMarkup();
  assert.match(markup,/<th>Note<\/th>/);
  assert.match(opportunityUiSource,/Add Note/);
  assert.match(opportunityUiSource,/Edit Note/);
  assert.match(opportunityUiSource,/Save Note/);
  assert.match(opportunityUiSource,/data-v2-workflow-note-input/);
  assert.match(opportunityUiSource,/data-v2-workflow-note-save/);
  assert.match(opportunityUiSource,/Object\.hasOwn\(extra,"note"\)/);
  assert.match(opportunityUiSource,/payload\.note=extra\.note/);
  assert.match(opportunityUiSource,/note updated/);
});


test("editing a Snoozed workflow note preserves the existing snooze deadline", () => {
  assert.match(opportunityUiSource,/v2WorkflowSnoozeUntil/);
  assert.match(opportunityUiSource,/Object\.hasOwn\(extra,"note"\).*v2WorkflowSnoozeUntil/s);
  assert.match(opportunityUiSource,/button\.dataset\.v2WorkflowSnoozeUntil/);
  assert.match(opportunityUiSource,/new Date\(Date\.now\(\)\+7\*86400000\)/);
});


test("Opportunity Center renders observational GSC Outcome Validation for completed actions", () => {
  const markup=organicOpportunityPanelMarkup();
  assert.match(markup,/OUTCOME VALIDATION/);
  assert.match(markup,/data-v2-workflow-outcome-ready/);
  assert.match(markup,/data-v2-workflow-outcome-total/);
  assert.match(markup,/data-v2-workflow-outcomes-body/);
  assert.match(markup,/observational only/);
  assert.match(markup,/不证明这些变化由该 SEO 动作造成/);
  assert.match(opportunityUiSource,/workflow_outcomes/);
  assert.match(opportunityUiSource,/waiting_for_post_data/);
  assert.match(opportunityUiSource,/collecting_post_data/);
  assert.match(opportunityUiSource,/page_fallback/);
  assert.match(opportunityUiSource,/position_improvement/);
});


test("architecture overlap tasks hand off directly to the GSC Potential Cannibalization view", () => {
  assert.match(opportunityUiSource,/Open GSC Overlap/);
  assert.match(opportunityUiSource,/data-v2-opportunity-gsc-overlap/);
  assert.match(opportunityUiSource,/activateTab\?\.\(section,"gsc"\)/);
  assert.match(opportunityUiSource,/data-v2-gsc-performance-view="cannibalization"/);
  assert.match(opportunityUiSource,/review_cannibalization/);
});


test("Opportunity Center exposes AI History as optional zero-cost D1 evidence", () => {
  const markup=organicOpportunityPanelMarkup();
  assert.match(markup,/data-v2-opportunity-source="ai_visibility"/);
  assert.match(markup,/AI History/);
  assert.match(markup,/Open AI Visibility/);
  assert.match(opportunityUiSource,/source === "ai_visibility"/);
  assert.match(opportunityUiSource,/Ready · D1/);
  assert.match(opportunityUiSource,/AI History ready · D1/);
});

test("AI recovery tasks route to AI Visibility instead of pretending the workflow label is a keyword", () => {
  assert.match(opportunityUiSource,/dataforseo_ai_history/);
  assert.match(opportunityUiSource,/AI History · D1/);
  assert.match(opportunityUiSource,/ai_visibility_recovery/);
  assert.match(opportunityUiSource,/v2OpportunityAiVisibility/);
  assert.match(opportunityUiSource,/Open AI Visibility/);
  assert.match(opportunityUiSource,/globalThis\.location\.hash="ai-visibility"/);
  assert.match(opportunityUiSource,/\["dataforseo_ai_history","ai_prompt_tracker_d1"\]\.includes\(item\.query_source\)|\["dataforseo_ai_history", "ai_prompt_tracker_d1"\]\.includes\(item\.query_source\)/);
  assert.match(opportunityUiSource,/nextBestOpenPage\.hidden = aiWorkspace/);
});


test("Opportunity Center exposes Prompt Tracker D1 evidence and routes Prompt loss actions to AI Visibility", () => {
  const markup=organicOpportunityPanelMarkup();
  assert.match(markup,/data-v2-opportunity-source="ai_prompt_tracker"/);
  assert.match(markup,/Prompt Tracker/);
  assert.match(markup,/Open Prompt Tracker/);
  assert.match(opportunityUiSource,/source === "ai_prompt_tracker"/);
  assert.match(opportunityUiSource,/Prompt Tracker ready · D1/);
  assert.match(opportunityUiSource,/ai_prompt_tracker_d1/);
  assert.match(opportunityUiSource,/ai_prompt_recovery/);
  assert.match(opportunityUiSource,/Prompt Tracker · D1/);
  assert.match(opportunityUiSource,/\["dataforseo_ai_history","ai_prompt_tracker_d1"\]|\["dataforseo_ai_history", "ai_prompt_tracker_d1"\]/);
  assert.match(opportunityUiSource,/Open AI Visibility/);
});
