function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function bool(value) {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}

function percent(count, total) {
  const numerator = finite(count);
  const denominator = finite(total);
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function changeFor(latest = null, previous = null) {
  if (!latest) {
    return { code: "no_data", label: "No observations", kind: "neutral" };
  }
  if (!previous) {
    return { code: "first_observation", label: "First observation", kind: "neutral" };
  }

  const latestCited = bool(latest.target_domain_cited);
  const previousCited = bool(previous.target_domain_cited);
  if (previousCited === false && latestCited === true) {
    return { code: "citation_gained", label: "Citation gained", kind: "positive" };
  }
  if (previousCited === true && latestCited === false) {
    return { code: "citation_lost", label: "Citation lost", kind: "negative" };
  }

  const latestMentioned = bool(latest.target_domain_mentioned);
  const previousMentioned = bool(previous.target_domain_mentioned);
  if (previousMentioned === false && latestMentioned === true) {
    return { code: "mention_gained", label: "Mention gained", kind: "positive" };
  }
  if (previousMentioned === true && latestMentioned === false) {
    return { code: "mention_lost", label: "Mention lost", kind: "negative" };
  }

  return { code: "stable", label: "No signal change", kind: "neutral" };
}

export function summarizeAiPromptTrend({
  observationCount = 0,
  mentionObservationCount = 0,
  citationObservationCount = 0,
  totalActualCostUsd = 0,
  latest = null,
  previous = null,
} = {}) {
  const count = Math.max(0, Number(observationCount) || 0);
  const mentioned = Math.max(0, Number(mentionObservationCount) || 0);
  const cited = Math.max(0, Number(citationObservationCount) || 0);
  const spend = finite(totalActualCostUsd);

  return {
    observation_count: count,
    mention_observation_count: mentioned,
    citation_observation_count: cited,
    mention_rate_percent: percent(mentioned, count),
    citation_rate_percent: percent(cited, count),
    total_actual_cost_usd: spend === null ? 0 : Math.round(spend * 1e8) / 1e8,
    latest_observed_at: latest?.observed_at ?? null,
    previous_observed_at: previous?.observed_at ?? null,
    change: changeFor(latest, previous),
    disclaimer:
      "Prompt trend summarizes repeated saved observations for the same configured prompt. It is descriptive, not a probability, ranking score, or causal attribution.",
  };
}
