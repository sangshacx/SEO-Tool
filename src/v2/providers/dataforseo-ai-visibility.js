import { readBoundedJson } from "./bounded-json.js";

export const AI_VISIBILITY_TARGET_METRICS_ENDPOINT =
  "https://api.dataforseo.com/v3/ai_optimization/llm_mentions/target_metrics/live";
export const AI_VISIBILITY_MULTI_TARGET_METRICS_ENDPOINT =
  "https://api.dataforseo.com/v3/ai_optimization/llm_mentions/multi_target_metrics/live";
export const AI_VISIBILITY_TOP_PAGES_ENDPOINT =
  "https://api.dataforseo.com/v3/ai_optimization/llm_mentions/top_mentioned_pages/live";
export const AI_VISIBILITY_HISTORY_ENDPOINT =
  "https://api.dataforseo.com/v3/ai_optimization/llm_mentions/historical/live";
export const AI_VISIBILITY_NEW_LOST_ENDPOINT =
  "https://api.dataforseo.com/v3/ai_optimization/llm_mentions/timeseries_new_lost/live";

export const AI_VISIBILITY_PLATFORMS = Object.freeze(["google", "chat_gpt"]);
export const AI_VISIBILITY_TOP_PAGE_LIMITS = Object.freeze([10, 25, 50, 100]);
export const AI_VISIBILITY_HISTORY_MONTHS = Object.freeze([0, 6, 12]);

export class AiVisibilityProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AiVisibilityProviderError";
    this.code = details.code ?? "AI_VISIBILITY_PROVIDER_ERROR";
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

export function normalizeAiVisibilityDomain(value) {
  let raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  try {
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    const url = new URL(raw);
    const domain = url.hostname.replace(/^www\./, "").replace(/\.$/, "");
    return validDomain(domain) && domain.length <= 63 ? domain : null;
  } catch {
    return null;
  }
}

function normalizePlatform(value) {
  const platform = String(value ?? "").trim().toLowerCase();
  if (!AI_VISIBILITY_PLATFORMS.includes(platform)) {
    throw new AiVisibilityProviderError("Choose a supported AI visibility platform.", {
      code: "INVALID_PROVIDER_PLATFORM",
      httpStatus: 400,
    });
  }
  return platform;
}

export function normalizeAiVisibilityMarket({ platform, locationCode, languageCode }) {
  const normalizedPlatform = normalizePlatform(platform);
  const location = Number(locationCode);
  const language = String(languageCode ?? "").trim().toLowerCase();
  if (!Number.isInteger(location) || location <= 0 || !language) {
    throw new AiVisibilityProviderError("Choose a supported AI visibility market.", {
      code: "INVALID_PROVIDER_MARKET",
      httpStatus: 400,
    });
  }
  if (normalizedPlatform === "chat_gpt" && (location !== 2840 || language !== "en")) {
    throw new AiVisibilityProviderError("ChatGPT LLM Mentions currently supports United States / English only.", {
      code: "CHATGPT_MARKET_UNSUPPORTED",
      httpStatus: 400,
    });
  }
  return { platform: normalizedPlatform, locationCode: location, languageCode: language };
}

function groupRows(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      key: item?.key ?? null,
      mentions: finite(item?.mentions),
      ai_search_volume: finite(item?.ai_search_volume),
    }))
    .filter((item) => item.key !== null);
}

function normalizeMetricSet(metrics = {}) {
  return {
    total: {
      mentions: finite(metrics?.total?.mentions),
      ai_search_volume: finite(metrics?.total?.ai_search_volume),
    },
    location: groupRows(metrics?.location),
    language: groupRows(metrics?.language),
    platform: groupRows(metrics?.platform),
    source_domains: groupRows(metrics?.sources_domain),
    search_result_domains: groupRows(metrics?.search_results_domain),
    brand_entities: groupRows(metrics?.brand_entities_title),
    brand_categories: groupRows(metrics?.brand_entities_category),
  };
}

function resultMeta(result) {
  return {
    total_count: finite(result?.total_count),
    returned_count: Number.isInteger(result?.items_count)
      ? result.items_count
      : Array.isArray(result?.items) ? result.items.length : 0,
    offset: finite(result?.offset) ?? 0,
  };
}

async function requestLlmMentions({ login, password, endpoint, task, errorMessage }) {
  if (!login || !password) {
    throw new AiVisibilityProviderError("DataForSEO credentials are not configured.", {
      code: "PROVIDER_CREDENTIALS_MISSING",
      httpStatus: 503,
    });
  }

  const response = await fetch(endpoint, {
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
    throw new AiVisibilityProviderError("DataForSEO returned an invalid AI visibility response.", {
      code: error?.code ?? "PROVIDER_INVALID_RESPONSE",
      providerStatus: response.status,
    });
  }

  const providerTask = payload?.tasks?.[0];
  const actualCostUsd = finite(payload?.cost) ?? finite(providerTask?.cost);
  if (!response.ok || payload?.status_code !== 20000 || providerTask?.status_code !== 20000) {
    throw new AiVisibilityProviderError(errorMessage, {
      code: "PROVIDER_REQUEST_FAILED",
      providerStatus: providerTask?.status_code ?? payload?.status_code ?? response.status,
      actualCostUsd,
    });
  }

  return {
    payload,
    providerTask,
    result: providerTask?.result?.[0] ?? null,
    actualCostUsd,
  };
}

export async function fetchAiVisibilityTargetMetrics({
  login,
  password,
  target,
  platform,
  locationCode,
  languageCode,
}) {
  const domain = normalizeAiVisibilityDomain(target);
  if (!domain) {
    throw new AiVisibilityProviderError("A valid root domain is required.", {
      code: "INVALID_PROVIDER_TARGET",
      httpStatus: 400,
    });
  }
  const market = normalizeAiVisibilityMarket({ platform, locationCode, languageCode });
  const task = {
    target: [{
      domain,
      search_filter: "include",
      include_subdomains: false,
    }],
    platform: market.platform,
    location_code: market.locationCode,
    language_code: market.languageCode,
    internal_list_limit: 10,
    tag: "seo-pro-v2-ai-visibility-target",
  };

  const response = await requestLlmMentions({
    login,
    password,
    endpoint: AI_VISIBILITY_TARGET_METRICS_ENDPOINT,
    task,
    errorMessage: "DataForSEO could not complete the AI visibility target metrics request.",
  });
  const result = response.result;
  return {
    data: {
      target: domain,
      platform: market.platform,
      location_code: market.locationCode,
      language_code: market.languageCode,
      metrics: normalizeMetricSet(result?.aggregated_metrics),
      ...resultMeta(result),
      generated_at: new Date().toISOString(),
      disclaimer:
        "LLM Mentions are DataForSEO indexed AI-search observations. Mentions and AI search volume do not equal visits, conversions, or causal SEO impact.",
    },
    actualCostUsd: response.actualCostUsd,
    taskCount: Number.isInteger(response.payload?.tasks_count) ? response.payload.tasks_count : 1,
    resultCount: Number.isInteger(response.providerTask?.result_count) ? response.providerTask.result_count : 0,
  };
}

export function normalizeAiVisibilityComparisonDomains(values) {
  const domains = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const domain = normalizeAiVisibilityDomain(value);
    if (!domain) {
      throw new AiVisibilityProviderError("Every comparison target must be a valid root domain.", {
        code: "INVALID_PROVIDER_TARGET",
        httpStatus: 400,
      });
    }
    if (seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }
  if (domains.length < 2 || domains.length > 10) {
    throw new AiVisibilityProviderError("Compare between 2 and 10 unique root domains.", {
      code: "INVALID_PROVIDER_TARGET_COUNT",
      httpStatus: 400,
    });
  }
  return domains;
}

export async function fetchAiVisibilityMultiTargetMetrics({
  login,
  password,
  targets,
  platform,
  locationCode,
  languageCode,
}) {
  const domains = normalizeAiVisibilityComparisonDomains(targets);
  const market = normalizeAiVisibilityMarket({ platform, locationCode, languageCode });
  const task = {
    targets: domains.map((domain) => ({
      key: domain,
      target: [{
        domain,
        search_filter: "include",
        include_subdomains: false,
      }],
    })),
    platform: market.platform,
    location_code: market.locationCode,
    language_code: market.languageCode,
    order_by: ["total.mentions,desc"],
    limit: domains.length,
    offset: 0,
    internal_list_limit: 10,
    tag: "seo-pro-v2-ai-visibility-compare",
  };

  const response = await requestLlmMentions({
    login,
    password,
    endpoint: AI_VISIBILITY_MULTI_TARGET_METRICS_ENDPOINT,
    task,
    errorMessage: "DataForSEO could not complete the AI visibility comparison request.",
  });
  const result = response.result;
  const items = (Array.isArray(result?.items) ? result.items : []).map((item) => ({
    target: String(item?.key ?? ""),
    metrics: normalizeMetricSet(item),
  })).filter((item) => item.target);

  return {
    data: {
      targets: domains,
      platform: market.platform,
      location_code: market.locationCode,
      language_code: market.languageCode,
      aggregate_metrics: normalizeMetricSet(result?.aggregated_metrics),
      items,
      ...resultMeta(result),
      generated_at: new Date().toISOString(),
      disclaimer:
        "Cross-domain AI visibility is descriptive mention data for the same platform and market. It is not a ranking probability or business-performance score.",
    },
    actualCostUsd: response.actualCostUsd,
    taskCount: Number.isInteger(response.payload?.tasks_count) ? response.payload.tasks_count : 1,
    resultCount: items.length,
  };
}

function normalizedPage(item = {}) {
  const page = typeof item?.page === "string" ? item.page.trim() : "";
  if (!page) return null;
  try {
    const url = new URL(page);
    if (!["http:", "https:"].includes(url.protocol)) return null;
  } catch {
    return null;
  }
  const metrics = normalizeMetricSet(item);
  return {
    page,
    mentions: metrics.total.mentions,
    ai_search_volume: metrics.total.ai_search_volume,
    source_domains: metrics.source_domains,
    search_result_domains: metrics.search_result_domains,
    platform: metrics.platform,
  };
}

export async function fetchAiVisibilityTopMentionedPages({
  login,
  password,
  target,
  platform,
  locationCode,
  languageCode,
  limit = 25,
}) {
  const domain = normalizeAiVisibilityDomain(target);
  if (!domain) {
    throw new AiVisibilityProviderError("A valid root domain is required.", {
      code: "INVALID_PROVIDER_TARGET",
      httpStatus: 400,
    });
  }
  const depth = Number(limit);
  if (!AI_VISIBILITY_TOP_PAGE_LIMITS.includes(depth)) {
    throw new AiVisibilityProviderError("Choose a supported AI visibility page depth.", {
      code: "INVALID_PROVIDER_LIMIT",
      httpStatus: 400,
    });
  }
  const market = normalizeAiVisibilityMarket({ platform, locationCode, languageCode });
  const task = {
    target: [{
      domain,
      search_filter: "include",
      include_subdomains: false,
    }],
    platform: market.platform,
    location_code: market.locationCode,
    language_code: market.languageCode,
    links_scope: "sources",
    limit: depth,
    offset: 0,
    internal_list_limit: 5,
    order_by: ["total.mentions,desc", "total.ai_search_volume,desc"],
    tag: "seo-pro-v2-ai-visibility-pages",
  };

  const response = await requestLlmMentions({
    login,
    password,
    endpoint: AI_VISIBILITY_TOP_PAGES_ENDPOINT,
    task,
    errorMessage: "DataForSEO could not complete the top mentioned pages request.",
  });
  const result = response.result;
  const items = (Array.isArray(result?.items) ? result.items : [])
    .map(normalizedPage)
    .filter(Boolean);

  return {
    data: {
      target: domain,
      platform: market.platform,
      location_code: market.locationCode,
      language_code: market.languageCode,
      depth,
      aggregate_metrics: normalizeMetricSet(result?.aggregated_metrics),
      items,
      ...resultMeta({ ...result, items }),
      generated_at: new Date().toISOString(),
      disclaimer:
        "Top Mentioned Pages reports pages observed in LLM mentions for the target. Source-domain counts describe observed citations and do not prove referral traffic.",
    },
    actualCostUsd: response.actualCostUsd,
    taskCount: Number.isInteger(response.payload?.tasks_count) ? response.payload.tasks_count : 1,
    resultCount: items.length,
  };
}


const AI_VISIBILITY_HISTORY_START = "2025-08-01";

function monthPercent(current, previous) {
  const now = finite(current);
  const before = finite(previous);
  if (now === null || before === null || before === 0) return null;
  return Math.round(((now - before) / Math.abs(before)) * 10000) / 100;
}

export function aiVisibilityHistoryDateRange(months = 12, now = new Date()) {
  const requested = Number(months);
  if (!AI_VISIBILITY_HISTORY_MONTHS.includes(requested)) {
    throw new AiVisibilityProviderError("Choose 6, 12, or all available AI visibility history.", {
      code: "INVALID_PROVIDER_RANGE",
      httpStatus: 400,
    });
  }
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = requested === 0
    ? new Date(AI_VISIBILITY_HISTORY_START + "T00:00:00Z")
    : new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - requested + 1, 1));
  const minimum = new Date(AI_VISIBILITY_HISTORY_START + "T00:00:00Z");
  const boundedStart = start < minimum ? minimum : start;
  return {
    dateFrom: boundedStart.toISOString().slice(0, 10),
    dateTo: end.toISOString().slice(0, 10),
  };
}

function normalizeHistoricalPoints(items) {
  const points = (Array.isArray(items) ? items : [])
    .map((item) => {
      const year = Number(item?.year);
      const month = Number(item?.month);
      if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
      return {
        period: String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0"),
        mentions: finite(item?.metrics?.mentions),
        ai_search_volume: finite(item?.metrics?.ai_search_volume),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.period.localeCompare(b.period));

  return points.map((point, index) => {
    const previous = points[index - 1] ?? null;
    return {
      ...point,
      change: {
        mentions_percent: previous ? monthPercent(point.mentions, previous.mentions) : null,
        ai_search_volume_percent: previous ? monthPercent(point.ai_search_volume, previous.ai_search_volume) : null,
      },
    };
  });
}

function normalizeNewLostPoints(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const date = typeof item?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
        ? item.date
        : null;
      if (!date) return null;
      const newMentions = finite(item?.new_mentions) ?? 0;
      const lostMentions = finite(item?.lost_mentions) ?? 0;
      const newVolume = finite(item?.new_ai_search_volume) ?? 0;
      const lostVolume = finite(item?.lost_ai_search_volume) ?? 0;
      return {
        date,
        new_mentions: newMentions,
        lost_mentions: lostMentions,
        net_mentions: newMentions - lostMentions,
        new_ai_search_volume: newVolume,
        lost_ai_search_volume: lostVolume,
        net_ai_search_volume: newVolume - lostVolume,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchAiVisibilityHistorical({
  login,
  password,
  target,
  platform,
  locationCode,
  languageCode,
  months = 12,
  now = new Date(),
}) {
  const domain = normalizeAiVisibilityDomain(target);
  if (!domain) {
    throw new AiVisibilityProviderError("A valid root domain is required.", {
      code: "INVALID_PROVIDER_TARGET",
      httpStatus: 400,
    });
  }
  const market = normalizeAiVisibilityMarket({ platform, locationCode, languageCode });
  const { dateFrom, dateTo } = aiVisibilityHistoryDateRange(months, now);
  const task = {
    target: [{
      domain,
      search_filter: "include",
      include_subdomains: false,
    }],
    platform: market.platform,
    location_code: market.locationCode,
    language_code: market.languageCode,
    date_from: dateFrom,
    date_to: dateTo,
    tag: "seo-pro-v2-ai-visibility-history",
  };

  const response = await requestLlmMentions({
    login,
    password,
    endpoint: AI_VISIBILITY_HISTORY_ENDPOINT,
    task,
    errorMessage: "DataForSEO could not complete the AI visibility historical request.",
  });
  const result = response.result;
  const points = normalizeHistoricalPoints(result?.items);

  return {
    data: {
      target: domain,
      platform: market.platform,
      location_code: market.locationCode,
      language_code: market.languageCode,
      months: Number(months),
      date_from: dateFrom,
      date_to: dateTo,
      points,
      returned_count: points.length,
      generated_at: new Date().toISOString(),
      disclaimer:
        "AI Visibility Historical is DataForSEO month-level indexed LLM mention history. It describes observed mentions and AI search volume, not visits or causal SEO impact.",
    },
    actualCostUsd: response.actualCostUsd,
    taskCount: Number.isInteger(response.payload?.tasks_count) ? response.payload.tasks_count : 1,
    resultCount: points.length,
  };
}

export async function fetchAiVisibilityNewLost({
  login,
  password,
  target,
  platform,
  locationCode,
  languageCode,
  months = 12,
  now = new Date(),
}) {
  const domain = normalizeAiVisibilityDomain(target);
  if (!domain) {
    throw new AiVisibilityProviderError("A valid root domain is required.", {
      code: "INVALID_PROVIDER_TARGET",
      httpStatus: 400,
    });
  }
  const market = normalizeAiVisibilityMarket({ platform, locationCode, languageCode });
  const { dateFrom, dateTo } = aiVisibilityHistoryDateRange(months, now);
  const task = {
    target: [{
      domain,
      search_filter: "include",
      include_subdomains: false,
    }],
    platform: market.platform,
    location_code: market.locationCode,
    language_code: market.languageCode,
    date_from: dateFrom,
    date_to: dateTo,
    group_range: "month",
    tag: "seo-pro-v2-ai-visibility-new-lost",
  };

  const response = await requestLlmMentions({
    login,
    password,
    endpoint: AI_VISIBILITY_NEW_LOST_ENDPOINT,
    task,
    errorMessage: "DataForSEO could not complete the AI visibility new/lost request.",
  });
  const result = response.result;
  const points = normalizeNewLostPoints(result?.items);

  return {
    data: {
      target: domain,
      platform: market.platform,
      location_code: market.locationCode,
      language_code: market.languageCode,
      months: Number(months),
      date_from: result?.date_from ?? dateFrom,
      date_to: result?.date_to ?? dateTo,
      group_range: result?.group_range ?? "month",
      points,
      returned_count: points.length,
      generated_at: new Date().toISOString(),
      disclaimer:
        "New/Lost LLM Mentions compares DataForSEO's indexed LLM responses between periods. A lost mention is an observed response-level change, not proof of lost referral traffic.",
    },
    actualCostUsd: response.actualCostUsd,
    taskCount: Number.isInteger(response.payload?.tasks_count) ? response.payload.tasks_count : 1,
    resultCount: points.length,
  };
}
