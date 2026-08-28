export const KEYWORD_POTENTIAL_SCORE_VERSION = "keyword-potential-v0.1";

const COMPONENT_WEIGHTS = {
  demand: 0.35,
  feasibility: 0.30,
  commercial_value: 0.20,
  trend: 0.15,
};

const INTENT_SCORES = {
  transactional: 100,
  commercial: 80,
  informational: 40,
  navigational: 20,
};

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value) {
  return Math.round(clamp(value));
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function demandScore(searchVolume) {
  const volume = finiteNumber(searchVolume);

  if (volume === null || volume < 0) {
    return null;
  }

  return roundScore((Math.log10(volume + 1) / 5) * 100);
}

function feasibilityScore(keywordDifficulty) {
  const difficulty = finiteNumber(keywordDifficulty);

  if (difficulty === null) {
    return null;
  }

  return roundScore(100 - clamp(difficulty));
}

function commercialValueScore(cpcUsd, primaryIntent) {
  const cpc = finiteNumber(cpcUsd);
  const intentScore = INTENT_SCORES[primaryIntent] ?? null;
  const parts = [];

  if (cpc !== null && cpc >= 0) {
    parts.push({
      score: roundScore((Math.log1p(cpc) / Math.log(11)) * 100),
      weight: 0.6,
    });
  }

  if (intentScore !== null) {
    parts.push({ score: intentScore, weight: 0.4 });
  }

  if (!parts.length) {
    return null;
  }

  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  return roundScore(
    parts.reduce((sum, part) => sum + part.score * part.weight, 0) /
      totalWeight,
  );
}

function trendScore(change = {}) {
  const weightedChanges = [
    [finiteNumber(change.monthly), 0.25],
    [finiteNumber(change.quarterly), 0.35],
    [finiteNumber(change.yearly), 0.40],
  ].filter(([value]) => value !== null);

  if (!weightedChanges.length) {
    return null;
  }

  const totalWeight = weightedChanges.reduce(
    (sum, [, weight]) => sum + weight,
    0,
  );

  return roundScore(
    weightedChanges.reduce(
      (sum, [value, weight]) =>
        sum + clamp(50 + value) * weight,
      0,
    ) / totalWeight,
  );
}

function component(score, weight, explanation) {
  return {
    score,
    weight_percent: Math.round(weight * 100),
    available: score !== null,
    explanation,
  };
}

function decisionFor(score) {
  if (score === null) {
    return {
      code: "insufficient_data",
      label: "Insufficient data",
      reason: "Demand and ranking difficulty are required.",
    };
  }

  if (score >= 75) {
    return {
      code: "promising_validate_serp",
      label: "Promising — validate SERP",
      reason:
        "Strong preliminary potential, but SERP weakness is not yet included.",
    };
  }

  if (score >= 55) {
    return {
      code: "validate_serp",
      label: "Validate SERP",
      reason:
        "Potential is reasonable; inspect ranking pages before prioritizing.",
    };
  }

  if (score >= 35) {
    return {
      code: "monitor",
      label: "Monitor",
      reason:
        "The current balance of demand, difficulty, value, and trend is limited.",
    };
  }

  return {
    code: "skip_for_now",
    label: "Skip for now",
    reason:
      "Preliminary potential is weak relative to the available signals.",
  };
}

export function scoreKeywordPotential(keywordOverview) {
  const metrics = keywordOverview?.metrics ?? {};
  const intent = keywordOverview?.intent ?? {};
  const trend = keywordOverview?.trend ?? {};

  const scores = {
    demand: demandScore(metrics.search_volume),
    feasibility: feasibilityScore(metrics.keyword_difficulty),
    commercial_value: commercialValueScore(
      metrics.cpc_usd,
      intent.primary,
    ),
    trend: trendScore(trend.change),
  };

  const weightedParts = Object.entries(scores)
    .filter(([, score]) => score !== null)
    .map(([name, score]) => ({
      score,
      weight: COMPONENT_WEIGHTS[name],
    }));

  const availableWeight = weightedParts.reduce(
    (sum, part) => sum + part.weight,
    0,
  );

  const hasCoreSignals =
    scores.demand !== null && scores.feasibility !== null;

  const score =
    hasCoreSignals && availableWeight > 0
      ? roundScore(
          weightedParts.reduce(
            (sum, part) => sum + part.score * part.weight,
            0,
          ) / availableWeight,
        )
      : null;

  const confidenceScore = Math.min(
    80,
    Math.round(availableWeight * 100 * 0.8),
  );

  return {
    version: KEYWORD_POTENTIAL_SCORE_VERSION,
    score,
    confidence_score: confidenceScore,
    is_estimate: true,
    decision: decisionFor(score),
    components: {
      demand: component(
        scores.demand,
        COMPONENT_WEIGHTS.demand,
        "Log-scaled monthly search demand.",
      ),
      feasibility: component(
        scores.feasibility,
        COMPONENT_WEIGHTS.feasibility,
        "Inverse of DataForSEO organic keyword difficulty; null is not treated as zero.",
      ),
      commercial_value: component(
        scores.commercial_value,
        COMPONENT_WEIGHTS.commercial_value,
        "CPC and search intent are commercial signals, not revenue.",
      ),
      trend: component(
        scores.trend,
        COMPONENT_WEIGHTS.trend,
        "Monthly, quarterly, and yearly search-volume change.",
      ),
    },
    limitations: [
      "SERP weakness is not included in v0.1.",
      "The score is not a revenue estimate.",
      "Site authority and first-party performance data are not included.",
    ],
  };
}
