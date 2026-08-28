import { scoreKeywordPotential } from "../scoring/keyword-potential.js";

function normalizeMonthlySearches(monthlySearches) {
  if (!Array.isArray(monthlySearches)) {
    return [];
  }

  return monthlySearches
    .filter(
      (entry) =>
        Number.isInteger(entry?.year) &&
        Number.isInteger(entry?.month),
    )
    .map((entry) => ({
      year: entry.year,
      month: entry.month,
      search_volume:
        typeof entry.search_volume === "number"
          ? entry.search_volume
          : null,
    }))
    .sort(
      (a, b) =>
        b.year - a.year ||
        b.month - a.month,
    )
    .slice(0, 12);
}

export function normalizeKeywordOverview(providerResult) {
  const item = providerResult?.items?.[0] ?? null;

  if (!item) {
    return null;
  }

  const keywordInfo = item.keyword_info ?? {};
  const properties = item.keyword_properties ?? {};
  const intent = item.search_intent_info ?? {};

  const overview = {
    keyword: item.keyword ?? null,
    location_code: item.location_code ?? providerResult.location_code ?? null,
    language_code: item.language_code ?? providerResult.language_code ?? null,
    metrics: {
      search_volume: keywordInfo.search_volume ?? null,
      keyword_difficulty: properties.keyword_difficulty ?? null,
      cpc_usd: keywordInfo.cpc ?? null,
      competition: keywordInfo.competition ?? null,
      competition_level: keywordInfo.competition_level ?? null,
      low_top_of_page_bid_usd:
        keywordInfo.low_top_of_page_bid ?? null,
      high_top_of_page_bid_usd:
        keywordInfo.high_top_of_page_bid ?? null,
    },
    intent: {
      primary: intent.main_intent ?? null,
      secondary: Array.isArray(intent.foreign_intent)
        ? intent.foreign_intent
        : [],
      last_updated_at: intent.last_updated_time ?? null,
    },
    trend: {
      monthly_searches: normalizeMonthlySearches(
        keywordInfo.monthly_searches,
      ),
      change: {
        monthly:
          keywordInfo.search_volume_trend?.monthly ?? null,
        quarterly:
          keywordInfo.search_volume_trend?.quarterly ?? null,
        yearly:
          keywordInfo.search_volume_trend?.yearly ?? null,
      },
    },
    keyword_properties: {
      core_keyword: properties.core_keyword ?? null,
      detected_language: properties.detected_language ?? null,
      is_another_language: properties.is_another_language ?? null,
    },
    data_freshness: {
      keyword_metrics_updated_at:
        keywordInfo.last_updated_time ?? null,
    },
  };

  return {
    ...overview,
    intelligence: {
      keyword_potential: scoreKeywordPotential(overview),
    },
  };
}
