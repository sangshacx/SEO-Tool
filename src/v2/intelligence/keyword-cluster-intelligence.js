export const CLUSTER_INTELLIGENCE_VERSION = "cluster-intelligence-v0.1";

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

function scoreAgainstCluster(keyword, cluster) {
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

  const score = roundScore(
    best.similarity.score * 0.55
    + primarySimilarity.score * 0.25
    + bestIntent.score * 0.20,
  );

  return {
    cluster_id: Number(cluster.id),
    cluster_name: cluster.name,
    score,
    best_member_similarity: best.similarity.score,
    primary_similarity: primarySimilarity.score,
    intent_compatibility: bestIntent.score,
    intent_relation: bestIntent.code,
    best_overlap_keyword: best.member.keyword,
    best_overlap_role: best.member.role ?? (Number(best.member.saved_keyword_id) === Number(cluster.primary?.saved_keyword_id) ? "primary" : "supporting"),
    shared_tokens: best.similarity.shared_tokens,
  };
}

function decisionFor(score) {
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

  return { level, score, reason };
}

function reasonsFor(match, keyword) {
  if (!match) return ["当前没有包含关键词成员的现有 Topic Cluster。"];
  const reasons = [];
  reasons.push(
    match.shared_tokens.length
      ? "与“" + match.best_overlap_keyword + "”共享：" + match.shared_tokens.join("、") + "。"
      : "与最接近的 Cluster 成员没有明显有效词元重叠。",
  );
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
} = {}) {
  const assignedIds = new Set();
  clusters.forEach((cluster) => {
    clusterMembers(cluster).forEach((member) => assignedIds.add(Number(member.saved_keyword_id)));
  });

  const unassigned = keywords.filter((keyword) => !assignedIds.has(Number(keyword.saved_keyword_id)));
  const suggestions = unassigned.map((keyword) => {
    const matches = clusters
      .map((cluster) => scoreAgainstCluster(keyword, cluster))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || b.best_member_similarity - a.best_member_similarity || a.cluster_id - b.cluster_id);
    const best = matches[0] ?? null;
    const decision = decisionFor(best?.score ?? 0);
    const cannibalization = cannibalizationFor(best);

    return {
      saved_keyword_id: Number(keyword.saved_keyword_id),
      keyword: keyword.keyword,
      intent_primary: keyword.intent_primary ?? null,
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
            best_member_similarity: best.best_member_similarity,
            primary_similarity: best.primary_similarity,
            intent_compatibility: best.intent_compatibility,
            intent_relation: best.intent_relation,
            best_overlap_keyword: best.best_overlap_keyword,
            best_overlap_role: best.best_overlap_role,
            shared_tokens: best.shared_tokens,
          }
        : null,
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
      truncated: Boolean(truncated),
    },
    suggestions,
    thresholds: {
      assign_to_existing_min_score: 75,
      manual_review_min_score: 55,
      cannibalization_high_min_score: 85,
      cannibalization_medium_min_score: 70,
      cannibalization_low_min_score: 55,
    },
    limitations: [
      "v0.1 uses deterministic keyword-token similarity and cached search intent only.",
      "SERP URL overlap is not included, so cannibalization labels are potential risks rather than confirmed cannibalization.",
      "The engine never modifies Topic Cluster assignments automatically.",
    ],
  };
}
