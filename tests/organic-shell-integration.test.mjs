import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shell = await readFile(new URL("../public/v2-shell.js", import.meta.url), "utf8");
const organic = await readFile(new URL("../public/v2-organic-intelligence.js", import.meta.url), "utf8");
const historyUi = await readFile(new URL("../public/v2-organic-history-ui.js", import.meta.url), "utf8");
const opportunityUi = await readFile(new URL("../public/v2-organic-opportunity-ui.js", import.meta.url), "utf8");

test("V2 shell creates and mounts Organic Intelligence after market context is ready", () => {
  assert.match(shell, /createOrganicIntelligenceWorkspace/);
  assert.match(shell, /mountOrganicIntelligence/);
  assert.match(shell, /content\.prepend\(createOrganicIntelligenceWorkspace\(\)\)/);
  assert.match(shell, /mountOrganicIntelligence\(\{ root: shell, context, fetchImpl \}\)/);
});

test("Organic Intelligence uses the dedicated API and explicit live-request confirmation", () => {
  assert.match(organic, /\/api\/v2\/organic\/keywords/);
  assert.match(organic, /allow_live_request:allowPaid\.checked/);
  assert.match(organic, /LIVE_REQUEST_CONFIRMATION_REQUIRED/);
  assert.match(organic, /Organic Keywords 已读取：缓存命中，本次费用 \$0/);
});


test("Organic Intelligence exposes Top Pages and reuses page URLs for keyword drilldown", () => {
  assert.match(organic, /\/api\/v2\/organic\/pages/);
  assert.match(organic, /data-v2-organic-tab="pages"/);
  assert.match(organic, /data-v2-organic-page-url/);
  assert.match(organic, /target\.value=button\.dataset\.v2OrganicPageUrl/);
  assert.match(organic, /activateTab\(section,"keywords"\);load\(\)/);
});


test("Organic Intelligence exposes Latest Position Changes with explicit cost guard", () => {
  assert.match(organic, /\/api\/v2\/organic\/changes/);
  assert.match(organic, /data-v2-organic-tab="changes"/);
  assert.match(organic, /Latest Position Changes/);
  assert.match(organic, /latest_provider_update|Provider update/);
  assert.match(organic, /LIVE_REQUEST_CONFIRMATION_REQUIRED/);
});


test("Organic Intelligence exposes competitor discovery and handoffs to Site Explorer and Keyword Gap", () => {
  assert.match(organic, /\/api\/v2\/organic\/competitors/);
  assert.match(organic, /data-v2-organic-tab="competitors"/);
  assert.match(organic, /Keyword Similarity = Shared Keywords/);
  assert.match(organic, /data-v2-analyze-competitor/);
  assert.match(organic, /data-v2-competitor-gap/);
  assert.match(organic, /gapCompetitorDomain/);
});


test("Organic Intelligence mounts Project and Provider Organic History as one controlled workspace", () => {
  assert.match(organic, /v2-organic-history-ui\.js/);
  assert.match(organic, /data-v2-organic-tab="history"/);
  assert.match(organic, /organicHistoryPanelMarkup/);
  assert.match(organic, /mountOrganicHistoryTab/);
  assert.match(historyUi, /\/api\/v2\/organic\/history/);
  assert.match(historyUi, /Load Project History · \$0/);
  assert.match(historyUi, /allow_live_request: allowPaid\.checked/);
  assert.match(historyUi, /LIVE_REQUEST_CONFIRMATION_REQUIRED/);
  assert.match(historyUi, /30 天缓存/);
});


test("Organic Intelligence mounts a cache-only Opportunity Center with page and keyword handoffs", () => {
  assert.match(organic, /v2-organic-opportunity-ui\.js/);
  assert.match(organic, /data-v2-organic-tab="opportunities"/);
  assert.match(organic, /organicOpportunityPanelMarkup/);
  assert.match(organic, /mountOrganicOpportunityTab/);
  assert.match(opportunityUi, /\/api\/v2\/organic\/opportunities/);
  assert.match(opportunityUi, /Cache-only decision layer · \$0/);
  assert.doesNotMatch(opportunityUi, /allow_live_request/);
  assert.match(opportunityUi, /data-v2-opportunity-page/);
  assert.match(opportunityUi, /data-v2-opportunity-keyword/);
});
