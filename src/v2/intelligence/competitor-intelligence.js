export const COMPETITOR_INTELLIGENCE_VERSION = "competitor-intelligence-v0.1";

const WEIGHTS = Object.freeze({
  visibility: 0.35,
  keyword_footprint: 0.25,
  commercial_signal: 0.20,
  actionability: 0.20,
});

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function round(value) {
  return Math.round(clamp(value));
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function logScale(value, cap) {
  const number = finite(value);
  if (number === null) return 50;
  if (number <= 0) return 0;
  return round((Math.log10(number + 1) / Math.log10(cap + 1)) * 100);
}

function sampleRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row?.keyword);
}

function commercialShare(rows) {
  if (!rows.length) return 50;
  const known = rows.filter((row) => row.intent);
  if (!known.length) return 50;
  const commercial = known.filter((row) => {
    const intent = String(row.intent || "").toLowerCase();
    return intent === "commercial" || intent === "transactional";
  }).length;
  return round((commercial / known.length) * 100);
}

function averageCpcScore(rows) {
  const values = rows.map((row) => finite(row.cpc_usd)).filter((value) => value !== null);
  if (!values.length) return 50;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return round((Math.log10(average + 1) / Math.log10(6)) * 100);
}

function actionabilityScore(rows) {
  if (!rows.length) return 50;
  const measurable = rows.filter((row) =>
    finite(row.search_volume) !== null && finite(row.keyword_difficulty) !== null
  );
  const opportunityShare = measurable.length
    ? measurable.filter((row) =>
        finite(row.search_volume) >= 100 && finite(row.keyword_difficulty) <= 50
      ).length / measurable.length
    : 0.5;
  const urlCoverage = rows.filter((row) => row.ranking_url).length / rows.length;
  return round(opportunityShare * 70 + urlCoverage * 30);
}

function confidenceScore(organic, rows) {
  const aggregateValues = [
    organic?.estimated_monthly_traffic,
    organic?.ranked_keywords,
    organic?.positions?.top_10,
    organic?.estimated_paid_traffic_cost_usd,
  ];
  const aggregateCompleteness = aggregateValues.filter((value) => finite(value) !== null).length / aggregateValues.length;
  const sampleSize = Math.min(rows.length / 20, 1);
  const rowCompleteness = rows.length
    ? rows.reduce((sum, row) => {
        const fields = [row.position, row.search_volume, row.keyword_difficulty, row.intent, row.ranking_url];
        return sum + fields.filter((value) => value !== null && value !== undefined && value !== "").length / fields.length;
      }, 0) / rows.length
    : 0;
  return round(25 + aggregateCompleteness * 35 + sampleSize * 20 + rowCompleteness * 20);
}

function decisionFor(score) {
  if (score >= 75) {
    return {
      code: "high_research_value",
      label: "高研究价值",
      next_action: "优先进入 Keyword Gap，验证其高价值关键词是否为本站真实缺口。",
    };
  }
  if (score >= 55) {
    return {
      code: "research_worthy",
      label: "值得继续研究",
      next_action: "先筛选 Top 10、商业词和较低 KD 关键词，再进入 Keyword Gap 验证。",
    };
  }
  if (score >= 35) {
    return {
      code: "selective_research",
      label: "选择性研究",
      next_action: "只研究与你站点主题高度相关的关键词，不必全面跟随该域名。",
    };
  }
  return {
    code: "low_priority_research",
    label: "低优先研究",
    next_action: "暂不扩大投入，优先研究与目标市场和主题更接近的竞争对手。",
  };
}

function explain({ factors, rows }) {
  const signals = [];
  const cautions = [];
  if (factors.visibility >= 70) signals.push("自然搜索可见度较强，具备持续拆解价值。");
  if (factors.keyword_footprint >= 70) signals.push("排名关键词覆盖面较大，可提供更多主题与页面线索。");
  if (factors.commercial_signal >= 65) signals.push("商业意图 / CPC / 流量价值信号较强。");
  if (factors.actionability >= 65) signals.push("样本中存在较多可进一步验证的关键词机会。");
  if (!signals.length) {
    const strongest = Object.entries(factors).sort((a, b) => b[1] - a[1])[0];
    signals.push(`当前最强信号：${strongest?.[0] || "data"} ${strongest?.[1] ?? 0}/100。`);
  }
  if (rows.length < 20) cautions.push("排名关键词样本较少，结论置信度受限。");
  if (factors.actionability < 40) cautions.push("当前样本中可直接转化为关键词行动的信号有限。");
  if (factors.commercial_signal < 40) cautions.push("商业意图和付费价值信号偏弱。");
  return { signals: signals.slice(0, 3), cautions: cautions.slice(0, 3) };
}

export function buildCompetitorSnapshotIntelligence({
  domain = null,
  organic = {},
  top_keywords = [],
} = {}) {
  const rows = sampleRows(top_keywords);
  const visibility = round(
    logScale(organic?.estimated_monthly_traffic, 100000) * 0.65
    + logScale(organic?.positions?.top_10, 10000) * 0.35
  );
  const keywordFootprint = logScale(organic?.ranked_keywords, 100000);
  const commercialSignal = round(
    commercialShare(rows) * 0.55
    + averageCpcScore(rows) * 0.25
    + logScale(organic?.estimated_paid_traffic_cost_usd, 10000) * 0.20
  );
  const actionability = actionabilityScore(rows);
  const factors = {
    visibility,
    keyword_footprint: keywordFootprint,
    commercial_signal: commercialSignal,
    actionability,
  };
  const score = round(
    visibility * WEIGHTS.visibility
    + keywordFootprint * WEIGHTS.keyword_footprint
    + commercialSignal * WEIGHTS.commercial_signal
    + actionability * WEIGHTS.actionability
  );
  const confidence = confidenceScore(organic, rows);
  const decision = decisionFor(score);
  const explanation = explain({ factors, rows });

  return {
    version: COMPETITOR_INTELLIGENCE_VERSION,
    domain,
    score,
    confidence_score: confidence,
    decision,
    factors,
    weights: WEIGHTS,
    signals: explanation.signals,
    cautions: explanation.cautions,
    sample: {
      ranked_keyword_rows: rows.length,
      commercial_rows: rows.filter((row) => ["commercial", "transactional"].includes(String(row.intent || "").toLowerCase())).length,
      actionable_rows: rows.filter((row) => finite(row.search_volume) >= 100 && finite(row.keyword_difficulty) <= 50).length,
    },
    disclaimer: "Competitor Research Value 是基于当前 SEO 指标和最多 50 个排名关键词样本的确定性研究优先级，不代表对手真实收入、业务规模或最终可超越概率。",
  };
}
