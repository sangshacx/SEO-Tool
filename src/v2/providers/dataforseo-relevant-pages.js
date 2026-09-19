import { readBoundedJson } from "./bounded-json.js";

export const RELEVANT_PAGES_ENDPOINT = "https://api.dataforseo.com/v3/dataforseo_labs/google/relevant_pages/live";
export const RELEVANT_PAGE_DEPTHS = Object.freeze([100, 500, 1000]);

export class RelevantPagesProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RelevantPagesProviderError";
    this.code = details.code ?? "RELEVANT_PAGES_PROVIDER_ERROR";
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

function validDomain(domain) {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain);
}

export function normalizeRelevantPagesDomain(value) {
  let raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  try {
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    const url = new URL(raw);
    const domain = url.hostname.replace(/^www\./, "").replace(/\.$/, "");
    return validDomain(domain) ? domain : null;
  } catch {
    return null;
  }
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

function normalizeItem(item, totalEtv) {
  const organic = item?.metrics?.organic ?? {};
  const traffic = finite(organic.etv);
  const url = typeof item?.page_address === "string" ? item.page_address.slice(0, 4000) : null;
  let relativeUrl = null;
  try {
    if (url) {
      const parsed = new URL(url);
      relativeUrl = (parsed.pathname || "/") + parsed.search;
    }
  } catch {
    relativeUrl = null;
  }
  return {
    url,
    relative_url: relativeUrl,
    organic_traffic: traffic,
    traffic_share_percent:
      traffic !== null && totalEtv !== null && totalEtv > 0
        ? Math.round((traffic / totalEtv) * 10000) / 100
        : null,
    organic_keywords: finite(organic.count),
    traffic_value_usd: finite(organic.estimated_paid_traffic_cost),
    positions: positionMetrics(organic),
    changes: {
      new: finite(organic.is_new),
      up: finite(organic.is_up),
      down: finite(organic.is_down),
      lost: finite(organic.is_lost),
    },
  };
}

function normalizeResult(result, request) {
  const rawItems = Array.isArray(result?.items) ? result.items : [];
  const totalEtv = rawItems.reduce((sum, item) => sum + (finite(item?.metrics?.organic?.etv) ?? 0), 0);
  const items = rawItems.map((item) => normalizeItem(item, totalEtv)).filter((item) => item.url);
  return {
    target: request.target,
    historical_serp_mode: "live",
    depth: request.limit,
    total_count: finite(result?.total_count) ?? items.length,
    returned_count: items.length,
    items,
    generated_at: new Date().toISOString(),
    disclaimer: "Top Pages traffic and keyword counts are DataForSEO estimates for the selected market. Change counters compare the provider's latest and previous database updates.",
  };
}

export async function fetchRelevantPages({
  login,
  password,
  target,
  locationCode,
  languageCode,
  limit = 500,
}) {
  if (!login || !password) {
    throw new RelevantPagesProviderError("DataForSEO credentials are not configured.", {
      code: "PROVIDER_CREDENTIALS_MISSING",
      httpStatus: 503,
    });
  }
  const domain = normalizeRelevantPagesDomain(target);
  if (!domain) {
    throw new RelevantPagesProviderError("A valid root domain is required.", {
      code: "INVALID_PROVIDER_TARGET",
      httpStatus: 400,
    });
  }
  if (!RELEVANT_PAGE_DEPTHS.includes(Number(limit))) {
    throw new RelevantPagesProviderError("Choose a supported result depth.", {
      code: "INVALID_PROVIDER_LIMIT",
      httpStatus: 400,
    });
  }

  const task = {
    target: domain,
    location_code: locationCode,
    language_code: languageCode,
    item_types: ["organic"],
    include_clickstream_data: false,
    historical_serp_mode: "live",
    ignore_synonyms: true,
    limit: Number(limit),
    order_by: ["metrics.organic.etv,desc", "metrics.organic.count,desc"],
    tag: "seo-pro-v2-organic-pages",
  };

  const response = await fetch(RELEVANT_PAGES_ENDPOINT, {
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
    throw new RelevantPagesProviderError("DataForSEO returned an invalid response.", {
      code: error?.code ?? "PROVIDER_INVALID_RESPONSE",
      providerStatus: response.status,
    });
  }

  const providerTask = payload?.tasks?.[0];
  const actualCostUsd = finite(payload?.cost) ?? finite(providerTask?.cost);
  if (!response.ok || payload?.status_code !== 20000 || providerTask?.status_code !== 20000) {
    throw new RelevantPagesProviderError("DataForSEO could not complete the relevant pages request.", {
      code: "PROVIDER_REQUEST_FAILED",
      providerStatus: providerTask?.status_code ?? payload?.status_code ?? response.status,
      actualCostUsd,
    });
  }

  const result = providerTask?.result?.[0] ?? null;
  return {
    data: normalizeResult(result, { target: domain, limit: Number(limit) }),
    actualCostUsd,
    taskCount: Number.isInteger(payload?.tasks_count) ? payload.tasks_count : 1,
    resultCount: Number.isInteger(providerTask?.result_count)
      ? providerTask.result_count
      : Array.isArray(result?.items) ? result.items.length : 0,
  };
}
