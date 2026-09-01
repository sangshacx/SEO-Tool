export const DASHBOARD_EMPTY_TREND_COPY = "需要至少两份快照才能显示趋势";

import { mountDashboardRefresh } from "./v2-dashboard-refresh.js";

const METRICS = Object.freeze([
  { id: "organic_keywords", label: "Organic Keywords", module: "organic", field: "organic_keywords", route: "#keywords" },
  { id: "organic_traffic", label: "Organic Traffic", module: "organic", field: "organic_traffic", route: "#website" },
  { id: "traffic_value", label: "Traffic Value", module: "organic", field: "traffic_value", route: "#website", currency: true },
  { id: "domain_rank", label: "Domain Rank", module: "backlinks", field: "domain_rank", route: "#website" },
  { id: "backlinks", label: "Backlinks", module: "backlinks", field: "backlinks", route: "#backlinks" },
  { id: "referring_domains", label: "Referring Domains", module: "backlinks", field: "referring_domains", route: "#backlinks" },
]);

const ROUTES = Object.freeze(Object.fromEntries(METRICS.map((metric) => [metric.id, metric.route])));
const TREND_RANGES = Object.freeze([30, 90, 180, 365]);
const TREND_CONFIG = Object.freeze({
  organic: {
    title: "Organic Traffic & Keywords",
    moduleNames: ["organic", "organic_overview"],
    series: [
      { label: "Organic Traffic", keys: ["organic_traffic", "traffic"], className: "v2-dashboard-line primary" },
      { label: "Organic Keywords", keys: ["organic_keywords", "keywords"], className: "v2-dashboard-line secondary" },
    ],
  },
  backlinks: {
    title: "Backlinks & Referring Domains",
    moduleNames: ["backlinks", "backlink_overview"],
    series: [
      { label: "Backlinks", keys: ["backlinks", "value"], className: "v2-dashboard-line primary" },
      { label: "Referring Domains", keys: ["referring_domains", "domains"], className: "v2-dashboard-line secondary" },
    ],
  },
});

function valueAt(module, field) {
  if (!module || module.availability === "unavailable") return null;
  const source = module.data || module;
  const value = source?.[field];
  return value === undefined || value === null || value === "" ? null : value;
}

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dashboardPayload(payload) {
  return payload?.data || payload || {};
}

function modulesFrom(payload) {
  return dashboardPayload(payload).modules || {};
}

function moduleFrom(payload, names) {
  const modules = modulesFrom(payload);
  return names.map((name) => modules[name]).find(Boolean) || { availability: "unavailable" };
}

function modulesNamed(payload, names) {
  const modules = modulesFrom(payload);
  return names.map((name) => modules[name]).filter(Boolean);
}

function rowsFrom(module) {
  const data = module?.data || module || {};
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.recent_items)) return data.recent_items;
  if (Array.isArray(data.alerts)) return data.alerts;
  return Array.isArray(data) ? data : [];
}

function text(element, value) {
  element.textContent = value == null || value === "" ? "—" : String(value);
  return element;
}

function dateLabel(value) {
  if (!value) return "更新时间未知";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? `更新于 ${value}` : `更新于 ${parsed.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}`;
}

export function formatDashboardMetric(module, field, { currency = false } = {}) {
  const value = valueAt(module, field);
  if (value === null) return "暂无数据";
  const numeric = number(value);
  if (numeric === null) return String(value);
  if (currency) return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(numeric);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numeric);
}

export function formatDashboardDelta(current, previous, { currency = false } = {}) {
  const now = number(current);
  const before = number(previous);
  if (now === null || before === null) return "";
  const delta = now - before;
  const prefix = delta > 0 ? "+" : "";
  if (currency) return `${prefix}${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(delta)}`;
  return `${prefix}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(delta)}`;
}

export function formatDashboardScope(module, fallbackScope = {}) {
  const scope = module?.scope || fallbackScope || {};
  const site = scope.site || scope.domain || fallbackScope.domain;
  const country = scope.country || scope.location_name || fallbackScope.location_name;
  const language = scope.language || scope.language_name || fallbackScope.language_name;
  const source = module?.source ? ({ d1: "D1", kv_cache: "KV 缓存", live: "实时快照" }[module.source] || module.source) : "来源未知";
  return [[site, country, language].filter(Boolean).join(" · "), source, dateLabel(module?.updated_at || module?.freshness?.updated_at)].filter(Boolean).join(" · ");
}

export function limitDashboardRows(rows, limit = 10) {
  return Array.isArray(rows) ? rows.slice(0, Math.max(0, limit)) : [];
}

export function selectDashboardTrendPoints(points, days, now = new Date()) {
  const cutoff = now.getTime() - Number(days) * 86400000;
  return (Array.isArray(points) ? points : []).filter((point) => new Date(point.captured_at || point.snapshot_at || point.date || 0).getTime() >= cutoff);
}

export function trendState(points) {
  return Array.isArray(points) && points.length >= 2 ? { state: "ready", points } : { state: "empty", message: DASHBOARD_EMPTY_TREND_COPY };
}

export function dashboardDetailRoute(metric) {
  return ROUTES[metric] || "#overview";
}

export function buildDashboardRequestUrl(scope = {}) {
  const query = new URLSearchParams({
    site: String(scope.domain || scope.site || ""),
    location_code: String(scope.location_code || ""),
    language_code: String(scope.language_code || ""),
  });
  return `/api/v2/dashboard?${query.toString()}`;
}

export function createDashboardLoader({ fetchImpl, onLoading = () => {}, onSuccess = () => {}, onError = () => {} } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("Fetch is not available.");
  let requestId = 0;
  let renderedData = false;
  return Object.freeze({
    hasRenderedData: () => renderedData,
    async load(scope) {
      const current = ++requestId;
      onLoading(scope, renderedData);
      try {
        const response = await fetchImpl(buildDashboardRequestUrl(scope), { headers: { accept: "application/json" } });
        const payload = await response.json().catch(() => ({}));
        if (current !== requestId) return { stale: true };
        if (!response.ok || payload.ok === false) {
          const error = new Error(payload?.error?.message || (response.status === 503 ? "总览数据暂时不可用，请重试。" : "无法读取总览数据。"));
          error.status = response.status;
          throw error;
        }
        renderedData = true;
        onSuccess(payload, scope);
        return { stale: false };
      } catch (error) {
        if (current !== requestId) return { stale: true };
        onError(error, scope, renderedData);
        throw error;
      }
    },
  });
}

function card(metric, payload, scope) {
  const module = moduleFrom(payload, metric.module === "organic" ? ["organic", "organic_overview"] : ["backlinks", "backlink_overview"]);
  const previous = module?.previous || module?.previous_snapshot || {};
  const current = valueAt(module, metric.field);
  const delta = formatDashboardDelta(current, previous[metric.field], { currency: metric.currency });
  const article = document.createElement("article");
  article.className = "v2-dashboard-card";
  const link = document.createElement("a");
  link.href = metric.route;
  link.dataset.v2Go = metric.route.slice(1);
  link.className = "v2-dashboard-card-link";
  const label = document.createElement("span");
  label.className = "v2-dashboard-label";
  text(label, metric.label);
  const value = document.createElement("strong");
  value.className = "v2-dashboard-value";
  text(value, formatDashboardMetric(module, metric.field, { currency: metric.currency }));
  const deltaNode = document.createElement("span");
  deltaNode.className = `v2-dashboard-delta ${delta.startsWith("-") ? "down" : ""}`;
  text(deltaNode, delta || "无上一份快照");
  const source = document.createElement("small");
  source.className = "v2-dashboard-source";
  text(source, formatDashboardScope(module, scope));
  link.append(label, value, deltaNode, source);
  article.append(link);
  return article;
}

function annotationNode(module, scope) {
  const note = document.createElement("small");
  note.className = "v2-dashboard-annotation";
  text(note, formatDashboardScope(module, scope));
  return note;
}

function annotationGroup(modules, scope) {
  const available = (Array.isArray(modules) ? modules : []).filter((module) => module && module.availability !== "unavailable");
  if (!available.length) return null;
  const wrapper = document.createElement("div");
  wrapper.className = "v2-dashboard-annotations";
  available.forEach((module) => wrapper.append(annotationNode(module, scope)));
  return wrapper;
}

function heading(title, route) {
  const row = document.createElement("div");
  row.className = "v2-dashboard-section-head";
  const titleNode = document.createElement("h3");
  text(titleNode, title);
  const link = document.createElement("a");
  link.href = route;
  link.dataset.v2Go = route.slice(1);
  text(link, "查看全部");
  row.append(titleNode, link);
  return row;
}

function table(headers, rows, rowValues, emptyCopy) {
  const wrapper = document.createElement("div");
  wrapper.className = "v2-dashboard-tablewrap";
  const element = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  headers.forEach((label) => { const cell = document.createElement("th"); text(cell, label); headRow.append(cell); });
  head.append(headRow);
  const body = document.createElement("tbody");
  const limited = limitDashboardRows(rows);
  if (!limited.length) {
    const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = headers.length; cell.className = "v2-dashboard-empty"; text(cell, emptyCopy); row.append(cell); body.append(row);
  } else limited.forEach((item) => {
    const row = document.createElement("tr");
    rowValues(item).forEach((value) => { const cell = document.createElement("td"); text(cell, value == null || value === "" ? "暂无数据" : value); row.append(cell); });
    body.append(row);
  });
  element.append(head, body); wrapper.append(element); return wrapper;
}

function trendPoints(payload, kind) {
  const config = TREND_CONFIG[kind];
  const module = moduleFrom(payload, config?.moduleNames || []);
  const data = module.data || module;
  return data?.trends?.[kind] || data?.history || [];
}

function valueFromPoint(point, keys) {
  for (const key of keys) {
    const value = number(point?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function pathFromValues(values, width, height, max) {
  if (!Array.isArray(values) || values.filter((value) => value !== null).length < 2) return "";
  let hasPreviousValue = false;
  return values.map((value, index) => {
    if (value === null) { hasPreviousValue = false; return ""; }
    const command = hasPreviousValue ? "L" : "M";
    hasPreviousValue = true;
    return `${command}${(index / (values.length - 1)) * width} ${height - (value / max) * (height - 18)}`;
  }).filter(Boolean).join(" ");
}

function trend(payload, kind, days, scope) {
  const config = TREND_CONFIG[kind];
  const all = trendPoints(payload, kind);
  const points = selectDashboardTrendPoints(all, days);
  const state = trendState(points);
  const figure = document.createElement("figure");
  figure.className = "v2-dashboard-trend";
  const caption = document.createElement("figcaption");
  text(caption, config.title);
  figure.append(caption);
  const seriesValues = config.series.map((series) => ({
    ...series,
    values: points.map((point) => valueFromPoint(point, series.keys)),
  }));
  const legend = document.createElement("div");
  legend.className = "v2-dashboard-trend-legend";
  seriesValues.forEach((series) => {
    const item = document.createElement("span");
    item.className = `v2-dashboard-trend-key ${series.className.includes("secondary") ? "secondary" : "primary"}`;
    text(item, `${series.label}${series.values.filter((value) => value !== null).length < 2 ? " · 暂无数据" : ""}`);
    legend.append(item);
  });
  figure.append(legend);
  const note = annotationGroup([moduleFrom(payload, config.moduleNames)], scope);
  if (note) figure.append(note);
  if (state.state === "empty") { const empty = document.createElement("p"); empty.className = "v2-dashboard-empty"; text(empty, state.message); figure.append(empty); return figure; }
  const values = seriesValues.flatMap((series) => series.values.filter((value) => value !== null));
  const max = Math.max(...values, 1);
  const width = 640; const height = 180;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `${caption.textContent} ${days} 天趋势`);
  seriesValues.forEach((series) => {
    const path = pathFromValues(series.values, width, height, max);
    if (!path) return;
    const pathNode = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathNode.setAttribute("d", path);
    pathNode.setAttribute("class", series.className);
    if (typeof pathNode.className === "string") pathNode.className = series.className;
    svg.append(pathNode);
  });
  figure.append(svg);
  return figure;
}

function rowLabel(row) {
  if (!row || typeof row !== "object") return "暂无数据";
  if (row.label && row.detail) return `${row.label}：${row.detail}`;
  if (row.referring_domain && row.status) return `${row.referring_domain} · ${row.status}`;
  if (row.referring_domain) return row.referring_domain;
  if (row.title) return row.title;
  if (row.domain) return row.domain;
  if (row.keyword && row.competitor_domain) return `${row.keyword} · ${row.competitor_domain}`;
  if (row.keyword) return row.keyword;
  if (row.message) return row.message;
  if (row.label) return row.label;
  return "暂无数据";
}

function listGroup(title, module, route, emptyCopy, scope, rows = rowsFrom(module)) {
  const group = document.createElement("section"); group.className = "v2-dashboard-list-group";
  const groupHeading = document.createElement("div"); groupHeading.className = "v2-dashboard-list-group-head";
  const headingNode = document.createElement("h4"); text(headingNode, title);
  const link = document.createElement("a"); link.href = route; link.dataset.v2Go = route.slice(1); text(link, "查看全部");
  groupHeading.append(headingNode, link); group.append(groupHeading);
  if (module && module.availability !== "unavailable") group.append(annotationNode(module, scope));
  const list = document.createElement("ul");
  const limited = limitDashboardRows(rows);
  if (!limited.length) { const item = document.createElement("li"); item.className = "v2-dashboard-empty"; text(item, emptyCopy); list.append(item); }
  else limited.forEach((row) => { const item = document.createElement("li"); text(item, rowLabel(row)); list.append(item); });
  group.append(list); return group;
}

function listPanel(title, route, groups) {
  const panel = document.createElement("section"); panel.className = "v2-dashboard-list"; panel.append(heading(title, route), ...groups); return panel;
}

function manualResearchRows(module) {
  return rowsFrom(module).filter((item) => item?.outreach_recommendation === "research_first");
}

function savedProspectRows(module) {
  return rowsFrom(module).filter((item) => item?.outreach_recommendation !== "research_first" && ["new", "researching"].includes(item?.status));
}

function linkChangeRows(module) {
  const events = module?.data?.events;
  if (Array.isArray(events)) return events.filter((item) => ["new", "lost"].includes(item?.type));
  const alerts = module?.data?.alerts;
  return Array.isArray(alerts) ? alerts
    .filter((item) => ["BACKLINKS_LOST", "REFERRING_DOMAINS_LOST"].includes(item?.code))
    .map((item) => ({ type: "lost", label: `Lost · ${item.label || "Backlinks"}`, detail: item.detail || "" })) : [];
}

function warningRows(module) {
  return rowsFrom(module).filter((item) => /(?:SPAM|BROKEN)/.test(item?.code || ""));
}

function tablePanel(title, route, module, headers, rowValues, emptyCopy, scope) {
  const panel = document.createElement("section");
  panel.className = "v2-dashboard-table-panel";
  panel.append(heading(title, route));
  const note = annotationGroup([module], scope);
  if (note) panel.append(note);
  panel.append(table(headers, rowsFrom(module), rowValues, emptyCopy));
  return panel;
}

export function renderDashboard(root, payload, scope = {}, trendRange = 90) {
  const dashboard = root.querySelector("[data-v2-dashboard]");
  if (!dashboard) return null;
  const body = dashboard.querySelector("[data-v2-dashboard-body]");
  body.replaceChildren();
  const meta = dashboardPayload(payload).meta || {};
  text(dashboard.querySelector("[data-v2-dashboard-updated]"), meta.updated_at ? dateLabel(meta.updated_at) : "尚无总览快照");
  const warning = dashboard.querySelector("[data-v2-dashboard-warning]");
  const warnings = dashboardPayload(payload).warnings || [];
  text(warning, warnings.length ? warnings.join("；") : ""); warning.hidden = !warnings.length;
  const grid = document.createElement("div"); grid.className = "v2-dashboard-metrics"; METRICS.forEach((metric) => grid.append(card(metric, payload, scope))); body.append(grid);
  const controls = document.createElement("div"); controls.className = "v2-dashboard-trend-controls";
  TREND_RANGES.forEach((range) => { const button = document.createElement("button"); button.type = "button"; button.dataset.v2DashboardRange = String(range); text(button, range === 180 ? "6m" : range === 365 ? "1y" : `${range}d`); button.setAttribute("aria-pressed", String(range === trendRange)); controls.append(button); }); body.append(controls);
  const trends = document.createElement("div"); trends.className = "v2-dashboard-trends"; trends.append(trend(payload, "organic", trendRange, scope), trend(payload, "backlinks", trendRange, scope)); body.append(trends);
  const keywordModule = moduleFrom(payload, ["top_keywords", "organic_keywords"]);
  const competitors = moduleFrom(payload, ["competitors", "competitor_summary"]);
  const tables = document.createElement("div"); tables.className = "v2-dashboard-tables";
  const keywordPanel = tablePanel("Top Organic Keywords", "#keywords", keywordModule, ["Keyword", "Position", "Volume", "Traffic", "KD", "CPC", "Ranking URL"], (row) => [row.keyword, row.position, row.volume ?? row.search_volume, row.traffic ?? row.estimated_traffic, row.kd ?? row.keyword_difficulty, row.cpc ?? row.cpc_usd, row.url ?? row.ranking_url], "暂无数据", scope);
  const competitorPanel = tablePanel("Competitors", "#competitors", competitors, ["Domain", "Ranked Keywords", "Competitor-only", "Traffic", "Keyword Gap", "Backlink Gap"], (row) => [row.domain, row.ranked_keywords, row.competitor_only_keywords, row.traffic ?? row.estimated_traffic, row.keyword_gap, row.backlink_gap], "暂无数据", scope);
  tables.append(keywordPanel, competitorPanel); body.append(tables);
  const keywordOpportunities = moduleFrom(payload, ["keyword_opportunities"]);
  const backlinkGap = moduleFrom(payload, ["backlink_gap"]);
  const prospects = moduleFrom(payload, ["backlink_opportunities"]);
  const workflow = moduleFrom(payload, ["workflow"]);
  const backlinkHistory = moduleFrom(payload, ["backlink_history"]);
  const lists = document.createElement("div"); lists.className = "v2-dashboard-lists"; lists.append(
    listPanel("Opportunities", "#opportunities", [
      listGroup("High-value Keyword Gap", keywordOpportunities, "#opportunities", "暂无数据", scope),
      listGroup("High-quality Backlink Gap", backlinkGap, "#backlinks", "暂无数据", scope),
      listGroup("Manual-research domains", prospects, "#backlinks", "暂无数据", scope, manualResearchRows(prospects)),
    ]),
    listPanel("Risks & workflow", "#backlinks", [
      listGroup("New/lost backlinks", backlinkHistory, "#backlinks", "暂无数据", scope, linkChangeRows(backlinkHistory)),
      listGroup("Spam/broken-link warnings", backlinkHistory, "#backlinks", "暂无数据", scope, warningRows(backlinkHistory)),
      listGroup("Saved prospects awaiting action", workflow, "#backlinks", "暂无数据", scope, savedProspectRows(workflow)),
    ]),
  ); body.append(lists);
  return dashboard;
}

export function createDashboardOverview() {
  const section = document.createElement("section"); section.className = "v2-dashboard panel"; section.dataset.v2View = "overview"; section.dataset.v2Dashboard = "";
  section.innerHTML = '<div class="v2-dashboard-header"><div><div class="label">缓存数据总览</div><h1 id="v2DashboardSite">网站总览</h1><p class="lead" data-v2-dashboard-updated>正在准备总览…</p></div><div class="v2-dashboard-actions"><button type="button" data-v2-dashboard-refresh>更新总览数据</button><button type="button" data-v2-dashboard-retry hidden>重试读取总览</button></div></div><p class="v2-dashboard-status" data-v2-dashboard-status role="status"></p><p class="v2-dashboard-warning" data-v2-dashboard-warning role="alert" hidden></p><div data-v2-dashboard-body></div>';
  return section;
}

export function mountDashboard({ root, context, fetchImpl = globalThis.fetch } = {}) {
  const dashboard = root?.querySelector?.("[data-v2-dashboard]");
  if (!dashboard || !context || typeof fetchImpl !== "function") return () => {};
  const status = dashboard.querySelector("[data-v2-dashboard-status]");
  const title = dashboard.querySelector("#v2DashboardSite");
  const retry = dashboard.querySelector("[data-v2-dashboard-retry]");
  let payload; let scope; let trendRange = 90; let destroyed = false;
  const loader = createDashboardLoader({
    fetchImpl,
    onLoading(nextScope, hasRenderedData) { if (destroyed) return; scope = nextScope; if (retry) retry.hidden = true; text(title, nextScope.domain || "网站总览"); text(status, hasRenderedData ? "正在加载新的站点范围，保留当前数据…" : "正在读取缓存总览…"); },
    onSuccess(nextPayload, nextScope) { if (destroyed) return; payload = nextPayload; scope = nextScope; if (retry) retry.hidden = true; renderDashboard(root, payload, scope, trendRange); text(status, "缓存总览已更新，本次费用 $0。"); },
    onError(error, _nextScope, hasRenderedData) {
      if (destroyed) return;
      if (retry) retry.hidden = error?.status !== 503;
      const suffix = hasRenderedData
        ? (error?.status === 503 ? " 已保留上次显示的数据，本次费用 $0。" : " 已保留上次显示的数据。")
        : (error?.status === 503 ? " 本次费用 $0，请重试。" : " 请重试。");
      text(status, `${error.message || "无法读取总览数据。"}${suffix}`);
    },
  });
  const refreshReview = mountDashboardRefresh({
    root: dashboard,
    fetchImpl,
    getScope: () => scope,
    onDashboardReload: () => !destroyed && scope ? loader.load(scope).catch(() => {}) : Promise.resolve(),
    onStatus: (message) => text(status, message),
  });
  const refresh = dashboard.querySelector("[data-v2-dashboard-refresh]");
  const handleRefresh = (event) => refreshReview.open(event.currentTarget || refresh);
  const handleRetry = () => {
    if (!scope) return Promise.resolve();
    return loader.load(scope).catch(() => {});
  };
  const handleRange = (event) => {
    const button = event.target.closest("[data-v2-dashboard-range]");
    if (!button || !payload) return;
    trendRange = Number(button.dataset.v2DashboardRange);
    renderDashboard(root, payload, scope, trendRange);
  };
  refresh?.addEventListener("click", handleRefresh);
  retry?.addEventListener("click", handleRetry);
  dashboard.addEventListener("click", handleRange);
  const unsubscribe = context.subscribe((nextScope) => destroyed ? Promise.resolve() : loader.load(nextScope).catch(() => {}));
  return () => {
    if (destroyed) return;
    destroyed = true;
    refresh?.removeEventListener("click", handleRefresh);
    retry?.removeEventListener("click", handleRetry);
    dashboard.removeEventListener("click", handleRange);
    refreshReview.destroy();
    unsubscribe();
  };
}
