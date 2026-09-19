import assert from "node:assert/strict";
import test from "node:test";

import { buildOrganicPositionChanges, classifyOrganicPositionChange } from "../src/v2/organic/organic-position-changes.js";

test("Position Changes classification prioritizes lost then new/up/down", () => {
  assert.equal(classifyOrganicPositionChange({movement:{is_lost:true,is_up:true}}).code,"lost");
  assert.equal(classifyOrganicPositionChange({movement:{is_new:true}}).code,"new");
  assert.equal(classifyOrganicPositionChange({movement:{is_up:true}}).code,"improved");
  assert.equal(classifyOrganicPositionChange({movement:{is_down:true}}).code,"declined");
  assert.equal(classifyOrganicPositionChange({movement:{}}).code,"stable");
});

test("Position Changes exposes aggregate and returned-sample counts separately", () => {
  const data=buildOrganicPositionChanges({
    organic:{changes:{new:20,up:40,down:15,lost:8}},
    update_window:{previous_updated_at:"2026-09-05T00:00:00.000Z",last_updated_at:"2026-09-12T00:00:00.000Z"},
    items:[
      {keyword:"a",movement:{is_new:true}},
      {keyword:"b",movement:{is_up:true}},
      {keyword:"c",movement:{is_down:true}},
      {keyword:"d",movement:{is_lost:true}},
    ],
  });
  assert.deepEqual(data.change_summary.aggregate,{new:20,improved:40,declined:15,lost:8});
  assert.deepEqual(data.change_summary.returned,{new:1,improved:1,declined:1,lost:1,stable:0});
  assert.equal(data.change_window.semantics,"latest_provider_update");
});
