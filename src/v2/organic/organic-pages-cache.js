import { normalizeRelevantPagesDomain, RELEVANT_PAGE_DEPTHS } from "../providers/dataforseo-relevant-pages.js";

function encode(value) {
  return encodeURIComponent(String(value));
}

export function buildOrganicPagesCacheKey({
  target,
  locationCode,
  languageCode,
  depth = 500,
}) {
  const domain = normalizeRelevantPagesDomain(target);
  if (!domain) throw new TypeError("Invalid organic pages target.");
  return [
    "v2",
    "organic-pages",
    "v1",
    encode(domain),
    Number(locationCode),
    String(languageCode).toLowerCase(),
    "live",
    Number(depth),
  ].join(":");
}

export function organicPagesCacheCandidates(input) {
  const requested = Number(input?.depth ?? 500);
  if (!RELEVANT_PAGE_DEPTHS.includes(requested)) throw new TypeError("Invalid organic pages depth.");
  return [...RELEVANT_PAGE_DEPTHS]
    .filter((depth) => depth >= requested)
    .sort((a, b) => b - a)
    .map((depth) => ({
      depth,
      key: buildOrganicPagesCacheKey({ ...input, depth }),
    }));
}

export function projectOrganicPagesDepth(data, depth) {
  const limit = Number(depth);
  const items = Array.isArray(data?.items) ? data.items.slice(0, limit) : [];
  return {
    ...data,
    depth: limit,
    returned_count: items.length,
    items,
  };
}
