import {
  OrganicHistoryProviderError,
  ORGANIC_HISTORY_MONTHS,
  fetchOrganicHistory,
  normalizeOrganicHistoryDomain,
} from "../../../../src/v2/providers/dataforseo-organic-history.js";
import {
  organicHistoryCacheCandidates,
  buildOrganicHistoryCacheKey,
  projectOrganicHistoryMonths,
} from "../../../../src/v2/organic/organic-history-cache.js";
import { summarizeOrganicHistory } from "../../../../src/v2/organic/organic-history.js";
import { normalizeMarketRequest } from "../../../../src/v2/markets/request-market.js";
import { normalizeDashboardScope } from "../../../../src/v2/dashboard/contracts.js";
import { readDashboardHistory } from "../../../../src/v2/storage/site-dashboard.js";
import { recordApiUsage } from "../../../../src/v2/storage/keyword-overview.js";

const PROVIDER_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const PROJECT_DAYS = new Set([0, 90, 180, 365, 730]);
const MAX_BODY_BYTES = 64 * 1024;
const ENDPOINT_NAME = "dataforseo_labs/google/historical_rank_overview/live";
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function logUsage(env, values) {
  try {
    await recordApiUsage({
      db: env.DB,
      ...values,
      provider: "dataforseo",
      endpoint: ENDPOINT_NAME,
      operation: "organic_history",
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "organic history usage logging failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function readHierarchicalCache(cache, input) {
  for (const candidate of organicHistoryCacheCandidates(input)) {
    const entry = await cache.get(candidate.key, "json");
    if (!entry) continue;
    const data = entry && typeof entry === "object" && Object.hasOwn(entry, "data") ? entry.data : entry;
    return {
      data: projectOrganicHistoryMonths(data, input.months),
      cachedAt: entry?.cached_at ?? data?.generated_at ?? null,
      cachedFromMonths: candidate.months,
    };
  }
  return null;
}

export async function onRequestGet({ request, env }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  if (!env?.DB) {
    return json({ ok: false, error: { code: "BINDING_MISSING", message: "Preview DB binding is not configured." } }, 503);
  }

  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? 365);
  if (!Number.isInteger(days) || !PROJECT_DAYS.has(days)) {
    return json({ ok: false, error: { code: "INVALID_RANGE", field: "days", message: "Choose 90, 180, 365, 730, or 0 for all Project History." } }, 400);
  }

  let scope;
  try {
    scope = normalizeDashboardScope({
      domain: url.searchParams.get("target") ?? url.searchParams.get("domain"),
      location_code: url.searchParams.get("location_code"),
      language_code: url.searchParams.get("language_code"),
    });
  } catch {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "target", message: "Enter a valid root domain and supported market." } }, 400);
  }

  try {
    const history = await readDashboardHistory(env.DB, scope, days);
    const points = history.organic ?? [];
    return json({
      ok: true,
      data: {
        target: scope.domain,
        source: "project",
        days,
        points,
        summary: summarizeOrganicHistory(points),
        disclaimer: "Project History contains SEO Pro V2 snapshots collected for this managed site and market. It does not backfill periods before snapshots were recorded.",
      },
      meta: {
        request_id: requestId,
        source: "d1",
        actual_cost_usd: 0,
        task_count: 0,
        provider_requests: 0,
        duration_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "organic project history query failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return json({ ok: false, error: { code: "PROJECT_HISTORY_FAILED", message: "Project History could not be loaded." }, meta: { request_id: requestId } }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Request body must be 64 KB or smaller." } }, 413);
  }
  if (!env?.CACHE || !env?.DB) {
    return json({ ok: false, error: { code: "BINDINGS_MISSING", message: "Preview storage bindings are not configured." } }, 503);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400); }

  const domain = normalizeOrganicHistoryDomain(body?.target ?? body?.domain);
  if (!domain) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "target", message: "Enter a valid root domain." } }, 400);
  }
  const months = Number(body?.months ?? 12);
  if (!Number.isInteger(months) || !ORGANIC_HISTORY_MONTHS.includes(months)) {
    return json({ ok: false, error: { code: "INVALID_RANGE", field: "months", message: "Choose 6, 12, 24, 36, or 60 months." } }, 400);
  }

  let locationCode;
  let languageCode;
  try { ({ locationCode, languageCode } = normalizeMarketRequest(body)); }
  catch { return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "market", message: "Select a supported country and language combination." } }, 400); }

  const cacheInput = { target: domain, locationCode, languageCode, months };
  const cached = await readHierarchicalCache(env.CACHE, cacheInput);
  if (cached) {
    await logUsage(env, {
      requestId,
      taskCount: 0,
      resultCount: cached.data.points?.length ?? 0,
      actualCostUsd: 0,
      cacheHit: true,
      status: "success",
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
    });
    return json({
      ok: true,
      data: { ...cached.data, source: "provider", summary: summarizeOrganicHistory(cached.data.points) },
      meta: {
        request_id: requestId,
        cached: true,
        cached_at: cached.cachedAt,
        cached_from_months: cached.cachedFromMonths,
        requested_months: months,
        actual_cost_usd: 0,
        cache_ttl_days: 30,
        provider_requests: 0,
        duration_ms: Date.now() - startedAt,
      },
    });
  }

  if (body?.allow_live_request !== true) {
    return json({
      ok: false,
      error: {
        code: "LIVE_REQUEST_CONFIRMATION_REQUIRED",
        message: "No compatible 30-day Provider History cache exists. Allow a live request to continue.",
      },
      meta: {
        request_id: requestId,
        cached: false,
        requested_months: months,
        actual_cost_usd: 0,
        cache_ttl_days: 30,
        provider_requests: 0,
      },
    }, 409);
  }

  try {
    const provider = await fetchOrganicHistory({
      login: env.DATAFORSEO_LOGIN,
      password: env.DATAFORSEO_PASSWORD,
      target: domain,
      locationCode,
      languageCode,
      months,
    });
    const cachedAt = new Date().toISOString();
    const cacheKey = buildOrganicHistoryCacheKey(cacheInput);
    await env.CACHE.put(cacheKey, JSON.stringify({ data: provider.data, cached_at: cachedAt }), { expirationTtl: PROVIDER_CACHE_TTL_SECONDS });
    await logUsage(env, {
      requestId,
      taskCount: provider.taskCount,
      resultCount: provider.resultCount,
      actualCostUsd: provider.actualCostUsd,
      cacheHit: false,
      status: "success",
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
    });
    return json({
      ok: true,
      data: { ...provider.data, source: "provider", summary: summarizeOrganicHistory(provider.data.points) },
      meta: {
        request_id: requestId,
        cached: false,
        cached_at: cachedAt,
        cached_from_months: months,
        requested_months: months,
        actual_cost_usd: provider.actualCostUsd,
        cache_ttl_days: 30,
        provider_requests: 1,
        duration_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    const providerError = error instanceof OrganicHistoryProviderError ? error : null;
    const httpStatus = providerError?.httpStatus ?? 502;
    await logUsage(env, {
      requestId,
      taskCount: providerError?.code === "PROVIDER_CREDENTIALS_MISSING" ? 0 : 1,
      resultCount: 0,
      actualCostUsd: providerError?.actualCostUsd ?? null,
      cacheHit: false,
      status: "error",
      httpStatus,
      durationMs: Date.now() - startedAt,
    });
    return json({
      ok: false,
      error: { code: providerError?.code ?? "ORGANIC_HISTORY_FAILED", message: "Provider History could not be loaded." },
      meta: { request_id: requestId },
    }, httpStatus);
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use GET for Project History or POST for Provider History." } }, 405);
}
