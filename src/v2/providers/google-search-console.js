import { readBoundedJson } from "./bounded-json.js";

export const GSC_SITES_ENDPOINT = "https://www.googleapis.com/webmasters/v3/sites";
export const GSC_SEARCH_ANALYTICS_BASE = "https://www.googleapis.com/webmasters/v3/sites";
export const GSC_MAX_ROWS = 25000;
export const GSC_DIMENSIONS = Object.freeze(["date", "query", "page", "country", "device", "searchAppearance"]);
export const GSC_SEARCH_TYPES = Object.freeze(["web"]);

export class GscProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "GscProviderError";
    this.code = details.code ?? "GSC_PROVIDER_ERROR";
    this.httpStatus = details.httpStatus ?? 502;
    this.providerStatus = details.providerStatus ?? null;
  }
}

function gscError(response, payload, fallback = "Google Search Console request failed.") {
  const status = Number(response?.status ?? 0);
  const providerMessage = payload?.error?.message ?? fallback;
  if (status === 401) {
    return new GscProviderError(providerMessage, { code: "GSC_AUTH_EXPIRED", httpStatus: 401, providerStatus: status });
  }
  if (status === 403) {
    return new GscProviderError(providerMessage, { code: "GSC_ACCESS_DENIED", httpStatus: 403, providerStatus: status });
  }
  if (status === 429) {
    return new GscProviderError(providerMessage, { code: "GSC_QUOTA_EXCEEDED", httpStatus: 429, providerStatus: status });
  }
  return new GscProviderError(providerMessage, { code: "GSC_REQUEST_FAILED", httpStatus: status >= 400 && status < 600 ? status : 502, providerStatus: status || null });
}

async function authorizedJson(url, accessToken, options = {}) {
  if (!accessToken) {
    throw new GscProviderError("Google Search Console access token is missing.", {
      code: "GSC_AUTH_REQUIRED",
      httpStatus: 401,
    });
  }
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + accessToken,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  let payload;
  try {
    payload = await readBoundedJson(response);
  } catch (error) {
    throw new GscProviderError("Google Search Console returned an invalid response.", {
      code: error?.code ?? "GSC_INVALID_RESPONSE",
      httpStatus: 502,
      providerStatus: response.status,
    });
  }
  if (!response.ok || payload?.error) throw gscError(response, payload);
  return payload;
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z"));
}

function normalizeDimensions(value) {
  const dimensions = Array.isArray(value) ? value : [];
  const normalized = dimensions.map((item) => String(item).trim()).filter(Boolean);
  if (new Set(normalized).size !== normalized.length || normalized.some((item) => !GSC_DIMENSIONS.includes(item))) {
    throw new GscProviderError("Choose supported Search Analytics dimensions.", {
      code: "GSC_INVALID_DIMENSIONS",
      httpStatus: 400,
    });
  }
  if (normalized.includes("searchAppearance") && normalized.length !== 1) {
    throw new GscProviderError("Search appearance must be queried as the only dimension before filtering by a discovered value.", {
      code: "GSC_SEARCH_APPEARANCE_DIMENSION_EXCLUSIVE",
      httpStatus: 400,
    });
  }
  return normalized;
}

function normalizeSiteEntry(entry = {}) {
  const siteUrl = typeof entry.siteUrl === "string" ? entry.siteUrl : null;
  if (!siteUrl) return null;
  return {
    property: siteUrl,
    property_type: siteUrl.startsWith("sc-domain:") ? "domain" : "url_prefix",
    domain: siteUrl.startsWith("sc-domain:")
      ? siteUrl.slice("sc-domain:".length).toLowerCase()
      : (() => {
          try { return new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, ""); }
          catch { return null; }
        })(),
    permission_level: typeof entry.permissionLevel === "string" ? entry.permissionLevel : null,
    verified: entry.permissionLevel !== "siteUnverifiedUser",
  };
}

export async function listGscProperties({ accessToken }) {
  const payload = await authorizedJson(GSC_SITES_ENDPOINT, accessToken, { method: "GET" });
  const properties = (Array.isArray(payload?.siteEntry) ? payload.siteEntry : [])
    .map(normalizeSiteEntry)
    .filter(Boolean)
    .sort((a, b) => a.property.localeCompare(b.property));
  return { properties, count: properties.length };
}

export function buildGscSearchAnalyticsRequest({
  startDate,
  endDate,
  dimensions = [],
  rowLimit = 1000,
  startRow = 0,
  searchType = "web",
  dataState = "final",
  dimensionFilterGroups,
} = {}) {
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    throw new GscProviderError("Use a valid inclusive Search Analytics date range.", {
      code: "GSC_INVALID_DATE_RANGE",
      httpStatus: 400,
    });
  }
  const normalizedDimensions = normalizeDimensions(dimensions);
  const limit = Number(rowLimit);
  const offset = Number(startRow);
  if (!Number.isInteger(limit) || limit < 1 || limit > GSC_MAX_ROWS) {
    throw new GscProviderError("Search Analytics rowLimit must be between 1 and 25,000.", {
      code: "GSC_INVALID_ROW_LIMIT",
      httpStatus: 400,
    });
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new GscProviderError("Search Analytics startRow must be a non-negative integer.", {
      code: "GSC_INVALID_START_ROW",
      httpStatus: 400,
    });
  }
  if (!GSC_SEARCH_TYPES.includes(searchType)) {
    throw new GscProviderError("SEO Pro V2 Phase 10 currently supports Google Web Search data only.", {
      code: "GSC_INVALID_SEARCH_TYPE",
      httpStatus: 400,
    });
  }
  if (!["final", "all"].includes(dataState)) {
    throw new GscProviderError("Choose final or all Search Analytics data.", {
      code: "GSC_INVALID_DATA_STATE",
      httpStatus: 400,
    });
  }
  return {
    startDate,
    endDate,
    dimensions: normalizedDimensions,
    type: searchType,
    dataState,
    rowLimit: limit,
    startRow: offset,
    ...(Array.isArray(dimensionFilterGroups) && dimensionFilterGroups.length ? { dimensionFilterGroups } : {}),
  };
}

export async function queryGscSearchAnalytics({
  accessToken,
  property,
  ...requestInput
}) {
  if (typeof property !== "string" || !property.trim()) {
    throw new GscProviderError("A Search Console property is required.", {
      code: "GSC_PROPERTY_REQUIRED",
      httpStatus: 400,
    });
  }
  const body = buildGscSearchAnalyticsRequest(requestInput);
  const url = GSC_SEARCH_ANALYTICS_BASE + "/" + encodeURIComponent(property.trim()) + "/searchAnalytics/query";
  const payload = await authorizedJson(url, accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const dimensions = body.dimensions;
  const rows = (Array.isArray(payload?.rows) ? payload.rows : []).map((row) => {
    const keys = Array.isArray(row?.keys) ? row.keys : [];
    const dimensionValues = Object.fromEntries(dimensions.map((dimension, index) => [dimension, keys[index] ?? null]));
    return {
      ...dimensionValues,
      clicks: Number.isFinite(Number(row?.clicks)) ? Number(row.clicks) : null,
      impressions: Number.isFinite(Number(row?.impressions)) ? Number(row.impressions) : null,
      ctr: Number.isFinite(Number(row?.ctr)) ? Number(row.ctr) : null,
      position: Number.isFinite(Number(row?.position)) ? Number(row.position) : null,
    };
  });
  return {
    property: property.trim(),
    request: body,
    response_aggregation_type: payload?.responseAggregationType ?? null,
    rows,
    returned_count: rows.length,
    has_more: rows.length === body.rowLimit,
    next_start_row: rows.length === body.rowLimit ? body.startRow + rows.length : null,
    disclaimer: "Search Analytics can return top rows rather than every row. SEO Pro V2 preserves this limitation in downstream analysis.",
  };
}


export function isGenerativeAiAppearanceCandidate(value) {
  const appearance = String(value ?? "").trim();
  if (!appearance) return false;
  return /(^|[_\s-])AI([_\s-]|$)|GENERATIVE/i.test(appearance);
}

export async function discoverGscSearchAppearances({
  accessToken,
  property,
  startDate,
  endDate,
  rowLimit = 250,
} = {}) {
  const result = await queryGscSearchAnalytics({
    accessToken,
    property,
    startDate,
    endDate,
    dimensions: ["searchAppearance"],
    rowLimit,
    startRow: 0,
    searchType: "web",
    dataState: "final",
  });

  const appearances = result.rows.map((row) => ({
    appearance: row.searchAppearance,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
    generative_ai_candidate: isGenerativeAiAppearanceCandidate(row.searchAppearance),
  }));

  return {
    property: result.property,
    start_date: startDate,
    end_date: endDate,
    appearances,
    candidate_count: appearances.filter((row) => row.generative_ai_candidate).length,
    returned_count: appearances.length,
    disclaimer:
      "Search appearance values are discovered from this property at runtime. Candidate labels are conservative hints only; SEO Pro V2 never hard-codes or auto-selects an undocumented Generative AI appearance value.",
  };
}
