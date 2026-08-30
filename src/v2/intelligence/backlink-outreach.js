function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

const DOMAIN_RISKS = [
  {
    type: "website_value",
    pattern: /(websiteworth|siteworth|worthofweb|websitevalue|pagesearch)/i,
    penalty: 45,
    reason: "域名特征符合网站估值或网站价值聚合工具",
  },
  {
    type: "directory",
    pattern: /(webdirectory|website-directory|linkdirectory|submit-?site|submit-?website|directory\.shop|directory\.pro)/i,
    penalty: 38,
    reason: "域名特征符合通用网站目录或提交站",
  },
  {
    type: "generic_aggregation",
    pattern: /(alljobs|runningwebsites|globalecommerce)/i,
    penalty: 28,
    reason: "域名特征符合通用聚合站，行业相关性通常较弱",
  },
];

export function assessBacklinkOutreach(item = {}) {
  const domain = String(item.domain ?? "").toLowerCase();
  const metrics = item.metrics ?? {};
  const rank = clamp(finite(metrics.strongest_rank));
  const spam = clamp(finite(metrics.average_spam_score));
  const nofollow = clamp(finite(metrics.nofollow_share_percent));
  const broken = clamp(finite(metrics.broken_share_percent));
  const backlinks = Math.max(0, finite(metrics.total_backlinks));
  const reasons = [];
  const riskTypes = [];
  let score = 45 + (rank * 0.45) + Math.min(12, Math.log10(backlinks + 1) * 8)
    - (spam * 0.55) - (broken * 0.3) - (Math.max(0, nofollow - 70) * 0.15);

  for (const risk of DOMAIN_RISKS) {
    if (!risk.pattern.test(domain)) continue;
    score -= risk.penalty;
    riskTypes.push(risk.type);
    reasons.push(risk.reason);
  }
  if (spam >= 50) reasons.push(`Spam Score ${Math.round(spam)}，风险偏高`);
  else if (spam <= 10) reasons.push(`Spam Score ${Math.round(spam)}，风险较低`);
  if (rank >= 60) reasons.push(`来源 Rank ${Math.round(rank)}，权威度信号较强`);
  else if (rank < 10) reasons.push(`来源 Rank ${Math.round(rank)}，权威度证据较弱`);
  if (nofollow >= 90) reasons.push(`Nofollow 占比 ${Math.round(nofollow)}%，传递价值有限`);
  if (broken >= 25) reasons.push(`失效链接占比 ${Math.round(broken)}%，可用性风险较高`);

  const qualityScore = Math.round(clamp(score));
  const hasObviousRisk = riskTypes.includes("website_value") || riskTypes.includes("directory");
  const recommendation = hasObviousRisk || qualityScore < 30 ? "skip"
    : qualityScore >= 70 ? "research_first"
      : qualityScore >= 50 ? "possible"
        : "low_value";
  return {
    quality_score: qualityScore,
    recommendation,
    confidence: Math.round(clamp(55 + Math.min(25, backlinks) + (riskTypes.length * 10))),
    risk_types: riskTypes,
    reasons,
    version: "backlink-outreach-v0.1",
  };
}

function normalizedText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9\u00c0-\u024f\u4e00-\u9fff]+/g, " ").trim();
}

export function classifyWebsiteRelevance(evidence = {}, topics = []) {
  const normalizedTopics = [...new Set((Array.isArray(topics) ? topics : [])
    .map(normalizedText).filter(Boolean))];
  if (evidence.unavailable_reason || (!evidence.title && !evidence.description && !evidence.text)) {
    return {
      score: null,
      confidence: 15,
      evidence_status: "unavailable",
      matched_topics: [],
      reasons: ["无法读取公开页面，相关性证据不足"],
    };
  }

  const title = normalizedText(evidence.title);
  const description = normalizedText(evidence.description);
  const text = normalizedText(evidence.text);
  const matchedTopics = [];
  let evidencePoints = 0;
  for (const topic of normalizedTopics) {
    const inTitle = title.includes(topic);
    const inDescription = description.includes(topic);
    const inText = text.includes(topic);
    if (inTitle || inDescription || inText) matchedTopics.push(topic);
    evidencePoints += inTitle ? 18 : 0;
    evidencePoints += inDescription ? 12 : 0;
    evidencePoints += inText ? 6 : 0;
  }
  const coverage = normalizedTopics.length ? (matchedTopics.length / normalizedTopics.length) * 100 : 0;
  const score = Math.round(clamp((coverage * 0.75) + Math.min(25, evidencePoints)));
  const confidence = Math.round(clamp(45 + Math.min(30, (title.length ? 10 : 0) + (description.length ? 10 : 0) + (text.length >= 80 ? 10 : 0))));
  return {
    score,
    confidence,
    evidence_status: "available",
    matched_topics: matchedTopics,
    reasons: matchedTopics.length
      ? [`公开页面匹配 ${matchedTopics.length}/${normalizedTopics.length} 个目标主题：${matchedTopics.join("、")}`]
      : ["公开页面未发现明确的目标主题匹配"],
  };
}

export function combineOutreachAssessment(quality = {}, relevance = {}, networkRisk) {
  const reasons = [...(quality.reasons ?? []), ...(relevance.reasons ?? [])];
  const riskTypes = [...new Set([...(quality.risk_types ?? []), ...(networkRisk ? [networkRisk.risk_type] : [])])];
  if (networkRisk) reasons.push(`多个候选域名使用高度相似的页面模板，可能存在站群特征`);
  const relevanceScore = relevance.score;
  let recommendation = quality.recommendation ?? "possible";
  if (recommendation !== "skip" && networkRisk) recommendation = "low_value";
  if (recommendation !== "skip" && relevanceScore != null) {
    const combined = (finite(quality.quality_score) * 0.55) + (relevanceScore * 0.45);
    recommendation = combined >= 70 && relevanceScore >= 60 ? "research_first"
      : combined >= 50 && relevanceScore >= 35 ? "possible"
        : combined >= 35 ? "low_value"
          : "skip";
  }
  return {
    quality_score: quality.quality_score ?? null,
    relevance_score: relevanceScore ?? null,
    recommendation,
    confidence: Math.round((finite(quality.confidence, 0) + finite(relevance.confidence, 0)) / 2),
    risk_types: riskTypes,
    reasons,
    version: "backlink-outreach-v0.1",
  };
}

function templateSignature(item) {
  return normalizedText(`${item.title ?? ""} ${item.description ?? ""}`);
}

export function detectPossibleSiteNetwork(items = []) {
  const groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const signature = templateSignature(item);
    if (signature.length < 40) continue;
    const domains = groups.get(signature) ?? [];
    domains.push(String(item.domain ?? ""));
    groups.set(signature, domains);
  }
  const result = {};
  for (const domains of groups.values()) {
    if (domains.length < 2) continue;
    for (const domain of domains) {
      result[domain] = {
        risk_type: "possible_site_network",
        matched_domains: domains.filter((candidate) => candidate !== domain).sort(),
        confidence: 60,
      };
    }
  }
  return result;
}

