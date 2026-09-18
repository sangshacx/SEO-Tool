import { buildCompetitorGapAction } from "../src/v2/intelligence/competitor-gap-action.js";

export function competitorIntelligencePresentation(intelligence = {}) {
  const score = Number.isFinite(Number(intelligence?.score)) ? Number(intelligence.score) : null;
  const confidence = Number.isFinite(Number(intelligence?.confidence_score)) ? Number(intelligence.confidence_score) : null;
  return {
    score,
    score_label: score == null ? "—" : String(score),
    decision_label: intelligence?.decision?.label || "等待 Snapshot",
    next_action: intelligence?.decision?.next_action || "先运行竞争对手自然搜索概览。",
    confidence_label: confidence == null ? "—" : `${confidence}/100`,
  };
}

function listItems(documentLike, target, items, emptyText) {
  target.replaceChildren();
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    const li = documentLike.createElement("li");
    li.textContent = emptyText;
    target.appendChild(li);
    return;
  }
  rows.forEach((value) => {
    const li = documentLike.createElement("li");
    li.textContent = value;
    target.appendChild(li);
  });
}

export function mountCompetitorIntelligence({
  root,
  competitorWorkspace,
  eventTarget = globalThis.window,
  documentLike = globalThis.document,
} = {}) {
  const panel = root?.querySelector?.(".v2-competitor-snapshot-panel");
  const result = panel?.querySelector?.("#competitorResult");
  const gapInput = root?.querySelector?.("#gapCompetitorDomain");
  if (!panel || !result || !documentLike) return () => {};

  const card = documentLike.createElement("section");
  card.className = "v2-competitor-intelligence-card";
  card.dataset.v2CompetitorIntelligence = "";
  card.hidden = true;
  card.innerHTML = `
    <div class="v2-competitor-intelligence-head">
      <div>
        <div class="v2-competitor-intelligence-eyebrow">COMPETITOR INTELLIGENCE · v0.1</div>
        <h3>Competitor Research Value</h3>
        <p>判断这个域名值不值得继续投入研究，以及下一步应该验证什么。</p>
      </div>
      <div class="v2-competitor-intelligence-score">
        <b data-v2-competitor-intelligence-score>—</b>
        <span data-v2-competitor-intelligence-decision>等待 Snapshot</span>
        <small data-v2-competitor-intelligence-confidence>Confidence —</small>
      </div>
    </div>
    <div class="v2-competitor-intelligence-factors">
      <div><span>Visibility</span><b data-v2-ci-factor="visibility">—</b><small>35%</small></div>
      <div><span>Keyword Footprint</span><b data-v2-ci-factor="keyword_footprint">—</b><small>25%</small></div>
      <div><span>Commercial Signal</span><b data-v2-ci-factor="commercial_signal">—</b><small>20%</small></div>
      <div><span>Actionability</span><b data-v2-ci-factor="actionability">—</b><small>20%</small></div>
    </div>
    <div class="v2-competitor-intelligence-detail">
      <div><b>为什么值得看</b><ul data-v2-ci-signals></ul></div>
      <div><b>限制 / 注意</b><ul data-v2-ci-cautions></ul></div>
    </div>
    <div class="v2-competitor-intelligence-next">
      <div>
        <span>下一步</span>
        <b data-v2-ci-next>先运行 Snapshot。</b>
        <small data-v2-ci-disclaimer></small>
      </div>
      <button type="button" data-v2-ci-gap>去验证 Keyword Gap</button>
    </div>
  `;
  result.before(card);

  const gapPanel = root?.querySelector?.(".v2-competitor-gap-panel");
  const gapResult = gapPanel?.querySelector?.("#gapResult");
  const gapCard = documentLike.createElement("section");
  gapCard.className = "v2-competitor-gap-action-card";
  gapCard.dataset.v2CompetitorGapAction = "";
  gapCard.hidden = true;
  gapCard.innerHTML = `
    <div class="v2-competitor-gap-action-head">
      <div>
        <div class="v2-competitor-intelligence-eyebrow">GAP ACTION BRIEF · v0.1</div>
        <h3>What should I do next?</h3>
        <p>把 Keyword Gap 样本压缩成 Easy Wins、需验证机会和本轮最值得先做的关键词。</p>
      </div>
      <div class="v2-gap-action-decision">
        <b data-v2-gap-action-label>等待 Keyword Gap</b>
        <span data-v2-gap-action-next>先运行 Keyword Gap。</span>
      </div>
    </div>
    <div class="v2-gap-action-metrics">
      <div><span>Easy Wins</span><b data-v2-gap-metric="easy_wins">—</b></div>
      <div><span>高机会需验证</span><b data-v2-gap-metric="high_validate">—</b></div>
      <div><span>商业型缺口</span><b data-v2-gap-metric="commercial_gaps">—</b></div>
      <div><span>低 KD 缺口</span><b data-v2-gap-metric="low_kd_gaps">—</b></div>
    </div>
    <div class="v2-gap-action-top">
      <b>Top 3 优先动作</b>
      <ol data-v2-gap-action-list></ol>
    </div>
    <div class="v2-gap-action-foot" data-v2-gap-action-disclaimer></div>
  `;
  gapResult?.before?.(gapCard);

  let currentDomain = "";
  const render = (detail = {}) => {
    const intelligence = detail.intelligence;
    if (!intelligence) return;
    currentDomain = detail.domain || intelligence.domain || "";
    const view = competitorIntelligencePresentation(intelligence);
    card.querySelector("[data-v2-competitor-intelligence-score]").textContent = view.score_label;
    card.querySelector("[data-v2-competitor-intelligence-decision]").textContent = view.decision_label;
    card.querySelector("[data-v2-competitor-intelligence-confidence]").textContent = `Confidence ${view.confidence_label}`;
    Object.entries(intelligence.factors || {}).forEach(([key, value]) => {
      const target = card.querySelector(`[data-v2-ci-factor="${key}"]`);
      if (target) target.textContent = value == null ? "—" : String(value);
    });
    listItems(documentLike, card.querySelector("[data-v2-ci-signals]"), intelligence.signals, "当前没有明显强项信号。");
    listItems(documentLike, card.querySelector("[data-v2-ci-cautions]"), intelligence.cautions, "当前样本没有额外限制提示。");
    card.querySelector("[data-v2-ci-next]").textContent = view.next_action;
    card.querySelector("[data-v2-ci-disclaimer]").textContent = `${intelligence.version || "competitor-intelligence-v0.1"} · ${intelligence.disclaimer || ""}`;
    card.hidden = false;
  };

  const handleSnapshot = (event) => render(event?.detail || {});
  eventTarget?.addEventListener?.("seo-pro-v2:competitor-snapshot-ready", handleSnapshot);

  const handleGapReady = (event) => {
    const data = event?.detail?.data || event?.detail || {};
    const brief = buildCompetitorGapAction(data);
    if (!gapCard) return;
    gapCard.querySelector("[data-v2-gap-action-label]").textContent = brief.decision.label;
    gapCard.querySelector("[data-v2-gap-action-next]").textContent = brief.decision.next_action;
    Object.entries(brief.summary).forEach(([key, value]) => {
      const target = gapCard.querySelector(`[data-v2-gap-metric="${key}"]`);
      if (target) target.textContent = String(value);
    });
    const list = gapCard.querySelector("[data-v2-gap-action-list]");
    list.replaceChildren();
    if (!brief.top_actions.length) {
      const item = documentLike.createElement("li");
      item.textContent = "当前样本没有达到优先行动阈值的关键词。";
      list.appendChild(item);
    } else {
      brief.top_actions.forEach((action) => {
        const item = documentLike.createElement("li");
        const keyword = documentLike.createElement("b");
        keyword.textContent = action.keyword;
        const meta = documentLike.createElement("span");
        meta.textContent = [
          `Action ${action.action_score}`,
          action.gap_priority == null ? null : `Gap ${action.gap_priority}`,
          action.search_volume == null ? null : `Vol ${action.search_volume}`,
          action.keyword_difficulty == null ? null : `KD ${action.keyword_difficulty}`,
          action.competitor_position == null ? null : `竞品 #${action.competitor_position}`,
        ].filter(Boolean).join(" · ");
        item.append(keyword, meta);
        list.appendChild(item);
      });
    }
    gapCard.querySelector("[data-v2-gap-action-disclaimer]").textContent = `${brief.version} · ${brief.disclaimer}`;
    gapCard.hidden = false;
  };
  eventTarget?.addEventListener?.("seo-pro-v2:keyword-gap-ready", handleGapReady);

  const gapButton = card.querySelector("[data-v2-ci-gap]");
  gapButton.addEventListener("click", () => {
    if (!currentDomain || !gapInput) return;
    gapInput.value = currentDomain;
    competitorWorkspace?.activateTab?.("gap");
    gapInput.focus?.();
  });

  return () => {
    eventTarget?.removeEventListener?.("seo-pro-v2:competitor-snapshot-ready", handleSnapshot);
    eventTarget?.removeEventListener?.("seo-pro-v2:keyword-gap-ready", handleGapReady);
    card.remove?.();
    gapCard.remove?.();
  };
}
