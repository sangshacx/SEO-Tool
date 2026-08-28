function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value) {
  return Math.min(100, Math.max(0, value));
}

export function assessBacklinkDetail(item = {}) {
  const domainRank = finite(item.domain_from_rank);
  const pageRank = finite(item.page_from_rank);
  const backlinkRank = finite(item.rank);
  const spam = finite(item.spam_score);
  const parts = [
    { value: domainRank === null ? null : clamp(domainRank), weight: 0.45 },
    { value: pageRank === null ? null : clamp(pageRank), weight: 0.3 },
    { value: backlinkRank === null ? null : clamp(backlinkRank), weight: 0.15 },
    { value: spam === null ? null : clamp(100 - spam), weight: 0.1 },
  ].filter((part) => part.value !== null);
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const score = parts.length
    ? Math.round(parts.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight)
    : null;

  let label = "Insufficient data";
  let code = "insufficient";
  if (item.is_lost || item.is_broken || (spam !== null && spam >= 30)) {
    label = item.is_lost ? "Lost" : item.is_broken ? "Broken" : "High risk";
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
    confidence_score: Math.round((parts.length / 4) * 100),
  };
}

export function summarizeBacklinkDetails(items = []) {
  const domainRanks = items.map((item) => finite(item.domain_from_rank)).filter((value) => value !== null);
  const pageRanks = items.map((item) => finite(item.page_from_rank)).filter((value) => value !== null);
  return {
    returned_backlinks: items.length,
    dofollow_backlinks: items.filter((item) => item.dofollow === true).length,
    nofollow_backlinks: items.filter((item) => item.dofollow === false).length,
    broken_backlinks: items.filter((item) => item.is_broken).length,
    lost_backlinks: items.filter((item) => item.is_lost).length,
    high_risk_backlinks: items.filter((item) => item.quality?.code === "high-risk").length,
    new_backlinks: items.filter((item) => item.is_new).length,
    average_domain_rank: domainRanks.length
      ? Math.round(domainRanks.reduce((sum, value) => sum + value, 0) / domainRanks.length)
      : null,
    average_page_rank: pageRanks.length
      ? Math.round(pageRanks.reduce((sum, value) => sum + value, 0) / pageRanks.length)
      : null,
  };
}
