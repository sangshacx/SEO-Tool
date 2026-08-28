export const SERP_WEAKNESS_SCORE_VERSION = "serp-weakness-v0.1";

const CLICK_PENALTIES = {
  ai_overview: 30,
  local_pack: 20,
  shopping: 18,
  featured_snippet: 12,
  answer_box: 12,
  paid: 10,
  knowledge_graph: 10,
  popular_products: 8,
  videos: 5,
  video: 5,
  images: 5,
  top_stories: 5,
};

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(clamp(value));
}

function inverseRankScore(value) {
  const rank = finiteNumber(value);

  if (rank === null || rank < 0) {
    return null;
  }

  return round(100 - (clamp(rank, 0, 1000) / 1000) * 100);
}

function inverseReferringDomainsScore(value) {
  const domains = finiteNumber(value);

  if (domains === null || domains < 0) {
    return null;
  }

  return round(
    100 -
      (Math.log1p(domains) / Math.log1p(1000)) * 100,
  );
}

function weightedScore(parts) {
  const available = parts.filter((part) => part.score !== null);

  if (!available.length) {
    return null;
  }

  const totalWeight = available.reduce(
    (sum, part) => sum + part.weight,
    0,
  );

  return round(
    available.reduce(
      (sum, part) => sum + part.score * part.weight,
      0,
    ) / totalWeight,
  );
}

function clickOpportunity(itemTypes) {
  const types = Array.isArray(itemTypes)
    ? [...new Set(itemTypes)]
    : [];

  const penalty = types.reduce(
    (sum, type) => sum + (CLICK_PENALTIES[type] ?? 0),
    0,
  );

  return {
    score: round(100 - Math.min(75, penalty)),
    detected_features: types,
    penalized_features: types
      .filter((type) => CLICK_PENALTIES[type])
      .map((type) => ({
        type,
        penalty: CLICK_PENALTIES[type],
      })),
  };
}

function decisionFor(rankingWeakness, clickScore) {
  if (rankingWeakness === null) {
    return {
      code: "insufficient_data",
      label: "Insufficient SERP data",
    };
  }

  if (rankingWeakness >= 70 && clickScore >= 60) {
    return {
      code: "weak_serp",
      label: "Weak SERP opportunity",
    };
  }

  if (rankingWeakness >= 45) {
    return {
      code: "mixed_serp",
      label: "Mixed — inspect ranking pages",
    };
  }

  return {
    code: "strong_serp",
    label: "Strong SERP competition",
  };
}

export function scoreSerpWeakness(keywordItem) {
  const backlinks = keywordItem?.avg_backlinks_info ?? {};
  const serp = keywordItem?.serp_info ?? {};

  const components = {
    domain_weakness: inverseRankScore(backlinks.main_domain_rank),
    page_weakness: inverseRankScore(backlinks.rank),
    referring_domain_weakness:
      inverseReferringDomainsScore(backlinks.referring_domains),
  };

  const rankingWeakness = weightedScore([
    { score: components.domain_weakness, weight: 0.4 },
    { score: components.page_weakness, weight: 0.3 },
    {
      score: components.referring_domain_weakness,
      weight: 0.3,
    },
  ]);

  const click = clickOpportunity(serp.serp_item_types);
  const availableSignals = Object.values(components)
    .filter((value) => value !== null).length;
  const confidenceScore = Math.round(
    (availableSignals / 3) * 70 +
      (serp.last_updated_time ? 15 : 0) +
      (backlinks.last_updated_time ? 15 : 0),
  );

  return {
    version: SERP_WEAKNESS_SCORE_VERSION,
    ranking_weakness: rankingWeakness,
    organic_click_opportunity: click.score,
    confidence_score: confidenceScore,
    is_estimate: true,
    decision: decisionFor(rankingWeakness, click.score),
    components,
    serp_features: {
      detected: click.detected_features,
      penalized: click.penalized_features,
    },
    source_metrics: {
      average_referring_domains:
        finiteNumber(backlinks.referring_domains),
      average_page_rank: finiteNumber(backlinks.rank),
      average_main_domain_rank:
        finiteNumber(backlinks.main_domain_rank),
      serp_results_count: serp.se_results_count ?? null,
    },
    data_freshness: {
      serp_updated_at: serp.last_updated_time ?? null,
      backlinks_updated_at:
        backlinks.last_updated_time ?? null,
    },
    limitations: [
      "Uses top-10 averages, not page-by-page content quality.",
      "Click opportunity is not an organic CTR forecast.",
      "Site authority and first-party performance are not included.",
    ],
  };
}
