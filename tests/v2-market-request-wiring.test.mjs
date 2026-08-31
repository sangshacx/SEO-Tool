import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { createMarketContext } from "../public/v2-market-context.js";
import {
  SEO_RESEARCH_ENDPOINTS,
  createMarketInitializationCoordinator,
  persistSiteMarket,
  setResearchControlsReady,
  submitSeoResearchRequest,
} from "../public/v2-shell.js";

const html = await readFile(new URL("../public/v2.html", import.meta.url), "utf8");
const shellSource = await readFile(new URL("../public/v2-shell.js", import.meta.url), "utf8");

function installSynchronousGate(windowLike) {
  const source = html.match(/<script data-v2-market-gate>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(source, "synchronous market gate bootstrap is missing");
  new Function("window", source)(windowLike);
  return windowLike.__seoProV2ResearchGate;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function response(data = {}) {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { "content-type": "application/json" } });
}

function fetchSpy() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined });
    return response({ domain: options.body ? JSON.parse(options.body).domain : undefined });
  };
  return { calls, fetchImpl };
}

const workflows = [
  ["keywordOverview", { keyword: "waterproof membrane" }],
  ["keywordIdeas", { seed_keyword: "waterproof membrane", limit: 25 }],
  ["serpWeakness", { keyword: "waterproof membrane" }],
  ["seoOpportunity", { keyword: "waterproof membrane" }],
  ["competitorSnapshot", { domain: "competitor.example" }],
  ["keywordGap", { own_domain: "own.example", competitor_domain: "competitor.example" }],
];

test("executes all six submit paths with the current non-US market and preserves workflow fields", async () => {
  const context = createMarketContext({ location_code: 2840, language_code: "en" });
  const spy = fetchSpy();

  for (const [index, [workflow, fields]] of workflows.entries()) {
    const market = index === workflows.length - 1
      ? { location_code: 2702, language_code: "zh-CN" }
      : { location_code: 2682, language_code: "ar" };
    context.set(market);
    const original = structuredClone(fields);
    await submitSeoResearchRequest(workflow, fields, { context, fetchImpl: spy.fetchImpl });
    assert.deepEqual(fields, original, `${workflow} input was mutated`);
  }

  assert.equal(spy.calls.length, 6);
  workflows.forEach(([workflow, fields], index) => {
    const call = spy.calls[index];
    assert.equal(call.url, SEO_RESEARCH_ENDPOINTS[workflow]);
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.headers["Content-Type"], "application/json");
    assert.deepEqual(call.body, {
      ...fields,
      location_code: index === workflows.length - 1 ? 2702 : 2682,
      language_code: index === workflows.length - 1 ? "zh-CN" : "ar",
    });
  });
});

test("site and market switching may persist to sites but cannot call research before submit", async () => {
  const context = createMarketContext({ domain: "own.example", location_code: 2840, language_code: "en" });
  const spy = fetchSpy();
  const researchUrls = new Set(Object.values(SEO_RESEARCH_ENDPOINTS));

  context.set({ domain: "other.example", location_code: 2682, language_code: "ar" });
  await persistSiteMarket(spy.fetchImpl, "other.example", context.get());

  assert.equal(spy.calls.length, 1);
  assert.equal(spy.calls[0].url, "/api/v2/sites");
  assert.equal(spy.calls[0].options.method, "PATCH");
  assert.deepEqual(spy.calls[0].body, { domain: "other.example", location_code: 2682, language_code: "ar" });
  assert.equal(spy.calls.some((call) => researchUrls.has(call.url)), false);

  await submitSeoResearchRequest("keywordOverview", { keyword: "waterproofing" }, { context, fetchImpl: spy.fetchImpl });
  assert.equal(spy.calls.length, 2);
  assert.equal(spy.calls[1].url, "/api/v2/keywords/overview");
  assert.equal(spy.calls.filter((call) => researchUrls.has(call.url)).length, 1);
  assert.deepEqual(spy.calls[1].body, { keyword: "waterproofing", location_code: 2682, language_code: "ar" });
});

test("supplemental source guard keeps every page workflow on the shared submit helper", () => {
  for (const workflow of Object.keys(SEO_RESEARCH_ENDPOINTS)) {
    assert.match(html, new RegExp(`submitSeoResearchRequest\\(["']${workflow}["']`));
  }
  const guardedWorkflows = [...html.matchAll(/data-v2-market-research="([^"]+)" disabled/g)]
    .flatMap((match) => match[1].split(/\s+/))
    .sort();
  assert.deepEqual(guardedWorkflows, Object.keys(SEO_RESEARCH_ENDPOINTS).sort());
  assert.doesNotMatch(html, /language_code\s*:\s*["']en["']/);
  assert.doesNotMatch(shellSource, /seo-pro-v2\.seo-tool-dme\.pages\.dev/);
});

test("delayed market initialization blocks early research then enables the resolved market exactly once", async () => {
  const windowLike = {};
  const gate = installSynchronousGate(windowLike);
  const spy = fetchSpy();
  const pending = deferred();
  const controls = workflows.map(([workflow]) => ({ disabled: false, dataset: { v2MarketResearch: workflow } }));
  const root = { querySelectorAll: () => controls };
  setResearchControlsReady(root, false);

  const coordinator = createMarketInitializationCoordinator({
    initialize: () => pending.promise,
    onReady: ({ context }) => {
      gate.ready = true;
      gate.submit = (workflow, fields) => submitSeoResearchRequest(workflow, fields, { context, fetchImpl: spy.fetchImpl });
      setResearchControlsReady(root, true);
    },
    onFailure() {},
  });
  const loading = coordinator.start();

  await assert.rejects(windowLike.submitSeoResearchRequest("keywordOverview", { keyword: "early" }), (error) => error.code === "MARKET_CONTEXT_NOT_READY");
  assert.equal(spy.calls.length, 0);
  assert.equal(controls.every((control) => control.disabled), true);

  const context = createMarketContext({ location_code: 2682, language_code: "ar" });
  pending.resolve({ context });
  await loading;
  assert.equal(controls.every((control) => !control.disabled), true);

  await windowLike.submitSeoResearchRequest("keywordOverview", { keyword: "ready" });
  assert.equal(spy.calls.length, 1);
  assert.equal(spy.calls[0].url, SEO_RESEARCH_ENDPOINTS.keywordOverview);
  assert.deepEqual(spy.calls[0].body, { keyword: "ready", location_code: 2682, language_code: "ar" });
});

test("catalog failure remains blocked with actionable retry and retry success does not duplicate initialization", async () => {
  const windowLike = {};
  const gate = installSynchronousGate(windowLike);
  const spy = fetchSpy();
  const controls = workflows.map(([workflow]) => ({ disabled: false, dataset: { v2MarketResearch: workflow } }));
  const root = { querySelectorAll: () => controls };
  const warning = { textContent: "" };
  const retry = { hidden: true };
  let attempts = 0;
  const context = createMarketContext({ location_code: 2702, language_code: "zh-CN" });

  const coordinator = createMarketInitializationCoordinator({
    initialize: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("MARKET_CATALOG_UNAVAILABLE");
      return { context };
    },
    onReady: ({ context: readyContext }) => {
      gate.ready = true;
      gate.submit = (workflow, fields) => submitSeoResearchRequest(workflow, fields, { context: readyContext, fetchImpl: spy.fetchImpl });
      setResearchControlsReady(root, true);
      retry.hidden = true;
    },
    onFailure: () => {
      gate.ready = false;
      setResearchControlsReady(root, false);
      warning.textContent = "关键词市场目录加载失败，请检查网络后重试加载市场。";
      retry.hidden = false;
    },
  });

  await assert.rejects(coordinator.start(), /MARKET_CATALOG_UNAVAILABLE/);
  assert.equal(controls.every((control) => control.disabled), true);
  assert.match(warning.textContent, /重试加载市场/);
  assert.equal(retry.hidden, false);
  assert.equal(spy.calls.length, 0);

  const [firstRetry, duplicateRetry] = await Promise.all([coordinator.retry(), coordinator.retry()]);
  assert.equal(firstRetry.context, context);
  assert.equal(duplicateRetry.context, context);
  assert.equal(attempts, 2);
  assert.equal(controls.every((control) => !control.disabled), true);

  await windowLike.submitSeoResearchRequest("keywordGap", { own_domain: "own.example", competitor_domain: "other.example" });
  assert.equal(spy.calls.length, 1);
  assert.equal(spy.calls[0].url, SEO_RESEARCH_ENDPOINTS.keywordGap);
  assert.deepEqual(spy.calls[0].body, { own_domain: "own.example", competitor_domain: "other.example", location_code: 2702, language_code: "zh-CN" });
});
