import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DASHBOARD_EMPTY_TREND_COPY,
  buildDashboardRequestUrl,
  createDashboardLoader,
  dashboardDetailRoute,
  formatDashboardDelta,
  formatDashboardMetric,
  formatDashboardScope,
  limitDashboardRows,
  mountDashboard,
  renderDashboard,
  selectDashboardTrendPoints,
  trendState,
} from "../public/v2-dashboard.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.className = "";
    this.hidden = false;
    this.parentNode = null;
    this.id = "";
    this.href = "";
    this.type = "";
    this._text = "";
  }

  set textContent(value) {
    this._text = value == null ? "" : String(value);
    this.children = [];
  }

  get textContent() {
    return [this._text, ...this.children.map((child) => child.textContent)].join("");
  }

  append(...children) {
    children.filter((child) => child !== null && child !== undefined).forEach((child) => {
      if (child instanceof FakeElement) {
        child.parentNode = this;
        this.children.push(child);
        return;
      }
      const textNode = new FakeElement("#text");
      textNode._text = String(child);
      textNode.parentNode = this;
      this.children.push(textNode);
    });
  }

  replaceChildren(...children) {
    this._text = "";
    this.children = [];
    this.append(...children);
  }

  addEventListener(type, handler) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), handler]);
  }

  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== handler));
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  dispatchEvent(event = {}) {
    const nextEvent = { ...event, target: event.target || this };
    let result = true;
    for (const handler of this.listeners.get(nextEvent.type) || []) result = handler(nextEvent);
    return result;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "id") this.id = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  querySelector(selector) {
    return walk(this).find((node) => matches(node, selector)) || null;
  }

  querySelectorAll(selector) {
    return walk(this).filter((node) => matches(node, selector));
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matches(current, selector)) return current;
      current = current.parentNode;
    }
    return null;
  }
}

function walk(node) {
  return node.children.flatMap((child) => [child, ...walk(child)]);
}

function datasetKey(selector) {
  return selector
    .slice(6, -1)
    .split("-")
    .map((part, index) => (index ? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}` : part))
    .join("");
}

function matches(node, selector) {
  if (selector.startsWith("#")) return node.id === selector.slice(1);
  if (selector.startsWith(".")) return node.className.split(/\s+/).includes(selector.slice(1));
  if (selector.startsWith("[data-")) return Object.hasOwn(node.dataset, datasetKey(selector));
  return node.tagName === selector.toUpperCase();
}

function withFakeDocument(run) {
  const previous = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createElementNS: (_namespace, tagName) => new FakeElement(tagName),
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.document = previous;
    });
}

function dashboardScope(domain = "example.com") {
  return {
    domain,
    site: domain,
    location_code: 2840,
    location_name: "United States",
    language_code: "en",
    language_name: "English",
  };
}

function dashboardPayload(scope = dashboardScope()) {
  return {
    data: {
      meta: { updated_at: "2026-08-31T12:00:00.000Z" },
      warnings: ["stale organic snapshot"],
      modules: {
        organic: {
          availability: "available",
          source: "d1",
          updated_at: "2026-08-31T12:00:00.000Z",
          scope,
          previous_snapshot: { organic_traffic: 90, organic_keywords: 190, traffic_value: 12 },
          data: {
            organic_traffic: 120,
            organic_keywords: 240,
            traffic_value: 18,
            trends: {
              organic: [
                { captured_at: "2026-08-01T00:00:00.000Z", organic_traffic: 90, organic_keywords: 180 },
                { captured_at: "2026-08-31T00:00:00.000Z", organic_traffic: 120, organic_keywords: 240 },
              ],
            },
          },
        },
        backlinks: {
          availability: "available",
          source: "d1",
          updated_at: "2026-08-31T11:00:00.000Z",
          scope,
          previous_snapshot: { domain_rank: 40, backlinks: 200, referring_domains: 20 },
          data: {
            domain_rank: 48,
            backlinks: 301,
            referring_domains: 44,
            trends: {
              backlinks: [
                { captured_at: "2026-08-01T00:00:00.000Z", backlinks: 220, referring_domains: 30 },
                { captured_at: "2026-08-31T00:00:00.000Z", backlinks: 301, referring_domains: 44 },
              ],
            },
          },
        },
        top_keywords: {
          availability: "available",
          source: "d1",
          updated_at: "2026-08-31T12:00:00.000Z",
          scope,
          data: {
            rows: [{ keyword: "waterproof membrane", position: 3, search_volume: 880, estimated_traffic: 30, keyword_difficulty: 12, cpc_usd: 1.2, ranking_url: "https://example.com/page" }],
          },
        },
        competitors: {
          availability: "available",
          source: "kv_cache",
          updated_at: "2026-08-31T10:00:00.000Z",
          scope,
          data: {
            rows: [{ domain: "rival.example", ranked_keywords: 210, shared_keywords: null, competitor_only_keywords: 18, estimated_traffic: 999, keyword_gap: 18, backlink_gap: 7 }],
          },
        },
        keyword_opportunities: {
          availability: "available",
          source: "kv_cache",
          updated_at: "2026-08-31T10:00:00.000Z",
          scope,
          data: {
            rows: [{ keyword: "roof coating", title: "roof coating", priority: 77 }],
          },
        },
        backlink_opportunities: {
          availability: "available",
          source: "d1",
          updated_at: "2026-08-31T09:00:00.000Z",
          scope,
          data: {
            items: [{ referring_domain: "partner.example", opportunity_label: "High", status: "new", quality_score: 70 }],
          },
        },
        backlink_gap: {
          availability: "available",
          source: "kv_cache",
          updated_at: "2026-08-31T08:00:00.000Z",
          scope,
          data: {
            rows: [{ domain: "gap-source.example", competitor_domain: "rival.example", opportunity_score: 88 }],
          },
        },
        backlink_history: {
          availability: "available",
          source: "d1",
          updated_at: "2026-08-31T11:00:00.000Z",
          scope,
          data: {
            alerts: [{ code: "BACKLINKS_LOST", label: "Lost links", detail: "2 domains dropped" }],
          },
        },
        workflow: {
          availability: "available",
          source: "d1",
          updated_at: "2026-08-31T09:00:00.000Z",
          scope,
          data: {
            recent_items: [{ referring_domain: "follow-up.example", status: "researching" }],
          },
        },
      },
    },
  };
}

function dashboardHarness() {
  const root = new FakeElement("div");
  const dashboard = new FakeElement("section");
  dashboard.dataset.v2Dashboard = "";
  const title = new FakeElement("h1");
  title.id = "v2DashboardSite";
  const updated = new FakeElement("p");
  updated.dataset.v2DashboardUpdated = "";
  const status = new FakeElement("p");
  status.dataset.v2DashboardStatus = "";
  const warning = new FakeElement("p");
  warning.dataset.v2DashboardWarning = "";
  const refresh = new FakeElement("button");
  refresh.dataset.v2DashboardRefresh = "";
  const retry = new FakeElement("button");
  retry.dataset.v2DashboardRetry = "";
  retry.hidden = true;
  const body = new FakeElement("div");
  body.dataset.v2DashboardBody = "";
  dashboard.append(title, updated, status, warning, refresh, retry, body);
  root.append(dashboard);
  return { root, dashboard, title, updated, status, warning, refresh, retry, body };
}

test("distinguishes unavailable metrics from an explicitly sourced zero", () => {
  assert.equal(formatDashboardMetric({ availability: "unavailable" }, "traffic"), "暂无数据");
  assert.equal(formatDashboardMetric({ availability: "available", data: { traffic: 0 } }, "traffic"), "0");
  assert.equal(formatDashboardMetric({ availability: "available", data: { traffic: 12345 } }, "traffic"), "12,345");
});

test("formats sourced scope, freshness, and previous snapshot deltas", () => {
  const module = {
    source: "d1",
    updated_at: "2026-08-30T12:00:00.000Z",
    scope: { site: "example.com", country: "United States", language: "English" },
  };
  assert.match(formatDashboardScope(module), /example\.com/);
  assert.match(formatDashboardScope(module), /United States/);
  assert.match(formatDashboardScope(module), /D1/);
  assert.equal(formatDashboardDelta(12, 10), "+2");
  assert.equal(formatDashboardDelta(0, 0), "0");
  assert.equal(formatDashboardDelta(null, 10), "");
});

test("limits tables, selects requested trend ranges, and preserves the exact trend empty copy", () => {
  assert.equal(limitDashboardRows(Array.from({ length: 12 }, (_, index) => index)).length, 10);
  const points = [
    { captured_at: "2025-01-01T00:00:00.000Z", value: 10 },
    { captured_at: "2026-07-15T00:00:00.000Z", value: 20 },
    { captured_at: "2026-08-30T00:00:00.000Z", value: 30 },
  ];
  assert.deepEqual(selectDashboardTrendPoints(points, 30, new Date("2026-08-31T00:00:00.000Z")).map((point) => point.value), [30]);
  assert.equal(trendState(points.slice(0, 1)).message, DASHBOARD_EMPTY_TREND_COPY);
});

test("routes dashboard details to existing V2 views and builds only a relative zero-cost request", () => {
  assert.equal(dashboardDetailRoute("organic_keywords"), "#keywords");
  assert.equal(dashboardDetailRoute("organic_traffic"), "#website");
  assert.equal(dashboardDetailRoute("referring_domains"), "#backlinks");
  const request = buildDashboardRequestUrl({ domain: "example.com", location_code: 2840, language_code: "en" });
  assert.equal(request, "/api/v2/dashboard?site=example.com&location_code=2840&language_code=en");
});

test("reloads only the current market scope, discards stale responses, and retains prior data on failure", async () => {
  const pending = [];
  const successes = [];
  const failures = [];
  const loader = createDashboardLoader({
    fetchImpl(url) { return new Promise((resolve) => pending.push({ url, resolve })); },
    onSuccess(payload, scope) { successes.push({ payload, scope }); },
    onError(error, scope) { failures.push({ error, scope }); },
  });
  const first = loader.load({ domain: "old.example", location_code: 2840, language_code: "en" });
  const second = loader.load({ domain: "new.example", location_code: 2036, language_code: "en" });
  assert.match(pending[0].url, /^\/api\/v2\/dashboard\?/);
  assert.doesNotMatch(pending[0].url, /provider|refresh/);
  pending[1].resolve({ ok: true, json: async () => ({ ok: true, data: { modules: {} } }) });
  pending[0].resolve({ ok: true, json: async () => ({ ok: true, data: { modules: { organic: { data: { organic_traffic: 999 } } } } }) });
  assert.deepEqual(await second, { stale: false });
  assert.deepEqual(await first, { stale: true });
  assert.equal(successes.length, 1);
  assert.equal(successes[0].scope.domain, "new.example");
  const failed = loader.load({ domain: "new.example", location_code: 2036, language_code: "en" });
  pending[2].resolve({ ok: false, status: 503, json: async () => ({ ok: false, error: { message: "D1 unavailable" } }) });
  await assert.rejects(failed, /D1 unavailable/);
  assert.equal(failures.length, 1);
  assert.equal(loader.hasRenderedData(), true);
});

test("dashboard sources declare the complete zero-cost Overview structure and portable assets", async () => {
  const [html, css, source, shell] = await Promise.all([
    readFile(new URL("../public/v2.html", import.meta.url), "utf8"),
    readFile(new URL("../public/v2-dashboard.css", import.meta.url), "utf8"),
    readFile(new URL("../public/v2-dashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../public/v2-shell.js", import.meta.url), "utf8"),
  ]);
  for (const label of ["Organic Keywords", "Organic Traffic", "Traffic Value", "Domain Rank", "Backlinks", "Referring Domains"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /Top Organic Keywords/);
  assert.match(source, /Competitors/);
  assert.match(source, /需要至少两份快照才能显示趋势/);
  assert.match(source, /fetchImpl\(buildDashboardRequestUrl/);
  assert.doesNotMatch(source, /dashboard\/refresh/);
  assert.match(html, /href="\.\/v2-dashboard\.css"/);
  assert.match(html, /src="\.\/v2-dashboard\.js"/);
  assert.match(css, /\.v2-dashboard/);
  assert.match(shell, /mountDashboard/);
  assert.doesNotMatch(source, /fetch\(\s*["']https?:\/\//);
});

test("renderDashboard draws paired trend paths, merged opportunity-risk modules, and per-module annotations", async () => {
  await withFakeDocument(() => {
    const { root, body, updated, warning } = dashboardHarness();
    renderDashboard(root, dashboardPayload(), dashboardScope(), 90);
    assert.match(updated.textContent, /更新于/);
    assert.equal(warning.hidden, false);
    assert.match(warning.textContent, /stale organic snapshot/);

    const figures = body.querySelectorAll("figure");
    assert.equal(figures.length, 2);
    assert.equal(figures[0].querySelectorAll("path").length, 2);
    assert.equal(figures[1].querySelectorAll("path").length, 2);

    const annotationCount = body.querySelectorAll(".v2-dashboard-annotation").length;
    assert.equal(annotationCount, 10);

    const listTexts = body.querySelectorAll("li").map((node) => node.textContent);
    assert.ok(listTexts.some((value) => value.includes("roof coating")));
    assert.ok(listTexts.some((value) => value.includes("follow-up.example")));
    const linkChanges = body.querySelectorAll(".v2-dashboard-list-group").find((node) => node.textContent.includes("New/lost backlinks"));
    assert.match(linkChanges.textContent, /Lost links/);
  });
});

test("keeps a sourced manual-research prospect visible when keyword-gap rows reach their per-module cap", async () => {
  await withFakeDocument(() => {
    const { root, body } = dashboardHarness();
    const payload = dashboardPayload();
    payload.data.modules.keyword_opportunities.data.rows = Array.from(
      { length: 12 },
      (_, index) => ({ keyword: `keyword-gap-${index + 1}` }),
    );
    payload.data.modules.backlink_opportunities.data.items = [{
      referring_domain: "manual-research.example",
      status: "researching",
      outreach_recommendation: "research_first",
    }];

    renderDashboard(root, payload, dashboardScope(), 90);

    const listTexts = body.querySelectorAll("li").map((node) => node.textContent);
    assert.ok(listTexts.some((value) => value.includes("keyword-gap-10")));
    assert.ok(listTexts.some((value) => value.includes("manual-research.example")));
  });
});

test("renders only sourced trend series and marks a null series unavailable", async () => {
  await withFakeDocument(() => {
    const { root, body } = dashboardHarness();
    const payload = dashboardPayload();
    payload.data.modules.organic.data.trends.organic = [
      { captured_at: "2026-08-01T00:00:00.000Z", organic_traffic: null, organic_keywords: 180 },
      { captured_at: "2026-08-31T00:00:00.000Z", organic_traffic: null, organic_keywords: 240 },
    ];

    renderDashboard(root, payload, dashboardScope(), 90);

    const organicTrend = body.querySelectorAll("figure")[0];
    const paths = organicTrend.querySelectorAll("path");
    assert.equal(paths.length, 1);
    assert.match(paths[0].className, /secondary/);
    assert.match(organicTrend.textContent, /Organic Traffic.*暂无数据/);
  });
});

test("groups real aggregate opportunity and risk categories with their provenance without duplicating saved prospects", async () => {
  await withFakeDocument(() => {
    const { root, body } = dashboardHarness();
    const payload = dashboardPayload();
    const { modules } = payload.data;
    modules.keyword_opportunities.data.rows = [{ keyword: "keyword-gap.example", priority: 77 }];
    modules.backlink_opportunities.data.items = [
      { referring_domain: "manual-research.example", status: "researching", quality_score: 86, outreach_recommendation: "research_first" },
      { referring_domain: "saved-prospect.example", status: "new", quality_score: 55, outreach_recommendation: "possible" },
    ];
    modules.backlink_gap.data.rows = [{ domain: "gap-source.example", competitor_domain: "rival.example", opportunity_score: 88 }];
    modules.backlink_history.data = {
      points: [
        { snapshot_at: "2026-08-01T00:00:00.000Z", backlinks: 100 },
        { snapshot_at: "2026-08-31T00:00:00.000Z", backlinks: 120 },
      ],
      alerts: [
        { code: "BACKLINKS_LOST", label: "外链数量明显下降", detail: "较上次下降 10%。" },
        { code: "SPAM_INCREASE", label: "Spam Score 上升", detail: "较上次增加 5 分。" },
        { code: "BROKEN_LINKS_INCREASE", label: "失效外链增加", detail: "较上次增加 2 条。" },
      ],
    };
    modules.workflow.data = {
      total_count: 2,
      pending_count: 2,
      status_counts: { new: 1, researching: 1 },
      recent_items: [...modules.backlink_opportunities.data.items],
    };

    renderDashboard(root, payload, dashboardScope(), 90);

    const groups = body.querySelectorAll(".v2-dashboard-list-group");
    assert.equal(groups.length, 6);
    const group = (title) => groups.find((node) => node.textContent.includes(title));
    const keywordGap = group("High-value Keyword Gap");
    const manualResearch = group("Manual-research domains");
    const savedProspects = group("Saved prospects awaiting action");
    const linkChanges = group("New/lost backlinks");
    const warnings = group("Spam/broken-link warnings");
    const backlinkGap = group("High-quality Backlink Gap");

    assert.match(keywordGap.textContent, /KV 缓存/);
    assert.match(manualResearch.textContent, /manual-research\.example/);
    assert.match(manualResearch.querySelector(".v2-dashboard-annotation").textContent, /example\.com.*D1/);
    assert.doesNotMatch(savedProspects.textContent, /manual-research\.example/);
    assert.match(savedProspects.textContent, /saved-prospect\.example/);
    assert.match(linkChanges.textContent, /Lost/);
    assert.doesNotMatch(linkChanges.textContent, /New backlinks/);
    assert.match(warnings.textContent, /Spam Score 上升/);
    assert.match(warnings.textContent, /失效外链增加/);
    assert.match(backlinkGap.textContent, /gap-source\.example/);
    assert.match(backlinkGap.querySelector(".v2-dashboard-annotation").textContent, /KV 缓存/);
    assert.doesNotMatch(backlinkGap.textContent, /saved-prospect\.example/);
    assert.equal(body.querySelectorAll("li").filter((node) => node.textContent.includes("manual-research.example")).length, 1);
  });
});

test("competitor table truthfully labels total ranked keywords rather than shared keywords", async () => {
  await withFakeDocument(() => {
    const { root, body } = dashboardHarness();
    renderDashboard(root, dashboardPayload(), dashboardScope(), 90);
    const competitorPanel = body.querySelectorAll(".v2-dashboard-table-panel").find((node) => node.textContent.includes("Competitors"));
    assert.match(competitorPanel.textContent, /Ranked Keywords/);
    assert.doesNotMatch(competitorPanel.textContent, /Shared Keywords/);
    assert.match(competitorPanel.textContent, /210/);
  });
});

test("renders a sourced zero and marks a missing dashboard table value unavailable", async () => {
  await withFakeDocument(() => {
    const { root, body } = dashboardHarness();
    const payload = dashboardPayload();
    payload.data.modules.top_keywords.data.rows = [{
      keyword: "zero-volume keyword",
      position: 0,
      search_volume: null,
      estimated_traffic: 0,
      keyword_difficulty: null,
      cpc_usd: null,
      ranking_url: null,
    }];

    renderDashboard(root, payload, dashboardScope(), 90);

    const cells = body.querySelectorAll("td").map((node) => node.textContent);
    assert.ok(cells.includes("0"));
    assert.ok(cells.includes("暂无数据"));
  });
});

test("mountDashboard shows an explicit zero-cost retry after a 503 and keeps prior data until retry succeeds", async () => {
  await withFakeDocument(async () => {
    const { root, body, status, retry } = dashboardHarness();
    const pending = [];
    const calls = [];
    const fetchImpl = (url) => new Promise((resolve) => {
      calls.push(url);
      pending.push(resolve);
    });
    let subscribed;
    const context = {
      subscribe(handler) {
        subscribed = handler;
        handler(dashboardScope("first.example"));
        return () => {};
      },
    };

    mountDashboard({ root, context, fetchImpl });
    assert.match(status.textContent, /正在读取缓存总览/);
    pending[0]({ ok: true, json: async () => dashboardPayload(dashboardScope("first.example")) });
    await Promise.resolve();
    await Promise.resolve();

    const previousChildren = body.children.length;
    const retryableLoad = subscribed(dashboardScope("second.example"));
    pending[1]({ ok: false, status: 503, json: async () => ({ ok: false, error: { message: "总览数据暂时不可用，请重试。" } }) });
    await retryableLoad;

    assert.equal(body.children.length, previousChildren);
    assert.equal(retry.hidden, false);
    assert.match(status.textContent, /本次费用 \$0/);

    const retried = retry.dispatchEvent({ type: "click" });
    assert.equal(calls.length, 3);
    pending[2]({ ok: true, json: async () => dashboardPayload(dashboardScope("second.example")) });
    await retried;
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(retry.hidden, true);
    assert.match(status.textContent, /缓存总览已更新，本次费用 \$0/);
  });
});

test("a first-load 503 does not claim that nonexistent previous data was retained", async () => {
  await withFakeDocument(async () => {
    const { root, status } = dashboardHarness();
    let resolveFetch;
    const context = {
      subscribe(handler) {
        handler(dashboardScope());
        return () => {};
      },
    };
    mountDashboard({
      root,
      context,
      fetchImpl: () => new Promise((resolve) => { resolveFetch = resolve; }),
    });
    resolveFetch({ ok: false, status: 503, json: async () => ({ ok: false, error: { message: "D1 unavailable" } }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(status.textContent, /D1 unavailable/);
    assert.match(status.textContent, /本次费用 \$0/);
    assert.doesNotMatch(status.textContent, /保留上次显示的数据/);
  });
});

test("mountDashboard cleanup removes refresh, retry, and delegated range listeners before remount", async () => {
  await withFakeDocument(async () => {
    const { root, dashboard, refresh, retry } = dashboardHarness();
    let reviewPosts = 0;
    const fetchImpl = (url, options = {}) => {
      if (options.method === "POST") {
        reviewPosts += 1;
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({
            ok: false,
            error: { code: "LIVE_REQUEST_CONFIRMATION_REQUIRED", message: "Need confirmation." },
            data: {
              scope: { site: "example.com", location_code: 2840, language_code: "en" },
              modules: {
                organic: { status: "confirmation_required", cached: false, actual_cost_usd: 0, task_count: 0, cache_write_ok: true, error: { code: "LIVE_REQUEST_CONFIRMATION_REQUIRED" } },
                backlinks: { status: "ready", cached: true, actual_cost_usd: 0, task_count: 0, cache_write_ok: true },
                competitors: { status: "skip", cached: true, actual_cost_usd: 0, task_count: 0, cache_write_ok: true },
                keyword_opportunities: { status: "skip", cached: true, actual_cost_usd: 0, task_count: 0, cache_write_ok: true },
                backlink_opportunities: { status: "skip", cached: true, actual_cost_usd: 0, task_count: 0, cache_write_ok: true },
              },
            },
            meta: { actual_cost_usd: 0, total_actual_cost_usd: 0, task_count: 0 },
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => dashboardPayload() });
    };
    const context = {
      subscribe(handler) {
        handler(dashboardScope());
        return () => {};
      },
    };

    const firstCleanup = mountDashboard({ root, context, fetchImpl });
    firstCleanup();
    const secondCleanup = mountDashboard({ root, context, fetchImpl });
    refresh.dispatchEvent({ type: "click" });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(reviewPosts, 1);
    assert.equal((refresh.listeners.get("click") || []).length, 1);
    assert.equal((retry.listeners.get("click") || []).length, 1);
    assert.equal((dashboard.listeners.get("click") || []).length, 1);
    secondCleanup();
    assert.equal((refresh.listeners.get("click") || []).length, 0);
    assert.equal((retry.listeners.get("click") || []).length, 0);
    assert.equal((dashboard.listeners.get("click") || []).length, 0);
  });
});

test("mountDashboard cleanup suppresses late loader callbacks from the old mount", async () => {
  await withFakeDocument(async () => {
    const { root, body, status } = dashboardHarness();
    const pending = [];
    const fetchImpl = () => new Promise((resolve) => pending.push(resolve));
    const context = {
      subscribe(handler) {
        handler(dashboardScope());
        return () => {};
      },
    };

    const firstCleanup = mountDashboard({ root, context, fetchImpl });
    firstCleanup();
    const secondCleanup = mountDashboard({ root, context, fetchImpl });
    pending[0]({ ok: true, status: 200, json: async () => dashboardPayload(dashboardScope("old.example")) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(body.children.length, 0);
    assert.match(status.textContent, /正在读取缓存总览/);

    pending[1]({ ok: true, status: 200, json: async () => dashboardPayload(dashboardScope("new.example")) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(body.children.length > 0);
    secondCleanup();
  });
});
