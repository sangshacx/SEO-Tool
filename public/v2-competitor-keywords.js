const DEFAULT_PAGE_SIZE = 10;

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
  locationLike = globalThis.location,
  documentLike = globalThis.document,
  requestAnimationFrameImpl = globalThis.requestAnimationFrame,
} = {}) {
  let rows = [];
  let page = 1;

  const render = () => {
    const model = paginateCompetitorKeywords(rows, page);
    page = model.page;
    body.replaceChildren();
    if (!model.rows.length) {
      const row = documentLike.createElement("tr");
      const cell = documentLike.createElement("td");
      cell.colSpan = 7;
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
      body.appendChild(row);
    });
    previousButton.disabled = !model.has_previous;
    nextButton.disabled = !model.has_next;
    pageLabel.textContent = `第 ${model.page} / ${model.total_pages} 页 · ${model.total_rows} 条关键词`;
    return model;
  };

  previousButton.addEventListener("click", () => { page -= 1; render(); });
  nextButton.addEventListener("click", () => { page += 1; render(); });

  return Object.freeze({
    setRows(nextRows) {
      rows = Array.isArray(nextRows) ? nextRows : [];
      page = 1;
      return render();
    },
    render,
  });
}
