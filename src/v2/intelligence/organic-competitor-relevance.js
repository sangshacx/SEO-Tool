export const ORGANIC_COMPETITOR_RELEVANCE_VERSION = "organic-competitor-relevance-v1";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percent(numerator, denominator) {
  const a = finite(numerator);
  const b = finite(denominator);
  if (a === null || b === null || b <= 0) return null;
  return Math.round((a / b) * 10000) / 100;
}

export function buildOrganicCompetitorRelevance({
  sharedKeywords,
  targetKeywords,
  competitorKeywords,
} = {}) {
  const shared = finite(sharedKeywords);
  const own = finite(targetKeywords);
  const competitor = finite(competitorKeywords);
  const similarity =
    shared !== null && own !== null && competitor !== null && own > 0 && competitor > 0
      ? Math.round(Math.min(1, shared / Math.sqrt(own * competitor)) * 10000) / 100
      : null;
  return {
    version: ORGANIC_COMPETITOR_RELEVANCE_VERSION,
    keyword_similarity_percent: similarity,
    your_coverage_percent: percent(shared, own),
    their_overlap_percent: percent(shared, competitor),
    formula: "shared_keywords / sqrt(target_keywords * competitor_keywords)",
  };
}
