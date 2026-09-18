import { compareSerpOverlap } from "./serp-overlap.js";
import { buildSerpVerificationPriority } from "./serp-verification-priority.js";

export const CLUSTER_INTELLIGENCE_VERSION = "cluster-intelligence-v0.2";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "best", "buy", "by", "cost", "for", "from",
  "guide", "how", "in", "is", "of", "on", "or", "price", "prices", "the", "to", "vs",
  "what", "where", "which", "with",
]);

const TOKEN_ALIASES = new Map([
  ["coatings", "coating"],
  ["floors", "floor"],
  ["flooring", "floor"],
  ["membranes", "membrane"],
  ["paints", "paint"],
  ["roofs", "roof"],
  ["roofing", "roof"],
  ["sealants", "sealant"],
  ["suppliers", "supplier"],
  ["manufacturers", "manufacturer"],
  ["solutions", "solution"],
]);

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value) {
  return Math.round(clamp(value));
}

function normalizeToken(token) {
  if (TOKEN_ALIASES.has(token)) return TOKEN_ALIASES.get(token);
  if (token.length > 4 && token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export function normalizeClusterKeyword(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function clusterKeywordTokens(value) {
  return normalizeClusterKeyword(value)
    .split(" ")
    .filter(Boolean)
    .map(normalizeToken)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function setSimilarity(firstTokens, secondTokens, firstKeyword, secondKeyword) {
  if (!firstTokens.length || !secondTokens.length) {
    return { score: 0, shared_tokens: [] };
  }

  const first = new Set(firstTokens);
  const second = new Set(secondTokens);
  const shared = [...first].filter((token) => second.has(token)).sort();
  const unionSize = new Set([...first, ...second]).size;
  const containment = shared.length / Math.min(first.size, second.size);
  const jaccard = unionSize ? shared.length / unionSize : 0;

  const normalizedFirst = normalizeClusterKeyword(firstKeyword);
  const normalizedSecond = normalizeClusterKeyword(secondKeyword);
  const phraseContainment = normalizedFirst && normalizedSecond
    && (normalizedFirst === normalizedSecond
      || normalizedFirst.startsWith(normalizedSecond + " ")
      || normalizedSecond.startsWith(normalizedFirst + " ")
      || normalizedFirst.endsWith(" " + normalizedSecond)
      || normalizedSecond.endsWith(" " + normalizedFirst));

  const score = phraseContainment
    ? 100
    : roundScore((containment * 0.60 + jaccard * 0.40) * 100);

  return { score, shared_tokens: shared };
}

function intentCompatibility(candidateIntent, memberIntent) {
  const first = String(candidateIntent ?? "").trim().toLowerCase();
  const second = String(memberIntent ?? "").trim().toLowerCase();
  if (!first && !second) return { score: 50, code: "unknown" };
  if (!first || !second) return { score: 60, code: "partial" };
  if (first === second) return { score: 100, code: "same" };

  const commercialPair = new Set(["commercial", "transactional"]);
  if (commercialPair.has(first) && commercialPair.has(second)) {
    return { score: 75, code: "adjacent_commercial" };
  }
  return { score: 25, code: "different" };
}

function clusterMembers(cluster) {
  return [
    ...(cluster?.primary ? [cluster.primary] : []),
    ...(Array.isArray(cluster?.supporting) ? cluster.supporting : []),
    ...(Array.isArray(cluster?.members) ? cluster.members : []),
  ].filter((member, index, rows) => {
    const id = Number(member?.saved_keyword_id);
    return Number.isInteger(id) && id > 0
      && rows.findIndex((candidate) => Number(candidate?.saved_keyword_id) === id) === index;
  });
}

function scoreAgainstCluster(keyword, cluster, analysisTime) {
  const candidateTokens = clusterKeywordTokens(keyword.keyword);
  const members = clusterMembers(cluster);
  if (!members.length) return null;

  let best = null;
  for (const member of members) {
    const similarity = setSimilarity(
      candidateTokens,
      clusterKeywordTokens(member.keyword),
      keyword.keyword,
      member.keyword,
    );
    const intent = intentCompatibility(keyword.intent_primary, member.intent_primary);
    const candidate = {
      member,
      similarity,
      intent,
    };
    if (
      !best
      || candidate.similarity.score > best.similarity.score
      || (
        candidate.similarity.score === best.similarity.score
        && candidate.intent.score > best.intent.score
      )
    ) {
      best = candidate;
    }
  }

  const primary = cluster.primary ?? members[0];
  const primarySimilarity = setSimilarity(
    candidateTokens,
    clusterKeywordTokens(primary.keyword),
    keyword.keyword,
    primary.keyword,
  );
  const primaryIntent = intentCompatibility(keyword.intent_primary, primary.intent_primary);
  const bestIntent = best.intent.score >= primaryIntent.score ? best.intent : primaryIntent;

  const baseScore = roundScore(
    best.similarity.score * 0.55
    + primarySimilarity.score * 0.25
    + bestIntent.score * 0.20,
  );

  const serpCandidates = members.map((member) => ({
    member,
    evidence: compareSerpOverlap(keyword, member, { analysisTime }),
  }));
  const priority = { available: 5, stale: 4, insufficient: 3, market_mismatch: 2, unavailable: 1 };
  serpCandidates.sort((a, b) =>
    (priority[b.evidence.status] ?? 0) - (priority[a.evidence.status] ?? 0)
    || b.evidence.score - a.evidence.score
  );
  const strongestSerp = serpCandidates[0] ?? null;
  const serpEvidence = strongestSerp
    ? {
        ...strongestSerp.evidence,
        matched_keyword: strongestSerp.member.keyword,
        matched_role: strongestSerp.member.role
          ?? (Number(strongestSerp.member.saved_keyword_id) === Number(cluster.primary?.saved_keyword_id) ? "primary" : "supporting"),
        matched_metrics: strongestSerp.member.metrics ?? null,
        matched_intent_primary: strongestSerp.member.intent_primary ?? null,
      }
    : null;
  const score = serpEvidence?.status === "available"
    ? roundScore(baseScore * 0.60 + serpEvidence.score * 0.40)
    : baseScore;

  return {
    cluster_id: Number(cluster.id),
    cluster_name: cluster.name,
    score,
    base_score: baseScore,
    serp_overlap: serpEvidence,
    best_member_similarity: best.similarity.score,
    primary_similarity: primarySimilarity.score,
    intent_compatibility: bestIntent.score,
    intent_relation: bestIntent.code,
    best_overlap_keyword: best.member.keyword,
    best_overlap_role: best.member.role ?? (Number(best.member.saved_keyword_id) === Number(cluster.primary?.saved_keyword_id) ? "primary" : "supporting"),
    shared_tokens: best.similarity.shared_tokens,
  };
}

function decisionFor(score, serpOverlap) {
  if (serpOverlap?.status === "available" && serpOverlap.strength === "strong" && score >= 65) {
    return {
      code: "assign_to_existing",
      label: "建议归入现有 Cluster",
      next_action: "SERP URL 重叠较强；复核页面目标后，可手动分配到该 Topic Cluster。",
    };
  }
  if (score >= 75) {
    return {
      code: "assign_to_existing",
      label: "建议归入现有 Cluster",
      next_action: "复核建议后，可手动分配到该 Topic Cluster。",
    };
  }
  if (score >= 55) {
    return {
      code: "review_cluster_fit",
      label: "需要人工复核",
      next_action: "先比较搜索意图与页面目标，再决定归入现有 Cluster 或新建 Cluster。",
    };
  }
  return {
    code: "new_cluster_candidate",
    label: "更适合新建 Cluster",
    next_action: "当前没有足够强的现有 Cluster 匹配；可考虑新建 Cluster 或继续积累相关关键词。",
  };
}

function cannibalizationFor(match) {
  if (!match) {
    return {
      level: "none",
      score: 0,
      reason: "没有可比较的现有 Cluster 成员。",
    };
  }

  if (match.serp_overlap?.status === "available") {
    const strength = match.serp_overlap.strength;
    const level = strength === "strong" ? "high" : strength === "moderate" ? "medium" : "none";
    const score = strength === "strong"
      ? Math.max(85, match.serp_overlap.score)
      : strength === "moderate"
        ? Math.max(70, match.serp_overlap.score)
        : Math.min(54, match.serp_overlap.score);
    return {
      level,
      score,
      evidence_source: "serp_overlap",
      reason: strength === "strong"
        ? "真实 Top 10 SERP URL 高度重叠；若为两个关键词分别创建页面，存在较高的潜在页面重叠风险。"
        : strength === "moderate"
          ? "真实 Top 10 SERP 存在中等 URL 重叠；独立建页前应人工复核页面目标。"
          : "真实 Top 10 SERP URL 重叠较低，暂不支持较高的页面蚕食风险判断。",
    };
  }

  const intentBoost = match.intent_relation === "same"
    ? 20
    : match.intent_relation === "adjacent_commercial"
      ? 12
      : match.intent_relation === "partial"
        ? 6
        : 0;
  const score = roundScore(match.best_member_similarity * 0.80 + intentBoost);
  const level = score >= 85 ? "high" : score >= 70 ? "medium" : score >= 55 ? "low" : "none";

  const reason = level === "high"
    ? "关键词与现有 Cluster 成员高度重叠，且 Intent 兼容；若单独建页，存在较高的潜在页面重叠风险。"
    : level === "medium"
      ? "关键词与现有 Cluster 成员有明显重叠；建议在独立建页前人工复核页面目标。"
      : level === "low"
        ? "存在一定关键词结构重叠，但不足以单独判断为页面蚕食。"
        : "当前确定性信号不足以提示明显的页面重叠风险。";

  return { level, score, evidence_source: "lexical_intent", reason };
}

function reasonsFor(match, keyword) {
  if (!match) return ["当前没有包含关键词成员的现有 Topic Cluster。"];
  const reasons = [];
  reasons.push(
    match.shared_tokens.length
      ? "与“" + match.best_overlap_keyword + "”共享：" + match.shared_tokens.join("、") + "。"
      : "与最接近的 Cluster 成员没有明显有效词元重叠。",
  );
  if (match.serp_overlap?.status === "available") {
    reasons.push(
      "SERP overlap：" + match.serp_overlap.shared_url_count + " 个共享 URL，"
      + match.serp_overlap.score + "% 重叠（"
      + match.serp_overlap.strength + "）。",
    );
  } else if (match.serp_overlap?.status === "stale") {
    reasons.push("已有 SERP 快照过旧，因此没有参与最终评分。");
  } else if (match.serp_overlap?.status === "insufficient") {
    reasons.push("已有 SERP 结果不足，暂时不能作为可靠聚类证据。");
  }

  if (match.intent_relation === "same") {
    reasons.push("当前关键词与最匹配成员的 Intent 一致（" + (keyword.intent_primary || "unknown") + "）。");
  } else if (match.intent_relation === "adjacent_commercial") {
    reasons.push("Intent 位于 Commercial / Transactional 相邻商业意图范围。");
  } else if (match.intent_relation === "different") {
    reasons.push("当前关键词与最匹配成员的 Intent 不同，因此降低 Cluster 匹配分。");
  } else {
    reasons.push("Intent 数据不完整，匹配置信度因此受限。");
  }
  return reasons;
}

export function buildClusterIntelligence({
  site_domain = null,
  keywords = [],
  clusters = [],
  total_saved_keywords = null,
  truncated = false,
  analysis_time = new Date().toISOString(),
} = {}) {
  const assignedIds = new Set();
  clusters.forEach((cluster) => {
    clusterMembers(cluster).forEach((member) => assignedIds.add(Number(member.saved_keyword_id)));
  });

  const unassigned = keywords.filter((keyword) => !assignedIds.has(Number(keyword.saved_keyword_id)));
  const suggestions = unassigned.map((keyword) => {
    const matches = clusters
      .map((cluster) => scoreAgainstCluster(keyword, cluster, analysis_time))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || b.best_member_similarity - a.best_member_similarity || a.cluster_id - b.cluster_id);
    const best = matches[0] ?? null;
    const decision = decisionFor(best?.score ?? 0, best?.serp_overlap);
    const cannibalization = cannibalizationFor(best);
    const verificationPriority = buildSerpVerificationPriority({
      decision_code: decision.code,
      match_score: best?.score ?? 0,
      search_volume: keyword.metrics?.search_volume,
      keyword_difficulty: keyword.metrics?.keyword_difficulty,
      intent_primary: keyword.intent_primary,
    });
    const matchedMemberVerificationPriority = best?.serp_overlap?.matched_keyword
      ? buildSerpVerificationPriority({
          decision_code: decision.code,
          match_score: best?.score ?? 0,
          search_volume: best.serp_overlap.matched_metrics?.search_volume,
          keyword_difficulty: best.serp_overlap.matched_metrics?.keyword_difficulty,
          intent_primary: best.serp_overlap.matched_intent_primary,
        })
      : null;

    return {
      saved_keyword_id: Number(keyword.saved_keyword_id),
      keyword: keyword.keyword,
      intent_primary: keyword.intent_primary ?? null,
      metrics: keyword.metrics ?? null,
      decision,
      suggested_cluster: best
        ? {
            id: best.cluster_id,
            name: best.cluster_name,
            score: best.score,
          }
        : null,
      components: best
        ? {
            lexical_intent_score: best.base_score,
            final_match_score: best.score,
            best_member_similarity: best.best_member_similarity,
            primary_similarity: best.primary_similarity,
            intent_compatibility: best.intent_compatibility,
            intent_relation: best.intent_relation,
            best_overlap_keyword: best.best_overlap_keyword,
            best_overlap_role: best.best_overlap_role,
            shared_tokens: best.shared_tokens,
          }
        : null,
      serp_overlap: best?.serp_overlap
        ? {
            ...best.serp_overlap,
            matched_verification_priority: matchedMemberVerificationPriority,
          }
        : null,
      verification_priority: verificationPriority,
      confidence: best?.serp_overlap?.status === "available"
        ? {
            level: "high",
            score: 90,
            reason: "最终建议包含有效期内的真实 SERP URL 重叠证据。",
          }
        : best?.serp_overlap?.status === "stale"
          ? {
              level: "low",
              score: 45,
              reason: "存在 SERP 快照，但已过时；当前建议主要依赖词面与 Intent。",
            }
          : {
              level: "medium",
              score: 60,
              reason: "当前建议主要依赖关键词结构与已缓存 Intent，尚缺可靠 SERP overlap 证据。",
            },
      cannibalization,
      reasons: reasonsFor(best, keyword),
    };
  }).sort((a, b) => {
    const scoreA = a.suggested_cluster?.score ?? 0;
    const scoreB = b.suggested_cluster?.score ?? 0;
    return scoreB - scoreA || b.cannibalization.score - a.cannibalization.score || a.keyword.localeCompare(b.keyword);
  });

  return {
    version: CLUSTER_INTELLIGENCE_VERSION,
    site_domain,
    analysis_time,
    summary: {
      total_saved_keywords: Number(total_saved_keywords ?? keywords.length),
      analyzed_keywords: keywords.length,
      assigned_keywords: keywords.length - unassigned.length,
      unassigned_keywords: unassigned.length,
      cluster_count: clusters.length,
      suggested_existing_cluster: suggestions.filter((item) => item.decision.code === "assign_to_existing").length,
      manual_review: suggestions.filter((item) => item.decision.code === "review_cluster_fit").length,
      new_cluster_candidates: suggestions.filter((item) => item.decision.code === "new_cluster_candidate").length,
      potential_cannibalization_high: suggestions.filter((item) => item.cannibalization.level === "high").length,
      serp_evidence_available: suggestions.filter((item) => item.serp_overlap?.status === "available").length,
      serp_evidence_strong: suggestions.filter((item) => item.serp_overlap?.strength === "strong").length,
      serp_evidence_stale: suggestions.filter((item) => item.serp_overlap?.status === "stale").length,
      serp_evidence_coverage_pct: suggestions.length
        ? Math.round((suggestions.filter((item) => item.serp_overlap?.status === "available").length / suggestions.length) * 100)
        : 0,
      verification_priority_high: suggestions.filter((item) => item.verification_priority?.code === "high").length,
      verification_priority_medium: suggestions.filter((item) => item.verification_priority?.code === "medium").length,
      verification_priority_low: suggestions.filter((item) => item.verification_priority?.code === "low").length,
      truncated: Boolean(truncated),
    },
    suggestions,
    thresholds: {
      assign_to_existing_min_score: 75,
      assign_with_strong_serp_min_score: 65,
      manual_review_min_score: 55,
      serp_overlap_strong_min_shared_urls: 3,
      serp_overlap_strong_min_score: 30,
      serp_overlap_min_results: 5,
      serp_overlap_max_age_days: 30,
      cannibalization_high_min_score: 85,
      cannibalization_medium_min_score: 70,
      cannibalization_low_min_score: 55,
    },
    limitations: [
      "v0.2 combines deterministic keyword-token similarity, cached search intent, and cached Top 10 SERP URL overlap when available.",
      "SERP overlap is evidence of search-intent similarity, not proof that the user's existing pages are cannibalizing each other.",
      "No new provider request is triggered by this analysis; missing or stale SERP evidence remains missing until the user explicitly refreshes it elsewhere.",
      "The engine never modifies Topic Cluster assignments automatically.",
    ],
  };
}
