import { readBoundedJson } from "./bounded-json.js";

export const RANKED_KEYWORDS_ENDPOINT = "https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live";
export const RANKED_KEYWORD_DEPTHS = Object.freeze([100, 500, 1000]);
export const RANKED_KEYWORD_HISTORY_MODES = Object.freeze(["live", "lost", "all"]);

export class RankedKeywordsProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RankedKeywordsProviderError";
    this.code = details.code ?? "RANKED_KEYWORDS_PROVIDER_ERROR";
    this.httpStatus = details.httpStatus ?? 502;
    this.providerStatus = details.providerStatus ?? null;
    this.actualCostUsd = details.actualCostUsd ?? null;
  }
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value, maxLength = 2000) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function validHostname(hostname) {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname);
}

export function normalizeRankedKeywordsTarget(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (!["http:", "https:"].includes(url.protocol) || !validHostname(url.hostname)) return null;
      url.hash = "";
      return { target: url.toString(), target_type: "url" };
    } catch {
      return null;
    }
  }
  const domain = raw.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!validHostname(domain)) return null;
  return { target: domain, target_type: "domain" };
}

function movementFor(serp, ranked) {
  const changes = serp?.rank_changes ?? {};
  const currentAbsolute = finite(serp?.rank_absolute);
  const previousAbsolute = finite(changes?.previous_rank_absolute);
  return {
    is_new: changes?.is_new === true,
    is_up: changes?.is_up === true,
    is_down: changes?.is_down === true,
    is_lost: ranked?.is_lost === true,
    previous_absolute_position: previousAbsolute,
    absolute_delta:
      currentAbsolute !== null && previousAbsolute !== null
        ? previousAbsolute - currentAbsolute
        : null,
  };
}

function normalizeItem(item, totalEtv) {
  const keywordData = item?.keyword_data ?? {};
  const info = keywordData.keyword_info ?? {};
  const props = keywordData.keyword_properties ?? {};
  const intent = keywordData.search_intent_info ?? {};
  const serpInfo = keywordData.serp_info ?? {};
  const ranked = item?.ranked_serp_element ?? {};
  const serp = ranked.serp_item ?? {};
  const etv = finite(serp.etv);

  return {
    keyword: stringOrNull(keywordData.keyword, 1000),
    intent: {
      primary: stringOrNull(intent.main_intent, 100),
      secondary: Array.isArray(intent.foreign_intent)
        ? intent.foreign_intent.filter((value) => typeof value === "string").slice(0, 10)
        : [],
    },
    position: finite(serp.rank_group),
    absolute_position: finite(serp.rank_absolute),
    movement: movementFor(serp, ranked),
    search_volume: finite(info.search_volume),
    keyword_difficulty: finite(props.keyword_difficulty ?? ranked.keyword_difficulty),
    cpc_usd: finite(info.cpc),
    competition: finite(info.competition),
    competition_level: stringOrNull(info.competition_level, 50),
    estimated_traffic: etv,
    traffic_share_percent:
      etv !== null && totalEtv !== null && totalEtv > 0
        ? Math.round((etv / totalEtv) * 10000) / 100
        : null,
    estimated_paid_traffic_cost_usd: finite(serp.estimated_paid_traffic_cost),
    ranking_url: stringOrNull(serp.url, 4000),
    ranking_title: stringOrNull(serp.title, 1000),
    relative_url: stringOrNull(serp.relative_url, 2000),
    serp_features: Array.isArray(serpInfo.serp_item_types)
      ? serpInfo.serp_item_types.filter((value) => typeof value === "string").slice(0, 60)
      : Array.isArray(ranked.serp_item_types)
        ? ranked.serp_item_types.filter((value) => typeof value === "string").slice(0, 60)
        : [],
    serp_last_updated_at: stringOrNull(ranked.last_updated_time ?? serpInfo.last_updated_time, 100),
    serp_previous_updated_at: stringOrNull(ranked.previous_updated_time ?? serpInfo.previous_updated_time, 100),
    keyword_metrics_updated_at: stringOrNull(info.last_updated_time, 100),
  };
}

function positionMetrics(organic = {}) {
  const value = (key) => finite(organic?.[key]) ?? 0;
  return {
    top_1: value("pos_1"),
    top_3: value("pos_1") + value("pos_2_3"),
    top_10: value("pos_1") + value("pos_2_3") + value("pos_4_10"),
    top_20: value("pos_1") + value("pos_2_3") + value("pos_4_10") + value("pos_11_20"),
    top_50:
      value("pos_1") + value("pos_2_3") + value("pos_4_10") + value("pos_11_20") +
      value("pos_21_30") + value("pos_31_40") + value("pos_41_50"),
    top_100:
      value("pos_1") + value("pos_2_3") + value("pos_4_10") + value("pos_11_20") +
      value("pos_21_30") + value("pos_31_40") + value("pos_41_50") + value("pos_51_60") +
      value("pos_61_70") + value("pos_71_80") + value("pos_81_90") + value("pos_91_100"),
  };
}

function latestIso(values) {
  return values
    .filter((value) => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .map((value) => new Date(value).toISOString())
    .sort()
    .at(-1) ?? null;
}

function normalizeResult(result, request) {
  const organic = result?.metrics?.organic ?? {};
  const totalEtv = finite(organic.etv);
  const items = (Array.isArray(result?.items) ? result.items : [])
    .map((item) => normalizeItem(item, totalEtv))
    .filter((item) => item.keyword);

  return {
    target: request.target,
    target_type: request.targetType,
    historical_serp_mode: request.historicalSerpMode,
    depth: request.limit,
    total_count: finite(result?.total_count) ?? items.length,
    returned_count: items.length,
    organic: {
      ranked_keywords: finite(organic.count ?? result?.total_count),
      estimated_monthly_traffic: totalEtv,
      estimated_paid_traffic_cost_usd: finite(organic.estimated_paid_traffic_cost),
      positions: positionMetrics(organic),
      changes: {
        new: finite(organic.is_new),
        up: finite(organic.is_up),
        down: finite(organic.is_down),
        lost: finite(organic.is_lost),
      },
    },
    update_window: {
      previous_updated_at: latestIso(items.map((item) => item.serp_previous_updated_at)),
      last_updated_at: latestIso(items.map((item) => item.serp_last_updated_at)),
    },
    items,
    generated_at: new Date().toISOString(),
    disclaimer:
      "Organic positions use rank_group. Movement uses DataForSEO absolute SERP rank changes since each keyword's previous provider update.",
  };
}

export async function fetchRankedKeywords({
  login,
  password,
  target,
  locationCode,
  languageCode,
  limit = 500,
  historicalSerpMode = "live",
}) {
  if (!login || !password) {
    throw new RankedKeywordsProviderError("DataForSEO credentials are not configured.", {
      code: "PROVIDER_CREDENTIALS_MISSING",
      httpStatus: 503,
    });
  }
  const normalized = normalizeRankedKeywordsTarget(target);
  if (!normalized) {
    throw new RankedKeywordsProviderError("A valid domain, subdomain, or absolute URL is required.", {
      code: "INVALID_PROVIDER_TARGET",
      httpStatus: 400,
    });
  }
  if (!RANKED_KEYWORD_DEPTHS.includes(Number(limit))) {
    throw new RankedKeywordsProviderError("Choose a supported result depth.", {
      code: "INVALID_PROVIDER_LIMIT",
      httpStatus: 400,
    });
  }
  if (!RANKED_KEYWORD_HISTORY_MODES.includes(historicalSerpMode)) {
    throw new RankedKeywordsProviderError("Choose a supported historical SERP mode.", {
      code: "INVALID_PROVIDER_HISTORY_MODE",
      httpStatus: 400,
    });
  }

  const task = {
    target: normalized.target,
    location_code: locationCode,
    language_code: languageCode,
    item_types: ["organic"],
    ignore_synonyms: true,
    include_clickstream_data: false,
    load_rank_absolute: true,
    historical_serp_mode: historicalSerpMode,
    limit: Number(limit),
    order_by: [
      "ranked_serp_element.serp_item.etv,desc",
      "keyword_data.keyword_info.search_volume,desc",
    ],
    tag: "seo-pro-v2-organic-keywords",
  };

  const response = await fetch(RANKED_KEYWORDS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(login + ":" + password),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify([task]),
  });

  let payload;
  try {
    payload = await readBoundedJson(response);
  } catch (error) {
    throw new RankedKeywordsProviderError("DataForSEO returned an invalid response.", {
      code: error?.code ?? "PROVIDER_INVALID_RESPONSE",
      providerStatus: response.status,
    });
  }

  const providerTask = payload?.tasks?.[0];
  const actualCostUsd = finite(payload?.cost) ?? finite(providerTask?.cost);
  if (!response.ok || payload?.status_code !== 20000 || providerTask?.status_code !== 20000) {
    throw new RankedKeywordsProviderError("DataForSEO could not complete the ranked keywords request.", {
      code: "PROVIDER_REQUEST_FAILED",
      providerStatus: providerTask?.status_code ?? payload?.status_code ?? response.status,
      actualCostUsd,
    });
  }

  const result = providerTask?.result?.[0] ?? null;
  return {
    data: normalizeResult(result, {
      target: normalized.target,
      targetType: normalized.target_type,
      historicalSerpMode,
      limit: Number(limit),
    }),
    actualCostUsd,
    taskCount: Number.isInteger(payload?.tasks_count) ? payload.tasks_count : 1,
    resultCount: Number.isInteger(result?.items_count)
      ? result.items_count
      : Array.isArray(result?.items) ? result.items.length : 0,
  };
}
