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

export const BATCH_SAVE_SURFACES = Object.freeze({
  ideasBody: Object.freeze({
    source: "keyword_ideas",
    controls_selector: ".ideasselection",
    label: "保存已选到关键词库",
  }),
  gapBody: Object.freeze({
    source: "keyword_gap",
    controls_selector: ".gapactions",
    label: "保存已选到关键词库",
  }),
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

export function normalizeBatchTagInput(value) {
  const seen = new Set();
  return String(value ?? "")
    .split(/[,;\n]+/)
    .map((tag) => tag.trim().replace(/\s+/g, " "))
    .filter((tag) => {
      if (!tag) return false;
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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

export function selectedResearchKeywords(body, spec) {
  const seen = new Set();
  const keywords = [];
  [...(body?.children || [])].forEach((row) => {
    const checkbox = row.children?.[0]?.querySelector?.('input[type="checkbox"]');
    if (!checkbox?.checked) return;
    const keyword = researchSurfaceKeyword(row, spec);
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) return;
    seen.add(key);
    keywords.push(keyword);
  });
  return keywords;
}

export async function saveKeywordSelection({
  keywords,
  saveOne,
  concurrency = 5,
} = {}) {
  const unique = [];
  const seen = new Set();
  for (const raw of Array.isArray(keywords) ? keywords : []) {
    const keyword = clean(raw).replace(/\s+/g, " ");
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    unique.push(keyword);
  }
  if (typeof saveOne !== "function") throw new Error("saveOne is required.");
  if (!unique.length) return { attempted: 0, saved: 0, failed: 0, failures: [] };

  const failures = [];
  let saved = 0;
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, 5, unique.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < unique.length) {
      const index = cursor++;
      const keyword = unique[index];
      try {
        await saveOne(keyword);
        saved += 1;
      } catch (error) {
        failures.push({ keyword, message: error?.message || "保存失败" });
      }
    }
  });
  await Promise.all(workers);
  return {
    attempted: unique.length,
    saved,
    failed: failures.length,
    failures,
  };
}

function markSurfaceKeywordsSaved(body, spec, keywords, siteDomain) {
  const saved = new Set((keywords || []).map((keyword) => clean(keyword).toLowerCase()));
  [...(body?.children || [])].forEach((row) => {
    const keyword = researchSurfaceKeyword(row, spec);
    if (!saved.has(keyword.toLowerCase())) return;
    const button = row.children?.[spec.keyword_cell_index]?.querySelector?.("[data-v2-inline-save-keyword]");
    if (!button) return;
    button.dataset.savedSiteDomain = siteDomain || "";
    button.textContent = "已保存";
    button.disabled = true;
    button.classList?.remove?.("error");
    button.classList?.add?.("saved");
  });
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

function renderRows({
  documentLike,
  body,
  items,
  keywordInput,
  locationLike,
  selectedIds,
  onSelectionChange,
}) {
  body.replaceChildren();
  for (const item of items) {
    const row = documentLike.createElement("tr");
    const selectCell = documentLike.createElement("td");
    const checkbox = documentLike.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "rowcheck";
    checkbox.checked = selectedIds?.has?.(Number(item.id)) || false;
    checkbox.setAttribute?.("aria-label", `选择 ${item.keyword}`);
    checkbox.addEventListener("change", () => {
      const id = Number(item.id);
      if (checkbox.checked) selectedIds?.add?.(id);
      else selectedIds?.delete?.(id);
      onSelectionChange?.();
    });
    selectCell.appendChild(checkbox);
    row.appendChild(selectCell);

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
    cell.colSpan = 11;
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
    <div class="v2-library-selection">
      <span class="sub" data-v2-library-selected>已选择 0 条</span>
      <button type="button" data-v2-library-select-page>选择当前页</button>
      <button type="button" data-v2-library-clear-selected>清空选择</button>
      <input type="text" data-v2-library-batch-tags placeholder="添加 Tag，例如 Commercial, Saudi">
      <button type="button" data-v2-library-add-tags>批量添加 Tag</button>
      <button type="button" data-v2-library-delete-selected>删除已选关键词</button>
      <span data-v2-library-batch-status class="v2-library-batch-status"></span>
    </div>
    <div class="note"><b>费用：</b>关键词库读取、筛选、Tag 管理、删除均为 $0；这里不会主动刷新 DataForSEO 指标。</div>
    <div data-v2-library-status class="status"></div>
    <div class="tablewrap">
      <table class="ideastable v2-library-table">
        <thead><tr><th>选择</th><th>关键词</th><th>搜索量</th><th>KD</th><th>CPC</th><th>Intent</th><th>市场</th><th>Tags</th><th>来源</th><th>指标时间</th><th>操作</th></tr></thead>
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
  const selectedSummary = section.querySelector("[data-v2-library-selected]");
  const selectPageButton = section.querySelector("[data-v2-library-select-page]");
  const clearSelectedButton = section.querySelector("[data-v2-library-clear-selected]");
  const batchTagsInput = section.querySelector("[data-v2-library-batch-tags]");
  const addTagsButton = section.querySelector("[data-v2-library-add-tags]");
  const deleteSelectedButton = section.querySelector("[data-v2-library-delete-selected]");
  const batchStatus = section.querySelector("[data-v2-library-batch-status]");
  const keywordInput = root.querySelector("#keyword");

  let page = 1;
  let totalPages = 1;
  let loading = false;
  let currentItems = [];
  const selectedLibraryIds = new Set();

  const showStatus = (message = "", type = "info") => {
    status.textContent = message;
    status.className = message ? `status on ${type}` : "status";
  };

  const updateLibrarySelection = () => {
    const market = context.get();
    const tags = normalizeBatchTagInput(batchTagsInput?.value);
    selectedSummary.textContent = `已选择 ${selectedLibraryIds.size} 条`;
    addTagsButton.disabled = !market?.domain || !selectedLibraryIds.size || !tags.length;
    addTagsButton.title = !market?.domain
      ? "请先在网站管理添加并选择当前网站"
      : !selectedLibraryIds.size
        ? "请先选择关键词"
        : !tags.length
          ? "请输入至少一个 Tag"
          : `给已选 ${selectedLibraryIds.size} 个关键词添加 ${tags.length} 个 Tag`;
    const tooManySelected = selectedLibraryIds.size > 100;
    deleteSelectedButton.disabled = !market?.domain || !selectedLibraryIds.size || tooManySelected;
    deleteSelectedButton.title = !market?.domain
      ? "请先在网站管理添加并选择当前网站"
      : tooManySelected
        ? "每次最多批量删除 100 个关键词"
        : selectedLibraryIds.size
          ? `删除当前网站中已选的 ${selectedLibraryIds.size} 个关键词`
          : "请先选择关键词";
    clearSelectedButton.disabled = !selectedLibraryIds.size;
    selectPageButton.disabled = !currentItems.length;
  };

  async function load() {
    const market = context.get();
    if (!market?.domain) {
      body.replaceChildren();
      currentItems = [];
      selectedLibraryIds.clear();
      renderRows({
        documentLike,
        body,
        items: [],
        keywordInput,
        locationLike,
        selectedIds: selectedLibraryIds,
        onSelectionChange: updateLibrarySelection,
      });
      updateLibrarySelection();
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
      currentItems = data.items || [];
      renderRows({
        documentLike,
        body,
        items: currentItems,
        keywordInput,
        locationLike,
        selectedIds: selectedLibraryIds,
        onSelectionChange: updateLibrarySelection,
      });
      updateLibrarySelection();
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

  const postSavedKeyword = async ({ keyword, source }) => {
    const payload = savedKeywordCreatePayload({
      market: context.get(),
      keyword,
      source,
    });
    return readJson(await fetchImpl(SAVED_KEYWORDS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    }));
  };

  const saveToLibrary = async ({ keyword, source }) => {
    const result = await postSavedKeyword({ keyword, source });
    await resetAndLoad();
    return result;
  };

  queryInput.addEventListener("input", resetAndLoad);
  tagInput.addEventListener("input", resetAndLoad);
  sortSelect.addEventListener("change", resetAndLoad);
  orderSelect.addEventListener("change", resetAndLoad);
  refreshButton.addEventListener("click", load);
  batchTagsInput.addEventListener("input", updateLibrarySelection);
  selectPageButton.addEventListener("click", () => {
    currentItems.forEach((item) => selectedLibraryIds.add(Number(item.id)));
    renderRows({
      documentLike,
      body,
      items: currentItems,
      keywordInput,
      locationLike,
      selectedIds: selectedLibraryIds,
      onSelectionChange: updateLibrarySelection,
    });
    updateLibrarySelection();
  });
  clearSelectedButton.addEventListener("click", () => {
    selectedLibraryIds.clear();
    renderRows({
      documentLike,
      body,
      items: currentItems,
      keywordInput,
      locationLike,
      selectedIds: selectedLibraryIds,
      onSelectionChange: updateLibrarySelection,
    });
    updateLibrarySelection();
  });
  addTagsButton.addEventListener("click", async () => {
    const market = context.get();
    const tags = normalizeBatchTagInput(batchTagsInput.value);
    if (!market?.domain || !selectedLibraryIds.size || !tags.length) {
      updateLibrarySelection();
      return;
    }
    addTagsButton.disabled = true;
    addTagsButton.textContent = "添加中…";
    batchStatus.textContent = "";
    batchStatus.className = "v2-library-batch-status";
    try {
      const result = await readJson(await fetchImpl(SAVED_KEYWORDS_URL, {
        method: "PATCH",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          site_domain: market.domain,
          ids: [...selectedLibraryIds],
          tags,
        }),
      }));
      const count = Number(result.data?.updated_count || selectedLibraryIds.size);
      batchStatus.textContent = `已给 ${count} 个关键词添加 Tag：${tags.join(" · ")} · 本次 $0`;
      batchStatus.className = "v2-library-batch-status success";
      selectedLibraryIds.clear();
      batchTagsInput.value = "";
      await load();
    } catch (error) {
      batchStatus.textContent = error.message || "批量添加 Tag 失败";
      batchStatus.className = "v2-library-batch-status error-text";
    } finally {
      addTagsButton.textContent = "批量添加 Tag";
      updateLibrarySelection();
    }
  });
  deleteSelectedButton.addEventListener("click", async () => {
    const market = context.get();
    const ids = [...selectedLibraryIds];
    if (!market?.domain || !ids.length || ids.length > 100) {
      updateLibrarySelection();
      return;
    }
    if (!confirmImpl(`确定从当前网站关键词库删除已选的 ${ids.length} 个关键词吗？此操作会同时移除这些关键词的 Tag 关联。`)) {
      return;
    }

    deleteSelectedButton.disabled = true;
    deleteSelectedButton.textContent = "删除中…";
    batchStatus.textContent = "";
    batchStatus.className = "v2-library-batch-status";
    try {
      const result = await readJson(await fetchImpl(SAVED_KEYWORDS_URL, {
        method: "DELETE",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          site_domain: market.domain,
          ids,
        }),
      }));
      const count = Number(result.data?.deleted_count || ids.length);
      selectedLibraryIds.clear();
      batchStatus.textContent = `已删除 ${count} 个关键词 · 本次 $0`;
      batchStatus.className = "v2-library-batch-status success";
      await load();
    } catch (error) {
      batchStatus.textContent = error.message || "批量删除关键词失败";
      batchStatus.className = "v2-library-batch-status error-text";
    } finally {
      deleteSelectedButton.textContent = "删除已选关键词";
      updateLibrarySelection();
    }
  });
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
      selectedLibraryIds.delete(Number(button.dataset.savedKeywordId));
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
    selectedLibraryIds.clear();
    updateLibrarySelection();
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
    .map(([bodyId, spec]) => ({ bodyId, body: root.querySelector(`#${bodyId}`), spec }))
    .filter(({ body }) => Boolean(body));

  const batchControls = [];
  const updateBatchControl = (control) => {
    const market = context.get();
    const keywords = selectedResearchKeywords(control.body, control.spec);
    control.button.disabled = !market?.domain || !keywords.length;
    control.button.title = !market?.domain
      ? "请先在网站管理添加并选择当前网站"
      : keywords.length
        ? `保存已选 ${keywords.length} 个关键词到当前网站关键词库`
        : "请先选择关键词";
  };

  Object.entries(BATCH_SAVE_SURFACES).forEach(([bodyId, batchSpec]) => {
    const surface = surfaceEntries.find((entry) => entry.bodyId === bodyId);
    const controls = root.querySelector(batchSpec.controls_selector);
    if (!surface || !controls || controls.querySelector?.(`[data-v2-batch-save-keywords="${bodyId}"]`)) return;

    const button = documentLike.createElement("button");
    button.type = "button";
    button.dataset.v2BatchSaveKeywords = bodyId;
    button.className = "v2-batch-save-keywords";
    button.textContent = batchSpec.label;

    const status = documentLike.createElement("span");
    status.dataset.v2BatchSaveStatus = bodyId;
    status.className = "v2-batch-save-status";
    controls.append(button, status);

    const control = { ...surface, ...batchSpec, button, status };
    batchControls.push(control);
    button.addEventListener("click", async () => {
      const market = context.get();
      const keywords = selectedResearchKeywords(surface.body, surface.spec);
      if (!market?.domain || !keywords.length) {
        updateBatchControl(control);
        return;
      }
      button.disabled = true;
      button.textContent = `保存 ${keywords.length} 条中…`;
      status.textContent = "";
      status.className = "v2-batch-save-status";
      const result = await saveKeywordSelection({
        keywords,
        concurrency: 5,
        saveOne: (keyword) => postSavedKeyword({ keyword, source: batchSpec.source }),
      });
      if (result.saved) {
        markSurfaceKeywordsSaved(surface.body, surface.spec, keywords.filter((keyword) =>
          !result.failures.some((failure) => failure.keyword.toLowerCase() === keyword.toLowerCase())
        ), market.domain);
      }
      await resetAndLoad();
      status.textContent = result.failed
        ? `已保存 ${result.saved} 条，失败 ${result.failed} 条 · 本次 $0`
        : `已保存 ${result.saved} 条到关键词库 · 本次 $0`;
      status.className = `v2-batch-save-status ${result.failed ? "error-text" : "success"}`;
      button.textContent = batchSpec.label;
      updateBatchControl(control);
    });

    surface.body.addEventListener("change", () => updateBatchControl(control));
    updateBatchControl(control);
  });

  refreshResearchSurfaceButtons = () => {
    surfaceEntries.forEach(({ body, spec }) => decorateSurface(body, spec));
    batchControls.forEach(updateBatchControl);
  };
  refreshResearchSurfaceButtons();

  surfaceEntries.forEach(({ body, spec }) => {
    if (typeof globalThis.MutationObserver === "function") {
      const observer = new globalThis.MutationObserver(() => {
        decorateSurface(body, spec);
        batchControls.filter((control) => control.body === body).forEach(updateBatchControl);
      });
      observer.observe(body, { childList: true });
      surfaceObservers.push(observer);
    }
  });

  updateLibrarySelection();
  updateSaveButton();

  return () => {
    unsubscribe?.();
    surfaceObservers.forEach((observer) => observer.disconnect?.());
    keywordInput?.removeEventListener("input", handleKeywordInput);
  };
}
