export const COMPETITOR_GAP_ACTION_VERSION = "competitor-gap-action-v0.1";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isCommercial(intent) {
  const value = String(intent || "").toLowerCase();
  return value === "commercial" || value === "transactional";
}

function classify(row) {
  const priority = finite(row?.intelligence?.gap_priority?.score);
  const kd = finite(row?.metrics?.keyword_difficulty);
  const rank = finite(row?.competitor_position);
  if (priority === null) return "insufficient";
  if (priority >= 65 && kd !== null && kd <= 35 && rank !== null && rank <= 10) return "easy_win";
  if (priority >= 75) return "high_validate";
  if (priority >= 55) return "review";
  return "monitor";
}

function opportunityScore(row) {
  const priority = finite(row?.intelligence?.gap_priority?.score) ?? 0;
  const volume = finite(row?.metrics?.search_volume);
  const kd = finite(row?.metrics?.keyword_difficulty);
  const cpc = finite(row?.metrics?.cpc_usd);
  const demand = volume == null ? 50 : volume <= 0 ? 0 : Math.min(100, Math.round((Math.log10(volume + 1) / Math.log10(10001)) * 100));
  const feasibility = kd == null ? 50 : Math.max(0, Math.min(100, 100 - kd));
  const commercial = isCommercial(row?.intent?.primary) ? 100 : 45;
  const cpcSignal = cpc == null ? 50 : Math.min(100, Math.round((Math.log10(cpc + 1) / Math.log10(6)) * 100));
  return Math.round(priority * 0.45 + demand * 0.20 + feasibility * 0.15 + commercial * 0.10 + cpcSignal * 0.10);
}

function decisionFor(summary) {
  if (summary.easy_wins >= 3 || (summary.easy_wins >= 1 && summary.high_validate >= 3)) {
    return {
      code: "attack_now",
      label: "优先抢占",
      next_action: "先处理 Top Easy Wins：检查竞品排名页与 SERP，再创建或强化对应页面。",
    };
  }
  if (summary.high_validate >= 3 || summary.commercial_gaps >= 5) {
    return {
      code: "validate_priority",
      label: "优先验证",
      next_action: "先验证高 Gap Priority 的 SERP 与页面差距，再决定本轮内容投入。",
    };
  }
  if (summary.review >= 3) {
    return {
      code: "selective",
      label: "选择性推进",
      next_action: "只挑与你站点主题和商业目标高度相关的缺口继续验证。",
    };
  }
  return {
    code: "monitor",
    label: "暂缓扩大投入",
    next_action: "当前样本缺少足够强的 Gap 机会，先研究其他竞争对手或等待更多数据。",
  };
}

export function buildCompetitorGapAction({
  competitor_domain = null,
  own_domain = null,
  opportunities = [],
} = {}) {
  const rows = (Array.isArray(opportunities) ? opportunities : []).filter((row) => row?.keyword);
  const enriched = rows.map((row) => ({
    row,
    class_code: classify(row),
    action_score: opportunityScore(row),
  }));
  const summary = {
    returned_opportunities: rows.length,
    easy_wins: enriched.filter((item) => item.class_code === "easy_win").length,
    high_validate: enriched.filter((item) => item.class_code === "high_validate").length,
    review: enriched.filter((item) => item.class_code === "review").length,
    commercial_gaps: rows.filter((row) => isCommercial(row?.intent?.primary)).length,
    low_kd_gaps: rows.filter((row) => {
      const kd = finite(row?.metrics?.keyword_difficulty);
      return kd !== null && kd <= 35;
    }).length,
  };
  const topActions = enriched
    .filter((item) => item.class_code !== "monitor" && item.class_code !== "insufficient")
    .sort((a, b) => b.action_score - a.action_score || String(a.row.keyword).localeCompare(String(b.row.keyword)))
    .slice(0, 3)
    .map((item) => ({
      keyword: item.row.keyword,
      action_score: item.action_score,
      class_code: item.class_code,
      gap_priority: finite(item.row?.intelligence?.gap_priority?.score),
      search_volume: finite(item.row?.metrics?.search_volume),
      keyword_difficulty: finite(item.row?.metrics?.keyword_difficulty),
      intent: item.row?.intent?.primary ?? null,
      competitor_position: finite(item.row?.competitor_position),
      competitor_url: item.row?.competitor_url ?? null,
    }));
  const decision = decisionFor(summary);

  return {
    version: COMPETITOR_GAP_ACTION_VERSION,
    competitor_domain,
    own_domain,
    decision,
    summary,
    top_actions: topActions,
    disclaimer: "Gap Action Brief 只基于本次最多 50 个 Keyword Gap 样本做确定性行动排序，不代表全部市场机会、排名概率或收入预测。",
  };
}
