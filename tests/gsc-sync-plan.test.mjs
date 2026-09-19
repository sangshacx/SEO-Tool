import assert from "node:assert/strict";
import test from "node:test";
import { defaultGscSyncDate, normalizeGscSyncRequest } from "../src/v2/gsc/sync-plan.js";

test("GSC sync defaults to finalized data three days ago and bounded high-value dimensions", () => {
  const now=new Date("2026-09-19T02:00:00.000Z");
  assert.equal(defaultGscSyncDate(now),"2026-09-16");
  assert.deepEqual(normalizeGscSyncRequest({},now),{
    target_date:"2026-09-16",
    dimension_sets:["query","page","query_page"],
    row_limit_per_set:2500,
  });
});

test("GSC sync validates dimension sets and bounded row caps", () => {
  const now=new Date("2026-09-19T02:00:00.000Z");
  assert.deepEqual(normalizeGscSyncRequest({
    target_date:"2026-09-10",
    dimension_sets:["device","country","device"],
    row_limit_per_set:5000,
  },now).dimension_sets,["device","country"]);
  assert.throws(()=>normalizeGscSyncRequest({dimension_sets:["bad"]},now),/supported/);
  assert.throws(()=>normalizeGscSyncRequest({row_limit_per_set:25000},now),/1000, 2500, or 5000/);
  assert.throws(()=>normalizeGscSyncRequest({target_date:"2026-09-19"},now),/before today/);
});
