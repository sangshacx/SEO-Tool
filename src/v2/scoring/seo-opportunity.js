export const SEO_OPPORTUNITY_SCORE_VERSION =
  "seo-opportunity-v1";

const WEIGHTS = {
  keyword_potential: 0.55,
  ranking_weakness: 0.30,
  organic_click_opportunity: 0.15,
};

function finiteScore(value) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
}

function round(value) {
  return Math.round(Math.min(100, Math.max(0, value)));
}

function decisionFor(score) {
  if (score === null) {
    return {
      code: "insufficient_data",
      label: "Run SERP analysis first",
      priority: "unknown",
      next_action: "Analyze SERP weakness",
    };
  }

  if (score >= 75) {
    return {
      code: "high_priority_candidate",
      label: "High-priority candidate",
      priority: "high",
      next_action:
        "Review the ranking pages, then create or refresh content.",
    };
  }

  if (score >= 60) {
    return {
      code: "promising_candidate",
      label: "Promising candidate",
      priority: "medium_high",
      next_action:
        "Confirm content gaps before creating the page.",
    };
  }

  if (score >= 45) {
    return {
      code: "manual_validation",
      label: "Manual validation required",
      priority: "medium",
      next_action:
        "Inspect ranking pages and search intent before investing.",
    };
  }

  return {
    code: "skip_for_now",
    label: "Skip for now",
    priority: "low",
    next_action:
      "Choose a stronger related keyword or monitor this query.",
  };
}

export function scoreSeoOpportunity({
  keywordPotential,
  serpWeakness,
}) {
  const values = {
    keyword_potential: finiteScore(keywordPotential?.score),
    ranking_weakness:
      finiteScore(serpWeakness?.ranking_weakness),
    organic_click_opportunity:
      finiteScore(serpWeakness?.organic_click_opportunity),
  };

  const complete = Object.values(values)
    .every((value) => value !== null);

  const score = complete
    ? round(
        Object.entries(values).reduce(
          (sum, [name, value]) =>
            sum + value * WEIGHTS[name],
          0,
        ),
      )
    : null;

  const keywordConfidence =
    finiteScore(keywordPotential?.confidence_score) ?? 0;
  const serpConfidence =
    finiteScore(serpWeakness?.confidence_score) ?? 0;
  const confidenceScore = complete
    ? Math.min(
        90,
        round(
          keywordConfidence * 0.55 +
            serpConfidence * 0.45,
        ),
      )
    : 0;

  return {
    version: SEO_OPPORTUNITY_SCORE_VERSION,
    score,
    confidence_score: confidenceScore,
    is_estimate: true,
    decision: decisionFor(score),
    components: {
      keyword_potential: {
        score: values.keyword_potential,
        weight_percent: 55,
      },
      ranking_weakness: {
        score: values.ranking_weakness,
        weight_percent: 30,
      },
      organic_click_opportunity: {
        score: values.organic_click_opportunity,
        weight_percent: 15,
      },
    },
    explainability: {
      formula:
        "55% keyword potential + 30% ranking weakness + 15% organic click opportunity",
      interpretation:
        "Higher means a better preliminary SEO opportunity.",
    },
    limitations: [
      "This is not a traffic or revenue forecast.",
      "Site authority and topical relevance are not included.",
      "First-party GSC, GA4, AdSense, and affiliate data are not included.",
    ],
  };
}
