import { isValidBacklinkDomain, normalizeBacklinkDomain } from "../backlinks/domain.js";

const DATAFORSEO_URL = "https://api.dataforseo.com/v3/backlinks/anchors/live";
const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;
const ORDER_BY = {
  backlinks: ["backlinks,desc"],
  referring_domains: ["referring_domains,desc", "backlinks,desc"],
  rank: ["rank,desc", "backlinks,desc"],
  spam_score: ["backlinks_spam_score,asc", "backlinks,desc"],
  first_seen: ["first_seen,desc"],
};

export class BacklinkAnchorsProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "BacklinkAnchorsProviderError";
    this.code = details.code ?? "BACKLINK_ANCHORS_PROVIDER_ERROR";
    this.httpStatus = details.httpStatus ?? 502;
    this.providerStatus = details.providerStatus ?? null;
    this.actualCostUsd = details.actualCostUsd ?? null;
  }
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value, maxLength = 500) {
  return typeof value === "string" && value ? value.slice(0, maxLength) : null;
}

function numericRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, count]) => typeof key === "string" && typeof count === "number" && Number.isFinite(count))
    .slice(0, 10));
}

async function boundedJson(response) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new BacklinkAnchorsProviderError("DataForSEO response was unexpectedly large.", { code: "PROVIDER_RESPONSE_TOO_LARGE" });
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
      throw new BacklinkAnchorsProviderError("DataForSEO response was unexpectedly large.", { code: "PROVIDER_RESPONSE_TOO_LARGE" });
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
    throw new BacklinkAnchorsProviderError("DataForSEO returned invalid JSON.", { code: "PROVIDER_INVALID_RESPONSE" });
  }
}

function normalizeItem(item) {
  return {
    anchor: typeof item?.anchor === "string" ? item.anchor.slice(0, 500) : "",
    rank: finite(item?.rank),
    backlinks: finite(item?.backlinks),
    first_seen: stringOrNull(item?.first_seen, 100),
    lost_date: stringOrNull(item?.lost_date, 100),
    spam_score: finite(item?.backlinks_spam_score),
    broken_backlinks: finite(item?.broken_backlinks),
    broken_pages: finite(item?.broken_pages),
    referring_domains: finite(item?.referring_domains),
    referring_domains_nofollow: finite(item?.referring_domains_nofollow),
    referring_main_domains: finite(item?.referring_main_domains),
    referring_main_domains_nofollow: finite(item?.referring_main_domains_nofollow),
    referring_ips: finite(item?.referring_ips),
    referring_subnets: finite(item?.referring_subnets),
    referring_pages: finite(item?.referring_pages),
    referring_pages_nofollow: finite(item?.referring_pages_nofollow),
    top_tlds: numericRecord(item?.referring_links_tld),
    link_types: numericRecord(item?.referring_links_types),
    link_attributes: numericRecord(item?.referring_links_attributes),
    platform_types: numericRecord(item?.referring_links_platform_types),
    semantic_locations: numericRecord(item?.referring_links_semantic_locations),
    countries: numericRecord(item?.referring_links_countries),
  };
}

function normalizeResult(result, request) {
  const items = Array.isArray(result?.items) ? result.items.map(normalizeItem) : [];
  const totalCount = finite(result?.total_count) ?? 0;
  const accessibleCount = Math.min(totalCount, 20000);
  return {
    target: request.target,
    scope: "domain_with_subdomains",
    status: request.status,
    sort: request.sort,
    pagination: {
      total_count: totalCount,
      accessible_count: accessibleCount,
      items_count: items.length,
      limit: request.limit,
      offset: request.offset,
      page: Math.floor(request.offset / request.limit) + 1,
      total_pages: accessibleCount ? Math.ceil(accessibleCount / request.limit) : 0,
      has_previous: request.offset > 0,
      has_next: request.offset + request.limit < accessibleCount && items.length > 0,
      offset_cap: 20000,
    },
    items,
    generated_at: new Date().toISOString(),
    disclaimer: "Anchor 分类和占比是当前页规则分析；分页最多访问前 20,000 条，不能代替人工外链审查。",
  };
}

export async function fetchBacklinkAnchors({ login, password, target, limit, offset, sort, status }) {
  if (!login || !password) {
    throw new BacklinkAnchorsProviderError("DataForSEO credentials are not configured.", { code: "PROVIDER_CREDENTIALS_MISSING", httpStatus: 503 });
  }
  const normalizedTarget = normalizeBacklinkDomain(target);
  if (!isValidBacklinkDomain(normalizedTarget)) {
    throw new BacklinkAnchorsProviderError("A valid target domain is required.", { code: "INVALID_PROVIDER_TARGET", httpStatus: 400 });
  }
  const task = {
    target: normalizedTarget,
    limit,
    offset,
    internal_list_limit: 10,
    order_by: ORDER_BY[sort] ?? ORDER_BY.backlinks,
    backlinks_status_type: status,
    include_subdomains: true,
    exclude_internal_backlinks: true,
    rank_scale: "one_hundred",
    tag: "seo-pro-v2-backlink-anchors",
  };
  const response = await fetch(DATAFORSEO_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${login}:${password}`)}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify([task]),
  });
  const payload = await boundedJson(response);
  const providerTask = payload?.tasks?.[0];
  const actualCostUsd = finite(payload?.cost) ?? finite(providerTask?.cost);
  if (!response.ok || payload?.status_code !== 20000 || providerTask?.status_code !== 20000) {
    throw new BacklinkAnchorsProviderError("DataForSEO could not complete the backlink anchors request.", {
      code: "PROVIDER_REQUEST_FAILED",
      providerStatus: providerTask?.status_code ?? payload?.status_code ?? null,
      actualCostUsd,
    });
  }
  const result = providerTask?.result?.[0] ?? null;
  return {
    data: normalizeResult(result, { target: normalizedTarget, limit, offset, sort, status }),
    actualCostUsd,
    taskCount: finite(payload?.tasks_count) ?? 1,
    resultCount: finite(result?.items_count) ?? (result?.items?.length ?? 0),
  };
}
