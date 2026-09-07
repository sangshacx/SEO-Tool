const EMPTY = "—";
const TABLE_CONFIG = Object.freeze({
  ideas: Object.freeze({ keyword: 2, volume: 3, difficulty: 4, cpc: 5, intent: 6, rank: null, source: "Keyword Ideas" }),
  competitor: Object.freeze({ keyword: 1, rank: 2, volume: 3, difficulty: 4, cpc: 5, intent: 6, source: "Competitor Snapshot" }),
  gap: Object.freeze({ keyword: 2, rank: 3, volume: 4, difficulty: 5, cpc: 6, intent: 7, source: "Keyword Gap" }),
  dashboard: Object.freeze({ keyword: 0, rank: 1, volume: 2, difficulty: 4, cpc: 5, intent: null, source: "Dashboard · Top Organic Keywords" }),
});

function present(value) {
  return value !== null && value !== undefined && String(value).trim() !== "" && String(value).trim() !== EMPTY;
}

function display(value) {
  return present(value) ? String(value).trim() : EMPTY;
}

function firstPresent(...values) {
  return values.find(present);
}

function displayCpc(value) {
  if (!present(value)) return EMPTY;
  if (typeof value === "string" && value.trim().startsWith("$")) return value.trim();
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `$${numeric.toFixed(2)}` : display(value);
}

function intentValue(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return firstPresent(value.primary, value.main_intent, value.label);
  return undefined;
}

export function normalizeKeywordDetail(item = {}, context = {}) {
  const metrics = item.metrics && typeof item.metrics === "object" ? item.metrics : {};
  return Object.freeze({
    keyword: display(firstPresent(item.keyword, item.term)),
    search_volume: display(firstPresent(item.search_volume, item.volume, metrics.search_volume)),
    keyword_difficulty: display(firstPresent(item.keyword_difficulty, item.kd, metrics.keyword_difficulty)),
    cpc: displayCpc(firstPresent(item.cpc_usd, item.cpc, metrics.cpc_usd)),
    intent: display(firstPresent(intentValue(item.intent), item.main_intent, item.search_intent)),
    rank: display(firstPresent(item.position, item.competitor_position, item.rank)),
    source: display(firstPresent(context.source, item.source)),
    updated_at: display(firstPresent(context.updated_at, item.updated_at, item.cached_at)),
  });
}

export function keywordDetailFromCells(kind, cells = [], context = {}) {
  const config = TABLE_CONFIG[kind];
  if (!config) throw new TypeError(`Unknown keyword detail source: ${kind}`);
  const at = (index) => index === null || index === undefined ? undefined : cells[index];
  return Object.freeze({
    keyword: display(at(config.keyword)),
    search_volume: display(at(config.volume)),
    keyword_difficulty: display(at(config.difficulty)),
    cpc: display(at(config.cpc)),
    intent: display(at(config.intent)),
    rank: display(at(config.rank)),
    source: display(firstPresent(context.source, config.source)),
    updated_at: display(context.updated_at),
  });
}

export function updatedAtFromMeta(value) {
  const text = String(value || "");
  const match = text.match(/更新于\s*([^·]+)/);
  return match?.[1]?.trim() || EMPTY;
}

export function createKeywordDetailController({
  input,
  form,
  submitButton,
  locationLike = globalThis.location,
  render = () => {},
  reveal = () => {},
} = {}) {
  let current = null;
  return Object.freeze({
    open(item, context = {}) {
      const detail = item?.search_volume !== undefined || item?.metrics || item?.position !== undefined || item?.competitor_position !== undefined
        ? normalizeKeywordDetail(item, context)
        : Object.freeze({ ...item, keyword: display(item?.keyword), source: display(firstPresent(context.source, item?.source)), updated_at: display(firstPresent(context.updated_at, item?.updated_at)) });
      if (!present(detail.keyword)) return null;
      current = detail;
      if (input) input.value = detail.keyword;
      if (locationLike) locationLike.hash = "keywords";
      render(detail);
      reveal(detail);
      return detail;
    },
    analyze() {
      if (!current || !form || !submitButton || submitButton.disabled || typeof form.requestSubmit !== "function") return false;
      if (input) input.value = current.keyword;
      form.requestSubmit(submitButton);
      return true;
    },
    current() { return current; },
  });
}

function appendMetric(doc, grid, label, id) {
  const card = doc.createElement("div");
  card.className = "metric";
  const labelNode = doc.createElement("div");
  labelNode.className = "label";
  labelNode.textContent = label;
  const valueNode = doc.createElement("div");
  valueNode.className = "value";
  valueNode.id = id;
  valueNode.textContent = EMPTY;
  card.append(labelNode, valueNode);
  grid.appendChild(card);
}

function createPanel(doc) {
  const panel = doc.createElement("div");
  panel.id = "keywordDetail";
  panel.className = "keyworddetail hidden";
  panel.setAttribute("aria-live", "polite");
  panel.innerHTML = `
    <div class="keyworddetailhead">
      <div><div class="label">关键词详情 · 列表数据</div><div id="keywordDetailKeyword" class="keyworddetailtitle">—</div></div>
      <span class="keyworddetailcost">本次 $0</span>
    </div>
    <div id="keywordDetailMetrics" class="metrics"></div>
    <div class="keyworddetailmeta"><span>来源：<b id="keywordDetailSource">—</b></span><span>更新时间：<b id="keywordDetailUpdated">—</b></span></div>
    <div class="note"><b>Cost Guard：</b>这里只读取已经显示在列表中的数据，不会调用 DataForSEO。只有点击“获取完整分析”才会进入现有 Keyword Explorer 查询流程。</div>
    <div class="keyworddetailactions"><button id="keywordDetailAnalyze" type="button">获取完整分析</button></div>`;
  const grid = panel.querySelector("#keywordDetailMetrics");
  appendMetric(doc, grid, "月搜索量", "keywordDetailVolume");
  appendMetric(doc, grid, "关键词难度", "keywordDetailDifficulty");
  appendMetric(doc, grid, "CPC", "keywordDetailCpc");
  appendMetric(doc, grid, "搜索意图", "keywordDetailIntent");
  appendMetric(doc, grid, "当前排名", "keywordDetailRank");
  return panel;
}

function installStyle(doc) {
  if (doc.getElementById("v2KeywordDetailStyle")) return;
  const style = doc.createElement("style");
  style.id = "v2KeywordDetailStyle";
  style.textContent = `.keyworddetail{margin-top:16px;padding:18px;border:1px solid #31547d;border-radius:12px;background:#0b1728}.keyworddetail.hidden{display:none}.keyworddetailhead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.keyworddetailtitle{font-size:24px;font-weight:850;margin-top:4px;color:#edf4ff}.keyworddetailcost{padding:4px 8px;border-radius:999px;background:#123729;color:#83e4be;font-size:11px;font-weight:800}.keyworddetail .metrics{grid-template-columns:repeat(5,1fr)}.keyworddetailmeta{display:flex;flex-wrap:wrap;gap:16px;margin-top:12px;color:#8da3c2;font-size:12px}.keyworddetailmeta b{color:#c8d8ed}.keyworddetailactions{display:flex;justify-content:flex-end;margin-top:12px}.v2-keyword-detail-trigger{cursor:pointer;color:#91b9ff!important;font-weight:750}.v2-keyword-detail-trigger:hover,.v2-keyword-detail-trigger:focus{text-decoration:underline;outline:none}@media(max-width:800px){.keyworddetail .metrics{grid-template-columns:repeat(2,1fr)}}`;
  doc.head?.appendChild(style);
}

function rowTexts(row) {
  return Array.from(row?.children || []).map((cell) => String(cell.textContent || "").trim());
}

function rowKind(cell, row) {
  const body = row?.parentElement;
  const index = Array.from(row?.children || []).indexOf(cell);
  if (body?.id === "ideasBody" && index === TABLE_CONFIG.ideas.keyword) return "ideas";
  if (body?.id === "competitorBody" && index === TABLE_CONFIG.competitor.keyword) return "competitor";
  if (body?.id === "gapBody" && index === TABLE_CONFIG.gap.keyword) return "gap";
  const panel = cell?.closest?.(".v2-dashboard-table-panel");
  if (panel?.querySelector?.("h3")?.textContent?.trim() === "Top Organic Keywords" && index === 0) return "dashboard";
  return null;
}

function sourceContext(kind, doc, cell) {
  if (kind === "competitor") {
    const domain = doc.getElementById("competitorDomain")?.value?.trim();
    return { source: domain ? `Competitor Snapshot · ${domain}` : TABLE_CONFIG.competitor.source, updated_at: updatedAtFromMeta(doc.getElementById("competitorMeta")?.textContent) };
  }
  if (kind === "gap") {
    const domain = doc.getElementById("gapCompetitorDomain")?.value?.trim();
    return { source: domain ? `Keyword Gap · ${domain}` : TABLE_CONFIG.gap.source, updated_at: updatedAtFromMeta(doc.getElementById("gapMeta")?.textContent) };
  }
  if (kind === "dashboard") {
    const panel = cell?.closest?.(".v2-dashboard-table-panel");
    return { source: TABLE_CONFIG.dashboard.source, updated_at: updatedAtFromMeta(panel?.querySelector?.(".v2-dashboard-annotation")?.textContent) };
  }
  return { source: TABLE_CONFIG.ideas.source, updated_at: updatedAtFromMeta(doc.getElementById("ideasMeta")?.textContent) };
}

function markCell(cell) {
  if (!cell || cell.classList?.contains("v2-keyword-detail-trigger")) return;
  cell.classList?.add("v2-keyword-detail-trigger");
  cell.tabIndex = 0;
  cell.setAttribute?.("role", "button");
  const keyword = String(cell.textContent || "").trim();
  if (keyword) cell.setAttribute?.("aria-label", `查看关键词详情：${keyword}`);
}

function decorate(doc) {
  doc.querySelectorAll?.("#ideasBody tr td:nth-child(3),#competitorBody tr td:nth-child(2),#gapBody tr td:nth-child(3)").forEach(markCell);
  doc.querySelectorAll?.(".v2-dashboard-table-panel").forEach((panel) => {
    if (panel.querySelector?.("h3")?.textContent?.trim() !== "Top Organic Keywords") return;
    panel.querySelectorAll?.("tbody tr td:first-child").forEach(markCell);
  });
}

export function mountKeywordDetail({ doc = globalThis.document, win = globalThis.window } = {}) {
  if (!doc || !win || doc.getElementById?.("keywordDetail")) return null;
  const form = doc.getElementById("form"), input = doc.getElementById("keyword"), submitButton = doc.getElementById("submit"), status = doc.getElementById("status");
  if (!form || !input || !submitButton || !status) return null;
  installStyle(doc);
  const panel = createPanel(doc);
  status.insertAdjacentElement?.("afterend", panel);
  if (!panel.parentElement) status.parentElement?.insertBefore?.(panel, status.nextSibling || null);
  const nodes = {
    keyword: panel.querySelector("#keywordDetailKeyword"), volume: panel.querySelector("#keywordDetailVolume"), difficulty: panel.querySelector("#keywordDetailDifficulty"), cpc: panel.querySelector("#keywordDetailCpc"), intent: panel.querySelector("#keywordDetailIntent"), rank: panel.querySelector("#keywordDetailRank"), source: panel.querySelector("#keywordDetailSource"), updated: panel.querySelector("#keywordDetailUpdated"),
  };
  const controller = createKeywordDetailController({
    input, form, submitButton, locationLike: win.location,
    render(detail) {
      nodes.keyword.textContent = detail.keyword; nodes.volume.textContent = detail.search_volume; nodes.difficulty.textContent = detail.keyword_difficulty; nodes.cpc.textContent = detail.cpc; nodes.intent.textContent = detail.intent; nodes.rank.textContent = detail.rank; nodes.source.textContent = detail.source; nodes.updated.textContent = detail.updated_at;
      doc.getElementById("result")?.classList?.add("hidden"); panel.classList.remove("hidden");
    },
    reveal() { (win.requestAnimationFrame || ((callback) => callback()))(() => panel.scrollIntoView?.({ behavior: "smooth", block: "start" })); },
  });
  panel.querySelector("#keywordDetailAnalyze")?.addEventListener("click", () => {
    if (!controller.analyze()) {
      status.textContent = submitButton.disabled ? "关键词市场仍在加载，请稍后再获取完整分析。" : "当前关键词无法提交完整分析。";
      status.className = "status on info";
    }
  });

  const openFromTarget = (target) => {
    const cell = target?.closest?.("td");
    const row = cell?.closest?.("tr");
    const kind = rowKind(cell, row);
    if (!kind) return false;
    const detail = keywordDetailFromCells(kind, rowTexts(row), sourceContext(kind, doc, cell));
    controller.open(detail);
    return true;
  };
  doc.addEventListener("click", (event) => { openFromTarget(event.target); });
  doc.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!event.target?.classList?.contains("v2-keyword-detail-trigger")) return;
    event.preventDefault(); openFromTarget(event.target);
  });
  decorate(doc);
  if (typeof win.MutationObserver === "function" && doc.body) {
    const observer = new win.MutationObserver(() => decorate(doc));
    observer.observe(doc.body, { childList: true, subtree: true });
  }
  return controller;
}

export function autoMountKeywordDetail({ doc = globalThis.document, win = globalThis.window } = {}) {
  if (!doc || !win) return null;
  const mount = () => mountKeywordDetail({ doc, win });
  if (doc.readyState === "loading") { doc.addEventListener("DOMContentLoaded", mount, { once: true }); return null; }
  return mount();
}

if (typeof document !== "undefined" && typeof window !== "undefined") autoMountKeywordDetail({ doc: document, win: window });
