import {
  backlinkAnchorsCacheKey,
  isValidBacklinkDomain,
  normalizeBacklinkDomain,
} from "../../../../src/v2/backlinks/domain.js";
import { enrichAnchorPage } from "../../../../src/v2/intelligence/anchor-text.js";
import {
  BacklinkAnchorsProviderError,
  fetchBacklinkAnchors,
} from "../../../../src/v2/providers/dataforseo-backlink-anchors.js";
import { recordApiUsage } from "../../../../src/v2/storage/keyword-overview.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};
const ALLOWED_LIMITS = new Set([25, 50, 100]);
const ALLOWED_SORTS = new Set(["backlinks", "referring_domains", "rank", "spam_score", "first_seen"]);
const ALLOWED_STATUSES = new Set(["live", "lost"]);
const MAX_OFFSET_EXCLUSIVE = 20000;
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_BODY_BYTES = 64 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function logUsage(env, values) {
  try {
    await recordApiUsage({
      db: env.DB,
      ...values,
      provider: "dataforseo",
      endpoint: "backlinks/anchors/live",
      operation: "backlink_anchors",
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "backlink anchors usage logging failed",
      error: error instanceof Error ? error.message : String(error),
    }));
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
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400);
  }
  const domain = normalizeBacklinkDomain(body?.domain);
  const limit = Number(body?.limit ?? 25);
  const offset = Number(body?.offset ?? 0);
  const sort = typeof body?.sort === "string" ? body.sort : "backlinks";
  const status = typeof body?.status === "string" ? body.status : "live";
  const keyword = typeof body?.keyword === "string" ? body.keyword.trim() : "";
  if (!isValidBacklinkDomain(domain)) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "domain", message: "Enter a valid root domain without a path." } }, 400);
  }
  if (keyword.length > 200) {
    return json({ ok: false, error: { code: "INVALID_KEYWORD", field: "keyword", message: "Target keyword must be 200 characters or fewer." } }, 400);
  }
  if (!Number.isInteger(limit) || !ALLOWED_LIMITS.has(limit)) {
    return json({ ok: false, error: { code: "INVALID_LIMIT", field: "limit", message: "Choose 25, 50, or 100 rows." } }, 400);
  }
  if (!Number.isInteger(offset) || offset < 0 || offset >= MAX_OFFSET_EXCLUSIVE || offset % limit !== 0) {
    return json({ ok: false, error: { code: "INVALID_OFFSET", field: "offset", message: "Offset must be a page boundary below 20,000." } }, 400);
  }
  if (!ALLOWED_SORTS.has(sort)) {
    return json({ ok: false, error: { code: "INVALID_SORT", field: "sort", message: "Choose a supported anchor sort." } }, 400);
  }
  if (!ALLOWED_STATUSES.has(status)) {
    return json({ ok: false, error: { code: "INVALID_STATUS", field: "status", message: "Choose live or lost anchors." } }, 400);
  }
  const key = backlinkAnchorsCacheKey({ domain, limit, offset, sort, status });
  const cached = await env.CACHE.get(key, "json");
  if (cached) {
    const data = enrichAnchorPage(cached, { keyword });
    await logUsage(env, {
      requestId,
      taskCount: 0,
      resultCount: data.items.length,
      actualCostUsd: 0,
      cacheHit: true,
      status: "success",
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
    });
    return json({
      ok: true,
      data,
      meta: { request_id: requestId, cached: true, actual_cost_usd: 0, cache_ttl_days: 7, duration_ms: Date.now() - startedAt },
    });
  }
  if (!cached && body?.allow_live_request !== true) {
    return json({
      ok: false,
      error: { code: "LIVE_REQUEST_CONFIRMATION_REQUIRED", message: "No cached anchor page exists. Allow a live request to continue." },
      meta: { request_id: requestId, cached: false, actual_cost_usd: 0, cache_ttl_days: 7 },
    }, 409);
  }
  try {
    const provider = await fetchBacklinkAnchors({
      login: env.DATAFORSEO_LOGIN,
      password: env.DATAFORSEO_PASSWORD,
      target: domain,
      limit,
      offset,
      sort,
      status,
    });
    await env.CACHE.put(key, JSON.stringify(provider.data), { expirationTtl: CACHE_TTL_SECONDS });
    const data = enrichAnchorPage(provider.data, { keyword });
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
      data,
      meta: { request_id: requestId, cached: false, actual_cost_usd: provider.actualCostUsd, cache_ttl_days: 7, duration_ms: Date.now() - startedAt },
    });
  } catch (error) {
    const providerError = error instanceof BacklinkAnchorsProviderError ? error : null;
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
      message: "backlink anchors request failed",
      request_id: requestId,
      code: providerError?.code ?? "BACKLINK_ANCHORS_FAILED",
      provider_status: providerError?.providerStatus ?? null,
    }));
    return json({
      ok: false,
      error: { code: providerError?.code ?? "BACKLINK_ANCHORS_FAILED", message: "Anchor data could not be loaded." },
      meta: { request_id: requestId },
    }, httpStatus);
  }
}

export function onRequestGet() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for anchor analysis." } }, 405);
}
