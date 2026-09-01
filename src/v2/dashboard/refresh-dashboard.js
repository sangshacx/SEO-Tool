import { buildCompetitorSnapshotCacheKey, buildKeywordGapCacheKey } from "./cache-keys.js";
import {
  DASHBOARD_REFRESH_MODULES,
  dashboardScopeCacheKey,
  normalizeDashboardModule,
  normalizeDashboardScope,
  normalizeStoredModules,
  orderedRefreshModules,
} from "./contracts.js";
import {
  classifyDashboardRefresh,
  liveConfirmationMissing,
  readDashboardRefreshProfile,
} from "./refresh-preview.js";
import { backlinkGapCacheKey, backlinkSnapshotCacheKey } from "../backlinks/domain.js";
import { fetchBacklinkGap } from "../providers/dataforseo-backlink-gap.js";
import { fetchBacklinkSummary } from "../providers/dataforseo-backlinks.js";
import { readBoundedJson } from "../providers/bounded-json.js";
import { recordBacklinkSnapshot } from "../storage/backlink-history.js";
import { recordApiUsage } from "../storage/keyword-overview.js";
import { scoreKeywordPotential } from "../scoring/keyword-potential.js";
import {
  acquireDashboardRefreshLease,
  ownsDashboardRefreshLease,
  releaseDashboardRefreshLease,
  renewDashboardRefreshLease,
  writeDashboardSnapshot,
} from "../storage/site-dashboard.js";

const INFLIGHT = new Map();
const COMPETITOR_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const KEYWORD_GAP_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const BACKLINK_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_LEASE_MS = 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 20 * 1000;

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function taskCount(value) {
  const candidate = value?.task_count ?? value?.taskCount;
  return Number.isInteger(candidate) && candidate >= 0 ? candidate : null;
}

function actualCost(value) {
  return numberOrNull(value?.actual_cost_usd ?? value?.actualCostUsd);
}

function resultCount(value) {
  const candidate = value?.result_count ?? value?.resultCount;
  return Number.isInteger(candidate) && candidate >= 0 ? candidate : 0;
}

function currentIso(now) {
  return now().toISOString();
}

function canonicalCacheAt(value) {
  const candidate = value?.cached_at ?? value?.generated_at ?? value?.data?.generated_at;
  if (typeof candidate !== "string" || !Number.isFinite(Date.parse(candidate))) return null;
  return new Date(candidate).toISOString();
}

function cachedData(value) {
  return value && typeof value === "object" && Object.hasOwn(value, "data") ? value.data : value;
}

function oldestFreshness(values, expectedCount = values.length) {
  const normalized = values.filter((value) => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .map((value) => new Date(value).toISOString())
    .sort();
  return normalized.length === expectedCount ? normalized[0] : null;
}

function addWarning(result, message) {
  if (!message) return result;
  result.warning = result.warning ? `${result.warning} ${message}` : message;
  return result;
}

function defaultModuleResult(status, extra = {}) {
  return {
    status,
    cached: false,
    actual_cost_usd: 0,
    task_count: 0,
    provider_attempts: 0,
    cache_write_ok: true,
    updated_at: null,
    ...extra,
  };
}

function safeError(error, fallbackCode, fallbackMessage) {
  return { code: typeof error?.code === "string" ? error.code : fallbackCode, message: fallbackMessage };
}

export function parseConfirmedLiveModules(body = {}, selectedModules = []) {
  const explicit = body.confirmed_live_modules ?? body.allow_live_modules ?? body.live_modules;
  if (Array.isArray(explicit)) return new Set(explicit);
  return body.allow_live_request === true ? new Set(selectedModules) : new Set();
}

function organicSnapshotModules(scope, payload, updatedAt, source) {
  return {
    organic: normalizeDashboardModule("organic", {
      organic_keywords: payload?.organic?.ranked_keywords ?? null,
      organic_traffic: payload?.organic?.estimated_monthly_traffic ?? null,
      traffic_value: payload?.organic?.estimated_paid_traffic_cost_usd ?? null,
    }, { scope, source, updated_at: updatedAt, cached_at: updatedAt }),
    top_keywords: normalizeDashboardModule("top_keywords", {
      rows: Array.isArray(payload?.top_keywords) ? payload.top_keywords : [],
    }, { scope, source, updated_at: updatedAt, cached_at: updatedAt }),
  };
}

function backlinksSnapshotModule(scope, payload, updatedAt, source) {
  return {
    backlinks: normalizeDashboardModule("backlinks", {
      domain_rank: payload?.metrics?.domain_rank ?? payload?.domain_rank ?? null,
      backlinks: payload?.metrics?.backlinks ?? payload?.backlinks ?? null,
      referring_domains: payload?.metrics?.referring_domains ?? payload?.referring_domains ?? null,
    }, { scope, source, updated_at: updatedAt, snapshot_at: updatedAt }),
  };
}

function normalizeCompetitorSnapshotResult(result, domain) {
  const organic = result?.metrics?.organic ?? {};
  const topKeywords = (result?.items ?? []).map((item) => {
    const data = item.keyword_data ?? {};
    const info = data.keyword_info ?? {};
    const serp = item.ranked_serp_element?.serp_item ?? {};
    return {
      keyword: data.keyword ?? null,
      position: serp.rank_group ?? null,
      search_volume: info.search_volume ?? null,
      keyword_difficulty: data.keyword_properties?.keyword_difficulty ?? null,
      cpc_usd: info.cpc ?? null,
      intent: data.search_intent_info?.main_intent ?? null,
      ranking_url: serp.url ?? null,
      estimated_traffic: item.etv ?? serp.etv ?? null,
    };
  }).filter((item) => item.keyword);
  return {
    domain,
    organic: {
      estimated_monthly_traffic: organic.etv ?? null,
      ranked_keywords: organic.count ?? result?.total_count ?? null,
      estimated_paid_traffic_cost_usd: organic.estimated_paid_traffic_cost ?? null,
    },
    top_keywords: topKeywords,
  };
}

async function fetchCompetitorSnapshotLive(env, scope, domain, signal) {
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
    throw Object.assign(new Error("PROVIDER_CREDENTIALS_MISSING"), {
      code: "PROVIDER_CREDENTIALS_MISSING", httpStatus: 503, task_count: null, actual_cost_usd: null,
    });
  }
  const response = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Basic ${btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`)}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify([{
      target: domain,
      location_code: scope.location_code,
      language_code: scope.language_code,
      item_types: ["organic"],
      ignore_synonyms: true,
      include_clickstream_data: false,
      limit: 10,
      order_by: ["ranked_serp_element.serp_item.rank_group,asc", "keyword_data.keyword_info.search_volume,desc"],
      tag: "seo-pro-v2-dashboard-organic",
    }]),
  });
  const payload = await readBoundedJson(response);
  const task = payload.tasks?.[0];
  if (!response.ok || payload.status_code !== 20000 || task?.status_code !== 20000) {
    throw Object.assign(new Error("COMPETITOR_SNAPSHOT_FAILED"), {
      code: "COMPETITOR_SNAPSHOT_FAILED",
      httpStatus: 502,
      task_count: Number.isInteger(payload?.tasks_count) ? payload.tasks_count : null,
      actual_cost_usd: numberOrNull(payload?.cost) ?? numberOrNull(task?.cost),
    });
  }
  return {
    data: normalizeCompetitorSnapshotResult(task?.result?.[0], domain),
    task_count: Number.isInteger(payload?.tasks_count) ? payload.tasks_count : null,
    actual_cost_usd: numberOrNull(payload?.cost) ?? numberOrNull(task?.cost),
    result_count: Number.isInteger(task?.result_count) ? task.result_count : task?.result?.length ?? 0,
  };
}

function normalizeKeywordGapResult(result, competitorDomain, ownDomain) {
  const opportunities = (result?.items ?? []).map((item) => {
    const keywordData = item?.keyword_data ?? {};
    const keywordInfo = keywordData.keyword_info ?? {};
    const serp = item?.first_domain_serp_element ?? {};
    return {
      keyword: keywordData.keyword ?? null,
      competitor_domain: competitorDomain,
      search_volume: keywordInfo.search_volume ?? null,
      keyword_difficulty: keywordData.keyword_properties?.keyword_difficulty ?? null,
      estimated_traffic: serp.etv ?? null,
      priority: scoreKeywordPotential({
        metrics: {
          search_volume: keywordInfo.search_volume ?? null,
          keyword_difficulty: keywordData.keyword_properties?.keyword_difficulty ?? null,
          cpc_usd: keywordInfo.cpc ?? null,
          competition: keywordInfo.competition ?? null,
          competition_level: keywordInfo.competition_level ?? null,
        },
        intent: { primary: keywordData.search_intent_info?.main_intent ?? null, secondary: keywordData.search_intent_info?.foreign_intent ?? [] },
        trend: { change: {} },
      })?.score ?? null,
    };
  }).filter((item) => item.keyword);
  return { competitor_domain: competitorDomain, own_domain: ownDomain, total_gap_keywords: result?.total_count ?? opportunities.length, opportunities };
}

async function fetchKeywordGapLive(env, scope, competitorDomain, ownDomain, signal) {
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
    throw Object.assign(new Error("PROVIDER_CREDENTIALS_MISSING"), {
      code: "PROVIDER_CREDENTIALS_MISSING", httpStatus: 503, task_count: null, actual_cost_usd: null,
    });
  }
  const response = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Basic ${btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`)}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify([{
      target1: competitorDomain,
      target2: ownDomain,
      location_code: scope.location_code,
      language_code: scope.language_code,
      intersections: false,
      item_types: ["organic"],
      include_serp_info: false,
      include_clickstream_data: false,
      filters: [["first_domain_serp_element.etv", ">", 0]],
      limit: 10,
      order_by: ["keyword_data.keyword_info.search_volume,desc", "first_domain_serp_element.rank_group,asc"],
      tag: "seo-pro-v2-dashboard-keyword-gap",
    }]),
  });
  const payload = await readBoundedJson(response);
  const task = payload.tasks?.[0];
  if (!response.ok || payload.status_code !== 20000 || task?.status_code !== 20000) {
    throw Object.assign(new Error("KEYWORD_GAP_FAILED"), {
      code: "KEYWORD_GAP_FAILED",
      httpStatus: 502,
      task_count: Number.isInteger(payload?.tasks_count) ? payload.tasks_count : null,
      actual_cost_usd: numberOrNull(payload?.cost) ?? numberOrNull(task?.cost),
    });
  }
  return {
    data: normalizeKeywordGapResult(task?.result?.[0], competitorDomain, ownDomain),
    task_count: Number.isInteger(payload?.tasks_count) ? payload.tasks_count : null,
    actual_cost_usd: numberOrNull(payload?.cost) ?? numberOrNull(task?.cost),
    result_count: Number.isInteger(task?.result_count) ? task.result_count : task?.result?.length ?? 0,
  };
}

function defaultDependencies(overrides = {}) {
  return {
    fetchCompetitorSnapshot: ({ env, scope, domain, signal }) => fetchCompetitorSnapshotLive(env, scope, domain, signal),
    fetchKeywordGap: ({ env, scope, competitorDomain, ownDomain, signal }) => fetchKeywordGapLive(env, scope, competitorDomain, ownDomain, signal),
    fetchBacklinkSummary: ({ env, scope, signal }) => fetchBacklinkSummary({
      login: env.DATAFORSEO_LOGIN, password: env.DATAFORSEO_PASSWORD, target: scope.domain, signal,
    }),
    fetchBacklinkGap: ({ env, scope, competitor, signal }) => fetchBacklinkGap({
      login: env.DATAFORSEO_LOGIN,
      password: env.DATAFORSEO_PASSWORD,
      ownDomain: scope.domain,
      competitors: [competitor],
      limit: 25,
      offset: 0,
      signal,
    }),
    leaseDurationMs: DEFAULT_LEASE_MS,
    leaseHeartbeatMs: DEFAULT_HEARTBEAT_MS,
    sleep: (milliseconds, signal) => new Promise((resolve) => {
      const timer = setTimeout(resolve, milliseconds);
      signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    }),
    ...overrides,
  };
}

function leaseLostError(cause, accounting) {
  return Object.assign(new Error("Dashboard refresh lease ownership was lost."), {
    code: "REFRESH_LEASE_LOST",
    httpStatus: 409,
    task_count: taskCount(accounting),
    actual_cost_usd: actualCost(accounting),
    cause,
  });
}

function createLeaseGuard({ db, leaseKey, requestId, now, dependencies }) {
  const leaseMs = Math.max(20, Number(dependencies.leaseDurationMs) || DEFAULT_LEASE_MS);
  const heartbeatMs = Math.max(5, Math.min(Number(dependencies.leaseHeartbeatMs) || DEFAULT_HEARTBEAT_MS, Math.floor(leaseMs / 2)));
  const expiry = () => new Date(now().getTime() + leaseMs).toISOString();
  const renew = async () => {
    try {
      return await renewDashboardRefreshLease(db, leaseKey, requestId, expiry(), currentIso(now));
    } catch (error) {
      throw leaseLostError(error);
    }
  };
  return {
    async runProviderCall(call) {
      if (!await renew()) throw leaseLostError();
      const controller = new AbortController();
      const settled = Promise.resolve()
        .then(() => call(controller.signal))
        .then((value) => ({ state: "fulfilled", value }), (error) => ({ state: "rejected", error }));
      while (true) {
        const heartbeatController = new AbortController();
        const winner = await Promise.race([
          settled,
          dependencies.sleep(heartbeatMs, heartbeatController.signal).then(() => ({ state: "heartbeat" })),
        ]);
        heartbeatController.abort();
        if (winner.state === "heartbeat") {
          let renewed = false;
          try { renewed = await renew(); } catch { renewed = false; }
          if (!renewed) {
            controller.abort();
            const completed = await settled;
            throw leaseLostError(undefined, completed.state === "fulfilled" ? completed.value : completed.error);
          }
          continue;
        }
        let owned = false;
        try { owned = await ownsDashboardRefreshLease(db, leaseKey, requestId, currentIso(now)); } catch { owned = false; }
        if (!owned) {
          controller.abort();
          throw leaseLostError(undefined, winner.state === "fulfilled" ? winner.value : winner.error);
        }
        if (winner.state === "rejected") throw winner.error;
        return winner.value;
      }
    },
  };
}

function createAttemptTracker({ env, requestId, leaseGuard }) {
  let sequence = 0;
  const counts = new Map();
  const warnings = new Map();
  const warningFor = (moduleId) => warnings.get(moduleId) ?? null;
  const countFor = (moduleId) => counts.get(moduleId) ?? 0;
  const log = async (moduleId, values) => {
    try {
      await recordApiUsage({
        db: env.DB,
        requestId: `${requestId}:${moduleId}:${++sequence}`,
        provider: "dataforseo",
        endpoint: `dashboard/${moduleId}`,
        operation: "dashboard_refresh",
        taskCount: values.taskCount,
        resultCount: values.resultCount,
        actualCostUsd: values.actualCostUsd,
        cacheHit: values.cacheHit,
        status: values.status,
        httpStatus: values.httpStatus,
        durationMs: values.durationMs,
      });
    } catch {
      warnings.set(moduleId, "Provider accounting could not be persisted.");
    }
  };
  return {
    countFor,
    warningFor,
    async provider(moduleId, call) {
      let attempted = false;
      let started;
      try {
        const result = await leaseGuard.runProviderCall((signal) => {
          attempted = true;
          counts.set(moduleId, countFor(moduleId) + 1);
          started = Date.now();
          return call(signal);
        });
        await log(moduleId, {
          taskCount: taskCount(result),
          resultCount: resultCount(result),
          actualCostUsd: actualCost(result),
          cacheHit: false,
          status: "success",
          httpStatus: 200,
          durationMs: Date.now() - started,
        });
        return result;
      } catch (error) {
        if (!attempted) throw error;
        error.task_count = taskCount(error);
        error.actual_cost_usd = actualCost(error);
        error.provider_attempted = true;
        await log(moduleId, {
          taskCount: error.task_count,
          resultCount: 0,
          actualCostUsd: error.actual_cost_usd,
          cacheHit: false,
          status: "error",
          httpStatus: Number.isInteger(error.httpStatus) ? error.httpStatus : 502,
          durationMs: Date.now() - started,
        });
        throw error;
      }
    },
    async cached(moduleId, result, durationMs) {
      await log(moduleId, {
        taskCount: 0,
        resultCount: Array.isArray(result?.rows) ? result.rows.length : 0,
        actualCostUsd: 0,
        cacheHit: true,
        status: result.status,
        httpStatus: 200,
        durationMs,
      });
    },
  };
}

async function putCache(cache, key, value, expirationTtl) {
  await cache.put(key, JSON.stringify(value), { expirationTtl });
}

function createAccountingAccumulator() {
  return { cost: 0, tasks: 0, costUnknown: false, tasksUnknown: false };
}

function addAccounting(total, value) {
  const cost = actualCost(value);
  const tasks = taskCount(value);
  if (cost === null) total.costUnknown = true; else total.cost += cost;
  if (tasks === null) total.tasksUnknown = true; else total.tasks += tasks;
}

function applyAccounting(result, total) {
  result.actual_cost_usd = total.costUnknown ? null : total.cost;
  result.task_count = total.tasksUnknown ? null : total.tasks;
  return result;
}

async function executeOrganicModule(context) {
  const { env, scope, allowLive, now, dependencies, attempts } = context;
  const key = buildCompetitorSnapshotCacheKey(scope.domain, scope.location_code, scope.language_code);
  const cached = await env.CACHE.get(key, "json");
  if (cachedData(cached)) {
    const updatedAt = canonicalCacheAt(cached);
    return {
      result: defaultModuleResult("success", { cached: true, updated_at: updatedAt, snapshot_modules: ["organic", "top_keywords"] }),
      snapshotModules: organicSnapshotModules(scope, cachedData(cached), updatedAt, "kv_cache"),
    };
  }
  if (!allowLive) return { result: defaultModuleResult("confirmation_required", { error: { code: "LIVE_REQUEST_CONFIRMATION_REQUIRED", message: "No cached organic overview exists." } }) };
  const live = await attempts.provider("organic", (signal) => dependencies.fetchCompetitorSnapshot({ env, scope, domain: scope.domain, signal }));
  const updatedAt = currentIso(now);
  let cacheWriteOk = true;
  try { await putCache(env.CACHE, key, { data: live.data, cached_at: updatedAt }, COMPETITOR_CACHE_TTL_SECONDS); } catch { cacheWriteOk = false; }
  const result = defaultModuleResult("success", {
    cached: false,
    task_count: taskCount(live),
    actual_cost_usd: actualCost(live),
    cache_write_ok: cacheWriteOk,
    updated_at: updatedAt,
    snapshot_modules: ["organic", "top_keywords"],
  });
  if (!cacheWriteOk) addWarning(result, "Cache write failed; the next refresh may charge again.");
  return { result, snapshotModules: organicSnapshotModules(scope, live.data, updatedAt, "live") };
}

async function executeBacklinksModule(context) {
  const { env, scope, allowLive, now, dependencies, attempts } = context;
  const key = backlinkSnapshotCacheKey(scope.domain);
  const cached = await env.CACHE.get(key, "json");
  if (cached) {
    const updatedAt = canonicalCacheAt(cached);
    return {
      result: defaultModuleResult("success", { cached: true, updated_at: updatedAt, snapshot_modules: ["backlinks"] }),
      snapshotModules: backlinksSnapshotModule(scope, cachedData(cached), updatedAt, "kv_cache"),
    };
  }
  const row = await env.DB.prepare(
    `SELECT domain_rank, backlinks, referring_domains, snapshot_at
     FROM backlink_snapshots WHERE domain = ?
     ORDER BY snapshot_at DESC, id DESC LIMIT 1`,
  ).bind(scope.domain).first();
  if (row) {
    return {
      result: defaultModuleResult("success", { cached: true, updated_at: row.snapshot_at, snapshot_modules: ["backlinks"] }),
      snapshotModules: backlinksSnapshotModule(scope, row, row.snapshot_at, "d1"),
    };
  }
  if (!allowLive) return { result: defaultModuleResult("confirmation_required", { error: { code: "LIVE_REQUEST_CONFIRMATION_REQUIRED", message: "No cached backlink overview exists." } }) };
  const live = await attempts.provider("backlinks", (signal) => dependencies.fetchBacklinkSummary({ env, scope, signal }));
  const updatedAt = canonicalCacheAt(live.data) ?? currentIso(now);
  let cacheWriteOk = true;
  try { await putCache(env.CACHE, key, { ...live.data, cached_at: updatedAt }, BACKLINK_CACHE_TTL_SECONDS); } catch { cacheWriteOk = false; }
  let historyWriteOk = true;
  try { await recordBacklinkSnapshot({ db: env.DB, snapshot: live.data, source: "live", actualCostUsd: actualCost(live) }); } catch { historyWriteOk = false; }
  const result = defaultModuleResult("success", {
    cached: false,
    task_count: taskCount(live),
    actual_cost_usd: actualCost(live),
    cache_write_ok: cacheWriteOk,
    updated_at: updatedAt,
    snapshot_modules: ["backlinks"],
  });
  if (!cacheWriteOk) addWarning(result, "Cache write failed; the next refresh may charge again.");
  if (!historyWriteOk) addWarning(result, "Backlink history persistence failed.");
  return { result, snapshotModules: backlinksSnapshotModule(scope, live.data, updatedAt, "live") };
}

async function gapFields(env, scope, competitor) {
  const keyword = await env.CACHE.get(buildKeywordGapCacheKey(competitor, scope.domain, scope.location_code, scope.language_code), "json");
  const backlinkKey = await backlinkGapCacheKey({ ownDomain: scope.domain, competitors: [competitor], limit: 25, offset: 0 });
  const backlink = await env.CACHE.get(backlinkKey, "json");
  const keywordData = cachedData(keyword);
  const backlinkData = cachedData(backlink);
  const keywordAt = canonicalCacheAt(keyword);
  const backlinkAt = canonicalCacheAt(backlink);
  return {
    competitor_only_keywords: keywordData?.total_gap_keywords ?? keywordData?.opportunities?.length ?? null,
    keyword_gap: keywordData?.total_gap_keywords ?? keywordData?.opportunities?.length ?? null,
    backlink_gap: backlinkData?.pagination?.total_count ?? backlinkData?.summary?.total_count ?? backlinkData?.items?.length ?? null,
    provenance: {
      keyword_gap: keywordData ? { source: "kv_cache", updated_at: keywordAt } : null,
      backlink_gap: backlinkData ? { source: "kv_cache", updated_at: backlinkAt } : null,
    },
    freshness: [keywordData ? keywordAt : undefined, backlinkData ? backlinkAt : undefined].filter((value) => value !== undefined),
  };
}

async function executeCompetitorsModule(context) {
  const { env, scope, competitors, allowLive, now, dependencies, attempts } = context;
  if (!competitors.length) return { result: defaultModuleResult("skip", { cached: false, error: { code: "NO_PROVIDER", message: "No competitors are configured for this site." } }) };
  const entries = [];
  const freshness = [];
  let freshnessContributors = 0;
  const accounting = createAccountingAccumulator();
  let cacheWriteOk = true;
  let usedLive = false;
  const errors = [];
  for (const competitor of competitors) {
    const key = buildCompetitorSnapshotCacheKey(competitor, scope.location_code, scope.language_code);
    const cached = await env.CACHE.get(key, "json");
    let data = cachedData(cached);
    let updatedAt = canonicalCacheAt(cached);
    let source = "kv_cache";
    if (!data) {
      if (!allowLive) return { result: defaultModuleResult("confirmation_required", { error: { code: "LIVE_REQUEST_CONFIRMATION_REQUIRED", message: "One or more competitor snapshots need a live refresh." } }) };
      usedLive = true;
      source = "live";
      try {
        const live = await attempts.provider("competitors", (signal) => dependencies.fetchCompetitorSnapshot({ env, scope, domain: competitor, signal }));
        addAccounting(accounting, live);
        data = live.data;
        updatedAt = currentIso(now);
        try { await putCache(env.CACHE, key, { data, cached_at: updatedAt }, COMPETITOR_CACHE_TTL_SECONDS); } catch { cacheWriteOk = false; }
      } catch (error) {
        addAccounting(accounting, error);
        errors.push(error);
        continue;
      }
    }
    const gaps = await gapFields(env, scope, competitor);
    freshness.push(updatedAt, ...gaps.freshness);
    freshnessContributors += 1 + gaps.freshness.length;
    entries.push({
      domain: competitor,
      ranked_keywords: data?.organic?.ranked_keywords ?? null,
      shared_keywords: null,
      estimated_traffic: data?.organic?.estimated_monthly_traffic ?? null,
      competitor_only_keywords: gaps.competitor_only_keywords,
      keyword_gap: gaps.keyword_gap,
      backlink_gap: gaps.backlink_gap,
      provenance: {
        ...gaps.provenance,
        ranked_keywords: { source, updated_at: updatedAt },
      },
    });
  }
  const status = errors.length ? (entries.length ? "partial_failure" : "error") : "success";
  const updatedAt = oldestFreshness(freshness, freshnessContributors);
  const result = applyAccounting(defaultModuleResult(status, {
    cached: !usedLive,
    cache_write_ok: cacheWriteOk,
    updated_at: updatedAt,
    snapshot_modules: status === "success" && entries.length ? ["competitors"] : [],
    ...(errors.length ? { error: safeError(errors[0], "COMPETITOR_SNAPSHOT_FAILED", "Competitor summary could not be refreshed.") } : {}),
  }), accounting);
  if (!cacheWriteOk) addWarning(result, "Cache write failed; the next refresh may charge again.");
  return {
    result,
    snapshotModules: status === "success" && entries.length ? {
      competitors: normalizeDashboardModule("competitors", { rows: entries }, {
        scope, source: usedLive ? "live" : "kv_cache", updated_at: updatedAt,
      }),
    } : {},
  };
}

function keywordOpportunityRows(entries) {
  return entries.flatMap((entry) => entry.rows ?? []).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).slice(0, 10);
}

async function executeKeywordOpportunitiesModule(context) {
  const { env, scope, competitors, allowLive, now, dependencies, attempts } = context;
  if (!competitors.length) return { result: defaultModuleResult("skip", { cached: false, error: { code: "NO_PROVIDER", message: "No competitors are configured for this site." } }) };
  const entries = [];
  const freshness = [];
  const accounting = createAccountingAccumulator();
  let cacheWriteOk = true;
  let usedLive = false;
  const errors = [];
  for (const competitor of competitors) {
    const key = buildKeywordGapCacheKey(competitor, scope.domain, scope.location_code, scope.language_code);
    const cached = await env.CACHE.get(key, "json");
    let data = cachedData(cached);
    let updatedAt = canonicalCacheAt(cached);
    if (!data) {
      if (!allowLive) return { result: defaultModuleResult("confirmation_required", { error: { code: "LIVE_REQUEST_CONFIRMATION_REQUIRED", message: "One or more keyword gap snapshots need a live refresh." } }) };
      usedLive = true;
      try {
        const live = await attempts.provider("keyword_opportunities", (signal) => dependencies.fetchKeywordGap({ env, scope, competitorDomain: competitor, ownDomain: scope.domain, signal }));
        addAccounting(accounting, live);
        data = live.data;
        updatedAt = currentIso(now);
        try { await putCache(env.CACHE, key, { ...data, cached_at: updatedAt }, KEYWORD_GAP_CACHE_TTL_SECONDS); } catch { cacheWriteOk = false; }
      } catch (error) {
        addAccounting(accounting, error);
        errors.push(error);
        continue;
      }
    }
    freshness.push(updatedAt);
    entries.push({ competitor, rows: (data?.opportunities ?? []).map((item) => ({
      keyword: item.keyword ?? null,
      competitor_domain: competitor,
      priority: item.priority ?? item.intelligence?.gap_priority?.score ?? null,
      title: item.keyword ?? null,
    })) });
  }
  const rows = keywordOpportunityRows(entries);
  const status = errors.length ? (entries.length ? "partial_failure" : "error") : "success";
  const updatedAt = oldestFreshness(freshness, entries.length);
  const result = applyAccounting(defaultModuleResult(status, {
    cached: !usedLive,
    cache_write_ok: cacheWriteOk,
    updated_at: updatedAt,
    snapshot_modules: status === "success" && rows.length ? ["keyword_opportunities"] : [],
    ...(errors.length ? { error: safeError(errors[0], "KEYWORD_GAP_FAILED", "Keyword opportunities could not be refreshed.") } : {}),
  }), accounting);
  if (!cacheWriteOk) addWarning(result, "Cache write failed; the next refresh may charge again.");
  return {
    result,
    snapshotModules: status === "success" && rows.length ? {
      keyword_opportunities: normalizeDashboardModule("keyword_opportunities", { rows }, {
        scope, source: usedLive ? "live" : "kv_cache", updated_at: updatedAt,
      }),
    } : {},
  };
}

function backlinkOpportunityRows(entries) {
  return entries.flatMap((entry) => entry.rows ?? []).sort((a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0)).slice(0, 10);
}

async function executeBacklinkOpportunitiesModule(context) {
  const { env, scope, competitors, allowLive, now, dependencies, attempts } = context;
  if (!competitors.length) return { result: defaultModuleResult("skip", { cached: false, error: { code: "NO_PROVIDER", message: "No competitors are configured for this site." } }) };
  const entries = [];
  const freshness = [];
  const accounting = createAccountingAccumulator();
  let cacheWriteOk = true;
  let usedLive = false;
  const errors = [];
  for (const competitor of competitors) {
    const key = await backlinkGapCacheKey({ ownDomain: scope.domain, competitors: [competitor], limit: 25, offset: 0 });
    const cached = await env.CACHE.get(key, "json");
    let data = cachedData(cached);
    let updatedAt = canonicalCacheAt(cached);
    if (!data) {
      if (!allowLive) return { result: defaultModuleResult("confirmation_required", { error: { code: "LIVE_REQUEST_CONFIRMATION_REQUIRED", message: "One or more backlink gap snapshots need a live refresh." } }) };
      usedLive = true;
      try {
        const live = await attempts.provider("backlink_opportunities", (signal) => dependencies.fetchBacklinkGap({ env, scope, competitor, signal }));
        addAccounting(accounting, live);
        data = live.data;
        updatedAt = currentIso(now);
        try { await putCache(env.CACHE, key, { ...data, cached_at: updatedAt }, BACKLINK_CACHE_TTL_SECONDS); } catch { cacheWriteOk = false; }
      } catch (error) {
        addAccounting(accounting, error);
        errors.push(error);
        continue;
      }
    }
    freshness.push(updatedAt);
    entries.push({ competitor, rows: (data?.items ?? []).map((item) => ({
      domain: item.domain ?? null,
      competitor_domain: competitor,
      opportunity_score: item.opportunity?.score ?? null,
      title: item.domain ?? null,
    })) });
  }
  const rows = backlinkOpportunityRows(entries);
  const status = errors.length ? (entries.length ? "partial_failure" : "error") : "success";
  const updatedAt = oldestFreshness(freshness, entries.length);
  const result = applyAccounting(defaultModuleResult(status, {
    cached: !usedLive,
    cache_write_ok: cacheWriteOk,
    updated_at: updatedAt,
    snapshot_modules: status === "success" && rows.length ? ["backlink_gap"] : [],
    ...(errors.length ? { error: safeError(errors[0], "BACKLINK_GAP_FAILED", "Backlink opportunities could not be refreshed.") } : {}),
  }), accounting);
  if (!cacheWriteOk) addWarning(result, "Cache write failed; the next refresh may charge again.");
  return {
    result,
    snapshotModules: status === "success" && rows.length ? {
      backlink_gap: normalizeDashboardModule("backlink_gap", { rows }, {
        scope, source: usedLive ? "live" : "kv_cache", updated_at: updatedAt,
      }),
    } : {},
  };
}

async function executeModule(moduleId, context) {
  if (moduleId === "organic") return executeOrganicModule(context);
  if (moduleId === "backlinks") return executeBacklinksModule(context);
  if (moduleId === "competitors") return executeCompetitorsModule(context);
  if (moduleId === "keyword_opportunities") return executeKeywordOpportunitiesModule(context);
  return executeBacklinkOpportunitiesModule(context);
}

function moduleFailure(error, providerAttempts) {
  const attempted = providerAttempts > 0 || error?.provider_attempted === true;
  return defaultModuleResult("error", {
    cached: false,
    provider_attempts: providerAttempts,
    actual_cost_usd: attempted ? actualCost(error) : 0,
    task_count: attempted ? taskCount(error) : 0,
    error: safeError(error, "DASHBOARD_MODULE_FAILED", "This dashboard module could not be refreshed."),
  });
}

async function runDefaultRefreshDashboard({ scope, selectedModules, confirmedLiveModules, env, requestId, now, dependencies, competitors, leaseGuard }) {
  const startedAt = Date.now();
  const results = {};
  const warnings = [];
  const attempts = createAttemptTracker({ env, requestId, leaseGuard });
  for (const moduleId of selectedModules) {
    const executionStartedAt = Date.now();
    const before = attempts.countFor(moduleId);
    let executed;
    try {
      executed = await executeModule(moduleId, {
        env, scope, competitors, allowLive: confirmedLiveModules.has(moduleId), now, dependencies, attempts,
      });
    } catch (error) {
      executed = { result: moduleFailure(error, attempts.countFor(moduleId) - before), snapshotModules: {} };
    }
    executed.result.provider_attempts = attempts.countFor(moduleId) - before;
    if (executed.result.provider_attempts === 0 && executed.result.status === "success") {
      await attempts.cached(moduleId, executed.result, Date.now() - executionStartedAt);
    }
    const accountingWarning = attempts.warningFor(moduleId);
    if (accountingWarning) {
      addWarning(executed.result, accountingWarning);
      warnings.push(`${moduleId}: ${accountingWarning}`);
    }
    const snapshotModules = executed.snapshotModules ?? {};
    if (Object.keys(snapshotModules).length) {
      try {
        await writeDashboardSnapshot(env.DB, scope, snapshotModules, { now });
      } catch {
        executed.result.snapshot_write_ok = false;
        addWarning(executed.result, "Dashboard snapshot persistence failed.");
        warnings.push(`${moduleId}: Dashboard snapshot persistence failed.`);
      }
    }
    results[moduleId] = executed.result;
  }

  const paid = Object.values(results).filter((result) => result.provider_attempts > 0);
  const costUnknown = paid.some((result) => result.actual_cost_usd === null);
  const tasksUnknown = paid.some((result) => result.task_count === null);
  const totalCost = costUnknown ? null : Object.values(results).reduce((total, result) => total + (numberOrNull(result.actual_cost_usd) ?? 0), 0);
  const totalTasks = tasksUnknown ? null : Object.values(results).reduce((total, result) => total + (Number.isInteger(result.task_count) ? result.task_count : 0), 0);
  return {
    status: 200,
    body: {
      ok: true,
      data: { scope, modules: results },
      warnings,
      meta: {
        actual_cost_usd: totalCost,
        total_actual_cost_usd: totalCost,
        task_count: totalTasks,
        duration_ms: Date.now() - startedAt,
      },
    },
  };
}

async function runWithSingleFlight(key, task) {
  const active = INFLIGHT.get(key);
  if (active) return active;
  const pending = task().finally(() => {
    if (INFLIGHT.get(key) === pending) INFLIGHT.delete(key);
  });
  INFLIGHT.set(key, pending);
  return pending;
}

function zeroCostFailure(status, code, message, scope, modules = {}) {
  return {
    status,
    body: {
      ok: false,
      error: { code, message },
      data: { scope, modules },
      meta: { actual_cost_usd: 0, total_actual_cost_usd: 0, task_count: 0 },
    },
  };
}

export async function refreshDashboard({
  body,
  env,
  requestId = crypto.randomUUID(),
  now = () => new Date(),
  dependencies: dependencyOverrides = {},
}) {
  const scope = normalizeDashboardScope(body);
  const selectedModules = orderedRefreshModules(body.modules ?? []);
  const confirmedLiveModules = parseConfirmedLiveModules(body, selectedModules);
  if (!env?.DB || !env?.CACHE) {
    return zeroCostFailure(503, "BINDING_MISSING", "Preview dashboard bindings are not configured.", scope);
  }
  const dependencies = defaultDependencies(dependencyOverrides);

  let preflight;
  try {
    const profile = await readDashboardRefreshProfile(env.DB, scope);
    preflight = await classifyDashboardRefresh({ db: env.DB, cache: env.CACHE, scope, selectedModules, competitors: profile.competitors });
  } catch {
    return zeroCostFailure(503, "DASHBOARD_CACHE_STATE_UNAVAILABLE", "Dashboard refresh state is temporarily unavailable.", scope);
  }
  if (liveConfirmationMissing(preflight.modules, confirmedLiveModules)) {
    return zeroCostFailure(409, "LIVE_REQUEST_CONFIRMATION_REQUIRED", "One or more selected modules require live confirmation.", scope, preflight.modules);
  }

  const authorizationKey = [...confirmedLiveModules].sort().join(",");
  const flightKey = `${dashboardScopeCacheKey(scope)}:${selectedModules.join(",")}:${authorizationKey}`;
  return runWithSingleFlight(flightKey, async () => {
    const leaseKey = `dashboard-refresh:${dashboardScopeCacheKey(scope)}`;
    let acquired;
    try {
      acquired = await acquireDashboardRefreshLease(
        env.DB,
        leaseKey,
        requestId,
        new Date(now().getTime() + Math.max(20, Number(dependencies.leaseDurationMs) || DEFAULT_LEASE_MS)).toISOString(),
        currentIso(now),
      );
    } catch {
      return zeroCostFailure(503, "DASHBOARD_LEASE_UNAVAILABLE", "Dashboard refresh coordination is temporarily unavailable.", scope);
    }
    if (!acquired) return zeroCostFailure(409, "REFRESH_ALREADY_RUNNING", "A dashboard refresh is already running for this scope.", scope);
    try {
      let postLock;
      try {
        postLock = await classifyDashboardRefresh({ db: env.DB, cache: env.CACHE, scope, selectedModules, competitors: preflight.competitors });
      } catch {
        return zeroCostFailure(503, "DASHBOARD_CACHE_STATE_UNAVAILABLE", "Dashboard refresh state is temporarily unavailable.", scope);
      }
      if (liveConfirmationMissing(postLock.modules, confirmedLiveModules)) {
        return zeroCostFailure(409, "LIVE_REQUEST_CONFIRMATION_REQUIRED", "One or more selected modules require live confirmation.", scope, postLock.modules);
      }
      const leaseGuard = createLeaseGuard({ db: env.DB, leaseKey, requestId, now, dependencies });
      return await runDefaultRefreshDashboard({
        scope,
        selectedModules,
        confirmedLiveModules,
        env,
        requestId,
        now,
        dependencies,
        competitors: postLock.competitors,
        leaseGuard,
      });
    } finally {
      await releaseDashboardRefreshLease(env.DB, leaseKey, requestId).catch(() => {});
    }
  });
}

export { DASHBOARD_REFRESH_MODULES, buildCompetitorSnapshotCacheKey, buildKeywordGapCacheKey, normalizeStoredModules };
