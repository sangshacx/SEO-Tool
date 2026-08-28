const RULE_VERSION = "rules-0.1";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function weightedScore(parts) {
  const available = parts.filter((part) => part.score !== null);
  if (!available.length) return null;
  const totalWeight = available.reduce((sum, part) => sum + part.weight, 0);
  return Math.round(available.reduce((sum, part) => sum + part.score * part.weight, 0) / totalWeight);
}

function ratio(numerator, denominator) {
  const top = finite(numerator);
  const bottom = finite(denominator);
  return top === null || bottom === null || bottom <= 0 ? null : top / bottom;
}

function authorityScore(metrics) {
  const rank = finite(metrics.domain_rank);
  const domains = finite(metrics.referring_domains);
  return weightedScore([
    { score: rank === null ? null : clamp(rank), weight: 0.7 },
    {
      score: domains === null ? null : clamp((Math.log10(domains + 1) / 5) * 100),
      weight: 0.3,
    },
  ]);
}

function diversityScore(metrics) {
  const ipRatio = ratio(metrics.referring_ips, metrics.referring_domains);
  const mainDomainRatio = ratio(metrics.referring_main_domains, metrics.referring_domains);
  return weightedScore([
    { score: ipRatio === null ? null : clamp(ipRatio * 100), weight: 0.55 },
    { score: mainDomainRatio === null ? null : clamp(mainDomainRatio * 100), weight: 0.45 },
  ]);
}

function riskHygieneScore(metrics) {
  const spam = finite(metrics.backlink_spam_score);
  const brokenRatio = ratio(metrics.broken_backlinks, metrics.backlinks);
  return weightedScore([
    { score: spam === null ? null : clamp(100 - spam), weight: 0.65 },
    { score: brokenRatio === null ? null : clamp(100 - brokenRatio * 500), weight: 0.35 },
  ]);
}

function followBalanceScore(metrics) {
  const share = finite(metrics.nofollow_share_percent);
  if (share === null) return null;
  if (share >= 10 && share <= 60) return 100;
  return share < 10 ? clamp(50 + share * 5) : clamp(100 - (share - 60) * 2.5);
}

function grade(score) {
  if (score === null) return "Insufficient data";
  if (score >= 80) return "Strong";
  if (score >= 65) return "Healthy";
  if (score >= 45) return "Needs attention";
  return "High risk";
}

function diagnosticSignals(metrics) {
  const signals = [];
  const spam = finite(metrics.backlink_spam_score);
  const brokenRatio = ratio(metrics.broken_backlinks, metrics.backlinks);
  const ipRatio = ratio(metrics.referring_ips, metrics.referring_domains);
  const linksPerDomain = ratio(metrics.backlinks, metrics.referring_domains);
  const nofollow = finite(metrics.nofollow_share_percent);

  if (spam !== null && spam >= 30) {
    signals.push({ severity: "high", code: "HIGH_SPAM", label: "垃圾外链风险较高", detail: `Spam Score 为 ${spam}。` });
  } else if (spam !== null && spam >= 15) {
    signals.push({ severity: "medium", code: "ELEVATED_SPAM", label: "垃圾外链风险偏高", detail: `Spam Score 为 ${spam}。` });
  }
  if (brokenRatio !== null && brokenRatio >= 0.05) {
    signals.push({ severity: "medium", code: "BROKEN_LINKS", label: "失效外链占比较高", detail: `约 ${rounded(brokenRatio * 100)}% 的外链已失效。` });
  }
  if (ipRatio !== null && ipRatio < 0.35) {
    signals.push({ severity: "medium", code: "LOW_IP_DIVERSITY", label: "引用 IP 多样性较低", detail: `每个引用域对应的独立 IP 比例约为 ${rounded(ipRatio * 100)}%。` });
  }
  if (linksPerDomain !== null && linksPerDomain > 250) {
    signals.push({ severity: "low", code: "LINK_CONCENTRATION", label: "外链可能集中在少数站点", detail: `平均每个引用域约 ${Math.round(linksPerDomain)} 条外链。` });
  }
  if (nofollow !== null && (nofollow < 3 || nofollow > 85)) {
    signals.push({ severity: "low", code: "FOLLOW_IMBALANCE", label: "Follow 属性分布异常", detail: `Nofollow 占比为 ${nofollow}%，建议检查来源是否自然。` });
  }
  return signals;
}

function recommendations(metrics, signals) {
  const items = [];
  const codes = new Set(signals.map((signal) => signal.code));
  const rank = finite(metrics.domain_rank);
  if (rank !== null && rank < 35) items.push("优先获取相关行业网站的编辑型外链，提升引用域质量。");
  if (codes.has("HIGH_SPAM") || codes.has("ELEVATED_SPAM")) items.push("审查高风险来源与异常锚文本；仅在确认存在人工操纵风险后考虑处置。");
  if (codes.has("BROKEN_LINKS")) items.push("找出仍有价值的失效来源，联系站长修复链接或恢复对应页面。");
  if (codes.has("LOW_IP_DIVERSITY") || codes.has("LINK_CONCENTRATION")) items.push("扩大来源站点和网络分布，减少对少数站群或全站链接的依赖。");
  if (codes.has("FOLLOW_IMBALANCE")) items.push("检查链接获取方式，维持符合真实传播场景的 follow / nofollow 组合。");
  if (!items.length) items.push("当前未发现明显结构性风险；持续监控新增引用域、失效链接与 Spam Score 变化。");
  return items.slice(0, 4);
}

export function scoreBacklinkHealth(metrics = {}) {
  const components = {
    authority: authorityScore(metrics),
    diversity: diversityScore(metrics),
    risk_hygiene: riskHygieneScore(metrics),
    follow_balance: followBalanceScore(metrics),
  };
  const score = weightedScore([
    { score: components.authority, weight: 0.35 },
    { score: components.diversity, weight: 0.25 },
    { score: components.risk_hygiene, weight: 0.25 },
    { score: components.follow_balance, weight: 0.15 },
  ]);
  const availableSignals = [
    metrics.domain_rank,
    metrics.referring_domains,
    metrics.referring_ips,
    metrics.referring_main_domains,
    metrics.backlink_spam_score,
    ratio(metrics.broken_backlinks, metrics.backlinks),
    metrics.nofollow_share_percent,
  ].filter((value) => finite(value) !== null).length;
  const signals = diagnosticSignals(metrics);

  return {
    version: RULE_VERSION,
    score,
    grade: grade(score),
    confidence_score: Math.round((availableSignals / 7) * 100),
    components,
    signals,
    recommendations: recommendations(metrics, signals),
    disclaimer: "规则型外链诊断，仅用于排查方向，不代表 Google 排名或人工处罚判断。",
  };
}

export function enrichBacklinkSummary(summary) {
  if (!summary || typeof summary !== "object") return summary;
  return {
    ...summary,
    intelligence: {
      ...(summary.intelligence && typeof summary.intelligence === "object" ? summary.intelligence : {}),
      link_profile_health: scoreBacklinkHealth(summary.metrics),
    },
  };
}
