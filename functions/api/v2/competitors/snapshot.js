import { recordApiUsage } from "../../../../src/v2/storage/keyword-overview.js";
import { normalizeMarketRequest } from "../../../../src/v2/markets/request-market.js";

const ENDPOINT = "https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live";
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const HEADERS = { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" };

function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: HEADERS }); }
function normalizeDomain(value) { return typeof value === "string" ? value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0] : ""; }
function validDomain(domain) { return domain.length <= 253 && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain); }
export function buildCompetitorSnapshotCacheKey(domain, locationCode, languageCode) { return ["v2", "competitor-snapshot", domain, locationCode, languageCode].join(":"); }
async function usage(env, values) { try { await recordApiUsage({ db: env.DB, ...values, provider: "dataforseo", endpoint: "dataforseo_labs/google/ranked_keywords/live", operation: "competitor_snapshot" }); } catch (error) { console.error(JSON.stringify({ message: "competitor snapshot usage logging failed", error: error instanceof Error ? error.message : String(error) })); } }

function normalizeResult(result, domain) {
  const organic = result?.metrics?.organic ?? {};
  const topKeywords = (result?.items ?? []).map((item) => {
    const data = item.keyword_data ?? {}, info = data.keyword_info ?? {}, serp = item.ranked_serp_element?.serp_item ?? {};
    return { keyword: data.keyword ?? null, position: serp.rank_group ?? null, search_volume: info.search_volume ?? null, keyword_difficulty: data.keyword_properties?.keyword_difficulty ?? null, cpc_usd: info.cpc ?? null, intent: data.search_intent_info?.main_intent ?? null, ranking_url: serp.url ?? null, estimated_traffic: item.etv ?? serp.etv ?? null };
  }).filter((item) => item.keyword);
  return { domain, organic: { estimated_monthly_traffic: organic.etv ?? null, ranked_keywords: organic.count ?? result?.total_count ?? null, estimated_paid_traffic_cost_usd: organic.estimated_paid_traffic_cost ?? null, positions: { top_1: organic.pos_1 ?? null, top_3: (organic.pos_1 ?? 0) + (organic.pos_2_3 ?? 0), top_10: (organic.pos_1 ?? 0) + (organic.pos_2_3 ?? 0) + (organic.pos_4_10 ?? 0) } }, top_keywords: topKeywords };
}

export async function onRequestPost({ request, env }) {
  const startedAt = Date.now(), requestId = crypto.randomUUID();
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400); }
  const domain = normalizeDomain(body?.domain);
  let locationCode;
  let languageCode;
  try { ({ locationCode, languageCode } = normalizeMarketRequest(body)); } catch { return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "market", message: "Select a supported country and language combination." } }, 400); }
  if (!validDomain(domain)) return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "domain", message: "Enter a valid root domain without a path." } }, 400);
  const cacheKey = buildCompetitorSnapshotCacheKey(domain, locationCode, languageCode), cached = await env.CACHE.get(cacheKey, "json");
  if (cached) { await usage(env, { requestId, taskCount: 0, resultCount: cached.top_keywords?.length ?? 0, actualCostUsd: 0, cacheHit: true, status: "success", httpStatus: 200, durationMs: Date.now() - startedAt }); return json({ ok: true, data: cached, meta: { request_id: requestId, cached: true, actual_cost_usd: 0, cache_ttl_days: 7 } }); }
  try {
    if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) throw new Error("PROVIDER_CREDENTIALS_MISSING");
    const response = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: "Basic " + btoa(env.DATAFORSEO_LOGIN + ":" + env.DATAFORSEO_PASSWORD), "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify([{ target: domain, location_code: locationCode, language_code: languageCode, item_types: ["organic"], ignore_synonyms: true, include_clickstream_data: false, limit: 10, order_by: ["ranked_serp_element.serp_item.rank_group,asc", "keyword_data.keyword_info.search_volume,desc"], tag: "seo-pro-v2-competitor-snapshot" }]) });
    const payload = await response.json(), task = payload.tasks?.[0];
    if (!response.ok || payload.status_code !== 20000 || task?.status_code !== 20000) throw new Error("PROVIDER_REQUEST_FAILED");
    const data = normalizeResult(task.result?.[0], domain), cost = typeof payload.cost === "number" ? payload.cost : (typeof task.cost === "number" ? task.cost : null);
    await env.CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL_SECONDS });
    await usage(env, { requestId, taskCount: payload.tasks_count ?? 1, resultCount: data.top_keywords.length, actualCostUsd: cost, cacheHit: false, status: "success", httpStatus: 200, durationMs: Date.now() - startedAt });
    return json({ ok: true, data, meta: { request_id: requestId, cached: false, actual_cost_usd: cost, cache_ttl_days: 7 } });
  } catch (error) {
    const code = error?.message === "PROVIDER_CREDENTIALS_MISSING" ? error.message : "COMPETITOR_SNAPSHOT_FAILED", status = code === "PROVIDER_CREDENTIALS_MISSING" ? 503 : 502;
    await usage(env, { requestId, taskCount: 1, resultCount: 0, actualCostUsd: null, cacheHit: false, status: "error", httpStatus: status, durationMs: Date.now() - startedAt });
    return json({ ok: false, error: { code, message: "Competitor snapshot could not be completed." }, meta: { request_id: requestId } }, status);
  }
}

export function onRequestGet() { return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for competitor snapshots." } }, 405); }
