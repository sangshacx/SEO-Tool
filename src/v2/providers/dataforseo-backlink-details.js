import { assessBacklinkDetail, summarizeBacklinkDetails } from "../intelligence/backlink-detail-quality.js";
import { isValidBacklinkDomain, normalizeBacklinkDomain } from "../backlinks/domain.js";

const DATAFORSEO_URL = "https://api.dataforseo.com/v3/backlinks/backlinks/live";
const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;
const ORDER_BY = {
  rank: ["rank,desc"],
  domain_rank: ["domain_from_rank,desc", "page_from_rank,desc"],
  page_rank: ["page_from_rank,desc", "domain_from_rank,desc"],
  first_seen: ["first_seen,desc"],
  last_seen: ["last_seen,desc"],
  spam_score: ["backlink_spam_score,asc", "rank,desc"],
};

export class BacklinkDetailsProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "BacklinkDetailsProviderError";
    this.code = details.code ?? "BACKLINK_DETAILS_PROVIDER_ERROR";
    this.httpStatus = details.httpStatus ?? 502;
    this.providerStatus = details.providerStatus ?? null;
    this.actualCostUsd = details.actualCostUsd ?? null;
  }
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function stringOrNull(value, maxLength = 1000) {
  return typeof value === "string" && value ? value.slice(0, maxLength) : null;
}

function safeHttpUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

async function boundedJson(response) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new BacklinkDetailsProviderError("DataForSEO response was unexpectedly large.", { code: "PROVIDER_RESPONSE_TOO_LARGE" });
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
      throw new BacklinkDetailsProviderError("DataForSEO response was unexpectedly large.", { code: "PROVIDER_RESPONSE_TOO_LARGE" });
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
    throw new BacklinkDetailsProviderError("DataForSEO returned invalid JSON.", { code: "PROVIDER_INVALID_RESPONSE" });
  }
}

function normalizeItem(item) {
  const domainCandidate = normalizeBacklinkDomain(item?.domain_from);
  const domainFrom = isValidBacklinkDomain(domainCandidate) ? domainCandidate : null;
  const normalized = {
    domain_from: domainFrom,
    url_from: safeHttpUrl(item?.url_from),
    url_to: safeHttpUrl(item?.url_to),
    rank: finite(item?.rank),
    domain_from_rank: finite(item?.domain_from_rank),
    page_from_rank: finite(item?.page_from_rank),
    spam_score: finite(item?.backlink_spam_score),
    page_from_status_code: finite(item?.page_from_status_code),
    url_to_status_code: finite(item?.url_to_status_code),
    page_from_external_links: finite(item?.page_from_external_links),
    page_from_language: stringOrNull(item?.page_from_language, 20),
    domain_from_country: stringOrNull(item?.domain_from_country, 10),
    page_from_title: stringOrNull(item?.page_from_title, 500),
    first_seen: stringOrNull(item?.first_seen, 100),
    prev_seen: stringOrNull(item?.prev_seen, 100),
    last_seen: stringOrNull(item?.last_seen, 100),
    item_type: stringOrNull(item?.item_type, 50),
    attributes: Array.isArray(item?.attributes)
      ? item.attributes.filter((value) => typeof value === "string").slice(0, 10)
      : [],
    dofollow: booleanOrNull(item?.dofollow),
    original: booleanOrNull(item?.original),
    anchor: stringOrNull(item?.anchor, 500),
    alt: stringOrNull(item?.alt, 500),
    text_pre: stringOrNull(item?.text_pre, 500),
    text_post: stringOrNull(item?.text_post, 500),
    semantic_location: stringOrNull(item?.semantic_location, 100),
    links_count: finite(item?.links_count),
    is_new: booleanOrNull(item?.is_new) === true,
    is_lost: booleanOrNull(item?.is_lost) === true,
    is_broken: booleanOrNull(item?.is_broken) === true,
  };
  return { ...normalized, quality: assessBacklinkDetail(normalized) };
}

function normalizeResult(result, request) {
  const items = Array.isArray(result?.items)
    ? result.items.map(normalizeItem).filter((item) => item.domain_from && item.url_from && item.url_to)
    : [];
  const totalCount = finite(result?.total_count) ?? 0;
  const cappedTotal = Math.min(totalCount, 20000);
  return {
    target: request.target,
    scope: "domain_with_subdomains",
    status: request.status,
    follow: request.follow,
    sort: request.sort,
    pagination: {
      total_count: totalCount,
      accessible_count: cappedTotal,
      items_count: items.length,
      limit: request.limit,
      offset: request.offset,
      page: Math.floor(request.offset / request.limit) + 1,
      total_pages: cappedTotal ? Math.ceil(cappedTotal / request.limit) : 0,
      has_previous: request.offset > 0,
      has_next: request.offset + request.limit < cappedTotal && items.length > 0,
      offset_cap: 20000,
    },
    summary: summarizeBacklinkDetails(items),
    items,
    generated_at: new Date().toISOString(),
    disclaimer: "Link Quality 是规则评分；当前分页最多访问前 20,000 条，不能代替人工外链审查。",
  };
}

export async function fetchBacklinkDetails({ login, password, target, limit, offset, sort, status, follow }) {
  if (!login || !password) {
    throw new BacklinkDetailsProviderError("DataForSEO credentials are not configured.", { code: "PROVIDER_CREDENTIALS_MISSING", httpStatus: 503 });
  }
  const task = {
    target,
    mode: "as_is",
    limit,
    offset,
    order_by: ORDER_BY[sort] ?? ORDER_BY.rank,
    backlinks_status_type: status,
    include_subdomains: true,
    exclude_internal_backlinks: true,
    rank_scale: "one_hundred",
    tag: "seo-pro-v2-backlink-details",
  };
  if (follow === "dofollow") task.filters = ["dofollow", "=", true];
  if (follow === "nofollow") task.filters = ["dofollow", "=", false];

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
    throw new BacklinkDetailsProviderError("DataForSEO could not complete the backlink details request.", {
      code: "PROVIDER_REQUEST_FAILED",
      providerStatus: providerTask?.status_code ?? payload?.status_code ?? null,
      actualCostUsd,
    });
  }
  const result = providerTask?.result?.[0] ?? null;
  return {
    data: normalizeResult(result, { target, limit, offset, sort, status, follow }),
    actualCostUsd,
    taskCount: finite(payload?.tasks_count) ?? 1,
    resultCount: finite(result?.items_count) ?? (result?.items?.length ?? 0),
  };
}
