function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value) {
  return Math.min(100, Math.max(0, value));
}

function brokenShare(item) {
  const broken = finite(item.broken_backlinks);
  const backlinks = finite(item.backlinks);
  return broken === null || backlinks === null || backlinks <= 0 ? null : broken / backlinks;
}

export function scoreReferringDomainQuality(item = {}) {
  const rank = finite(item.rank);
  const spam = finite(item.spam_score);
  const broken = brokenShare(item);
  const parts = [
    { value: rank === null ? null : clamp(rank), weight: 0.65 },
    { value: spam === null ? null : clamp(100 - spam), weight: 0.25 },
    { value: broken === null ? null : clamp(100 - broken * 400), weight: 0.1 },
  ].filter((part) => part.value !== null);
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const score = parts.length
    ? Math.round(parts.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight)
    : null;

  let label = "Insufficient data";
  let code = "insufficient";
  if ((spam !== null && spam >= 30) || (broken !== null && broken >= 0.2)) {
    label = "High risk";
    code = "high-risk";
  } else if (score !== null && score >= 70) {
    label = "Strong";
    code = "strong";
  } else if (score !== null && score >= 50) {
    label = "Promising";
    code = "promising";
  } else if (score !== null) {
    label = "Review";
    code = "review";
  }

  return {
    version: "rules-0.1",
    score,
    label,
    code,
    confidence_score: Math.round((parts.length / 3) * 100),
  };
}

export function summarizeReferringDomains(items = []) {
  const ranked = items.map((item) => finite(item.rank)).filter((value) => value !== null);
  const qualities = items.map((item) => item.quality ?? scoreReferringDomainQuality(item));
  return {
    returned_domains: items.length,
    average_rank: ranked.length ? Math.round(ranked.reduce((sum, value) => sum + value, 0) / ranked.length) : null,
    strong_sources: qualities.filter((item) => item.code === "strong").length,
    high_risk_sources: qualities.filter((item) => item.code === "high-risk").length,
    backlinks_in_page: items.reduce((sum, item) => sum + (finite(item.backlinks) ?? 0), 0),
  };
}
