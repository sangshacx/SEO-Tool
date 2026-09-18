const SAVED_KEYWORDS_URL = "/api/v2/keywords/saved";

const SOURCE_LABELS = Object.freeze({
  manual: "手动",
  keyword_explorer: "Keyword Explorer",
  keyword_ideas: "Keyword Ideas",
  competitor_snapshot: "Competitor",
  keyword_gap: "Keyword Gap",
  serp_reality: "SERP Reality",
});

export const RESEARCH_SAVE_SURFACES = Object.freeze({
  ideasBody: Object.freeze({ source: "keyword_ideas", keyword_cell_index: 2 }),
  competitorBody: Object.freeze({ source: "competitor_snapshot", keyword_cell_index: 1 }),
  gapBody: Object.freeze({ source: "keyword_gap", keyword_cell_index: 2 }),
});

function clean(value) {
  return String(value ?? "").trim();
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("en-US").format(number) : "—";
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)}` : "—";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function buildSavedKeywordListUrl({
  siteDomain,
  q = "",
  tag = "",
  page = 1,
  pageSize = 50,
  sort = "created_at",
  order = "desc",
}) {
  const params = new URLSearchParams({
    site_domain: clean(siteDomain),
    page: String(page),
    page_size: String(pageSize),
    sort,
    order,
  });
  if (clean(q)) params.set("q", clean(q));
  if (clean(tag)) params.set("tag", clean(tag));
  return `${SAVED_KEYWORDS_URL}?${params.toString()}`;
}

export function savedKeywordCreatePayload({ market, keyword, source = "keyword_explorer", tags = [] }) {
  const value = clean(keyword).replace(/\s+/g, " ");
  if (!market?.domain) throw new Error("请先在网站管理添加并选择当前网站。");
  if (!value) throw new Error("请输入要保存的关键词。");
  return {
    site_domain: market.domain,
    keyword: value,
    location_code: Number(market.location_code),
    language_code: market.language_code,
    source,
    tags,
  };
}

export function researchSurfaceKeyword(row, spec) {
  const index = Number(spec?.keyword_cell_index);
  if (!row || !Number.isInteger(index) || index < 0) return "";
  const cell = row.children?.[index];
  if (!cell || cell.querySelector?.(".emptyrow")) return "";
  const linked = clean(cell.querySelector?.("a")?.textContent);
  if (linked) return linked.replace(/\s+/g, " ");
  const textNodes = [...(cell.childNodes || [])]
    .filter((node) => node?.nodeType === 3)
    .map((node) => clean(node.textContent))
    .filter(Boolean);
  const direct = clean(textNodes.join(" "));
  return (direct || clean(cell.textContent)).replace(/\s+/g, " ");
}

export function decorateResearchKeywordRows({
  body,
  spec,
  market,
  onSave,
  documentLike = globalThis.document,
} = {}) {
  if (!body || !spec || typeof onSave !== "function") return 0;
  let added = 0;
  [...(body.children || [])].forEach((row) => {
    if (row.querySelector?.(".emptyrow")) return;
    const cell = row.children?.[spec.keyword_cell_index];
    if (!cell) return;
    const keyword = researchSurfaceKeyword(row, spec);
    if (!keyword) return;
    const existing = cell.querySelector?.("[data-v2-inline-save-keyword]");
    if (existing) {
      const savedForCurrentSite = Boolean(market?.domain) && existing.dataset?.savedSiteDomain === market.domain;
      existing.classList?.toggle?.("saved", savedForCurrentSite);
      existing.classList?.remove?.("error");
      existing.textContent = savedForCurrentSite ? "已保存" : "保存";
      existing.disabled = !market?.domain || savedForCurrentSite;
      existing.title = market?.domain
        ? `保存“${keyword}”到当前网站关键词库`
        : "请先在网站管理添加并选择当前网站";
      return;
    }

    const button = documentLike.createElement("button");
    button.type = "button";
    button.className = "v2-inline-save-keyword";
    button.dataset.v2InlineSaveKeyword = "";
    button.textContent = "保存";
    button.title = market?.domain
      ? `保存“${keyword}”到当前网站关键词库`
      : "请先在网站管理添加并选择当前网站";
    button.disabled = !market?.domain;
    button.addEventListener("click", async (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      button.disabled = true;
      const original = button.textContent;
      button.textContent = "保存中…";
      try {
        const result = await onSave({ keyword, source: spec.source });
        button.textContent = "已保存";
        button.dataset.savedSiteDomain = result?.data?.site_domain || market?.domain || "";
        button.classList?.remove?.("error");
        button.classList?.add?.("saved");
      } catch (error) {
        button.textContent = "重试";
        button.title = error?.message || "保存失败";
        button.classList?.add?.("error");
      } finally {
        if (!button.classList?.contains?.("saved")) button.disabled = !market?.domain;
        if (!button.textContent) button.textContent = original;
      }
    });
    cell.appendChild(button);
    added += 1;
  });
  return added;
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || "关键词库操作失败");
  return payload;
}

function keywordButton(documentLike, item, keywordInput, locationLike) {
  const button = documentLike.createElement("button");
  button.type = "button";
  button.className = "v2-library-keyword";
  button.textContent = item.keyword;
  button.addEventListener("click", () => {
    if (keywordInput) keywordInput.value = item.keyword;
    if (locationLike) locationLike.hash = "keywords";
    keywordInput?.focus?.();
  });
  return button;
}

function renderRows({ documentLike, body, items, keywordInput, locationLike }) {
  body.replaceChildren();
  for (const item of items) {
    const row = documentLike.createElement("tr");
    const keywordCell = documentLike.createElement("td");
    keywordCell.appendChild(keywordButton(documentLike, item, keywordInput, locationLike));
    row.appendChild(keywordCell);

    const metrics = item.metrics || {};
    const values = [
      formatNumber(metrics.search_volume),
      metrics.keyword_difficulty ?? "—",
      formatMoney(metrics.cpc_usd),
      metrics.intent_primary || "—",
      `${item.location_code} · ${item.language_code}`,
      (item.tags || []).join(" · ") || "—",
      SOURCE_LABELS[item.source] || item.source || "—",
      formatDate(metrics.fetched_at || item.updated_at),
    ];
    values.forEach((value) => {
      const cell = documentLike.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });

    const actionCell = documentLike.createElement("td");
    const remove = documentLike.createElement("button");
    remove.type = "button";
    remove.className = "v2-library-remove";
    remove.dataset.savedKeywordId = String(item.id);
    remove.textContent = "删除";
    actionCell.appendChild(remove);
    row.appendChild(actionCell);
    body.appendChild(row);
  }

  if (!items.length) {
    const row = documentLike.createElement("tr");
    const cell = documentLike.createElement("td");
    cell.colSpan = 10;
    cell.className = "emptyrow";
    cell.textContent = "当前网站还没有保存关键词。可先在 Keyword Explorer 中保存一个关键词。";
    row.appendChild(cell);
    body.appendChild(row);
  }
}

export function createKeywordLibrarySection(documentLike = globalThis.document) {
  const section = documentLike.createElement("section");
  section.className = "panel v2-keyword-library";
  section.dataset.v2View = "keyword-library";
  section.dataset.v2KeywordLibrary = "";
  section.innerHTML = `
    <div class="v2-library-head">
      <div>
        <div class="section-title">Keyword Library</div>
        <p class="lead">把研究过的关键词保存成长期资产；查看已有最新指标不会触发 DataForSEO 请求。</p>
      </div>
      <button type="button" data-v2-library-refresh>刷新</button>
    </div>
    <div class="v2-library-tools">
      <input type="search" data-v2-library-query placeholder="搜索已保存关键词">
      <input type="search" data-v2-library-tag placeholder="Tag（可选）">
      <select data-v2-library-sort aria-label="关键词库排序">
        <option value="created_at">最近保存</option>
        <option value="search_volume">搜索量</option>
        <option value="keyword_difficulty">KD</option>
        <option value="cpc_usd">CPC</option>
        <option value="keyword">关键词</option>
      </select>
      <select data-v2-library-order aria-label="关键词库排序方向">
        <option value="desc">降序</option>
        <option value="asc">升序</option>
      </select>
    </div>
    <div class="note"><b>费用：</b>关键词库读取、筛选、删除均为 $0；这里不会主动刷新 DataForSEO 指标。</div>
    <div data-v2-library-status class="status"></div>
    <div class="tablewrap">
      <table class="ideastable v2-library-table">
        <thead><tr><th>关键词</th><th>搜索量</th><th>KD</th><th>CPC</th><th>Intent</th><th>市场</th><th>Tags</th><th>来源</th><th>指标时间</th><th>操作</th></tr></thead>
        <tbody data-v2-library-body></tbody>
      </table>
    </div>
    <div class="v2-library-pager">
      <span data-v2-library-summary>—</span>
      <button type="button" data-v2-library-prev>上一页</button>
      <button type="button" data-v2-library-next>下一页</button>
    </div>
  `;
  return section;
}

export function mountKeywordLibrary({
  root,
  context,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  documentLike = globalThis.document,
  locationLike = globalThis.location,
  confirmImpl = globalThis.confirm?.bind(globalThis) || (() => true),
} = {}) {
  const section = root?.querySelector?.("[data-v2-keyword-library]");
  if (!section || !context || typeof fetchImpl !== "function") return () => {};

  const body = section.querySelector("[data-v2-library-body]");
  const status = section.querySelector("[data-v2-library-status]");
  const summary = section.querySelector("[data-v2-library-summary]");
  const queryInput = section.querySelector("[data-v2-library-query]");
  const tagInput = section.querySelector("[data-v2-library-tag]");
  const sortSelect = section.querySelector("[data-v2-library-sort]");
  const orderSelect = section.querySelector("[data-v2-library-order]");
  const previousButton = section.querySelector("[data-v2-library-prev]");
  const nextButton = section.querySelector("[data-v2-library-next]");
  const refreshButton = section.querySelector("[data-v2-library-refresh]");
  const keywordInput = root.querySelector("#keyword");

  let page = 1;
  let totalPages = 1;
  let loading = false;

  const showStatus = (message = "", type = "info") => {
    status.textContent = message;
    status.className = message ? `status on ${type}` : "status";
  };

  async function load() {
    const market = context.get();
    if (!market?.domain) {
      body.replaceChildren();
      renderRows({ documentLike, body, items: [], keywordInput, locationLike });
      summary.textContent = "请先在“网站管理”添加网站";
      previousButton.disabled = true;
      nextButton.disabled = true;
      return;
    }

    loading = true;
    refreshButton.disabled = true;
    try {
      const response = await fetchImpl(buildSavedKeywordListUrl({
        siteDomain: market.domain,
        q: queryInput.value,
        tag: tagInput.value,
        page,
        pageSize: 50,
        sort: sortSelect.value,
        order: orderSelect.value,
      }), { headers: { accept: "application/json" } });
      const payload = await readJson(response);
      const data = payload.data || {};
      totalPages = Number(data.total_pages || 1);
      if (page > totalPages) {
        page = totalPages;
        return load();
      }
      renderRows({ documentLike, body, items: data.items || [], keywordInput, locationLike });
      summary.textContent = `第 ${data.page || page} / ${totalPages} 页 · ${data.total || 0} 个关键词 · 本次 $0`;
      previousButton.disabled = page <= 1;
      nextButton.disabled = page >= totalPages;
      showStatus();
    } catch (error) {
      showStatus(error.message || "关键词库读取失败", "error");
    } finally {
      loading = false;
      refreshButton.disabled = false;
    }
  }

  const resetAndLoad = () => {
    page = 1;
    return load();
  };

  const saveToLibrary = async ({ keyword, source }) => {
    const payload = savedKeywordCreatePayload({
      market: context.get(),
      keyword,
      source,
    });
    const result = await readJson(await fetchImpl(SAVED_KEYWORDS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    }));
    await resetAndLoad();
    return result;
  };

  queryInput.addEventListener("input", resetAndLoad);
  tagInput.addEventListener("input", resetAndLoad);
  sortSelect.addEventListener("change", resetAndLoad);
  orderSelect.addEventListener("change", resetAndLoad);
  refreshButton.addEventListener("click", load);
  previousButton.addEventListener("click", () => {
    if (loading || page <= 1) return;
    page -= 1;
    load();
  });
  nextButton.addEventListener("click", () => {
    if (loading || page >= totalPages) return;
    page += 1;
    load();
  });

  body.addEventListener("click", async (event) => {
    const button = event.target.closest?.("[data-saved-keyword-id]");
    if (!button) return;
    const market = context.get();
    if (!market?.domain) return;
    if (!confirmImpl("确定从关键词库删除这个关键词吗？")) return;
    button.disabled = true;
    try {
      await readJson(await fetchImpl(SAVED_KEYWORDS_URL, {
        method: "DELETE",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ site_domain: market.domain, id: Number(button.dataset.savedKeywordId) }),
      }));
      showStatus("已从关键词库删除。本次费用 $0。");
      await load();
    } catch (error) {
      button.disabled = false;
      showStatus(error.message || "删除失败", "error");
    }
  });

  const decisionHead = root.querySelector(".keyworddecision .decisionhead");
  let saveButton = root.querySelector("[data-v2-save-keyword]");
  let saveStatus = root.querySelector("[data-v2-save-keyword-status]");
  if (decisionHead && !saveButton) {
    const actions = documentLike.createElement("div");
    actions.className = "v2-keyword-decision-actions";
    const badge = decisionHead.querySelector(".decisionbadge");
    if (badge) actions.appendChild(badge);
    saveButton = documentLike.createElement("button");
    saveButton.type = "button";
    saveButton.dataset.v2SaveKeyword = "";
    saveButton.className = "v2-save-keyword";
    saveButton.textContent = "保存到关键词库";
    actions.appendChild(saveButton);
    decisionHead.appendChild(actions);

    saveStatus = documentLike.createElement("div");
    saveStatus.dataset.v2SaveKeywordStatus = "";
    saveStatus.className = "v2-save-keyword-status";
    decisionHead.parentElement?.insertBefore(saveStatus, decisionHead.nextSibling);
  }

  const updateSaveButton = () => {
    if (!saveButton) return;
    const market = context.get();
    const hasKeyword = Boolean(clean(keywordInput?.value));
    saveButton.disabled = !hasKeyword || !market?.domain;
    saveButton.title = !market?.domain
      ? "请先在网站管理添加并选择当前网站"
      : !hasKeyword
        ? "先分析或输入一个关键词"
        : "保存当前关键词到当前网站的关键词库";
  };

  const handleKeywordInput = () => updateSaveButton();
  keywordInput?.addEventListener("input", handleKeywordInput);

  let refreshResearchSurfaceButtons = () => {};
  const unsubscribe = context.subscribe(() => {
    updateSaveButton();
    refreshResearchSurfaceButtons();
    resetAndLoad();
  });

  saveButton?.addEventListener("click", async () => {
    try {
      const payload = savedKeywordCreatePayload({
        market: context.get(),
        keyword: keywordInput?.value,
        source: "keyword_explorer",
      });
      saveButton.disabled = true;
      saveButton.textContent = "保存中…";
      const result = await saveToLibrary({ keyword: payload.keyword, source: payload.source });
      saveStatus.textContent = `已保存“${result.data?.keyword || payload.keyword}”到关键词库 · 本次 $0`;
      saveStatus.className = "v2-save-keyword-status success";
    } catch (error) {
      saveStatus.textContent = error.message || "保存关键词失败";
      saveStatus.className = "v2-save-keyword-status error-text";
    } finally {
      saveButton.textContent = "保存到关键词库";
      updateSaveButton();
    }
  });

  const surfaceObservers = [];
  const decorateSurface = (body, spec) => decorateResearchKeywordRows({
    body,
    spec,
    market: context.get(),
    documentLike,
    onSave: saveToLibrary,
  });

  const surfaceEntries = Object.entries(RESEARCH_SAVE_SURFACES)
    .map(([bodyId, spec]) => ({ body: root.querySelector(`#${bodyId}`), spec }))
    .filter(({ body }) => Boolean(body));

  refreshResearchSurfaceButtons = () => {
    surfaceEntries.forEach(({ body, spec }) => decorateSurface(body, spec));
  };
  refreshResearchSurfaceButtons();

  surfaceEntries.forEach(({ body, spec }) => {
    if (typeof globalThis.MutationObserver === "function") {
      const observer = new globalThis.MutationObserver(() => decorateSurface(body, spec));
      observer.observe(body, { childList: true });
      surfaceObservers.push(observer);
    }
  });

  updateSaveButton();

  return () => {
    unsubscribe?.();
    surfaceObservers.forEach((observer) => observer.disconnect?.());
    keywordInput?.removeEventListener("input", handleKeywordInput);
  };
}
