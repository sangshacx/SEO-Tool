import {
  RankedKeywordsProviderError,
  RANKED_KEYWORD_DEPTHS,
  fetchRankedKeywords,
  normalizeRankedKeywordsTarget,
} from "../../../../src/v2/providers/dataforseo-ranked-keywords.js";
import {
  organicKeywordsCacheCandidates,
  buildOrganicKeywordsCacheKey,
  projectOrganicKeywordsDepth,
} from "../../../../src/v2/organic/organic-keywords-cache.js";
import { normalizeMarketRequest } from "../../../../src/v2/markets/request-market.js";
import { recordApiUsage } from "../../../../src/v2/storage/keyword-overview.js";

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_BODY_BYTES = 64 * 1024;
const ENDPOINT_NAME = "dataforseo_labs/google/ranked_keywords/live";
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
      operation: "organic_keywords",
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "organic keywords usage logging failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function readHierarchicalCache(cache, input) {
  for (const candidate of organicKeywordsCacheCandidates(input)) {
    const entry = await cache.get(candidate.key, "json");
    if (!entry) continue;
    const data = entry && typeof entry === "object" && Object.hasOwn(entry, "data") ? entry.data : entry;
    return {
      data: projectOrganicKeywordsDepth(data, input.depth),
      cachedAt: entry?.cached_at ?? data?.generated_at ?? null,
      cachedFromDepth: candidate.depth,
    };
  }
  return null;
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
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400);
  }

  const normalizedTarget = normalizeRankedKeywordsTarget(body?.target ?? body?.domain);
  if (!normalizedTarget) {
    return json({
      ok: false,
      error: { code: "VALIDATION_ERROR", field: "target", message: "Enter a valid domain, subdomain, or absolute page URL." },
    }, 400);
  }

  const depth = Number(body?.depth ?? 500);
  if (!Number.isInteger(depth) || !RANKED_KEYWORD_DEPTHS.includes(depth)) {
    return json({
      ok: false,
      error: { code: "INVALID_DEPTH", field: "depth", message: "Choose Quick 100, Standard 500, or Deep 1000." },
    }, 400);
  }

  let locationCode;
  let languageCode;
  try {
    ({ locationCode, languageCode } = normalizeMarketRequest(body));
  } catch {
    return json({
      ok: false,
      error: { code: "VALIDATION_ERROR", field: "market", message: "Select a supported country and language combination." },
    }, 400);
  }

  const cacheInput = {
    target: normalizedTarget.target,
    locationCode,
    languageCode,
    historicalSerpMode: "live",
    depth,
  };
  const cached = await readHierarchicalCache(env.CACHE, cacheInput);
  if (cached) {
    await logUsage(env, {
      requestId,
      taskCount: 0,
      resultCount: cached.data.items?.length ?? 0,
      actualCostUsd: 0,
      cacheHit: true,
      status: "success",
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
    });
    return json({
      ok: true,
      data: cached.data,
      meta: {
        request_id: requestId,
        cached: true,
        cached_at: cached.cachedAt,
        cached_from_depth: cached.cachedFromDepth,
        requested_depth: depth,
        actual_cost_usd: 0,
        cache_ttl_days: 7,
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
        message: "No compatible 7-day Organic Keywords cache exists. Allow a live request to continue.",
      },
      meta: {
        request_id: requestId,
        cached: false,
        requested_depth: depth,
        actual_cost_usd: 0,
        cache_ttl_days: 7,
        provider_requests: 0,
      },
    }, 409);
  }

  try {
    const provider = await fetchRankedKeywords({
      login: env.DATAFORSEO_LOGIN,
      password: env.DATAFORSEO_PASSWORD,
      target: normalizedTarget.target,
      locationCode,
      languageCode,
      limit: depth,
      historicalSerpMode: "live",
    });
    const cachedAt = new Date().toISOString();
    const cacheKey = buildOrganicKeywordsCacheKey(cacheInput);
    await env.CACHE.put(
      cacheKey,
      JSON.stringify({ data: provider.data, cached_at: cachedAt }),
      { expirationTtl: CACHE_TTL_SECONDS },
    );
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
      data: provider.data,
      meta: {
        request_id: requestId,
        cached: false,
        cached_at: cachedAt,
        cached_from_depth: depth,
        requested_depth: depth,
        actual_cost_usd: provider.actualCostUsd,
        cache_ttl_days: 7,
        provider_requests: 1,
        duration_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    const providerError = error instanceof RankedKeywordsProviderError ? error : null;
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
    console.error(JSON.stringify({
      message: "organic keywords request failed",
      request_id: requestId,
      code: providerError?.code ?? "ORGANIC_KEYWORDS_FAILED",
      provider_status: providerError?.providerStatus ?? null,
    }));
    return json({
      ok: false,
      error: {
        code: providerError?.code ?? "ORGANIC_KEYWORDS_FAILED",
        message: "Organic Keywords could not be loaded.",
      },
      meta: { request_id: requestId },
    }, httpStatus);
  }
}

export function onRequestGet() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for Organic Keywords." } }, 405);
}
