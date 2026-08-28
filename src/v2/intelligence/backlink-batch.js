function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function average(values) {
  const available = values.filter((value) => value !== null);
  if (!available.length) return null;
  return Math.round((available.reduce((sum, value) => sum + value, 0) / available.length) * 100) / 100;
}

function batchRow(summary) {
  const metrics = summary?.metrics ?? {};
  const health = summary?.intelligence?.link_profile_health ?? {};
  return {
    domain: summary?.target ?? null,
    health_score: finite(health.score),
    health_grade: health.grade ?? "Insufficient data",
    confidence_score: finite(health.confidence_score),
    domain_rank: finite(metrics.domain_rank),
    backlinks: finite(metrics.backlinks),
    referring_domains: finite(metrics.referring_domains),
    referring_ips: finite(metrics.referring_ips),
    dofollow_pages: finite(metrics.referring_pages_dofollow),
    nofollow_share_percent: finite(metrics.nofollow_share_percent),
    spam_score: finite(metrics.backlink_spam_score),
    broken_backlinks: finite(metrics.broken_backlinks),
    generated_at: summary?.generated_at ?? null,
  };
}

export function summarizeBacklinkBatch(summaries = []) {
  const rows = summaries
    .map(batchRow)
    .sort((a, b) => {
      if (a.health_score === null && b.health_score !== null) return 1;
      if (a.health_score !== null && b.health_score === null) return -1;
      return (b.health_score ?? 0) - (a.health_score ?? 0) || String(a.domain).localeCompare(String(b.domain));
    });

  return {
    version: "rules-0.1",
    rows,
    summary: {
      cached_domains: rows.length,
      average_health_score: average(rows.map((row) => row.health_score)),
      average_domain_rank: average(rows.map((row) => row.domain_rank)),
      strong_profiles: rows.filter((row) => row.health_score !== null && row.health_score >= 80).length,
      high_risk_profiles: rows.filter((row) => row.health_score !== null && row.health_score < 45).length,
    },
    disclaimer: "批量结果来自独立缓存快照与规则评分，不代表 Google 官方评级。",
    generated_at: new Date().toISOString(),
  };
}
