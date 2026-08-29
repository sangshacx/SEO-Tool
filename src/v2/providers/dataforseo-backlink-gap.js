import { isValidBacklinkDomain, normalizeBacklinkDomain } from "../backlinks/domain.js";
import { enrichBacklinkGapPage } from "../intelligence/backlink-gap-opportunity.js";

const DATAFORSEO_URL = "https://api.dataforseo.com/v3/backlinks/domain_intersection/live";
const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_OFFSET_EXCLUSIVE = 20000;

export class BacklinkGapProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "BacklinkGapProviderError";
    this.code = details.code ?? "BACKLINK_GAP_PROVIDER_ERROR";
    this.httpStatus = details.httpStatus ?? 502;
    this.providerStatus = details.providerStatus ?? null;
    this.actualCostUsd = details.actualCostUsd ?? null;
  }
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value, maxLength = 100) {
  return typeof value === "string" && value ? value.slice(0, maxLength) : null;
}

async function boundedJson(response) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new BacklinkGapProviderError("DataForSEO response was unexpectedly large.", { code: "PROVIDER_RESPONSE_TOO_LARGE" });
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
      throw new BacklinkGapProviderError("DataForSEO response was unexpectedly large.", { code: "PROVIDER_RESPONSE_TOO_LARGE" });
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
    throw new BacklinkGapProviderError("DataForSEO returned invalid JSON.", { code: "PROVIDER_INVALID_RESPONSE" });
  }
}

function normalizeCompetitor(record, domain) {
  return {
    domain,
    rank: finite(record?.rank),
    backlinks: finite(record?.backlinks),
    referring_pages: finite(record?.referring_pages),
    referring_pages_nofollow: finite(record?.referring_pages_nofollow),
    spam_score: finite(record?.backlinks_spam_score),
    broken_backlinks: finite(record?.broken_backlinks),
    first_seen: stringOrNull(record?.first_seen),
  };
}

function normalizeItem(item, competitors) {
  const intersection = item?.domain_intersection;
  if (!intersection || typeof intersection !== "object" || Array.isArray(intersection)) return null;
  const competitorRows = competitors.flatMap((domain, index) => {
    const record = intersection[String(index + 1)];
    return record && typeof record === "object" ? [normalizeCompetitor(record, domain)] : [];
  });
  const candidate = Object.values(intersection).find((record) => record && typeof record === "object")?.target;
  const domain = normalizeBacklinkDomain(candidate);
  if (!competitorRows.length || !isValidBacklinkDomain(domain)) return null;
  return { domain, competitors: competitorRows };
}

function normalizeResult(result, request) {
  const rawItems = Array.isArray(result?.items)
    ? result.items.map((item) => normalizeItem(item, request.competitors)).filter(Boolean)
    : [];
  const totalCount = finite(result?.total_count) ?? 0;
  const accessibleCount = Math.min(totalCount, MAX_OFFSET_EXCLUSIVE);
  return enrichBacklinkGapPage({
    own_domain: request.ownDomain,
    competitor_domains: [...request.competitors],
    scope: "domain_with_subdomains",
    status: "live",
    pagination: {
      total_count: totalCount,
      accessible_count: accessibleCount,
      items_count: rawItems.length,
      limit: request.limit,
      offset: request.offset,
      page: Math.floor(request.offset / request.limit) + 1,
      total_pages: accessibleCount ? Math.ceil(accessibleCount / request.limit) : 0,
      has_previous: request.offset > 0,
      has_next: request.offset + request.limit < accessibleCount && rawItems.length > 0,
      offset_cap: MAX_OFFSET_EXCLUSIVE,
    },
    items: rawItems,
    generated_at: new Date().toISOString(),
    disclaimer: "Opportunity Score 是当前页透明规则评分；结果仅表示竞争对手已有而本站尚缺少的潜在引用域，需人工确认相关性与联络价值。",
  });
}

export async function fetchBacklinkGap({ login, password, ownDomain, competitors, limit, offset }) {
  if (!login || !password) {
    throw new BacklinkGapProviderError("DataForSEO credentials are not configured.", { code: "PROVIDER_CREDENTIALS_MISSING", httpStatus: 503 });
  }
  const normalizedOwn = normalizeBacklinkDomain(ownDomain);
  const normalizedCompetitors = Array.isArray(competitors) ? competitors.map(normalizeBacklinkDomain) : [];
  if (!isValidBacklinkDomain(normalizedOwn)
    || normalizedCompetitors.length < 1
    || normalizedCompetitors.length > 3
    || normalizedCompetitors.some((domain) => !isValidBacklinkDomain(domain) || domain === normalizedOwn)) {
    throw new BacklinkGapProviderError("Valid own and competitor domains are required.", { code: "INVALID_PROVIDER_TARGETS", httpStatus: 400 });
  }
  const targets = Object.fromEntries(normalizedCompetitors.map((domain, index) => [String(index + 1), domain]));
  const task = {
    targets,
    exclude_targets: [normalizedOwn],
    limit,
    offset,
    internal_list_limit: 5,
    order_by: normalizedCompetitors.map((_domain, index) => `${index + 1}.rank,desc`),
    backlinks_status_type: "live",
    intersection_mode: "all",
    include_subdomains: true,
    include_indirect_links: false,
    exclude_internal_backlinks: true,
    rank_scale: "one_hundred",
    tag: "seo-pro-v2-backlink-gap",
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
    throw new BacklinkGapProviderError("DataForSEO could not complete the backlink gap request.", {
      code: "PROVIDER_REQUEST_FAILED",
      providerStatus: providerTask?.status_code ?? payload?.status_code ?? null,
      actualCostUsd,
    });
  }
  const result = providerTask?.result?.[0] ?? null;
  return {
    data: normalizeResult(result, { ownDomain: normalizedOwn, competitors: normalizedCompetitors, limit, offset }),
    actualCostUsd,
    taskCount: finite(payload?.tasks_count) ?? 1,
    resultCount: finite(result?.items_count) ?? (result?.items?.length ?? 0),
  };
}
