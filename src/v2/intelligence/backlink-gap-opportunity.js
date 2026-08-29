function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

function percent(value, total) {
  return total > 0 ? roundOne((value / total) * 100) : 0;
}

function opportunityLabel(score) {
  if (score >= 80) return "High priority";
  if (score >= 60) return "Good opportunity";
  if (score >= 40) return "Review";
  return "Low priority";
}

export function enrichBacklinkGapItem(item, { competitorCount } = {}) {
  const competitors = Array.isArray(item?.competitors) ? item.competitors.map((competitor) => ({ ...competitor })) : [];
  const totalCompetitors = Math.max(competitors.length, Number.isInteger(competitorCount) ? competitorCount : 0);
  const totalBacklinks = competitors.reduce((sum, competitor) => sum + finite(competitor.backlinks), 0);
  const totalReferringPages = competitors.reduce((sum, competitor) => sum + finite(competitor.referring_pages), 0);
  const nofollowPages = competitors.reduce((sum, competitor) => sum + finite(competitor.referring_pages_nofollow), 0);
  const brokenBacklinks = competitors.reduce((sum, competitor) => sum + finite(competitor.broken_backlinks), 0);
  const strongestRank = competitors.reduce((maximum, competitor) => Math.max(maximum, finite(competitor.rank)), 0);
  const averageSpamScore = competitors.length
    ? competitors.reduce((sum, competitor) => sum + finite(competitor.spam_score), 0) / competitors.length
    : 0;
  const coveragePercent = percent(competitors.length, totalCompetitors);
  const brokenSharePercent = percent(brokenBacklinks, totalReferringPages);
  const components = {
    authority: Math.round(clamp(strongestRank)),
    competitor_coverage: Math.round(clamp(coveragePercent)),
    evidence: Math.round(clamp(Math.log10(totalBacklinks + 1) * 30)),
    quality: Math.round(clamp(100 - averageSpamScore - brokenSharePercent)),
  };
  const score = Math.round(
    (components.authority * 0.35)
    + (components.competitor_coverage * 0.3)
    + (components.evidence * 0.2)
    + (components.quality * 0.15),
  );
  return {
    ...item,
    competitors,
    metrics: {
      coverage_count: competitors.length,
      coverage_percent: coveragePercent,
      strongest_rank: strongestRank,
      total_backlinks: totalBacklinks,
      total_referring_pages: totalReferringPages,
      nofollow_share_percent: percent(nofollowPages, totalReferringPages),
      average_spam_score: roundOne(averageSpamScore),
      broken_backlinks: brokenBacklinks,
      broken_share_percent: brokenSharePercent,
    },
    opportunity: {
      score,
      label: opportunityLabel(score),
      version: "backlink-gap-v0.1",
      components,
    },
  };
}

export function enrichBacklinkGapPage(page) {
  const competitorCount = Array.isArray(page?.competitor_domains) ? page.competitor_domains.length : 0;
  const items = (Array.isArray(page?.items) ? page.items : [])
    .map((item) => enrichBacklinkGapItem(item, { competitorCount }))
    .sort((left, right) => right.opportunity.score - left.opportunity.score
      || right.metrics.coverage_count - left.metrics.coverage_count
      || right.metrics.strongest_rank - left.metrics.strongest_rank);
  const averageScore = items.length
    ? Math.round(items.reduce((sum, item) => sum + item.opportunity.score, 0) / items.length)
    : 0;
  return {
    ...page,
    items,
    summary: {
      returned_domains: items.length,
      high_priority_domains: items.filter((item) => item.opportunity.score >= 80).length,
      multi_competitor_domains: items.filter((item) => item.metrics.coverage_count >= 2).length,
      average_opportunity_score: averageScore,
    },
  };
}
