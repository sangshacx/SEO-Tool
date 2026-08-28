import {
  BacklinkProviderError,
  fetchBacklinkSummary,
} from "../../../../src/v2/providers/dataforseo-backlinks.js";
import { enrichBacklinkSummary } from "../../../../src/v2/intelligence/backlink-health.js";
import {
  backlinkSnapshotCacheKey,
  isValidBacklinkDomain,
  normalizeBacklinkDomain,
} from "../../../../src/v2/backlinks/domain.js";
import { recordApiUsage } from "../../../../src/v2/storage/keyword-overview.js";
import { recordBacklinkSnapshot } from "../../../../src/v2/storage/backlink-history.js";

const ENDPOINT_NAME = "backlinks/summary/live";
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_BODY_BYTES = 64 * 1024;
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
      operation: "backlink_snapshot",
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "backlink snapshot usage logging failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function saveHistory(env, values) {
  try {
    return await recordBacklinkSnapshot({ db: env.DB, ...values });
  } catch (error) {
    console.error(JSON.stringify({
      message: "backlink history persistence failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return { inserted: false };
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
  if (!isValidBacklinkDomain(domain)) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "domain", message: "Enter a valid root domain without a path." } }, 400);
  }

  const key = backlinkSnapshotCacheKey(domain);
  const cached = await env.CACHE.get(key, "json");
  if (cached) {
    const enriched = enrichBacklinkSummary(cached);
    const history = await saveHistory(env, {
      snapshot: enriched,
      source: "cache",
      actualCostUsd: 0,
    });
    await logUsage(env, {
      requestId,
      taskCount: 0,
      resultCount: 1,
      actualCostUsd: 0,
      cacheHit: true,
      status: "success",
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
    });
    return json({
      ok: true,
      data: enriched,
      meta: { request_id: requestId, cached: true, actual_cost_usd: 0, cache_ttl_days: 7, history_inserted: history.inserted },
    });
  }

  if (body?.allow_live_request !== true) {
    return json({
      ok: false,
      error: {
        code: "LIVE_REQUEST_CONFIRMATION_REQUIRED",
        message: "No cached backlink snapshot exists. Allow a live request to continue.",
      },
      meta: { request_id: requestId, cached: false, actual_cost_usd: 0, cache_ttl_days: 7 },
    }, 409);
  }

  try {
    const provider = await fetchBacklinkSummary({
      login: env.DATAFORSEO_LOGIN,
      password: env.DATAFORSEO_PASSWORD,
      target: domain,
    });
    await env.CACHE.put(key, JSON.stringify(provider.data), { expirationTtl: CACHE_TTL_SECONDS });
    const history = await saveHistory(env, {
      snapshot: provider.data,
      source: "live",
      actualCostUsd: provider.actualCostUsd,
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
      data: provider.data,
      meta: {
        request_id: requestId,
        cached: false,
        actual_cost_usd: provider.actualCostUsd,
        cache_ttl_days: 7,
        history_inserted: history.inserted,
      },
    });
  } catch (error) {
    const providerError = error instanceof BacklinkProviderError ? error : null;
    const status = providerError?.httpStatus ?? 502;
    await logUsage(env, {
      requestId,
      taskCount: 1,
      resultCount: 0,
      actualCostUsd: providerError?.actualCostUsd ?? null,
      cacheHit: false,
      status: "error",
      httpStatus: status,
      durationMs: Date.now() - startedAt,
    });
    console.error(JSON.stringify({
      message: "backlink snapshot request failed",
      request_id: requestId,
      code: providerError?.code ?? "BACKLINK_SNAPSHOT_FAILED",
      provider_status: providerError?.providerStatus ?? null,
    }));
    return json({
      ok: false,
      error: {
        code: providerError?.code ?? "BACKLINK_SNAPSHOT_FAILED",
        message: "Backlink snapshot could not be completed.",
      },
      meta: { request_id: requestId },
    }, status);
  }
}

export function onRequestGet() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for backlink snapshots." } }, 405);
}
