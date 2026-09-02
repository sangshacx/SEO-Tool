const DEFAULT_PAGE_SIZE = 10;

export function paginateKeywordGap(rows, requestedPage, pageSize = DEFAULT_PAGE_SIZE) {
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

function displayNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
}

function displayCell(value) {
  return value == null || value === "" ? "—" : String(value);
}

export function createKeywordGapTable({
  body,
  previousButton,
  nextButton,
  pageLabel,
  selectedKeywords,
  onSelectionChange = () => {},
  documentLike = globalThis.document,
} = {}) {
  let rows = [];
  let page = 1;

  const render = () => {
    const model = paginateKeywordGap(rows, page);
    page = model.page;
    body.replaceChildren();
    if (!model.rows.length) {
      const row = documentLike.createElement("tr");
      const cell = documentLike.createElement("td");
      cell.colSpan = 10;
      cell.className = "emptyrow";
      cell.textContent = "没有找到可用的 Keyword Gap 数据";
      row.appendChild(cell);
      body.appendChild(row);
    }

    model.rows.forEach((item, index) => {
      const row = documentLike.createElement("tr");
      const pick = documentLike.createElement("td");
      const checkbox = documentLike.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "rowcheck";
      checkbox.checked = selectedKeywords.has(item.keyword);
      checkbox.setAttribute("aria-label", `选择 ${item.keyword}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedKeywords.add(item.keyword);
        else selectedKeywords.delete(item.keyword);
        onSelectionChange();
      });
      pick.appendChild(checkbox);
      row.appendChild(pick);

      const values = [
        (model.page - 1) * model.page_size + index + 1,
        item.keyword,
        displayCell(item.competitor_position),
        displayNumber(item.metrics?.search_volume),
        displayCell(item.metrics?.keyword_difficulty),
        item.metrics?.cpc_usd == null ? "—" : `$${Number(item.metrics.cpc_usd).toFixed(2)}`,
        displayCell(item.intent?.primary),
      ];
      values.forEach((value, valueIndex) => {
        const cell = documentLike.createElement("td");
        cell.textContent = value;
        if (valueIndex === 1) cell.className = "keywordcell";
        row.appendChild(cell);
      });

      const priorityCell = documentLike.createElement("td");
      const badge = documentLike.createElement("span");
      badge.className = "scorepill";
      badge.textContent = `${item.intelligence?.gap_priority?.score ?? "—"} · ${item.intelligence?.gap_priority?.label || "—"}`;
      priorityCell.appendChild(badge);
      row.appendChild(priorityCell);

      const pageCell = documentLike.createElement("td");
      if (item.competitor_url) {
        const link = documentLike.createElement("a");
        link.href = item.competitor_url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "ranklink";
        link.textContent = "查看页面";
        pageCell.appendChild(link);
      } else {
        pageCell.textContent = "—";
      }
      row.appendChild(pageCell);
      body.appendChild(row);
    });

    previousButton.disabled = !model.has_previous;
    nextButton.disabled = !model.has_next;
    pageLabel.textContent = `第 ${model.page} / ${model.total_pages} 页 · ${model.total_rows} 条机会`;
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
