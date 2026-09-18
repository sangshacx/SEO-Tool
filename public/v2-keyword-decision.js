(() => {
  const KEYWORD_DECISION_UI_VERSION = "keyword-decision-ui-v0.1";

  const COPY = Object.freeze({
    promising_validate_serp: Object.freeze({
      label: "优先验证",
      next_action: "下一步：分析 SERP 弱度，确认是否值得创建或强化页面。",
    }),
    validate_serp: Object.freeze({
      label: "值得进一步验证",
      next_action: "下一步：检查 SERP 竞争结构，再决定是否进入内容计划。",
    }),
    monitor: Object.freeze({
      label: "暂缓 / 观察",
      next_action: "下一步：先处理更强机会；后续关注需求、难度或趋势变化。",
    }),
    skip_for_now: Object.freeze({
      label: "暂不优先",
      next_action: "下一步：当前不建议投入，除非业务相关性或战略价值很高。",
    }),
    insufficient_data: Object.freeze({
      label: "数据不足",
      next_action: "下一步：补全搜索量和关键词难度后再判断。",
    }),
  });

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function keywordDecisionSummary(potential) {
    const code = potential?.decision?.code || "insufficient_data";
    const copy = COPY[code] || COPY.insufficient_data;
    const score = finiteNumber(potential?.score);
    const confidence = finiteNumber(potential?.confidence_score);
    const availableComponents = Object.values(potential?.components || {})
      .filter((component) => component?.available !== false && finiteNumber(component?.score) !== null)
      .length;
    const requiresSerpValidation = code === "promising_validate_serp" || code === "validate_serp";

    return Object.freeze({
      version: KEYWORD_DECISION_UI_VERSION,
      code,
      label: copy.label,
      next_action: copy.next_action,
      stage: "初步判断",
      score,
      confidence_score: confidence,
      available_components: availableComponents,
      requires_serp_validation: requiresSerpValidation,
      is_estimate: true,
      reason: score === null
        ? "当前缺少形成可靠初步判断所需的核心指标。"
        : `Potential ${score}/100 · 基于搜索量、KD、CPC/搜索意图与趋势；尚未包含 SERP 弱度。`,
    });
  }

  globalThis.KeywordDecisionView = Object.freeze({
    KEYWORD_DECISION_UI_VERSION,
    keywordDecisionSummary,
  });
})();
