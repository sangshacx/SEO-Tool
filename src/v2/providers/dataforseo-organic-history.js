import { readBoundedJson } from "./bounded-json.js";

export const ORGANIC_HISTORY_ENDPOINT = "https://api.dataforseo.com/v3/dataforseo_labs/google/historical_rank_overview/live";
export const ORGANIC_HISTORY_MONTHS = Object.freeze([6, 12, 24, 36, 60]);

export class OrganicHistoryProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "OrganicHistoryProviderError";
    this.code = details.code ?? "ORGANIC_HISTORY_PROVIDER_ERROR";
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

export function normalizeOrganicHistoryDomain(value) {
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
    top_100:
      value("pos_1") + value("pos_2_3") + value("pos_4_10") + value("pos_11_20") +
      value("pos_21_30") + value("pos_31_40") + value("pos_41_50") + value("pos_51_60") +
      value("pos_61_70") + value("pos_71_80") + value("pos_81_90") + value("pos_91_100"),
  };
}

function percentChange(current, previous) {
  const a = finite(current);
  const b = finite(previous);
  if (a === null || b === null || b === 0) return null;
  return Math.round(((a - b) / Math.abs(b)) * 10000) / 100;
}

function normalizePoints(items) {
  const points = (Array.isArray(items) ? items : []).map((item) => {
    const year = Number(item?.year);
    const month = Number(item?.month);
    const organic = item?.metrics?.organic ?? {};
    return {
      period: Number.isInteger(year) && Number.isInteger(month)
        ? String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0")
        : null,
      organic_keywords: finite(organic.count),
      organic_traffic: finite(organic.etv),
      traffic_value_usd: finite(organic.estimated_paid_traffic_cost),
      positions: positionMetrics(organic),
      changes: {
        new: finite(organic.is_new),
        up: finite(organic.is_up),
        down: finite(organic.is_down),
        lost: finite(organic.is_lost),
      },
    };
  }).filter((point) => point.period).sort((a, b) => a.period.localeCompare(b.period));

  return points.map((point, index) => {
    const previous = points[index - 1] ?? null;
    return {
      ...point,
      month_over_month: {
        organic_keywords_percent: previous ? percentChange(point.organic_keywords, previous.organic_keywords) : null,
        organic_traffic_percent: previous ? percentChange(point.organic_traffic, previous.organic_traffic) : null,
        traffic_value_percent: previous ? percentChange(point.traffic_value_usd, previous.traffic_value_usd) : null,
      },
    };
  });
}

function dateRange(months, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - Number(months) + 1, 1));
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: end.toISOString().slice(0, 10),
  };
}

export function organicHistoryDateRange(months, now = new Date()) {
  if (!ORGANIC_HISTORY_MONTHS.includes(Number(months))) {
    throw new TypeError("Unsupported organic history range.");
  }
  return dateRange(Number(months), now);
}

export async function fetchOrganicHistory({
  login,
  password,
  target,
  locationCode,
  languageCode,
  months = 12,
  now = new Date(),
}) {
  if (!login || !password) {
    throw new OrganicHistoryProviderError("DataForSEO credentials are not configured.", {
      code: "PROVIDER_CREDENTIALS_MISSING",
      httpStatus: 503,
    });
  }
  const domain = normalizeOrganicHistoryDomain(target);
  if (!domain) {
    throw new OrganicHistoryProviderError("A valid root domain is required.", {
      code: "INVALID_PROVIDER_TARGET",
      httpStatus: 400,
    });
  }
  if (!ORGANIC_HISTORY_MONTHS.includes(Number(months))) {
    throw new OrganicHistoryProviderError("Choose a supported history range.", {
      code: "INVALID_PROVIDER_RANGE",
      httpStatus: 400,
    });
  }

  const { dateFrom, dateTo } = dateRange(Number(months), now);
  const task = {
    target: domain,
    location_code: locationCode,
    language_code: languageCode,
    date_from: dateFrom,
    date_to: dateTo,
    correlate: true,
    ignore_synonyms: true,
    include_clickstream_data: false,
    tag: "seo-pro-v2-organic-history",
  };

  const response = await fetch(ORGANIC_HISTORY_ENDPOINT, {
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
    throw new OrganicHistoryProviderError("DataForSEO returned an invalid response.", {
      code: error?.code ?? "PROVIDER_INVALID_RESPONSE",
      providerStatus: response.status,
    });
  }

  const providerTask = payload?.tasks?.[0];
  const actualCostUsd = finite(payload?.cost) ?? finite(providerTask?.cost);
  if (!response.ok || payload?.status_code !== 20000 || providerTask?.status_code !== 20000) {
    throw new OrganicHistoryProviderError("DataForSEO could not complete the historical rank overview request.", {
      code: "PROVIDER_REQUEST_FAILED",
      providerStatus: providerTask?.status_code ?? payload?.status_code ?? response.status,
      actualCostUsd,
    });
  }

  const result = providerTask?.result?.[0] ?? null;
  const points = normalizePoints(result?.items);
  return {
    data: {
      target: domain,
      months: Number(months),
      date_from: dateFrom,
      date_to: dateTo,
      total_count: finite(result?.total_count) ?? points.length,
      returned_count: points.length,
      points,
      generated_at: new Date().toISOString(),
      disclaimer: "Historical Rank Overview is monthly DataForSEO database history. It is separate from SEO Pro V2 project snapshots and is loaded only on explicit request.",
    },
    actualCostUsd,
    taskCount: Number.isInteger(payload?.tasks_count) ? payload.tasks_count : 1,
    resultCount: Number.isInteger(result?.items_count)
      ? result.items_count
      : Array.isArray(result?.items) ? result.items.length : 0,
  };
}
