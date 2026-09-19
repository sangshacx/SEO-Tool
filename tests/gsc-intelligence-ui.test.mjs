import assert from "node:assert/strict";
import test from "node:test";
import { gscCoverageLabel, gscPerformancePanelMarkup } from "../public/v2-gsc-intelligence-ui.js";

test("GSC Performance UI makes stored coverage explicit", () => {
  assert.equal(gscCoverageLabel({current_days:3,previous_days:2,requested_days:28}),"3 / 28 current days · 2 / 28 comparison days");
  assert.equal(gscCoverageLabel({}),"No stored coverage");
});

test("GSC Performance is D1-first and sync is explicit", () => {
  const markup=gscPerformancePanelMarkup();
  assert.match(markup,/页面打开只读 D1/);
  assert.match(markup,/Sync latest finalized day · \$0/);
  assert.match(markup,/Backfill 7 missing days · \$0/);
  assert.match(markup,/Queries/);
  assert.match(markup,/Pages/);
  assert.match(markup,/Stored Coverage/);
  assert.match(markup,/GSC Settings/);
});
