import { readBoundedJson } from "./bounded-json.js";
import { buildOrganicCompetitorRelevance } from "../intelligence/organic-competitor-relevance.js";

export const ORGANIC_COMPETITORS_ENDPOINT = "https://api.dataforseo.com/v3/dataforseo_labs/google/competitors_domain/live";

export class OrganicCompetitorsProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "OrganicCompetitorsProviderError";
    this.code = details.code ?? "ORGANIC_COMPETITORS_PROVIDER_ERROR";
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

export function normalizeOrganicCompetitorDomain(value) {
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

function normalizedMetrics(item) {
  const organic = item?.full_domain_metrics?.organic ?? {};
  return {
    organic_keywords: finite(organic.count),
    organic_traffic: finite(organic.etv),
    traffic_value_usd: finite(organic.estimated_paid_traffic_cost),
    top_10:
      (finite(organic.pos_1) ?? 0) +
      (finite(organic.pos_2_3) ?? 0) +
      (finite(organic.pos_4_10) ?? 0),
  };
}

function normalizeResult(result, target) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const targetItem = items.find((item) => String(item?.domain ?? "").toLowerCase() === target) ?? null;
  const targetMetrics = normalizedMetrics(targetItem);
  const competitors = items
    .filter((item) => item?.domain && String(item.domain).toLowerCase() !== target)
    .map((item) => {
      const metrics = normalizedMetrics(item);
      const sharedKeywords = finite(item.intersections);
      return {
        domain: String(item.domain).toLowerCase(),
        shared_keywords: sharedKeywords,
        avg_position: finite(item.avg_position),
        ...metrics,
        intersecting_traffic: finite(item?.competitor_metrics?.organic?.etv ?? item?.metrics?.organic?.etv),
        relevance: buildOrganicCompetitorRelevance({
          sharedKeywords,
          targetKeywords: targetMetrics.organic_keywords,
          competitorKeywords: metrics.organic_keywords,
        }),
      };
    })
    .sort((a, b) =>
      (b.relevance.keyword_similarity_percent ?? -1) - (a.relevance.keyword_similarity_percent ?? -1) ||
      (b.shared_keywords ?? 0) - (a.shared_keywords ?? 0) ||
      a.domain.localeCompare(b.domain)
    );

  return {
    target,
    total_count: finite(result?.total_count) ?? competitors.length,
    returned_count: competitors.length,
    discovery: {
      max_rank_group: 20,
      exclude_top_domains: true,
      limit: 100,
    },
    target_metrics: targetMetrics,
    competitors,
    generated_at: new Date().toISOString(),
    disclaimer: "Keyword Similarity is a transparent normalized overlap metric, not a prediction of business competition, revenue, or ranking probability.",
  };
}

export async function fetchOrganicCompetitors({
  login,
  password,
  target,
  locationCode,
  languageCode,
}) {
  if (!login || !password) {
    throw new OrganicCompetitorsProviderError("DataForSEO credentials are not configured.", {
      code: "PROVIDER_CREDENTIALS_MISSING",
      httpStatus: 503,
    });
  }
  const domain = normalizeOrganicCompetitorDomain(target);
  if (!domain) {
    throw new OrganicCompetitorsProviderError("A valid root domain is required.", {
      code: "INVALID_PROVIDER_TARGET",
      httpStatus: 400,
    });
  }

  const task = {
    target: domain,
    location_code: locationCode,
    language_code: languageCode,
    item_types: ["organic"],
    include_clickstream_data: false,
    ignore_synonyms: true,
    max_rank_group: 20,
    exclude_top_domains: true,
    limit: 100,
    order_by: ["intersections,desc"],
    tag: "seo-pro-v2-organic-competitors",
  };

  const response = await fetch(ORGANIC_COMPETITORS_ENDPOINT, {
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
    throw new OrganicCompetitorsProviderError("DataForSEO returned an invalid response.", {
      code: error?.code ?? "PROVIDER_INVALID_RESPONSE",
      providerStatus: response.status,
    });
  }

  const providerTask = payload?.tasks?.[0];
  const actualCostUsd = finite(payload?.cost) ?? finite(providerTask?.cost);
  if (!response.ok || payload?.status_code !== 20000 || providerTask?.status_code !== 20000) {
    throw new OrganicCompetitorsProviderError("DataForSEO could not complete the organic competitors request.", {
      code: "PROVIDER_REQUEST_FAILED",
      providerStatus: providerTask?.status_code ?? payload?.status_code ?? response.status,
      actualCostUsd,
    });
  }
  const result = providerTask?.result?.[0] ?? null;
  return {
    data: normalizeResult(result, domain),
    actualCostUsd,
    taskCount: Number.isInteger(payload?.tasks_count) ? payload.tasks_count : 1,
    resultCount: Number.isInteger(providerTask?.result_count)
      ? providerTask.result_count
      : Array.isArray(result?.items) ? result.items.length : 0,
  };
}
