const DATAFORSEO_URL = "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;

export class SerpCompetitorsProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SerpCompetitorsProviderError";
    this.code = details.code ?? "SERP_COMPETITORS_PROVIDER_ERROR";
    this.httpStatus = details.httpStatus ?? 502;
    this.providerStatus = details.providerStatus ?? null;
    this.actualCostUsd = details.actualCostUsd ?? null;
    this.taskCount = details.taskCount ?? null;
  }
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeSerpCompetitors(result, keyword) {
  const organic = (Array.isArray(result?.items) ? result.items : [])
    .filter((item) => item?.type === "organic" && stringOrNull(item?.url) && stringOrNull(item?.domain))
    .sort((a, b) =>
      (numberOrNull(a?.rank_group) ?? Number.POSITIVE_INFINITY) -
        (numberOrNull(b?.rank_group) ?? Number.POSITIVE_INFINITY) ||
      (numberOrNull(a?.rank_absolute) ?? Number.POSITIVE_INFINITY) -
        (numberOrNull(b?.rank_absolute) ?? Number.POSITIVE_INFINITY),
    )
    .slice(0, 10)
    .map((item, index) => ({
      position: numberOrNull(item.rank_group) ?? index + 1,
      absolute_position: numberOrNull(item.rank_absolute),
      domain: stringOrNull(item.domain),
      url: stringOrNull(item.url),
      title: stringOrNull(item.title),
      description: stringOrNull(item.description),
      breadcrumb: stringOrNull(item.breadcrumb),
      website_name: stringOrNull(item.website_name),
      is_featured_snippet: item.is_featured_snippet === true,
      is_web_story: item.is_web_story === true,
    }));

  return {
    keyword: stringOrNull(result?.keyword) ?? keyword,
    location_code: numberOrNull(result?.location_code),
    language_code: stringOrNull(result?.language_code),
    search_engine_domain: stringOrNull(result?.se_domain),
    checked_at: stringOrNull(result?.datetime),
    serp_features: Array.isArray(result?.item_types)
      ? [...new Set(result.item_types.filter((value) => typeof value === "string"))]
      : [],
    items: organic,
    result_count: organic.length,
    disclaimer:
      "Page-level Google organic results only. Domain/Page authority and backlink strength are not included in this request.",
  };
}

export async function fetchSerpCompetitors({
  login,
  password,
  keyword,
  locationCode,
  languageCode,
  signal,
}) {
  if (!login || !password) {
    throw new SerpCompetitorsProviderError("DataForSEO credentials are not configured.", {
      code: "PROVIDER_CREDENTIALS_MISSING",
      httpStatus: 503,
    });
  }

  const response = await fetch(DATAFORSEO_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Basic ${btoa(`${login}:${password}`)}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify([{
      keyword,
      location_code: locationCode,
      language_code: languageCode,
      device: "desktop",
      os: "windows",
      depth: 10,
      tag: "seo-pro-v2-serp-competitors",
    }]),
  });

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new SerpCompetitorsProviderError("DataForSEO response was unexpectedly large.", {
      code: "PROVIDER_RESPONSE_TOO_LARGE",
      httpStatus: 502,
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new SerpCompetitorsProviderError("DataForSEO returned invalid JSON.", {
      code: "PROVIDER_INVALID_RESPONSE",
      httpStatus: 502,
    });
  }

  const task = payload?.tasks?.[0];
  const actualCostUsd = numberOrNull(payload?.cost) ?? numberOrNull(task?.cost);
  if (!response.ok || payload?.status_code !== 20000 || task?.status_code !== 20000) {
    throw new SerpCompetitorsProviderError("DataForSEO could not complete the SERP competitors request.", {
      code: "PROVIDER_REQUEST_FAILED",
      httpStatus: 502,
      providerStatus: task?.status_code ?? payload?.status_code ?? null,
      actualCostUsd,
      taskCount: numberOrNull(payload?.tasks_count),
    });
  }

  const result = task?.result?.[0] ?? null;
  return {
    data: result ? normalizeSerpCompetitors(result, keyword) : {
      keyword,
      location_code: locationCode,
      language_code: languageCode,
      search_engine_domain: null,
      checked_at: null,
      serp_features: [],
      items: [],
      result_count: 0,
      disclaimer:
        "Page-level Google organic results only. Domain/Page authority and backlink strength are not included in this request.",
    },
    actualCostUsd,
    taskCount: numberOrNull(payload?.tasks_count) ?? 1,
    resultCount: numberOrNull(task?.result_count) ?? (task?.result?.length ?? 0),
  };
}
