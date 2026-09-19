import {
  AiVisibilityProviderError,
  fetchAiVisibilityTargetMetrics,
  normalizeAiVisibilityDomain,
  normalizeAiVisibilityMarket,
} from "../../../../src/v2/providers/dataforseo-ai-visibility.js";
import {
  AI_VISIBILITY_CACHE_TTL_SECONDS,
  buildAiVisibilityCacheKey,
  readAiVisibilityCache,
  writeAiVisibilityCache,
} from "../../../../src/v2/ai/ai-visibility-cache.js";
import { normalizeMarketRequest } from "../../../../src/v2/markets/request-market.js";
import { recordApiUsage } from "../../../../src/v2/storage/keyword-overview.js";

const MAX_BODY_BYTES = 64 * 1024;
const ENDPOINT_NAME = "ai_optimization/llm_mentions/target_metrics/live";
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
      operation: "ai_visibility_target",
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "AI visibility usage logging failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function readBody(request) {
  const rawLength = request.headers.get("content-length");
  if (rawLength && /^\d+$/.test(rawLength.trim()) && Number(rawLength) > MAX_BODY_BYTES) {
    const error = new Error("Request body must be 64 KB or smaller.");
    error.code = "PAYLOAD_TOO_LARGE";
    error.httpStatus = 413;
    throw error;
  }
  let body;
  try { body = await request.json(); }
  catch {
    const error = new Error("Request body must be valid JSON.");
    error.code = "INVALID_JSON";
    error.httpStatus = 400;
    throw error;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const error = new Error("Request body must be a JSON object.");
    error.code = "INVALID_BODY";
    error.httpStatus = 400;
    throw error;
  }
  return body;
}

function validateRequest(body) {
  const domain = normalizeAiVisibilityDomain(body?.target ?? body?.domain);
  if (!domain) {
    const error = new Error("Enter a valid root domain.");
    error.code = "VALIDATION_ERROR";
    error.field = "target";
    error.httpStatus = 400;
    throw error;
  }

  let locationCode;
  let languageCode;
  try {
    ({ locationCode, languageCode } = normalizeMarketRequest(body));
  } catch {
    const error = new Error("Select a supported country and language combination.");
    error.code = "VALIDATION_ERROR";
    error.field = "market";
    error.httpStatus = 400;
    throw error;
  }

  const market = normalizeAiVisibilityMarket({
    platform: body?.platform,
    locationCode,
    languageCode,
  });

  return {
    target: domain,
    platform: market.platform,
    locationCode: market.locationCode,
    languageCode: market.languageCode,
  };
}

export async function onRequestPost({ request, env }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  if (!env?.CACHE || !env?.DB) {
    return json({
      ok: false,
      error: { code: "BINDINGS_MISSING", message: "Preview storage bindings are not configured." },
    }, 503);
  }

  let body;
  try {
    body = await readBody(request);
  } catch (error) {
    return json({
      ok: false,
      error: {
        code: error?.code ?? "INVALID_JSON",
        message: error?.message ?? "Invalid request.",
      },
    }, error?.httpStatus ?? 400);
  }

  let scope;
  try {
    scope = validateRequest(body);
  } catch (error) {
    const knownProvider = error instanceof AiVisibilityProviderError;
    return json({
      ok: false,
      error: {
        code: knownProvider ? error.code : error?.code ?? "VALIDATION_ERROR",
        message: error?.message ?? "Invalid AI visibility request.",
        ...(error?.field ? { field: error.field } : {}),
      },
      meta: {
        request_id: requestId,
        actual_cost_usd: 0,
        provider_requests: 0,
      },
    }, knownProvider ? error.httpStatus : error?.httpStatus ?? 400);
  }

  const cacheInput = {
    ...scope,
    view: "target",
  };
  const forceRefresh = body?.force_refresh === true;
  const cached = forceRefresh ? null : await readAiVisibilityCache(env.CACHE, cacheInput);

  if (cached) {
    await logUsage(env, {
      requestId,
      taskCount: 0,
      resultCount: 0,
      actualCostUsd: 0,
      cacheHit: true,
      status: "success",
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
    });
    return json({
      ok: true,
      data: { ...cached.data, source: "cache" },
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
        message: forceRefresh
          ? "A paid AI visibility refresh requires explicit confirmation."
          : "No AI visibility cache exists. Allow a paid live request to continue.",
      },
      meta: {
        request_id: requestId,
        cached: false,
        force_refresh: forceRefresh,
        actual_cost_usd: 0,
        provider_requests: 0,
        billing_note: "LLM Mentions is a paid DataForSEO request. Provider pricing is not hardcoded into SEO Pro V2.",
      },
    }, 409);
  }

  try {
    const provider = await fetchAiVisibilityTargetMetrics({
      login: env.DATAFORSEO_LOGIN,
      password: env.DATAFORSEO_PASSWORD,
      target: scope.target,
      platform: scope.platform,
      locationCode: scope.locationCode,
      languageCode: scope.languageCode,
    });

    const cachedAt = new Date().toISOString();
    await writeAiVisibilityCache(env.CACHE, cacheInput, provider.data, {
      cachedAt,
      ttlSeconds: AI_VISIBILITY_CACHE_TTL_SECONDS,
    });

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
      data: { ...provider.data, source: "provider" },
      meta: {
        request_id: requestId,
        cached: false,
        cached_at: cachedAt,
        force_refresh: forceRefresh,
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
    });
    return json({
      ok: false,
      error: {
        code: providerError?.code ?? "AI_VISIBILITY_FAILED",
        message: providerError?.message ?? "AI visibility could not be loaded.",
        provider_status: providerError?.providerStatus ?? undefined,
      },
      meta: {
        request_id: requestId,
        actual_cost_usd: providerError?.actualCostUsd ?? null,
      },
    }, httpStatus);
  }
}

export function onRequestGet() {
  return json({
    ok: false,
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "Use POST for AI visibility because the market and platform are explicit request inputs.",
    },
  }, 405);
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return onRequestGet(context);
}

export { buildAiVisibilityCacheKey };
