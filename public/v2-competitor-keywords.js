const DEFAULT_PAGE_SIZE = 10;

export const COMPETITOR_OPPORTUNITY_RULES_VERSION = "competitor-opportunity-presets-v0.1";

export const COMPETITOR_OPPORTUNITY_THRESHOLDS = Object.freeze({
  quick_position_max: 10,
  quick_keyword_difficulty_max: 35,
  commercial_search_volume_min: 100,
  high_cpc_usd_min: 1,
});

function numericValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function competitorOpportunityPresetMatches(item, preset = "all") {
  const position = numericValue(item?.position, Infinity);
  const difficulty = numericValue(item?.keyword_difficulty, Infinity);
  const volume = numericValue(item?.search_volume, 0);
  const cpc = numericValue(item?.cpc_usd, 0);
  const intent = String(item?.intent || "").toLowerCase();
  const commercialIntent = intent === "commercial" || intent === "transactional";

  if (preset === "quick-opportunity") {
    return position <= COMPETITOR_OPPORTUNITY_THRESHOLDS.quick_position_max &&
      difficulty <= COMPETITOR_OPPORTUNITY_THRESHOLDS.quick_keyword_difficulty_max;
  }
  if (preset === "commercial-demand") {
    return commercialIntent &&
      volume >= COMPETITOR_OPPORTUNITY_THRESHOLDS.commercial_search_volume_min;
  }
  if (preset === "high-cpc-commercial") {
    return commercialIntent &&
      cpc >= COMPETITOR_OPPORTUNITY_THRESHOLDS.high_cpc_usd_min;
  }
  return true;
}

export function filterAndSortCompetitorKeywords(rows, { query = "", intent = "", preset = "all", sort = "position" } = {}) {
  const normalizedQuery = String(query).trim().toLowerCase();
  const normalizedIntent = String(intent).trim().toLowerCase();
  const filtered = (Array.isArray(rows) ? rows : []).filter((item) => {
    const keyword = String(item?.keyword || "").toLowerCase();
    const itemIntent = String(item?.intent || "").toLowerCase();
    const position = numericValue(item?.position, Infinity);
    const difficulty = numericValue(item?.keyword_difficulty, Infinity);
    if (normalizedQuery && !keyword.includes(normalizedQuery)) return false;
    if (normalizedIntent && itemIntent !== normalizedIntent) return false;
    if (preset === "top10" && position > 10) return false;
    if (preset === "low-kd" && difficulty > 35) return false;
    if (["quick-opportunity", "commercial-demand", "high-cpc-commercial"].includes(preset) &&
        !competitorOpportunityPresetMatches(item, preset)) return false;
    return true;
  });
  const valueFor = {
    position: (item) => numericValue(item?.position, Infinity),
    volume: (item) => -numericValue(item?.search_volume, -Infinity),
    difficulty: (item) => numericValue(item?.keyword_difficulty, Infinity),
    cpc: (item) => -numericValue(item?.cpc_usd, -Infinity),
  }[sort] || ((item) => numericValue(item?.position, Infinity));
  return [...filtered].sort((left, right) =>
    valueFor(left) - valueFor(right) ||
    String(left?.keyword || "").localeCompare(String(right?.keyword || "")),
  );
}

export function paginateCompetitorKeywords(rows, requestedPage, pageSize = DEFAULT_PAGE_SIZE) {
  const items = Array.isArray(rows) ? rows : [];
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(Math.max(Number.isInteger(requestedPage) ? requestedPage : 1, 1), totalPages);
  const start = (page - 1) * size;
  return {
    rows: items.slice(start, start + size),
    page,
    page_size: size,
    total_rows: items.length,
    total_pages: totalPages,
    has_previous: page > 1,
    has_next: page < totalPages,
  };
}

export function prefillKeywordExplorer(keyword, {
  input,
  locationLike = globalThis.location,
  requestAnimationFrameImpl = globalThis.requestAnimationFrame,
} = {}) {
  const normalized = typeof keyword === "string" ? keyword.trim() : "";
  if (!normalized || !input) return false;
  input.value = normalized;
  if (locationLike) locationLike.hash = "keywords";
  const reveal = () => {
    input.scrollIntoView?.({ behavior: "smooth", block: "center" });
    input.focus?.();
  };
  if (typeof requestAnimationFrameImpl === "function") requestAnimationFrameImpl(reveal);
  else reveal();
  return true;
}

export function prefillKeywordGapValidation(keyword, {
  competitorDomainInput,
  gapCompetitorInput,
  gapFilterInput,
  gapForm,
  locationLike = globalThis.location,
  requestAnimationFrameImpl = globalThis.requestAnimationFrame,
} = {}) {
  const normalizedKeyword = typeof keyword === "string" ? keyword.trim() : "";
  const competitorDomain = String(competitorDomainInput?.value || "").trim();
  if (!normalizedKeyword || !competitorDomain || !gapCompetitorInput || !gapFilterInput) return false;

  gapCompetitorInput.value = competitorDomain;
  gapFilterInput.value = normalizedKeyword;
  gapFilterInput.dispatchEvent?.(new Event("input"));
  if (locationLike) locationLike.hash = "competitors";
  const reveal = () => {
    gapForm?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    gapCompetitorInput.focus?.();
  };
  if (typeof requestAnimationFrameImpl === "function") requestAnimationFrameImpl(reveal);
  else reveal();
  return true;
}

function displayNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
}

function displayCell(value) {
  return value == null || value === "" ? "—" : String(value);
}

export function createCompetitorKeywordTable({
  body,
  previousButton,
  nextButton,
  pageLabel,
  keywordInput,
  queryInput,
  intentSelect,
  presetSelect,
  sortSelect,
  competitorDomainInput,
  gapCompetitorInput,
  gapFilterInput,
  gapForm,
  onGapValidate = (item) => prefillKeywordGapValidation(item?.keyword, {
    competitorDomainInput,
    gapCompetitorInput,
    gapFilterInput,
    gapForm,
    locationLike,
    requestAnimationFrameImpl,
  }),
  locationLike = globalThis.location,
  documentLike = globalThis.document,
  requestAnimationFrameImpl = globalThis.requestAnimationFrame,
  eventTarget = globalThis.window,
  customEventFactory = (type, detail) => typeof globalThis.CustomEvent === "function"
    ? new globalThis.CustomEvent(type, { detail })
    : { type, detail },
} = {}) {
  let rows = [];
  let page = 1;

  const render = () => {
    const visibleRows = filterAndSortCompetitorKeywords(rows, {
      query: queryInput?.value,
      intent: intentSelect?.value,
      preset: presetSelect?.value,
      sort: sortSelect?.value,
    });
    const model = paginateCompetitorKeywords(visibleRows, page);
    page = model.page;
    body.replaceChildren();
    if (!model.rows.length) {
      const row = documentLike.createElement("tr");
      const cell = documentLike.createElement("td");
      cell.colSpan = 8;
      cell.className = "emptyrow";
      cell.textContent = "暂无排名关键词";
      row.appendChild(cell);
      body.appendChild(row);
    }
    model.rows.forEach((item, index) => {
      const row = documentLike.createElement("tr");
      const rank = documentLike.createElement("td");
      rank.textContent = (model.page - 1) * model.page_size + index + 1;
      row.appendChild(rank);

      const keywordCell = documentLike.createElement("td");
      const keywordLink = documentLike.createElement("a");
      keywordCell.className = "keywordcell";
      keywordLink.className = "competitorkeywordlink";
      keywordLink.href = "#keywords";
      keywordLink.textContent = item.keyword;
      keywordLink.setAttribute?.("aria-label", `在 Keyword Explorer 中查看 ${item.keyword}`);
      keywordLink.addEventListener("click", (event) => {
        event.preventDefault();
        prefillKeywordExplorer(item.keyword, { input: keywordInput, locationLike, requestAnimationFrameImpl });
      });
      keywordCell.appendChild(keywordLink);
      row.appendChild(keywordCell);

      [
        displayCell(item.position),
        displayNumber(item.search_volume),
        displayCell(item.keyword_difficulty),
        item.cpc_usd == null ? "—" : `$${Number(item.cpc_usd).toFixed(2)}`,
        displayCell(item.intent),
      ].forEach((value) => {
        const cell = documentLike.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });

      const actionCell = documentLike.createElement("td");
      const gapButton = documentLike.createElement("button");
      gapButton.type = "button";
      gapButton.className = "competitorgapbtn";
      gapButton.textContent = "验证 Gap";
      gapButton.setAttribute?.("aria-label", `在 Keyword Gap 中验证 ${item.keyword}`);
      gapButton.addEventListener("click", () => onGapValidate(item));
      actionCell.appendChild(gapButton);
      row.appendChild(actionCell);
      body.appendChild(row);
    });
    previousButton.disabled = !model.has_previous;
    nextButton.disabled = !model.has_next;
    pageLabel.textContent = `第 ${model.page} / ${model.total_pages} 页 · ${model.total_rows} 条关键词`;
    return model;
  };

  previousButton.addEventListener("click", () => { page -= 1; render(); });
  nextButton.addEventListener("click", () => { page += 1; render(); });
  [queryInput, intentSelect, presetSelect, sortSelect].forEach((control) => {
    control?.addEventListener(control === queryInput ? "input" : "change", () => {
      page = 1;
      render();
    });
  });

  return Object.freeze({
    setRows(nextRows, metadata = {}) {
      rows = Array.isArray(nextRows) ? nextRows : [];
      page = 1;
      const model = render();
      eventTarget?.dispatchEvent?.(customEventFactory("seo-pro-v2:competitor-snapshot-ready", {
        ...metadata,
        domain: metadata.domain || competitorDomainInput?.value || "",
        top_keywords: rows,
      }));
      return model;
    },
    render,
  });
}
