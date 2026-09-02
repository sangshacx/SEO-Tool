import { scoreKeywordPotential } from "../../../../src/v2/scoring/keyword-potential.js";
import { recordApiUsage } from "../../../../src/v2/storage/keyword-overview.js";
import { normalizeMarketRequest } from "../../../../src/v2/markets/request-market.js";
import { buildKeywordGapCacheKey } from "../../../../src/v2/dashboard/cache-keys.js";

export { buildKeywordGapCacheKey };

const ENDPOINT = "https://api.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live";
const ENDPOINT_NAME = "dataforseo_labs/google/domain_intersection/live";
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const RESULT_LIMIT = 50;
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function normalizeDomain(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0]
    : "";
}

function validDomain(domain) {
  return domain.length <= 253 && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain);
}

async function logUsage(env, values) {
  try {
    await recordApiUsage({
      db: env.DB,
      ...values,
      provider: "dataforseo",
      endpoint: ENDPOINT_NAME,
      operation: "keyword_gap",
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "keyword gap usage logging failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

function rankSignal(position) {
  if (!Number.isFinite(position)) return 20;
  if (position <= 3) return 100;
  if (position <= 10) return 85;
  if (position <= 20) return 65;
  if (position <= 50) return 40;
  return 20;
}

function opportunityLabel(score) {
  if (score >= 75) return "High";
  if (score >= 55) return "Medium";
  return "Low";
}

function normalizeItem(item) {
  const keywordData = item?.keyword_data ?? {};
  const keywordInfo = keywordData.keyword_info ?? {};
  const serp = item?.first_domain_serp_element ?? {};
  const position = serp.rank_group ?? null;
  const metrics = {
    search_volume: keywordInfo.search_volume ?? null,
    keyword_difficulty: keywordData.keyword_properties?.keyword_difficulty ?? null,
    cpc_usd: keywordInfo.cpc ?? null,
    competition: keywordInfo.competition ?? null,
    competition_level: keywordInfo.competition_level ?? null,
  };
  const intent = {
    primary: keywordData.search_intent_info?.main_intent ?? null,
    secondary: keywordData.search_intent_info?.foreign_intent ?? [],
  };
  const potential = scoreKeywordPotential({ metrics, intent, trend: { change: {} } });
  const potentialScore = potential?.score;
  const priority = Math.round(
    potentialScore === null || potentialScore === undefined
      ? rankSignal(position)
      : potentialScore * 0.75 + rankSignal(position) * 0.25,
  );

  return {
    keyword: keywordData.keyword ?? null,
    metrics,
    intent,
    competitor_position: position,
    competitor_url: serp.url ?? null,
    estimated_traffic: serp.etv ?? null,
    intelligence: {
      keyword_potential: potential,
      gap_priority: {
        score: priority,
        label: opportunityLabel(priority),
        version: "keyword-gap-v0.1",
      },
    },
  };
}

function normalizeResult(result, competitorDomain, ownDomain) {
  const opportunities = (result?.items ?? [])
    .map(normalizeItem)
    .filter((item) => item.keyword)
    .sort((a, b) => b.intelligence.gap_priority.score - a.intelligence.gap_priority.score);

  return {
    competitor_domain: competitorDomain,
    own_domain: ownDomain,
    total_gap_keywords: result?.total_count ?? opportunities.length,
    opportunities,
  };
}

export async function onRequestPost({ request, env }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  let body;

  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400);
  }

  const competitorDomain = normalizeDomain(body?.competitor_domain);
  const ownDomain = normalizeDomain(body?.own_domain);
  let locationCode;
  let languageCode;
  try {
    ({ locationCode, languageCode } = normalizeMarketRequest(body));
  } catch {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "market", message: "Select a supported country and language combination." } }, 400);
  }

  if (!validDomain(competitorDomain)) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "competitor_domain", message: "Enter a valid competitor root domain." } }, 400);
  }
  if (!validDomain(ownDomain)) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "own_domain", message: "Enter a valid own-site root domain." } }, 400);
  }
  if (competitorDomain === ownDomain) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "own_domain", message: "Own site and competitor must be different domains." } }, 400);
  }

  const key = buildKeywordGapCacheKey(competitorDomain, ownDomain, locationCode, languageCode);
  const cached = await env.CACHE.get(key, "json");
  if (cached) {
    await logUsage(env, {
      requestId,
      taskCount: 0,
      resultCount: cached.opportunities?.length ?? 0,
      actualCostUsd: 0,
      cacheHit: true,
      status: "success",
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
    });
    return json({
      ok: true,
      data: cached,
      meta: { request_id: requestId, cached: true, actual_cost_usd: 0, result_count: cached.opportunities?.length ?? 0, cache_ttl_days: 7 },
    });
  }

  try {
    if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
      throw new Error("PROVIDER_CREDENTIALS_MISSING");
    }

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(env.DATAFORSEO_LOGIN + ":" + env.DATAFORSEO_PASSWORD),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify([{
        target1: competitorDomain,
        target2: ownDomain,
        location_code: locationCode,
        language_code: languageCode,
        intersections: false,
        item_types: ["organic"],
        include_serp_info: false,
        include_clickstream_data: false,
        filters: [["first_domain_serp_element.etv", ">", 0]],
        limit: RESULT_LIMIT,
        order_by: ["keyword_data.keyword_info.search_volume,desc", "first_domain_serp_element.rank_group,asc"],
        tag: "seo-pro-v2-keyword-gap",
      }]),
    });
    const payload = await response.json();
    const task = payload.tasks?.[0];

    if (!response.ok || payload.status_code !== 20000 || task?.status_code !== 20000) {
      const providerMessage = task?.status_message ?? payload.status_message ?? "Provider request failed.";
      console.error(JSON.stringify({ message: "keyword gap provider request failed", provider_status: task?.status_code ?? payload.status_code, provider_message: providerMessage }));
      throw new Error("PROVIDER_REQUEST_FAILED");
    }

    const data = normalizeResult(task.result?.[0], competitorDomain, ownDomain);
    const cost = typeof payload.cost === "number" ? payload.cost : (typeof task.cost === "number" ? task.cost : null);
    await env.CACHE.put(key, JSON.stringify(data), { expirationTtl: CACHE_TTL_SECONDS });
    await logUsage(env, {
      requestId,
      taskCount: Number.isInteger(payload.tasks_count) ? payload.tasks_count : null,
      resultCount: data.opportunities.length,
      actualCostUsd: cost,
      cacheHit: false,
      status: "success",
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
    });

    return json({
      ok: true,
      data,
      meta: { request_id: requestId, cached: false, actual_cost_usd: cost, result_count: data.opportunities.length, cache_ttl_days: 7 },
    });
  } catch (error) {
    const code = error?.message === "PROVIDER_CREDENTIALS_MISSING" ? error.message : "KEYWORD_GAP_FAILED";
    const status = code === "PROVIDER_CREDENTIALS_MISSING" ? 503 : 502;
    await logUsage(env, {
      requestId,
      taskCount: null,
      resultCount: 0,
      actualCostUsd: null,
      cacheHit: false,
      status: "error",
      httpStatus: status,
      durationMs: Date.now() - startedAt,
    });
    return json({ ok: false, error: { code, message: "Keyword gap analysis could not be completed." }, meta: { request_id: requestId } }, status);
  }
}

export function onRequestGet() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for keyword gap analysis." } }, 405);
}
