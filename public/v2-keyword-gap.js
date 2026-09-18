const DEFAULT_PAGE_SIZE = 10;

export const KEYWORD_GAP_DECISION_VERSION = "keyword-gap-decision-v0.1";

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function classifyKeywordGapDecision(item) {
  const priority = finiteNumber(item?.intelligence?.gap_priority?.score);
  const difficulty = finiteNumber(item?.metrics?.keyword_difficulty);
  const rank = finiteNumber(item?.competitor_position);
  const thresholds = Object.freeze({
    gap_priority_min: 65,
    keyword_difficulty_max: 35,
    competitor_rank_max: 10,
  });

  if (priority === null) {
    return {
      version: KEYWORD_GAP_DECISION_VERSION,
      code: "insufficient_data",
      label: "数据不足",
      priority: "unknown",
      easy_win: false,
      next_action: "刷新关键词指标后再判断。",
      reasons: ["缺少 Gap Priority 分数"],
      thresholds,
      is_estimate: true,
    };
  }

  if (priority >= thresholds.gap_priority_min &&
      difficulty !== null && difficulty <= thresholds.keyword_difficulty_max &&
      rank !== null && rank <= thresholds.competitor_rank_max) {
    return {
      version: KEYWORD_GAP_DECISION_VERSION,
      code: "easy_win_candidate",
      label: "Easy Win 候选",
      priority: "high",
      easy_win: true,
      next_action: "先检查竞品排名页与搜索意图，再创建或强化对应页面。",
      reasons: [
        `Gap Priority ${priority} ≥ ${thresholds.gap_priority_min}`,
        `KD ${difficulty} ≤ ${thresholds.keyword_difficulty_max}`,
        `竞品排名 #${rank}，位于 Top ${thresholds.competitor_rank_max}`,
      ],
      thresholds,
      is_estimate: true,
    };
  }

  const blockers = [];
  if (difficulty === null) blockers.push("缺少 KD");
  else if (difficulty > thresholds.keyword_difficulty_max) blockers.push(`KD ${difficulty} > ${thresholds.keyword_difficulty_max}`);
  if (rank === null) blockers.push("缺少竞品排名");
  else if (rank > thresholds.competitor_rank_max) blockers.push(`竞品排名 #${rank} 未进入 Top ${thresholds.competitor_rank_max}`);

  if (priority >= 75) {
    return {
      version: KEYWORD_GAP_DECISION_VERSION,
      code: "high_opportunity_validate",
      label: "高机会 · 需验证",
      priority: "medium_high",
      easy_win: false,
      next_action: "优先验证 SERP 弱度与内容差距，再决定是否投入。",
      reasons: [`Gap Priority ${priority} 较高`, ...blockers],
      thresholds,
      is_estimate: true,
    };
  }

  if (priority >= 55) {
    return {
      version: KEYWORD_GAP_DECISION_VERSION,
      code: "manual_validation",
      label: "人工验证",
      priority: "medium",
      easy_win: false,
      next_action: "检查搜索意图、SERP 和本站主题相关性后再排期。",
      reasons: [`Gap Priority ${priority} 为中等`, ...blockers],
      thresholds,
      is_estimate: true,
    };
  }

  return {
    version: KEYWORD_GAP_DECISION_VERSION,
    code: "monitor_or_skip",
    label: "暂缓 / 监控",
    priority: "low",
    easy_win: false,
    next_action: "先处理更强的 Gap 机会，后续再观察该关键词。",
    reasons: [`Gap Priority ${priority} < 55`, ...blockers],
    thresholds,
    is_estimate: true,
  };
}

function numericValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function filterAndSortKeywordGap(rows, { query = "", intent = "", preset = "all", sort = "priority" } = {}) {
  const normalizedQuery = String(query).trim().toLowerCase();
  const normalizedIntent = String(intent).trim().toLowerCase();
  const filtered = (Array.isArray(rows) ? rows : []).filter((item) => {
    const keyword = String(item?.keyword || "").toLowerCase();
    const primaryIntent = String(item?.intent?.primary || "").toLowerCase();
    const priority = numericValue(item?.intelligence?.gap_priority?.score, 0);
    const difficulty = numericValue(item?.metrics?.keyword_difficulty, Infinity);
    const rank = numericValue(item?.competitor_position, Infinity);
    if (normalizedQuery && !keyword.includes(normalizedQuery)) return false;
    if (normalizedIntent && primaryIntent !== normalizedIntent) return false;
    if (preset === "high" && priority < 75) return false;
    if (preset === "quick" && classifyKeywordGapDecision(item).code !== "easy_win_candidate") return false;
    return true;
  });
  const values = {
    priority: (item) => -numericValue(item?.intelligence?.gap_priority?.score, -Infinity),
    volume: (item) => -numericValue(item?.metrics?.search_volume, -Infinity),
    difficulty: (item) => numericValue(item?.metrics?.keyword_difficulty, Infinity),
    cpc: (item) => -numericValue(item?.metrics?.cpc_usd, -Infinity),
    rank: (item) => numericValue(item?.competitor_position, Infinity),
  };
  const valueFor = values[sort] || values.priority;
  return [...filtered].sort((left, right) => valueFor(left) - valueFor(right) || String(left.keyword || "").localeCompare(String(right.keyword || "")));
}

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

export function openKeywordGapKeyword(keyword, {
  documentLike = globalThis.document,
  locationLike = globalThis.location,
  requestAnimationFrameLike = globalThis.requestAnimationFrame,
} = {}) {
  const value = String(keyword || "").trim();
  if (!value) return false;
  const input = documentLike?.getElementById?.("keyword");
  if (!input) return false;
  input.value = value;
  if (locationLike) locationLike.hash = "keywords";
  const focus = () => {
    input.scrollIntoView?.({ behavior: "smooth", block: "center" });
    input.focus?.();
  };
  if (typeof requestAnimationFrameLike === "function") requestAnimationFrameLike(focus);
  else focus();
  return true;
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
  onKeywordOpen = (item) => openKeywordGapKeyword(item?.keyword),
  queryInput,
  intentSelect,
  presetSelect,
  sortSelect,
  documentLike = globalThis.document,
} = {}) {
  let rows = [];
  let page = 1;

  const render = () => {
    const visibleRows = filterAndSortKeywordGap(rows, {
      query: queryInput?.value,
      intent: intentSelect?.value,
      preset: presetSelect?.value,
      sort: sortSelect?.value,
    });
    const model = paginateKeywordGap(visibleRows, page);
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
        if (valueIndex === 1) {
          cell.className = "keywordcell";
          const link = documentLike.createElement("a");
          link.href = "#keywords";
          link.className = "ranklink keywordgaplink";
          link.textContent = value;
          link.setAttribute("aria-label", `在 Keyword Explorer 中查看 ${item.keyword}`);
          link.addEventListener("click", (event) => {
            event?.preventDefault?.();
            onKeywordOpen(item);
          });
          cell.appendChild(link);
        } else {
          cell.textContent = value;
        }
        row.appendChild(cell);
      });

      const priorityCell = documentLike.createElement("td");
      const badge = documentLike.createElement("span");
      badge.className = "scorepill";
      badge.textContent = `${item.intelligence?.gap_priority?.score ?? "—"} · ${item.intelligence?.gap_priority?.label || "—"}`;
      const decision = classifyKeywordGapDecision(item);
      const decisionText = documentLike.createElement("div");
      decisionText.className = "sub gapdecision";
      decisionText.textContent = `${decision.label} · ${decision.next_action}`;
      decisionText.title = decision.reasons.join("；");
      priorityCell.appendChild(badge);
      priorityCell.appendChild(decisionText);
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
  [queryInput, intentSelect, presetSelect, sortSelect].forEach((control) => {
    control?.addEventListener(control === queryInput ? "input" : "change", () => { page = 1; render(); });
  });

  return Object.freeze({
    setRows(nextRows) {
      rows = Array.isArray(nextRows) ? nextRows : [];
      page = 1;
      return render();
    },
    render,
  });
}
