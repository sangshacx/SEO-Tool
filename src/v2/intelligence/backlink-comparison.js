function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function difference(own, competitor) {
  const left = finite(own);
  const right = finite(competitor);
  return left === null || right === null ? null : left - right;
}

function profile(role, summary) {
  const metrics = summary?.metrics ?? {};
  const health = summary?.intelligence?.link_profile_health ?? {};
  return {
    role,
    domain: summary?.target ?? null,
    health_score: finite(health.score),
    health_grade: health.grade ?? "Insufficient data",
    confidence_score: finite(health.confidence_score),
    domain_rank: finite(metrics.domain_rank),
    backlinks: finite(metrics.backlinks),
    referring_domains: finite(metrics.referring_domains),
    referring_main_domains: finite(metrics.referring_main_domains),
    referring_ips: finite(metrics.referring_ips),
    dofollow_pages: finite(metrics.referring_pages_dofollow),
    nofollow_share_percent: finite(metrics.nofollow_share_percent),
    spam_score: finite(metrics.backlink_spam_score),
    broken_backlinks: finite(metrics.broken_backlinks),
    components: health.components ?? {},
  };
}

function comparisonVerdict(healthGap) {
  if (healthGap === null) return { code: "insufficient_data", label: "数据不足" };
  if (healthGap >= 10) return { code: "ahead", label: "外链结构领先" };
  if (healthGap <= -10) return { code: "behind", label: "外链结构落后" };
  return { code: "close", label: "外链结构接近" };
}

function comparisonRecommendations(own, competitor, gaps) {
  const items = [];
  if (gaps.referring_domains !== null && gaps.referring_domains < 0) {
    items.push(`竞争对手多 ${Math.abs(gaps.referring_domains).toLocaleString("en-US")} 个引用域；优先获取行业媒体、协会和客户案例类独立来源。`);
  }
  if (gaps.domain_rank !== null && gaps.domain_rank < -5) {
    items.push("Domain Rank 明显落后；重点提升高相关、高权威引用域，而不是单纯增加外链总数。");
  }
  const diversityGap = difference(own.components?.diversity, competitor.components?.diversity);
  if (diversityGap !== null && diversityGap < -10) {
    items.push("引用来源多样性落后；减少对少数站点、站群或全站链接的依赖。");
  }
  const riskGap = difference(own.components?.risk_hygiene, competitor.components?.risk_hygiene);
  if (riskGap !== null && riskGap < -10) {
    items.push("风险健康度落后；先检查垃圾来源、异常锚文本和失效外链，再扩大获链规模。");
  }
  if (gaps.referring_domains !== null && gaps.referring_domains >= 0 && gaps.health_score !== null && gaps.health_score >= 0) {
    items.push("当前外链结构不弱于竞争对手；继续监控新增引用域质量，并把优势链接导向重点商业页面。");
  }
  if (!items.length) items.push("现有数据不足以形成明确差距判断；先补充快照或等待缓存更新后再比较。");
  return items.slice(0, 4);
}

export function compareBacklinkProfiles(ownSummary, competitorSummary) {
  const own = profile("own", ownSummary);
  const competitor = profile("competitor", competitorSummary);
  const gaps = {
    health_score: difference(own.health_score, competitor.health_score),
    domain_rank: difference(own.domain_rank, competitor.domain_rank),
    backlinks: difference(own.backlinks, competitor.backlinks),
    referring_domains: difference(own.referring_domains, competitor.referring_domains),
    referring_ips: difference(own.referring_ips, competitor.referring_ips),
    dofollow_pages: difference(own.dofollow_pages, competitor.dofollow_pages),
  };

  return {
    version: "rules-0.1",
    verdict: comparisonVerdict(gaps.health_score),
    profiles: [own, competitor],
    gaps,
    recommendations: comparisonRecommendations(own, competitor, gaps),
    disclaimer: "差距基于两份缓存快照与规则评分，不代表 Google 排名因素或真实获链难度。",
    generated_at: new Date().toISOString(),
  };
}
