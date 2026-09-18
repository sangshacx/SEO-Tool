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

  const gapButton = card.querySelector("[data-v2-ci-gap]");
  gapButton.addEventListener("click", () => {
    if (!currentDomain || !gapInput) return;
    gapInput.value = currentDomain;
    competitorWorkspace?.activateTab?.("gap");
    gapInput.focus?.();
  });

  return () => {
    eventTarget?.removeEventListener?.("seo-pro-v2:competitor-snapshot-ready", handleSnapshot);
    card.remove?.();
  };
}
