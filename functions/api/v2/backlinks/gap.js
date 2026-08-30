import {
  backlinkGapCacheKey,
  isValidBacklinkDomain,
  normalizeBacklinkDomain,
} from "../../../../src/v2/backlinks/domain.js";
import {
  BacklinkGapProviderError,
  fetchBacklinkGap,
} from "../../../../src/v2/providers/dataforseo-backlink-gap.js";
import { recordApiUsage } from "../../../../src/v2/storage/keyword-overview.js";
import { assessBacklinkOutreach } from "../../../../src/v2/intelligence/backlink-outreach.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};
const ALLOWED_LIMITS = new Set([25, 50, 100]);
const MAX_OFFSET_EXCLUSIVE = 20000;
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_BODY_BYTES = 64 * 1024;

class RequestBodyError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function boundedRequestJson(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) throw new RequestBodyError("PAYLOAD_TOO_LARGE");
  if (!request.body) throw new RequestBodyError("INVALID_JSON");
  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RequestBodyError("PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(combined));
  } catch {
    throw new RequestBodyError("INVALID_JSON");
  }
}

async function logUsage(env, values) {
  try {
    await recordApiUsage({
      db: env.DB,
      ...values,
      provider: "dataforseo",
      endpoint: "backlinks/domain_intersection/live",
      operation: "backlink_gap",
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "backlink gap usage logging failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

function normalizeCompetitors(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeBacklinkDomain).filter(Boolean))].sort();
}

function addOutreachQuality(page) {
  return {
    ...page,
    items: (Array.isArray(page?.items) ? page.items : []).map((item) => ({
      ...item,
      outreach: assessBacklinkOutreach(item),
    })),
  };
}

export async function onRequestPost({ request, env }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  if (!env?.CACHE || !env?.DB) {
    return json({ ok: false, error: { code: "BINDINGS_MISSING", message: "Preview storage bindings are not configured." } }, 503);
  }
  let body;
  try {
    body = await boundedRequestJson(request);
  } catch (error) {
    if (error instanceof RequestBodyError && error.code === "PAYLOAD_TOO_LARGE") {
      return json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Request body must be 64 KB or smaller." } }, 413);
    }
    return json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400);
  }
  const ownDomain = normalizeBacklinkDomain(body?.own_domain);
  const competitors = normalizeCompetitors(body?.competitor_domains);
  const limit = Number(body?.limit ?? 25);
  const offset = Number(body?.offset ?? 0);
  if (!isValidBacklinkDomain(ownDomain)) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "own_domain", message: "Enter a valid own root domain without a path." } }, 400);
  }
  if (competitors.length < 1
    || competitors.length > 3
    || competitors.includes(ownDomain)
    || competitors.some((domain) => !isValidBacklinkDomain(domain))) {
    return json({ ok: false, error: { code: "INVALID_COMPETITORS", field: "competitor_domains", message: "Enter one to three valid competitor domains different from your own." } }, 400);
  }
  if (!Number.isInteger(limit) || !ALLOWED_LIMITS.has(limit)) {
    return json({ ok: false, error: { code: "INVALID_LIMIT", field: "limit", message: "Choose 25, 50, or 100 rows." } }, 400);
  }
  if (!Number.isInteger(offset) || offset < 0 || offset >= MAX_OFFSET_EXCLUSIVE || offset % limit !== 0) {
    return json({ ok: false, error: { code: "INVALID_OFFSET", field: "offset", message: "Offset must be a page boundary below 20,000." } }, 400);
  }
  const key = await backlinkGapCacheKey({ ownDomain, competitors, limit, offset });
  let cached;
  try {
    cached = await env.CACHE.get(key, "json");
  } catch (error) {
    await logUsage(env, {
      requestId,
      taskCount: 0,
      resultCount: 0,
      actualCostUsd: 0,
      cacheHit: false,
      status: "error",
      httpStatus: 503,
      durationMs: Date.now() - startedAt,
    });
    console.error(JSON.stringify({
      message: "backlink gap cache read failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return json({
      ok: false,
      error: { code: "CACHE_UNAVAILABLE", message: "Backlink gap cache is temporarily unavailable." },
      meta: { request_id: requestId, actual_cost_usd: 0 },
    }, 503);
  }
  if (cached) {
    await logUsage(env, {
      requestId,
      taskCount: 0,
      resultCount: cached.items?.length ?? 0,
      actualCostUsd: 0,
      cacheHit: true,
      status: "success",
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
    });
    return json({
      ok: true,
      data: addOutreachQuality(cached),
      meta: { request_id: requestId, cached: true, actual_cost_usd: 0, cache_ttl_days: 7, duration_ms: Date.now() - startedAt },
    });
  }
  if (body?.allow_live_request !== true) {
    return json({
      ok: false,
      error: { code: "LIVE_REQUEST_CONFIRMATION_REQUIRED", message: "No cached backlink gap page exists. Allow a live request to continue." },
      meta: { request_id: requestId, cached: false, actual_cost_usd: 0, cache_ttl_days: 7 },
    }, 409);
  }
  try {
    const provider = await fetchBacklinkGap({
      login: env.DATAFORSEO_LOGIN,
      password: env.DATAFORSEO_PASSWORD,
      ownDomain,
      competitors,
      limit,
      offset,
    });
    let cacheStored = true;
    try {
      await env.CACHE.put(key, JSON.stringify(provider.data), { expirationTtl: CACHE_TTL_SECONDS });
    } catch (error) {
      cacheStored = false;
      console.error(JSON.stringify({
        message: "backlink gap cache write failed",
        request_id: requestId,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
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
      data: addOutreachQuality(provider.data),
      meta: {
        request_id: requestId,
        cached: false,
        cache_stored: cacheStored,
        actual_cost_usd: provider.actualCostUsd,
        cache_ttl_days: 7,
        duration_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    const providerError = error instanceof BacklinkGapProviderError ? error : null;
    const httpStatus = providerError?.httpStatus ?? 502;
    await logUsage(env, {
      requestId,
      taskCount: 1,
      resultCount: 0,
      actualCostUsd: providerError?.actualCostUsd ?? null,
      cacheHit: false,
      status: "error",
      httpStatus,
      durationMs: Date.now() - startedAt,
    });
    console.error(JSON.stringify({
      message: "backlink gap request failed",
      request_id: requestId,
      code: providerError?.code ?? "BACKLINK_GAP_FAILED",
      provider_status: providerError?.providerStatus ?? null,
    }));
    return json({
      ok: false,
      error: { code: providerError?.code ?? "BACKLINK_GAP_FAILED", message: "Backlink gap opportunities could not be loaded." },
      meta: { request_id: requestId },
    }, httpStatus);
  }
}

export function onRequestGet() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for backlink gap analysis." } }, 405);
}
