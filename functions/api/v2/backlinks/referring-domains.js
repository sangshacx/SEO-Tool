import {
  ReferringDomainsProviderError,
  fetchReferringDomains,
} from "../../../../src/v2/providers/dataforseo-referring-domains.js";
import {
  isValidBacklinkDomain,
  normalizeBacklinkDomain,
  referringDomainsCacheKey,
} from "../../../../src/v2/backlinks/domain.js";
import { recordApiUsage } from "../../../../src/v2/storage/keyword-overview.js";

const ENDPOINT_NAME = "backlinks/referring_domains/live";
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_BODY_BYTES = 64 * 1024;
const ALLOWED_LIMITS = new Set([25, 50, 100]);
const ALLOWED_SORTS = new Set(["rank", "backlinks", "spam_score", "first_seen"]);
const MAX_OFFSET = 100000;
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
      operation: "referring_domains",
    });
  } catch (error) {
    console.error(JSON.stringify({ message: "referring domains usage logging failed", error: error instanceof Error ? error.message : String(error) }));
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
  const sort = typeof body?.sort === "string" ? body.sort : "rank";
  if (!isValidBacklinkDomain(domain)) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "domain", message: "Enter a valid root domain without a path." } }, 400);
  }
  if (!Number.isInteger(limit) || !ALLOWED_LIMITS.has(limit)) {
    return json({ ok: false, error: { code: "INVALID_LIMIT", field: "limit", message: "Choose 25, 50, or 100 rows." } }, 400);
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET || offset % limit !== 0) {
    return json({ ok: false, error: { code: "INVALID_OFFSET", field: "offset", message: "Offset must be a non-negative page boundary." } }, 400);
  }
  if (!ALLOWED_SORTS.has(sort)) {
    return json({ ok: false, error: { code: "INVALID_SORT", field: "sort", message: "Choose a supported referring domain sort." } }, 400);
  }

  const key = referringDomainsCacheKey({ domain, limit, offset, sort });
  const cached = await env.CACHE.get(key, "json");
  if (cached) {
    await logUsage(env, { requestId, taskCount: 0, resultCount: cached.items?.length ?? 0, actualCostUsd: 0, cacheHit: true, status: "success", httpStatus: 200, durationMs: Date.now() - startedAt });
    return json({ ok: true, data: cached, meta: { request_id: requestId, cached: true, actual_cost_usd: 0, cache_ttl_days: 7, duration_ms: Date.now() - startedAt } });
  }

  if (body?.allow_live_request !== true) {
    return json({
      ok: false,
      error: { code: "LIVE_REQUEST_CONFIRMATION_REQUIRED", message: "No cached referring domains page exists. Allow a live request to continue." },
      meta: { request_id: requestId, cached: false, actual_cost_usd: 0, cache_ttl_days: 7 },
    }, 409);
  }

  try {
    const provider = await fetchReferringDomains({ login: env.DATAFORSEO_LOGIN, password: env.DATAFORSEO_PASSWORD, target: domain, limit, offset, sort });
    await env.CACHE.put(key, JSON.stringify(provider.data), { expirationTtl: CACHE_TTL_SECONDS });
    await logUsage(env, { requestId, taskCount: provider.taskCount, resultCount: provider.resultCount, actualCostUsd: provider.actualCostUsd, cacheHit: false, status: "success", httpStatus: 200, durationMs: Date.now() - startedAt });
    return json({ ok: true, data: provider.data, meta: { request_id: requestId, cached: false, actual_cost_usd: provider.actualCostUsd, cache_ttl_days: 7, duration_ms: Date.now() - startedAt } });
  } catch (error) {
    const providerError = error instanceof ReferringDomainsProviderError ? error : null;
    const status = providerError?.httpStatus ?? 502;
    await logUsage(env, { requestId, taskCount: 1, resultCount: 0, actualCostUsd: providerError?.actualCostUsd ?? null, cacheHit: false, status: "error", httpStatus: status, durationMs: Date.now() - startedAt });
    console.error(JSON.stringify({ message: "referring domains request failed", request_id: requestId, code: providerError?.code ?? "REFERRING_DOMAINS_FAILED", provider_status: providerError?.providerStatus ?? null }));
    return json({ ok: false, error: { code: providerError?.code ?? "REFERRING_DOMAINS_FAILED", message: "Referring domains could not be loaded." }, meta: { request_id: requestId } }, status);
  }
}

export function onRequestGet() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for referring domains." } }, 405);
}
