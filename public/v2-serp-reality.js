(() => {
  const SERP_REALITY_UI_VERSION = "serp-reality-ui-v0.1";

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function competitionLabel(score) {
    const value = finite(score);
    if (value === null) return "数据不足";
    if (value >= 70) return "SERP 较弱";
    if (value >= 45) return "混合竞争";
    return "SERP 较强";
  }

  function decisionCopy(code) {
    if (code === "weak_serp") return "存在较明显的排名突破空间，下一步应查看具体 Top 10 页面。";
    if (code === "mixed_serp") return "竞争结构混合，下一步需要逐页判断哪些结果可被超过。";
    if (code === "strong_serp") return "当前 Top 10 平均强度偏高，优先寻找更弱的相关关键词或更强内容角度。";
    return "当前 SERP 数据不足，暂不做强结论。";
  }

  function serpRealitySummary(data) {
    const metrics = data?.source_metrics || {};
    return Object.freeze({
      version: SERP_REALITY_UI_VERSION,
      ranking_weakness: finite(data?.ranking_weakness),
      organic_click_opportunity: finite(data?.organic_click_opportunity),
      confidence_score: finite(data?.confidence_score),
      average_main_domain_rank: finite(metrics.average_main_domain_rank),
      average_page_rank: finite(metrics.average_page_rank),
      average_referring_domains: finite(metrics.average_referring_domains),
      serp_results_count: finite(metrics.serp_results_count),
      competition_label: competitionLabel(data?.ranking_weakness),
      decision_label: data?.decision?.label || "—",
      next_action: decisionCopy(data?.decision?.code),
      detected_features: Array.isArray(data?.serp_features?.detected) ? data.serp_features.detected : [],
      page_level_results_available: false,
      limitation: "当前请求只提供 Top 10 聚合强度与 SERP 特征，不包含逐页 Top 10 URL 明细。",
      is_estimate: true,
    });
  }

  globalThis.SerpRealityView = Object.freeze({
    SERP_REALITY_UI_VERSION,
    serpRealitySummary,
  });
})();
