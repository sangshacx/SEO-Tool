import {
  AI_VISIBILITY_HISTORY_MONTHS,
  AiVisibilityProviderError,
  fetchAiVisibilityHistorical,
  fetchAiVisibilityNewLost,
  normalizeAiVisibilityDomain,
  normalizeAiVisibilityMarket,
} from "../../../../src/v2/providers/dataforseo-ai-visibility.js";
import {
  AI_VISIBILITY_CACHE_TTL_SECONDS,
  readAiVisibilityCache,
  writeAiVisibilityCache,
} from "../../../../src/v2/ai/ai-visibility-cache.js";
import {
  persistAiVisibilityHistorical,
  persistAiVisibilityNewLost,
  readAiVisibilityHistorical,
  readAiVisibilityNewLost,
} from "../../../../src/v2/storage/ai-visibility.js";
import { normalizeMarketRequest } from "../../../../src/v2/markets/request-market.js";
import { recordApiUsage } from "../../../../src/v2/storage/keyword-overview.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};
const SERIES = new Set(["historical", "new_lost"]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function scopeFrom(input = {}) {
  const target = normalizeAiVisibilityDomain(input?.target ?? input?.domain);
  if (!target) {
    const error = new Error("Enter a valid managed root domain.");
    error.code = "VALIDATION_ERROR";
    error.httpStatus = 400;
    throw error;
  }

  let locationCode;
  let languageCode;
  try {
    ({ locationCode, languageCode } = normalizeMarketRequest(input));
  } catch {
    const error = new Error("Select a supported country and language combination.");
    error.code = "VALIDATION_ERROR";
    error.httpStatus = 400;
    throw error;
  }

  const market = normalizeAiVisibilityMarket({
    platform: input?.platform,
    locationCode,
    languageCode,
  });

  return {
    target,
    platform: market.platform,
    locationCode: market.locationCode,
    languageCode: market.languageCode,
  };
}

async function requireManagedSite(db, target) {
  const row = await db.prepare(
    "SELECT id FROM site_profiles WHERE domain = ? LIMIT 1",
  ).bind(target).first();
  if (!row?.id) {
    const error = new Error("AI Visibility History is available only for a saved own-site profile.");
    error.code = "MANAGED_SITE_REQUIRED";
    error.httpStatus = 409;
    throw error;
  }
  return row;
}

async function logUsage(env, values, series) {
  try {
    await recordApiUsage({
      db: env.DB,
      ...values,
      provider: "dataforseo",
      endpoint: series === "new_lost"
        ? "ai_optimization/llm_mentions/timeseries_new_lost/live"
        : "ai_optimization/llm_mentions/historical/live",
      operation: series === "new_lost" ? "ai_visibility_new_lost" : "ai_visibility_history",
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "AI visibility history usage logging failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

export async function onRequestGet({ request, env }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  if (!env?.DB) {
    return json({ ok: false, error: { code: "BINDING_MISSING", message: "Preview DB binding is not configured." } }, 503);
  }

  const url = new URL(request.url);
  let scope;
  try {
    scope = scopeFrom({
      target: url.searchParams.get("target") ?? url.searchParams.get("domain"),
      location_code: url.searchParams.get("location_code"),
      language_code: url.searchParams.get("language_code"),
      platform: url.searchParams.get("platform"),
    });
    await requireManagedSite(env.DB, scope.target);
  } catch (error) {
    const known = error instanceof AiVisibilityProviderError;
    return json({
      ok: false,
      error: {
        code: known ? error.code : error?.code ?? "VALIDATION_ERROR",
        message: error?.message ?? "Invalid AI visibility history request.",
      },
      meta: { request_id: requestId, actual_cost_usd: 0, provider_requests: 0 },
    }, known ? error.httpStatus : error?.httpStatus ?? 400);
  }

  try {
    const [historical, newLost] = await Promise.all([
      readAiVisibilityHistorical(env.DB, scope),
      readAiVisibilityNewLost(env.DB, scope),
    ]);
    const latestFetchedAt = [...historical, ...newLost]
      .map((row) => row.provider_fetched_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

    return json({
      ok: true,
      data: {
        target: scope.target,
        platform: scope.platform,
        location_code: scope.locationCode,
        language_code: scope.languageCode,
        historical,
        new_lost: newLost,
        ready: historical.length > 0 || newLost.length > 0,
      },
      meta: {
        request_id: requestId,
        source: "d1",
        provider_fetched_at: latestFetchedAt,
        actual_cost_usd: 0,
        provider_requests: 0,
        duration_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "AI visibility D1 history read failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return json({
      ok: false,
      error: { code: "AI_VISIBILITY_HISTORY_READ_FAILED", message: "Stored AI visibility history could not be loaded." },
      meta: { request_id: requestId },
    }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  if (!env?.CACHE || !env?.DB) {
    return json({ ok: false, error: { code: "BINDINGS_MISSING", message: "Preview storage bindings are not configured." } }, 503);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400); }

  const series = String(body?.series ?? "historical");
  if (!SERIES.has(series)) {
    return json({ ok: false, error: { code: "INVALID_SERIES", message: "Choose historical or new_lost." } }, 400);
  }

  const months = Number(body?.months ?? 12);
  if (!Number.isInteger(months) || !AI_VISIBILITY_HISTORY_MONTHS.includes(months)) {
    return json({ ok: false, error: { code: "INVALID_RANGE", message: "Choose 6, 12, or 0 for all available history." } }, 400);
  }

  let scope;
  try {
    scope = scopeFrom(body);
    await requireManagedSite(env.DB, scope.target);
  } catch (error) {
    const known = error instanceof AiVisibilityProviderError;
    return json({
      ok: false,
      error: {
        code: known ? error.code : error?.code ?? "VALIDATION_ERROR",
        message: error?.message ?? "Invalid AI visibility history request.",
      },
      meta: { request_id: requestId, actual_cost_usd: 0, provider_requests: 0 },
    }, known ? error.httpStatus : error?.httpStatus ?? 400);
  }

  const cacheInput = {
    ...scope,
    view: "history-" + series,
    limit: months,
  };
  const forceRefresh = body?.force_refresh === true;
  const cached = forceRefresh ? null : await readAiVisibilityCache(env.CACHE, cacheInput);

  if (cached) {
    await logUsage(env, {
      requestId,
      taskCount: 0,
      resultCount: cached.data?.points?.length ?? 0,
      actualCostUsd: 0,
      cacheHit: true,
      status: "success",
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
    }, series);
    return json({
      ok: true,
      data: { ...cached.data, source: "cache", series },
      meta: {
        request_id: requestId,
        cached: true,
        cached_at: cached.cached_at,
        actual_cost_usd: 0,
        provider_requests: 0,
        cache_ttl_days: AI_VISIBILITY_CACHE_TTL_SECONDS / 86400,
        duration_ms: Date.now() - startedAt,
      },
    });
  }

  if (body?.allow_live_request !== true) {
    return json({
      ok: false,
      error: {
        code: "LIVE_REQUEST_CONFIRMATION_REQUIRED",
        message: "No compatible AI visibility " + series + " cache exists. Allow one paid live request to continue.",
      },
      meta: {
        request_id: requestId,
        cached: false,
        series,
        actual_cost_usd: 0,
        provider_requests: 0,
        billing_note: "Each historical series refresh is a separate paid DataForSEO LLM Mentions request.",
      },
    }, 409);
  }

  try {
    const provider = series === "new_lost"
      ? await fetchAiVisibilityNewLost({
          login: env.DATAFORSEO_LOGIN,
          password: env.DATAFORSEO_PASSWORD,
          ...scope,
          months,
        })
      : await fetchAiVisibilityHistorical({
          login: env.DATAFORSEO_LOGIN,
          password: env.DATAFORSEO_PASSWORD,
          ...scope,
          months,
        });

    const cachedAt = new Date().toISOString();
    if (series === "new_lost") {
      await persistAiVisibilityNewLost({
        db: env.DB,
        ...scope,
        points: provider.data.points,
        providerFetchedAt: cachedAt,
      });
    } else {
      await persistAiVisibilityHistorical({
        db: env.DB,
        ...scope,
        points: provider.data.points,
        providerFetchedAt: cachedAt,
      });
    }
    await writeAiVisibilityCache(env.CACHE, cacheInput, provider.data, { cachedAt });

    await logUsage(env, {
      requestId,
      taskCount: provider.taskCount,
      resultCount: provider.resultCount,
      actualCostUsd: provider.actualCostUsd,
      cacheHit: false,
      status: "success",
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
    }, series);

    return json({
      ok: true,
      data: { ...provider.data, source: "provider", series },
      meta: {
        request_id: requestId,
        cached: false,
        cached_at: cachedAt,
        actual_cost_usd: provider.actualCostUsd,
        provider_requests: 1,
        cache_ttl_days: AI_VISIBILITY_CACHE_TTL_SECONDS / 86400,
        duration_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    const providerError = error instanceof AiVisibilityProviderError ? error : null;
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
    }, series);
    return json({
      ok: false,
      error: {
        code: providerError?.code ?? "AI_VISIBILITY_HISTORY_FAILED",
        message: providerError?.message ?? "AI visibility history refresh failed.",
      },
      meta: {
        request_id: requestId,
        actual_cost_usd: providerError?.actualCostUsd ?? null,
      },
    }, httpStatus);
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use GET for stored history or POST to refresh one paid history series." } }, 405);
}
