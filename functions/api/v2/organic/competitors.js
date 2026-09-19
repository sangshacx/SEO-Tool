import {
  OrganicCompetitorsProviderError,
  fetchOrganicCompetitors,
  normalizeOrganicCompetitorDomain,
} from "../../../../src/v2/providers/dataforseo-organic-competitors.js";
import { buildOrganicCompetitorsCacheKey } from "../../../../src/v2/organic/organic-competitors-cache.js";
import { normalizeMarketRequest } from "../../../../src/v2/markets/request-market.js";
import { recordApiUsage } from "../../../../src/v2/storage/keyword-overview.js";

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const ENDPOINT_NAME = "dataforseo_labs/google/competitors_domain/live";
const JSON_HEADERS = { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" };

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
      operation: "organic_competitors",
    });
  } catch (error) {
    console.error(JSON.stringify({ message: "organic competitors usage logging failed", error: error instanceof Error ? error.message : String(error) }));
  }
}

function parseBusinessCompetitors(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").map((item) => item.toLowerCase()) : []);
  } catch {
    return new Set();
  }
}

async function enrichBusinessCompetitors(db, data) {
  const row = await db.prepare("SELECT competitors_json FROM site_profiles WHERE domain = ?").bind(data.target).first();
  const saved = parseBusinessCompetitors(row?.competitors_json);
  return {
    ...data,
    competitors: (data.competitors ?? []).map((item) => ({
      ...item,
      business_competitor: saved.has(item.domain),
      competitor_type: saved.has(item.domain) ? "business_and_seo" : "seo",
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
  try { body = await request.json(); }
  catch { return json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400); }

  const domain = normalizeOrganicCompetitorDomain(body?.target ?? body?.domain);
  if (!domain) return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "target", message: "Enter a valid root domain." } }, 400);

  let locationCode;
  let languageCode;
  try { ({ locationCode, languageCode } = normalizeMarketRequest(body)); }
  catch { return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "market", message: "Select a supported country and language combination." } }, 400); }

  const cacheKey = buildOrganicCompetitorsCacheKey({ target: domain, locationCode, languageCode });
  const cached = await env.CACHE.get(cacheKey, "json");
  if (cached) {
    const raw = cached && typeof cached === "object" && Object.hasOwn(cached, "data") ? cached.data : cached;
    const data = await enrichBusinessCompetitors(env.DB, raw);
    await logUsage(env, { requestId, taskCount: 0, resultCount: data.competitors?.length ?? 0, actualCostUsd: 0, cacheHit: true, status: "success", httpStatus: 200, durationMs: Date.now() - startedAt });
    return json({ ok: true, data, meta: { request_id: requestId, cached: true, cached_at: cached?.cached_at ?? raw?.generated_at ?? null, actual_cost_usd: 0, cache_ttl_days: 7, provider_requests: 0, duration_ms: Date.now() - startedAt } });
  }

  if (body?.allow_live_request !== true) {
    return json({
      ok: false,
      error: { code: "LIVE_REQUEST_CONFIRMATION_REQUIRED", message: "No 7-day Organic Competitors cache exists. Allow a live request to continue." },
      meta: { request_id: requestId, cached: false, actual_cost_usd: 0, cache_ttl_days: 7, provider_requests: 0 },
    }, 409);
  }

  try {
    const provider = await fetchOrganicCompetitors({
      login: env.DATAFORSEO_LOGIN,
      password: env.DATAFORSEO_PASSWORD,
      target: domain,
      locationCode,
      languageCode,
    });
    const cachedAt = new Date().toISOString();
    await env.CACHE.put(cacheKey, JSON.stringify({ data: provider.data, cached_at: cachedAt }), { expirationTtl: CACHE_TTL_SECONDS });
    const data = await enrichBusinessCompetitors(env.DB, provider.data);
    await logUsage(env, { requestId, taskCount: provider.taskCount, resultCount: provider.resultCount, actualCostUsd: provider.actualCostUsd, cacheHit: false, status: "success", httpStatus: 200, durationMs: Date.now() - startedAt });
    return json({ ok: true, data, meta: { request_id: requestId, cached: false, cached_at: cachedAt, actual_cost_usd: provider.actualCostUsd, cache_ttl_days: 7, provider_requests: 1, duration_ms: Date.now() - startedAt } });
  } catch (error) {
    const providerError = error instanceof OrganicCompetitorsProviderError ? error : null;
    const httpStatus = providerError?.httpStatus ?? 502;
    await logUsage(env, { requestId, taskCount: providerError?.code === "PROVIDER_CREDENTIALS_MISSING" ? 0 : 1, resultCount: 0, actualCostUsd: providerError?.actualCostUsd ?? null, cacheHit: false, status: "error", httpStatus, durationMs: Date.now() - startedAt });
    return json({ ok: false, error: { code: providerError?.code ?? "ORGANIC_COMPETITORS_FAILED", message: "Organic Competitors could not be loaded." }, meta: { request_id: requestId } }, httpStatus);
  }
}

export function onRequestGet() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for Organic Competitors." } }, 405);
}
