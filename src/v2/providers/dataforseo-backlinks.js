import { enrichBacklinkSummary } from "../intelligence/backlink-health.js";

const DATAFORSEO_URL = "https://api.dataforseo.com/v3/backlinks/summary/live";
const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;

export class BacklinkProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "BacklinkProviderError";
    this.code = details.code ?? "BACKLINK_PROVIDER_ERROR";
    this.httpStatus = details.httpStatus ?? 502;
    this.providerStatus = details.providerStatus ?? null;
    this.actualCostUsd = details.actualCostUsd ?? null;
    this.taskCount = details.taskCount ?? null;
  }
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function topEntries(value, limit = 10) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value)
    .map(([name, count]) => ({ name: name || "unknown", count: numberOrNull(count) ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function normalizeBacklinkSummary(result, target) {
  const referringPages = numberOrNull(result?.referring_pages);
  const nofollowPages = numberOrNull(result?.referring_pages_nofollow);
  const dofollowPages = referringPages === null || nofollowPages === null
    ? null
    : Math.max(0, referringPages - nofollowPages);
  const nofollowShare = referringPages && nofollowPages !== null
    ? Math.round((nofollowPages / referringPages) * 10000) / 100
    : null;

  return enrichBacklinkSummary({
    target,
    scope: "domain_with_subdomains",
    status: "live",
    metrics: {
      domain_rank: numberOrNull(result?.rank),
      backlinks: numberOrNull(result?.backlinks),
      referring_domains: numberOrNull(result?.referring_domains),
      referring_main_domains: numberOrNull(result?.referring_main_domains),
      referring_ips: numberOrNull(result?.referring_ips),
      referring_subnets: numberOrNull(result?.referring_subnets),
      referring_pages: referringPages,
      referring_pages_dofollow: dofollowPages,
      referring_pages_nofollow: nofollowPages,
      nofollow_share_percent: nofollowShare,
      backlink_spam_score: numberOrNull(result?.backlinks_spam_score),
      target_spam_score: numberOrNull(result?.info?.target_spam_score),
      broken_backlinks: numberOrNull(result?.broken_backlinks),
      broken_pages: numberOrNull(result?.broken_pages),
      crawled_pages: numberOrNull(result?.crawled_pages),
    },
    distributions: {
      top_tlds: topEntries(result?.referring_links_tld),
      link_types: topEntries(result?.referring_links_types),
      link_attributes: topEntries(result?.referring_links_attributes),
      platform_types: topEntries(result?.referring_links_platform_types),
      countries: topEntries(result?.referring_links_countries),
    },
    target_info: {
      server: typeof result?.info?.server === "string" ? result.info.server : null,
      cms: typeof result?.info?.cms === "string" ? result.info.cms : null,
      country: typeof result?.info?.country === "string" ? result.info.country : null,
    },
    first_seen: typeof result?.first_seen === "string" ? result.first_seen : null,
    generated_at: new Date().toISOString(),
  });
}

export async function fetchBacklinkSummary({ login, password, target, signal }) {
  if (!login || !password) {
    throw new BacklinkProviderError("DataForSEO credentials are not configured.", {
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
      target,
      include_subdomains: true,
      include_indirect_links: false,
      exclude_internal_backlinks: true,
      internal_list_limit: 10,
      backlinks_status_type: "live",
      rank_scale: "one_hundred",
      tag: "seo-pro-v2-backlink-snapshot",
    }]),
  });

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new BacklinkProviderError("DataForSEO response was unexpectedly large.", {
      code: "PROVIDER_RESPONSE_TOO_LARGE",
      httpStatus: 502,
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new BacklinkProviderError("DataForSEO returned invalid JSON.", {
      code: "PROVIDER_INVALID_RESPONSE",
      httpStatus: 502,
    });
  }

  const task = payload?.tasks?.[0];
  const actualCostUsd = numberOrNull(payload?.cost) ?? numberOrNull(task?.cost);
  if (!response.ok || payload?.status_code !== 20000 || task?.status_code !== 20000) {
    throw new BacklinkProviderError("DataForSEO could not complete the backlink summary request.", {
      code: "PROVIDER_REQUEST_FAILED",
      httpStatus: 502,
      providerStatus: task?.status_code ?? payload?.status_code ?? null,
      actualCostUsd,
      taskCount: Number.isInteger(payload?.tasks_count) ? payload.tasks_count : null,
    });
  }

  return {
    data: normalizeBacklinkSummary(task?.result?.[0] ?? null, target),
    actualCostUsd,
    taskCount: numberOrNull(payload?.tasks_count) ?? 1,
    resultCount: numberOrNull(task?.result_count) ?? (task?.result?.length ?? 0),
  };
}
