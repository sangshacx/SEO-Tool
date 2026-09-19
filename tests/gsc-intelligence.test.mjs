import assert from "node:assert/strict";
import test from "node:test";
import { enrichGscIntelligenceRows, summarizeGscStoredMetrics } from "../src/v2/gsc/intelligence.js";

test("GSC query intelligence converts real visibility into transparent actions", () => {
  const rows=enrichGscIntelligenceRows([
    {primary_key:"waterproof membrane",clicks:20,impressions:1000,position:7,previous_clicks:10,previous_impressions:800},
    {primary_key:"brand",clicks:50,impressions:100,position:2,previous_clicks:45,previous_impressions:100},
    {primary_key:"roof coating supplier",clicks:20,impressions:200,position:12,previous_clicks:18,previous_impressions:190},
  ],{view:"queries",comparisonAvailable:true});
  assert.equal(rows[0].action.code,"ctr_opportunity");
  assert.equal(rows[0].ctr,0.02);
  assert.equal(rows[0].change.clicks_percent,100);
  assert.equal(rows[1].action.code,"protect");
  assert.equal(rows[2].action.code,"quick_win");
});

test("GSC page intelligence uses stored period comparison only when comparison exists", () => {
  const rows=enrichGscIntelligenceRows([
    {primary_key:"https://example.com/page/",clicks:80,impressions:1000,position:6,previous_clicks:120,previous_impressions:1100},
  ],{view:"pages",comparisonAvailable:true});
  assert.equal(rows[0].action.code,"recover");
  assert.ok(rows[0].change.clicks_percent<0);

  const noCompare=enrichGscIntelligenceRows([
    {primary_key:"https://example.com/page/",clicks:80,impressions:1000,position:6,previous_clicks:0,previous_impressions:0},
  ],{view:"pages",comparisonAvailable:false});
  assert.equal(noCompare[0].change.clicks_percent,null);
});

test("GSC summary exposes comparison coverage rather than pretending a partial period is complete", () => {
  const partial=summarizeGscStoredMetrics({clicks:10,impressions:100,position:7},{current_days:2,previous_days:2,requested_days:28});
  assert.equal(partial.ctr,0.1);
  assert.equal(partial.comparison_available,true);
  assert.equal(partial.comparison_complete,false);
  const complete=summarizeGscStoredMetrics({clicks:10,impressions:100,position:7},{current_days:28,previous_days:28,requested_days:28});
  assert.equal(complete.comparison_complete,true);
});
