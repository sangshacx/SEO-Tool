import { normalizeRankedKeywordsTarget, RANKED_KEYWORD_DEPTHS } from "../providers/dataforseo-ranked-keywords.js";

function encode(value) {
  return encodeURIComponent(String(value));
}

export function buildOrganicKeywordsCacheKey({
  target,
  locationCode,
  languageCode,
  historicalSerpMode = "live",
  depth = 500,
}) {
  const normalized = normalizeRankedKeywordsTarget(target);
  if (!normalized) throw new TypeError("Invalid organic keywords target.");
  return [
    "v2",
    "organic-keywords",
    "v1",
    normalized.target_type,
    encode(normalized.target.toLowerCase()),
    Number(locationCode),
    String(languageCode).toLowerCase(),
    historicalSerpMode,
    Number(depth),
  ].join(":");
}

export function organicKeywordsCacheCandidates(input) {
  const requested = Number(input?.depth ?? 500);
  if (!RANKED_KEYWORD_DEPTHS.includes(requested)) throw new TypeError("Invalid organic keywords depth.");
  return [...RANKED_KEYWORD_DEPTHS]
    .filter((depth) => depth >= requested)
    .sort((a, b) => b - a)
    .map((depth) => ({
      depth,
      key: buildOrganicKeywordsCacheKey({ ...input, depth }),
    }));
}

export function projectOrganicKeywordsDepth(data, depth) {
  const limit = Number(depth);
  const items = Array.isArray(data?.items) ? data.items.slice(0, limit) : [];
  return {
    ...data,
    depth: limit,
    returned_count: items.length,
    items,
  };
}
