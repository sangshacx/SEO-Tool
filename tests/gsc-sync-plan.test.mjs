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
    backfill_days:1,
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


test("GSC multi-day backfill is bounded to seven days and 1,000 rows per set", async () => {
  const { gscSyncDates } = await import("../src/v2/gsc/sync-plan.js");
  const now=new Date("2026-09-19T02:00:00.000Z");
  const plan=normalizeGscSyncRequest({
    target_date:"2026-09-16",
    dimension_sets:["query","page","query_page"],
    row_limit_per_set:1000,
    backfill_days:7,
  },now);
  assert.equal(plan.backfill_days,7);
  assert.deepEqual(gscSyncDates(plan.target_date,plan.backfill_days),[
    "2026-09-10","2026-09-11","2026-09-12","2026-09-13","2026-09-14","2026-09-15","2026-09-16",
  ]);
  assert.throws(()=>normalizeGscSyncRequest({backfill_days:14},now),/1, 3, or 7/);
  assert.throws(()=>normalizeGscSyncRequest({backfill_days:7,row_limit_per_set:2500},now),/capped at 1,000/);
});
