import { scoreReferringDomainQuality, summarizeReferringDomains } from "../intelligence/referring-domain-quality.js";
import { isValidBacklinkDomain, normalizeBacklinkDomain } from "../backlinks/domain.js";

const DATAFORSEO_URL = "https://api.dataforseo.com/v3/backlinks/referring_domains/live";
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;
const ORDER_BY = {
  rank: ["rank,desc"],
  backlinks: ["backlinks,desc"],
  spam_score: ["backlinks_spam_score,asc", "rank,desc"],
  first_seen: ["first_seen,desc"],
};

export class ReferringDomainsProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ReferringDomainsProviderError";
    this.code = details.code ?? "REFERRING_DOMAINS_PROVIDER_ERROR";
    this.httpStatus = details.httpStatus ?? 502;
    this.providerStatus = details.providerStatus ?? null;
    this.actualCostUsd = details.actualCostUsd ?? null;
  }
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value) {
  return typeof value === "string" && value ? value : null;
}

async function boundedJson(response) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new ReferringDomainsProviderError("DataForSEO response was unexpectedly large.", { code: "PROVIDER_RESPONSE_TOO_LARGE" });
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ReferringDomainsProviderError("DataForSEO response was unexpectedly large.", { code: "PROVIDER_RESPONSE_TOO_LARGE" });
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(combined));
  } catch {
    throw new ReferringDomainsProviderError("DataForSEO returned invalid JSON.", { code: "PROVIDER_INVALID_RESPONSE" });
  }
}

function normalizeItem(item) {
  const domainCandidate = normalizeBacklinkDomain(item?.domain);
  const domain = isValidBacklinkDomain(domainCandidate) ? domainCandidate : null;
  const normalized = {
    domain,
    rank: finite(item?.rank),
    backlinks: finite(item?.backlinks),
    first_seen: stringOrNull(item?.first_seen),
    lost_date: stringOrNull(item?.lost_date),
    spam_score: finite(item?.backlinks_spam_score),
    broken_backlinks: finite(item?.broken_backlinks),
    broken_pages: finite(item?.broken_pages),
    referring_domains: finite(item?.referring_domains),
    referring_main_domains: finite(item?.referring_main_domains),
    referring_ips: finite(item?.referring_ips),
    referring_pages: finite(item?.referring_pages),
    nofollow_pages: finite(item?.referring_pages_nofollow),
  };
  return { ...normalized, quality: scoreReferringDomainQuality(normalized) };
}

function normalizeResult(result, { target, limit, offset, sort }) {
  const items = Array.isArray(result?.items) ? result.items.map(normalizeItem).filter((item) => item.domain) : [];
  const totalCount = finite(result?.total_count) ?? 0;
  return {
    target,
    scope: "domain_with_subdomains",
    status: "live",
    sort,
    pagination: {
      total_count: totalCount,
      items_count: items.length,
      limit,
      offset,
      page: Math.floor(offset / limit) + 1,
      total_pages: totalCount ? Math.ceil(totalCount / limit) : 0,
      has_previous: offset > 0,
      has_next: offset + items.length < totalCount,
    },
    summary: summarizeReferringDomains(items),
    items,
    generated_at: new Date().toISOString(),
    disclaimer: "Source Quality 是规则评分，用于筛选优先级，不代表 Google 评价或人工处罚结论。",
  };
}

export async function fetchReferringDomains({ login, password, target, limit, offset, sort }) {
  if (!login || !password) {
    throw new ReferringDomainsProviderError("DataForSEO credentials are not configured.", { code: "PROVIDER_CREDENTIALS_MISSING", httpStatus: 503 });
  }
  const response = await fetch(DATAFORSEO_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${login}:${password}`)}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify([{
      target,
      limit,
      offset,
      order_by: ORDER_BY[sort] ?? ORDER_BY.rank,
      internal_list_limit: 5,
      backlinks_status_type: "live",
      include_subdomains: true,
      include_indirect_links: false,
      exclude_internal_backlinks: true,
      rank_scale: "one_hundred",
      tag: "seo-pro-v2-referring-domains",
    }]),
  });

  const payload = await boundedJson(response);
  const task = payload?.tasks?.[0];
  const actualCostUsd = finite(payload?.cost) ?? finite(task?.cost);
  if (!response.ok || payload?.status_code !== 20000 || task?.status_code !== 20000) {
    throw new ReferringDomainsProviderError("DataForSEO could not complete the referring domains request.", {
      code: "PROVIDER_REQUEST_FAILED",
      providerStatus: task?.status_code ?? payload?.status_code ?? null,
      actualCostUsd,
    });
  }

  const result = task?.result?.[0] ?? null;
  return {
    data: normalizeResult(result, { target, limit, offset, sort }),
    actualCostUsd,
    taskCount: finite(payload?.tasks_count) ?? 1,
    resultCount: finite(result?.items_count) ?? (result?.items?.length ?? 0),
  };
}
