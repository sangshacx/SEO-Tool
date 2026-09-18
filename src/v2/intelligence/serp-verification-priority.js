export const SERP_VERIFICATION_PRIORITY_VERSION = "serp-verification-priority-v0.1";

const WEIGHTS = Object.freeze({
  decision_impact: 0.30,
  cluster_match: 0.25,
  search_demand: 0.20,
  commercial_intent: 0.15,
  seo_feasibility: 0.10,
});

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function rounded(value) {
  return Math.round(clamp(value));
}

function decisionImpact(code) {
  return ({
    assign_to_existing: 100,
    review_cluster_fit: 90,
    new_cluster_candidate: 40,
  })[String(code || "").toLowerCase()] ?? 50;
}

function demandScore(searchVolume) {
  const volume = Number(searchVolume);
  if (!Number.isFinite(volume) || volume < 0) return 50;
  if (volume === 0) return 0;
  return rounded((Math.log10(volume + 1) / Math.log10(10001)) * 100);
}

function commercialIntentScore(intent) {
  return ({
    transactional: 100,
    commercial: 90,
    informational: 45,
    navigational: 30,
  })[String(intent || "").toLowerCase()] ?? 50;
}

function feasibilityScore(keywordDifficulty) {
  const kd = Number(keywordDifficulty);
  if (!Number.isFinite(kd)) return 50;
  return rounded(100 - clamp(kd));
}

function labelFor(score) {
  if (score >= 75) return { code: "high", label: "高优先" };
  if (score >= 55) return { code: "medium", label: "中优先" };
  return { code: "low", label: "低优先" };
}

function reasonsFor({ factors, raw }) {
  const reasons = [];
  if (factors.decision_impact >= 90) {
    reasons.push("当前 Cluster 决策会直接受 SERP 证据影响。");
  }
  if (factors.cluster_match >= 70) {
    reasons.push("现有 Cluster Match 较高，补证据更可能改变或确认归类判断。");
  }
  if (raw.search_volume != null && factors.search_demand >= 65) {
    reasons.push("搜索需求较高，值得优先降低错误建页或错误聚类的成本。");
  }
  if (["commercial", "transactional"].includes(String(raw.intent_primary || "").toLowerCase())) {
    reasons.push("关键词具有商业意图，错误决策的业务机会成本更高。");
  }
  if (raw.keyword_difficulty != null && factors.seo_feasibility >= 65) {
    reasons.push("KD 较低，可执行性较高，验证后更容易立即转化为内容行动。");
  }
  if (!reasons.length) {
    reasons.push("当前决策影响与业务指标综合优先级有限，可在更高优先关键词之后验证。");
  }
  return reasons.slice(0, 3);
}

export function buildSerpVerificationPriority({
  decision_code = null,
  match_score = null,
  search_volume = null,
  keyword_difficulty = null,
  intent_primary = null,
} = {}) {
  const factors = {
    decision_impact: decisionImpact(decision_code),
    cluster_match: rounded(match_score),
    search_demand: demandScore(search_volume),
    commercial_intent: commercialIntentScore(intent_primary),
    seo_feasibility: feasibilityScore(keyword_difficulty),
  };
  const score = rounded(
    factors.decision_impact * WEIGHTS.decision_impact
    + factors.cluster_match * WEIGHTS.cluster_match
    + factors.search_demand * WEIGHTS.search_demand
    + factors.commercial_intent * WEIGHTS.commercial_intent
    + factors.seo_feasibility * WEIGHTS.seo_feasibility,
  );
  const classification = labelFor(score);
  const raw = {
    decision_code,
    match_score: Number.isFinite(Number(match_score)) ? Number(match_score) : null,
    search_volume: Number.isFinite(Number(search_volume)) ? Number(search_volume) : null,
    keyword_difficulty: Number.isFinite(Number(keyword_difficulty)) ? Number(keyword_difficulty) : null,
    intent_primary: intent_primary || null,
  };
  return {
    version: SERP_VERIFICATION_PRIORITY_VERSION,
    score,
    code: classification.code,
    label: classification.label,
    factors,
    weights: WEIGHTS,
    raw,
    reasons: reasonsFor({ factors, raw }),
    disclaimer: "Verification Priority 只用于排序 SERP 补证据任务，不代表排名概率、流量或收入。",
  };
}
