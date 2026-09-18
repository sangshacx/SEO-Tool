const SAVED_KEYWORDS_URL = "/api/v2/keywords/saved";
const KEYWORD_CLUSTERS_URL = "/api/v2/keywords/clusters";
const CLUSTER_INTELLIGENCE_URL = "/api/v2/keywords/cluster-intelligence";

export const CLUSTER_SERP_VERIFICATION_SESSION_KEY = "seo-pro-v2.cluster-serp-verification.v1";
export const CLUSTER_INTELLIGENCE_RETURN_SESSION_KEY = "seo-pro-v2.cluster-intelligence-return.v1";
const CLUSTER_SERP_VERIFICATION_TTL_MS = 2 * 60 * 60 * 1000;

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

export function buildKeywordClusterAssignments({
  cluster,
  selectedItems,
  primaryId,
} = {}) {
  const primary = Number(primaryId);
  const selected = Array.from(selectedItems || []);
  if (!Number.isInteger(primary) || primary < 1) {
    throw new Error("请选择一个 Primary Keyword。");
  }

  const existingMembers = [
    ...(cluster?.primary ? [cluster.primary] : []),
    ...(Array.isArray(cluster?.supporting) ? cluster.supporting : []),
  ];
  const primaryIsSelected = selected.some((item) => Number(item?.id) === primary);
  const primaryIsExisting = existingMembers.some((item) => Number(item?.saved_keyword_id) === primary);
  if (!primaryIsSelected && !primaryIsExisting) {
    throw new Error("Primary Keyword 必须来自已选关键词或当前 Cluster 现有成员。");
  }

  const roles = new Map();
  existingMembers.forEach((member) => {
    const id = Number(member?.saved_keyword_id);
    if (Number.isInteger(id) && id > 0) roles.set(id, "supporting");
  });
  selected.forEach((item) => {
    const id = Number(item?.id);
    if (Number.isInteger(id) && id > 0) roles.set(id, "supporting");
  });
  roles.set(primary, "primary");

  return [...roles.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([saved_keyword_id, role]) => ({ saved_keyword_id, role }));
}

export function clusterIntelligenceRiskLabel(level) {
  return ({
    high: "高",
    medium: "中",
    low: "低",
    none: "无明显风险",
  })[String(level || "").toLowerCase()] || "未知";
}

export function clusterIntelligenceDecisionLabel(code, fallback = "") {
  return ({
    assign_to_existing: "建议归入现有 Cluster",
    review_cluster_fit: "需要人工复核",
    new_cluster_candidate: "更适合新建 Cluster",
  })[String(code || "").toLowerCase()] || fallback || "—";
}


export function clusterSerpEvidencePresentation(evidence = {}) {
  const status = String(evidence?.status || "unavailable").toLowerCase();
  const strength = String(evidence?.strength || "none").toLowerCase();
  if (status === "available") {
    const strengthLabel = ({
      strong: "强",
      moderate: "中",
      weak: "弱",
    })[strength] || "弱";
    return {
      status,
      strength,
      label: `${strengthLabel} · ${Number(evidence?.score ?? 0)}%`,
      shared_label: `${Number(evidence?.shared_url_count ?? 0)} 个`,
      shared_urls: Array.isArray(evidence?.shared_urls) ? evidence.shared_urls : [],
    };
  }
  return {
    status,
    strength: "none",
    label: ({
      stale: "已过期",
      insufficient: "证据不足",
      market_mismatch: "市场不同",
      unavailable: "暂无 SERP",
    })[status] || "暂无 SERP",
    shared_label: "—",
    shared_urls: [],
  };
}

export function clusterConfidencePresentation(confidence = {}) {
  const level = String(confidence?.level || "medium").toLowerCase();
  return {
    level,
    label: ({
      high: "高",
      medium: "中",
      low: "低",
    })[level] || "中",
    score: Number.isFinite(Number(confidence?.score)) ? Number(confidence.score) : null,
    reason: clean(confidence?.reason),
  };
}


function clusterEvidenceNeedsRefresh(fetchedAt, analysisTime, maxAgeDays = 30) {
  const fetched = Date.parse(fetchedAt || "");
  const analysis = Date.parse(analysisTime || "");
  if (!Number.isFinite(fetched) || !Number.isFinite(analysis)) return false;
  return Math.max(0, analysis - fetched) > maxAgeDays * 86400000;
}

export function buildClusterSerpVerificationQueue({
  suggestions = [],
  analysisTime = new Date().toISOString(),
  maxAgeDays = 30,
  minResults = 5,
} = {}) {
  const queue = new Map();
  const add = ({ keyword, status, reason, suggestion, side }) => {
    const value = clean(keyword).replace(/\s+/g, " ");
    if (!value) return;
    const key = value.toLowerCase();
    const decisionCode = String(suggestion?.decision?.code || "");
    const priority = ["assign_to_existing", "review_cluster_fit"].includes(decisionCode) ? "high" : "normal";
    const matchScore = Number(suggestion?.components?.final_match_score ?? suggestion?.suggested_cluster?.score ?? 0) || 0;
    const candidate = {
      keyword: value,
      evidence_status: status,
      evidence_label: ({
        unavailable: "暂无 SERP",
        stale: "SERP 已过期",
        insufficient: "SERP 证据不足",
      })[status] || "需要验证",
      priority,
      priority_label: priority === "high" ? "优先验证" : "可稍后验证",
      match_score: matchScore,
      decision_code: decisionCode,
      source_keyword: clean(suggestion?.keyword),
      suggested_cluster: suggestion?.suggested_cluster?.name || null,
      side,
      reason,
    };
    const existing = queue.get(key);
    if (
      !existing
      || (candidate.priority === "high" && existing.priority !== "high")
      || candidate.match_score > existing.match_score
    ) {
      queue.set(key, candidate);
    }
  };

  for (const suggestion of Array.isArray(suggestions) ? suggestions : []) {
    if (!suggestion?.suggested_cluster?.id) continue;
    const evidence = suggestion?.serp_overlap || {};
    const status = String(evidence.status || "unavailable").toLowerCase();
    if (!["unavailable", "stale", "insufficient"].includes(status)) continue;

    const candidateKeyword = suggestion.keyword;
    const memberKeyword = evidence.matched_keyword;
    const candidateCount = Number(evidence.candidate_result_count || 0);
    const memberCount = Number(evidence.member_result_count || 0);

    if (status === "unavailable") {
      if (!evidence.candidate_fetched_at || candidateCount === 0) {
        add({
          keyword: candidateKeyword,
          status,
          side: "candidate",
          suggestion,
          reason: "候选关键词没有可用的已缓存 Top 10 SERP。",
        });
      }
      if (memberKeyword && (!evidence.member_fetched_at || memberCount === 0)) {
        add({
          keyword: memberKeyword,
          status,
          side: "cluster_member",
          suggestion,
          reason: "用于比较的现有 Cluster 成员没有可用的已缓存 Top 10 SERP。",
        });
      }
    } else if (status === "insufficient") {
      if (candidateCount < minResults) {
        add({
          keyword: candidateKeyword,
          status,
          side: "candidate",
          suggestion,
          reason: `候选关键词只有 ${candidateCount} 个可比较 organic 结果，少于 ${minResults} 个最低要求。`,
        });
      }
      if (memberKeyword && memberCount < minResults) {
        add({
          keyword: memberKeyword,
          status,
          side: "cluster_member",
          suggestion,
          reason: `现有 Cluster 成员只有 ${memberCount} 个可比较 organic 结果，少于 ${minResults} 个最低要求。`,
        });
      }
    } else if (status === "stale") {
      if (clusterEvidenceNeedsRefresh(evidence.candidate_fetched_at, analysisTime, maxAgeDays)) {
        add({
          keyword: candidateKeyword,
          status,
          side: "candidate",
          suggestion,
          reason: `候选关键词的 SERP 快照超过 ${maxAgeDays} 天。`,
        });
      }
      if (memberKeyword && clusterEvidenceNeedsRefresh(evidence.member_fetched_at, analysisTime, maxAgeDays)) {
        add({
          keyword: memberKeyword,
          status,
          side: "cluster_member",
          suggestion,
          reason: `现有 Cluster 成员的 SERP 快照超过 ${maxAgeDays} 天。`,
        });
      }
    }
  }

  return [...queue.values()].sort((a, b) => {
    const priority = (b.priority === "high" ? 1 : 0) - (a.priority === "high" ? 1 : 0);
    return priority || b.match_score - a.match_score || a.keyword.localeCompare(b.keyword);
  });
}

export function writeClusterSerpVerificationContext({
  storageLike,
  keyword,
  siteDomain,
  verification = {},
  now = new Date().toISOString(),
} = {}) {
  const value = clean(keyword).replace(/\s+/g, " ");
  if (!storageLike?.setItem || !value) return null;
  const payload = {
    keyword: value,
    site_domain: clean(siteDomain),
    evidence_status: clean(verification.evidence_status),
    evidence_label: clean(verification.evidence_label),
    priority: clean(verification.priority),
    priority_label: clean(verification.priority_label),
    reason: clean(verification.reason),
    suggested_cluster: clean(verification.suggested_cluster),
    source_keyword: clean(verification.source_keyword),
    created_at: now,
  };
  storageLike.setItem(CLUSTER_SERP_VERIFICATION_SESSION_KEY, JSON.stringify(payload));
  return payload;
}

export function readClusterSerpVerificationContext({
  storageLike,
  now = Date.now(),
} = {}) {
  if (!storageLike?.getItem) return null;
  try {
    const payload = JSON.parse(storageLike.getItem(CLUSTER_SERP_VERIFICATION_SESSION_KEY) || "null");
    if (!payload?.keyword) return null;
    const created = Date.parse(payload.created_at || "");
    if (!Number.isFinite(created) || Number(now) - created > CLUSTER_SERP_VERIFICATION_TTL_MS) {
      storageLike.removeItem?.(CLUSTER_SERP_VERIFICATION_SESSION_KEY);
      return null;
    }
    return payload;
  } catch {
    storageLike.removeItem?.(CLUSTER_SERP_VERIFICATION_SESSION_KEY);
    return null;
  }
}

export function clearClusterSerpVerificationContext(storageLike) {
  storageLike?.removeItem?.(CLUSTER_SERP_VERIFICATION_SESSION_KEY);
}

export function requestClusterIntelligenceReturn({
  storageLike,
  keyword,
  siteDomain,
  now = new Date().toISOString(),
} = {}) {
  if (!storageLike?.setItem) return null;
  const payload = {
    keyword: clean(keyword).replace(/\s+/g, " "),
    site_domain: clean(siteDomain),
    requested_at: now,
  };
  storageLike.setItem(CLUSTER_INTELLIGENCE_RETURN_SESSION_KEY, JSON.stringify(payload));
  return payload;
}

export function consumeClusterIntelligenceReturn({
  storageLike,
  siteDomain,
} = {}) {
  if (!storageLike?.getItem) return null;
  try {
    const payload = JSON.parse(storageLike.getItem(CLUSTER_INTELLIGENCE_RETURN_SESSION_KEY) || "null");
    storageLike.removeItem?.(CLUSTER_INTELLIGENCE_RETURN_SESSION_KEY);
    if (!payload) return null;
    if (clean(payload.site_domain) && clean(siteDomain) && clean(payload.site_domain) !== clean(siteDomain)) return null;
    return payload;
  } catch {
    storageLike.removeItem?.(CLUSTER_INTELLIGENCE_RETURN_SESSION_KEY);
    return null;
  }
}

export function handoffClusterSerpVerification({
  keyword,
  keywordInput,
  locationLike,
  storageLike,
  verification,
  siteDomain,
} = {}) {
  const value = clean(keyword).replace(/\s+/g, " ");
  if (!value) throw new Error("待验证关键词为空。");
  if (storageLike && verification) {
    writeClusterSerpVerificationContext({
      storageLike,
      keyword: value,
      siteDomain,
      verification,
    });
  }
  if (keywordInput) keywordInput.value = value;
  if (locationLike) locationLike.hash = "keywords";
  keywordInput?.focus?.();
  return { keyword: value, view: "keywords", submitted: false };
}

export function clusterSuggestionPrefill({ suggestion, cluster } = {}) {
  const savedKeywordId = Number(suggestion?.saved_keyword_id);
  const clusterId = Number(suggestion?.suggested_cluster?.id);
  if (!Number.isInteger(savedKeywordId) || savedKeywordId < 1) {
    throw new Error("建议关键词缺少有效 Saved Keyword ID。");
  }
  if (!Number.isInteger(clusterId) || clusterId < 1 || !cluster) {
    throw new Error("此建议没有可预填的现有 Topic Cluster。");
  }
  const existingPrimaryId = Number(cluster?.primary?.saved_keyword_id);
  const hasExistingPrimary = Number.isInteger(existingPrimaryId) && existingPrimaryId > 0;
  return {
    selected_item: {
      id: savedKeywordId,
      keyword: String(suggestion?.keyword || "").trim(),
    },
    cluster_id: clusterId,
    primary_id: hasExistingPrimary ? existingPrimaryId : savedKeywordId,
    suggested_role: hasExistingPrimary ? "supporting" : "primary",
  };
}

export function newClusterSuggestionPrefill({ suggestion } = {}) {
  const savedKeywordId = Number(suggestion?.saved_keyword_id);
  const keyword = clean(suggestion?.keyword).replace(/\s+/g, " ");
  if (!Number.isInteger(savedKeywordId) || savedKeywordId < 1) {
    throw new Error("建议关键词缺少有效 Saved Keyword ID。");
  }
  if (!keyword) {
    throw new Error("建议关键词为空，无法预填新 Cluster。");
  }
  return {
    selected_item: { id: savedKeywordId, keyword },
    cluster_name: keyword,
    primary_id: savedKeywordId,
  };
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
      onSelectionChange?.({ item, selected: checkbox.checked });
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
    <div class="v2-library-hero">
      <div>
        <div class="v2-library-eyebrow">KEYWORD ASSETS</div>
        <h2>关键词库</h2>
        <p>保存、筛选和组织值得持续跟踪的关键词，再把它们分配到 Topic Cluster。</p>
      </div>
      <div class="v2-library-hero-actions">
        <span class="v2-cost-pill">D1 管理 · $0</span>
        <button type="button" data-v2-library-refresh>刷新数据</button>
      </div>
    </div>

    <div class="v2-library-tabs" role="tablist" aria-label="关键词库视图">
      <button type="button" role="tab" aria-selected="true" class="active" data-v2-library-tab="keywords">全部关键词</button>
      <button type="button" role="tab" aria-selected="false" data-v2-library-tab="clusters">Topic Clusters</button>
      <button type="button" role="tab" aria-selected="false" data-v2-library-tab="intelligence">Cluster Intelligence</button>
    </div>

    <div class="v2-library-panel active" data-v2-library-panel="keywords">
      <div class="v2-library-filterbar">
        <div class="v2-library-search">
          <span aria-hidden="true">⌕</span>
          <input type="search" data-v2-library-query placeholder="搜索已保存关键词">
        </div>
        <input type="search" data-v2-library-tag placeholder="筛选 Tag">
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

      <div class="v2-library-bulkbar">
        <div class="v2-library-bulk-left">
          <span class="v2-selection-count" data-v2-library-selected>已选择 0 条</span>
          <button type="button" data-v2-library-select-page>选择当前页</button>
          <button type="button" data-v2-library-clear-selected>清空</button>
        </div>
        <div class="v2-library-bulk-right">
          <input type="text" data-v2-library-batch-tags placeholder="添加 Tag，例如 Commercial, Saudi">
          <button type="button" class="secondary-action" data-v2-library-add-tags>添加 Tag</button>
          <button type="button" class="danger-action" data-v2-library-delete-selected>删除已选</button>
        </div>
        <span data-v2-library-batch-status class="v2-library-batch-status"></span>
      </div>

      <div data-v2-library-status class="status"></div>

      <div class="v2-library-table-shell">
        <div class="tablewrap">
          <table class="ideastable v2-library-table">
            <thead>
              <tr>
                <th>选择</th>
                <th>关键词</th>
                <th>搜索量</th>
                <th>KD</th>
                <th>CPC</th>
                <th>Intent</th>
                <th>市场</th>
                <th>Tags</th>
                <th>来源</th>
                <th>指标时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody data-v2-library-body></tbody>
          </table>
        </div>
        <div class="v2-library-pager">
          <span data-v2-library-summary>—</span>
          <div>
            <button type="button" data-v2-library-prev>上一页</button>
            <button type="button" data-v2-library-next>下一页</button>
          </div>
        </div>
      </div>
    </div>

    <div class="v2-library-panel" data-v2-library-panel="clusters" hidden>
      <div class="v2-workspace-section-head">
        <div>
          <h3>Topic Clusters</h3>
          <p>用 Primary / Supporting 组织关键词。选择关键词后，在这里完成手动分配。</p>
        </div>
        <button type="button" data-v2-cluster-refresh>刷新 Cluster</button>
      </div>

      <div class="v2-cluster-compose">
        <div class="v2-field">
          <label>目标 Cluster</label>
          <select data-v2-cluster-select aria-label="选择 Topic Cluster">
            <option value="">选择 Topic Cluster</option>
          </select>
        </div>
        <div class="v2-field v2-field-grow">
          <label>新建 Cluster</label>
          <input type="text" maxlength="80" data-v2-cluster-name placeholder="输入 Cluster 名称">
        </div>
        <button type="button" class="primary-action" data-v2-cluster-create>创建 Cluster</button>
        <div class="v2-field">
          <label>Primary Keyword</label>
          <select data-v2-cluster-primary aria-label="选择 Primary Keyword">
            <option value="">选择 Primary Keyword</option>
          </select>
        </div>
        <button type="button" class="primary-action" data-v2-cluster-assign>分配已选关键词</button>
      </div>

      <div class="v2-inline-help">
        已有 Cluster 成员会保留；现有 Primary 默认保留。已选词若属于其他 Cluster，会移动到当前 Cluster。全部操作 $0。
      </div>
      <div data-v2-cluster-status class="v2-cluster-status"></div>
      <div data-v2-cluster-list class="v2-cluster-list"></div>
    </div>

    <div class="v2-library-panel" data-v2-library-panel="intelligence" hidden>
      <div class="v2-workspace-section-head">
        <div>
          <h3>Cluster Intelligence <span>v0.2</span></h3>
          <p>基于关键词结构、已缓存 Intent，并在可用时加入真实 Top 10 SERP URL overlap。Cannibalization 仍表示潜在风险。</p>
        </div>
        <button type="button" class="primary-action" data-v2-cluster-intelligence-run>分析 Cluster 建议</button>
      </div>
      <div data-v2-cluster-intelligence-status class="v2-cluster-intelligence-status"></div>
      <div data-v2-cluster-intelligence-summary class="v2-cluster-intelligence-summary"></div>
      <details class="v2-serp-verification-queue" data-v2-serp-verification-queue>
        <summary>
          <span><b>SERP Evidence Coverage</b><small>仅列出真正缺失、过期或证据不足的关键词</small></span>
          <span data-v2-serp-verification-count>待验证 0</span>
        </summary>
        <div data-v2-serp-verification-list class="v2-serp-verification-list">
          <div class="v2-serp-verification-empty">先运行 Cluster Intelligence，系统会在这里列出值得手动验证 SERP 的关键词。</div>
        </div>
      </details>
      <div class="v2-library-table-shell">
        <div class="tablewrap v2-cluster-intelligence-tablewrap">
          <table class="ideastable v2-cluster-intelligence-table">
            <thead>
              <tr>
                <th>Keyword</th>
                <th>建议</th>
                <th>建议 Cluster</th>
                <th>Match</th>
                <th>SERP Overlap</th>
                <th>Shared URLs</th>
                <th>Confidence</th>
                <th>Cannibalization</th>
                <th>原因</th>
                <th>下一步</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody data-v2-cluster-intelligence-body>
              <tr><td colspan="11" class="emptyrow">点击“分析 Cluster 建议”生成只读建议。本次 $0。</td></tr>
            </tbody>
          </table>
        </div>
      </div>
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
  windowLike = globalThis.window,
  sessionStorageLike = globalThis.sessionStorage,
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
  const clusterRefreshButton = section.querySelector("[data-v2-cluster-refresh]");
  const clusterSelect = section.querySelector("[data-v2-cluster-select]");
  const clusterNameInput = section.querySelector("[data-v2-cluster-name]");
  const clusterCreateButton = section.querySelector("[data-v2-cluster-create]");
  const clusterPrimarySelect = section.querySelector("[data-v2-cluster-primary]");
  const clusterAssignButton = section.querySelector("[data-v2-cluster-assign]");
  const clusterStatus = section.querySelector("[data-v2-cluster-status]");
  const clusterList = section.querySelector("[data-v2-cluster-list]");
  const intelligenceRunButton = section.querySelector("[data-v2-cluster-intelligence-run]");
  const intelligenceStatus = section.querySelector("[data-v2-cluster-intelligence-status]");
  const intelligenceSummary = section.querySelector("[data-v2-cluster-intelligence-summary]");
  const intelligenceBody = section.querySelector("[data-v2-cluster-intelligence-body]");
  const serpVerificationQueue = section.querySelector("[data-v2-serp-verification-queue]");
  const serpVerificationCount = section.querySelector("[data-v2-serp-verification-count]");
  const serpVerificationList = section.querySelector("[data-v2-serp-verification-list]");
  const libraryTabs = [...section.querySelectorAll("[data-v2-library-tab]")];
  const libraryPanels = [...section.querySelectorAll("[data-v2-library-panel]")];
  const keywordInput = root.querySelector("#keyword");

  let page = 1;
  let totalPages = 1;
  let loading = false;
  let currentItems = [];
  let keywordClusters = [];
  const selectedLibraryIds = new Set();
  const selectedLibraryItems = new Map();
  let refreshClusterControls = () => {};
  let prefillClusterSuggestion = async () => {};
  let prefillNewClusterSuggestion = async () => {};

  const activateLibraryTab = (tabId) => {
    const target = ["keywords", "clusters", "intelligence"].includes(tabId) ? tabId : "keywords";
    libraryTabs.forEach((button) => {
      const active = button.dataset.v2LibraryTab === target;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    libraryPanels.forEach((panel) => {
      const active = panel.dataset.v2LibraryPanel === target;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    return target;
  };

  libraryTabs.forEach((button) => {
    button.addEventListener("click", () => activateLibraryTab(button.dataset.v2LibraryTab));
  });



  const showStatus = (message = "", type = "info") => {
    status.textContent = message;
    status.className = message ? `status on ${type}` : "status";
  };

  const showClusterStatus = (message = "", type = "info") => {
    clusterStatus.textContent = message;
    clusterStatus.className = message ? `v2-cluster-status ${type}` : "v2-cluster-status";
  };

  const showIntelligenceStatus = (message = "", type = "info") => {
    intelligenceStatus.textContent = message;
    intelligenceStatus.className = message
      ? `v2-cluster-intelligence-status ${type}`
      : "v2-cluster-intelligence-status";
  };

  const resumeClusterIntelligence = () => {
    const view = String(locationLike?.hash || "").replace(/^#/, "");
    if (view !== "keyword-library") return false;
    const marker = consumeClusterIntelligenceReturn({
      storageLike: sessionStorageLike,
      siteDomain: context.get()?.domain,
    });
    if (!marker) return false;
    activateLibraryTab("intelligence");
    showIntelligenceStatus(
      marker.keyword
        ? `“${marker.keyword}”的 SERP 证据已更新，正在用 D1 数据重新计算 Cluster Intelligence…`
        : "SERP 证据已更新，正在用 D1 数据重新计算 Cluster Intelligence…",
      "info",
    );
    intelligenceRunButton.click();
    return true;
  };

  windowLike?.addEventListener?.("hashchange", resumeClusterIntelligence);

  const renderSerpVerificationQueue = (data = {}) => {
    const queue = buildClusterSerpVerificationQueue({
      suggestions: data.suggestions || [],
      analysisTime: data.analysis_time,
      maxAgeDays: Number(data.thresholds?.serp_overlap_max_age_days || 30),
      minResults: Number(data.thresholds?.serp_overlap_min_results || 5),
    });
    serpVerificationCount.textContent = `待验证 ${queue.length}`;
    serpVerificationList.replaceChildren();

    queue.forEach((item) => {
      const row = documentLike.createElement("div");
      row.className = "v2-serp-verification-item";
      row.dataset.priority = item.priority;

      const main = documentLike.createElement("div");
      main.className = "v2-serp-verification-main";
      const keyword = documentLike.createElement("b");
      keyword.textContent = item.keyword;
      const meta = documentLike.createElement("span");
      meta.textContent = [
        item.priority_label,
        item.evidence_label,
        item.suggested_cluster ? `影响 Cluster：${item.suggested_cluster}` : null,
      ].filter(Boolean).join(" · ");
      const reason = documentLike.createElement("small");
      reason.textContent = item.reason;
      main.append(keyword, meta, reason);

      const action = documentLike.createElement("button");
      action.type = "button";
      action.className = "v2-serp-verification-action";
      action.textContent = "去验证 SERP";
      action.title = "只跳转到关键词研究并预填关键词；不会自动提交或产生 DataForSEO 费用。";
      action.addEventListener("click", () => {
        handoffClusterSerpVerification({
          keyword: item.keyword,
          keywordInput,
          locationLike,
          storageLike: sessionStorageLike,
          verification: item,
          siteDomain: context.get()?.domain,
        });
      });

      row.append(main, action);
      serpVerificationList.appendChild(row);
    });

    if (!queue.length) {
      const empty = documentLike.createElement("div");
      empty.className = "v2-serp-verification-empty";
      empty.textContent = "当前没有需要补充的 SERP 证据。已有证据足够，或当前建议没有可比较的现有 Cluster。";
      serpVerificationList.appendChild(empty);
      serpVerificationQueue.open = false;
    } else {
      serpVerificationQueue.open = true;
    }
    return queue;
  };

  const clearClusterIntelligence = () => {
    intelligenceSummary.textContent = "";
    serpVerificationCount.textContent = "待验证 0";
    serpVerificationList.innerHTML = '<div class="v2-serp-verification-empty">先运行 Cluster Intelligence，系统会在这里列出值得手动验证 SERP 的关键词。</div>';
    serpVerificationQueue.open = false;
    intelligenceBody.replaceChildren();
    const row = documentLike.createElement("tr");
    const cell = documentLike.createElement("td");
    cell.colSpan = 11;
    cell.className = "emptyrow";
    cell.textContent = "点击“分析 Cluster 建议”生成只读建议。本次 $0。";
    row.appendChild(cell);
    intelligenceBody.appendChild(row);
    showIntelligenceStatus();
  };

  const renderClusterIntelligence = (data = {}) => {
    const summaryData = data.summary || {};
    renderSerpVerificationQueue(data);
    intelligenceSummary.textContent = [
      `未分配 ${summaryData.unassigned_keywords ?? 0}`,
      `建议现有 Cluster ${summaryData.suggested_existing_cluster ?? 0}`,
      `人工复核 ${summaryData.manual_review ?? 0}`,
      `新建候选 ${summaryData.new_cluster_candidates ?? 0}`,
      `高潜在蚕食风险 ${summaryData.potential_cannibalization_high ?? 0}`,
      `SERP 证据 ${summaryData.serp_evidence_available ?? 0}/${summaryData.unassigned_keywords ?? 0} · 覆盖 ${summaryData.serp_evidence_coverage_pct ?? 0}%`,
      (summaryData.serp_evidence_strong ?? 0) > 0 ? `强 SERP 证据 ${summaryData.serp_evidence_strong}` : null,
      (summaryData.serp_evidence_stale ?? 0) > 0 ? `过期 SERP ${summaryData.serp_evidence_stale}` : null,
      summaryData.truncated ? "仅分析最近 250 个 Saved Keywords" : null,
    ].filter(Boolean).join(" · ");

    intelligenceBody.replaceChildren();
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    suggestions.forEach((item) => {
      const row = documentLike.createElement("tr");
      const evidence = clusterSerpEvidencePresentation(item.serp_overlap);
      const confidence = clusterConfidencePresentation(item.confidence);
      const cells = [
        item.keyword || "—",
        clusterIntelligenceDecisionLabel(item.decision?.code, item.decision?.label),
        item.suggested_cluster
          ? `${item.suggested_cluster.name || "Unnamed"} · ${item.suggested_cluster.score ?? "—"}`
          : "—",
        item.components?.final_match_score ?? item.suggested_cluster?.score ?? "—",
        evidence.label,
        evidence.shared_label,
        confidence.score == null ? confidence.label : `${confidence.label} · ${confidence.score}`,
        `${clusterIntelligenceRiskLabel(item.cannibalization?.level)} · ${item.cannibalization?.score ?? 0}`,
        Array.isArray(item.reasons) && item.reasons.length ? item.reasons.join(" ") : "—",
        item.decision?.next_action || "—",
      ];
      cells.forEach((value, index) => {
        const cell = documentLike.createElement("td");
        cell.textContent = String(value);
        if (index === 4) {
          cell.className = "v2-serp-evidence-cell";
          cell.dataset.evidenceStatus = evidence.status;
          cell.dataset.evidenceStrength = evidence.strength;
          cell.title = item.serp_overlap?.reason || "当前没有可用的 SERP overlap 证据。";
        }
        if (index === 5 && evidence.shared_urls.length) {
          cell.className = "v2-serp-shared-urls";
          cell.title = evidence.shared_urls.join("\n");
        }
        if (index === 6) {
          cell.className = "v2-cluster-confidence";
          cell.dataset.confidence = confidence.level;
          cell.title = confidence.reason || "当前没有置信度说明。";
        }
        if (index === 7) {
          cell.dataset.risk = String(item.cannibalization?.level || "none");
          cell.title = item.cannibalization?.reason || "";
        }
        row.appendChild(cell);
      });

      const actionCell = documentLike.createElement("td");
      const decisionCode = String(item.decision?.code || "");
      if (decisionCode === "new_cluster_candidate") {
        const createPrefill = documentLike.createElement("button");
        createPrefill.type = "button";
        createPrefill.className = "v2-cluster-adopt";
        createPrefill.dataset.v2ClusterCreatePrefill = String(item.saved_keyword_id);
        createPrefill.textContent = "按建议新建 Cluster";
        createPrefill.title = "只预填新 Cluster 名称和 Primary Keyword；不会立即创建或写入数据库。";
        createPrefill.addEventListener("click", async () => {
          createPrefill.disabled = true;
          createPrefill.textContent = "预填中…";
          try {
            await prefillNewClusterSuggestion(item);
            createPrefill.textContent = "已预填";
          } catch (error) {
            createPrefill.textContent = "重试";
            createPrefill.title = error?.message || "预填失败";
            showIntelligenceStatus(error?.message || "新 Cluster 预填失败", "error");
          } finally {
            if (createPrefill.textContent !== "已预填") createPrefill.disabled = false;
          }
        });
        actionCell.appendChild(createPrefill);
      } else if (item.suggested_cluster?.id) {
        const adopt = documentLike.createElement("button");
        adopt.type = "button";
        adopt.className = "v2-cluster-adopt";
        adopt.dataset.v2ClusterAdopt = String(item.saved_keyword_id);
        adopt.textContent = decisionCode === "review_cluster_fit" ? "预填复核" : "采用此建议";
        adopt.title = "只预填关键词、Cluster 和 Primary/Supporting；不会立即写入数据库。";
        adopt.addEventListener("click", async () => {
          adopt.disabled = true;
          const original = adopt.textContent;
          adopt.textContent = "预填中…";
          try {
            await prefillClusterSuggestion(item);
            adopt.textContent = "已预填";
          } catch (error) {
            adopt.textContent = "重试";
            adopt.title = error?.message || "预填失败";
            showIntelligenceStatus(error?.message || "建议预填失败", "error");
          } finally {
            if (adopt.textContent !== "已预填") adopt.disabled = false;
            if (!adopt.textContent) adopt.textContent = original;
          }
        });
        actionCell.appendChild(adopt);
      } else {
        const hint = documentLike.createElement("span");
        hint.className = "sub";
        hint.textContent = "暂无可预填建议";
        actionCell.appendChild(hint);
      }
      row.appendChild(actionCell);
      intelligenceBody.appendChild(row);
    });

    if (!suggestions.length) {
      const row = documentLike.createElement("tr");
      const cell = documentLike.createElement("td");
      cell.colSpan = 11;
      cell.className = "emptyrow";
      cell.textContent = summaryData.unassigned_keywords === 0
        ? "当前分析范围内没有未分配关键词。"
        : "当前没有可显示的 Cluster 建议。";
      row.appendChild(cell);
      intelligenceBody.appendChild(row);
    }
  };

  const handleLibrarySelectionChange = ({ item, selected } = {}) => {
    const id = Number(item?.id);
    if (Number.isInteger(id) && id > 0) {
      if (selected) selectedLibraryItems.set(id, item);
      else selectedLibraryItems.delete(id);
    }
    updateLibrarySelection();
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
    refreshClusterControls();
  };

  async function load() {
    const market = context.get();
    if (!market?.domain) {
      body.replaceChildren();
      currentItems = [];
      selectedLibraryIds.clear();
      selectedLibraryItems.clear();
      renderRows({
        documentLike,
        body,
        items: [],
        keywordInput,
        locationLike,
        selectedIds: selectedLibraryIds,
        onSelectionChange: handleLibrarySelectionChange,
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
      currentItems.forEach((item) => {
        const id = Number(item.id);
        if (selectedLibraryIds.has(id)) selectedLibraryItems.set(id, item);
      });
      renderRows({
        documentLike,
        body,
        items: currentItems,
        keywordInput,
        locationLike,
        selectedIds: selectedLibraryIds,
        onSelectionChange: handleLibrarySelectionChange,
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
    currentItems.forEach((item) => {
      const id = Number(item.id);
      selectedLibraryIds.add(id);
      selectedLibraryItems.set(id, item);
    });
    renderRows({
      documentLike,
      body,
      items: currentItems,
      keywordInput,
      locationLike,
      selectedIds: selectedLibraryIds,
      onSelectionChange: handleLibrarySelectionChange,
    });
    updateLibrarySelection();
  });
  clearSelectedButton.addEventListener("click", () => {
    selectedLibraryIds.clear();
    selectedLibraryItems.clear();
    renderRows({
      documentLike,
      body,
      items: currentItems,
      keywordInput,
      locationLike,
      selectedIds: selectedLibraryIds,
      onSelectionChange: handleLibrarySelectionChange,
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
      selectedLibraryItems.clear();
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
      selectedLibraryItems.clear();
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
  function renderClusterList() {
    clusterList.replaceChildren();
    keywordClusters.forEach((cluster) => {
      const card = documentLike.createElement("div");
      card.className = "v2-cluster-card";

      const head = documentLike.createElement("div");
      head.className = "v2-cluster-card-head";
      const name = documentLike.createElement("b");
      name.textContent = cluster.name || "Unnamed Cluster";
      const count = documentLike.createElement("span");
      count.className = "sub";
      count.textContent = `${cluster.member_count || 0} 个关键词 · ${cluster.source || "manual"}`;
      head.append(name, count);

      const primary = documentLike.createElement("div");
      primary.className = "v2-cluster-primary";
      primary.textContent = `Primary：${cluster.primary?.keyword || "尚未指定"}`;

      const supporting = documentLike.createElement("div");
      supporting.className = "v2-cluster-supporting";
      const supportingKeywords = (cluster.supporting || []).map((item) => item.keyword).filter(Boolean);
      supporting.textContent = supportingKeywords.length
        ? `Supporting：${supportingKeywords.slice(0, 8).join(" · ")}${supportingKeywords.length > 8 ? ` · +${supportingKeywords.length - 8}` : ""}`
        : "Supporting：—";

      card.append(head, primary, supporting);
      clusterList.appendChild(card);
    });

    if (!keywordClusters.length) {
      const empty = documentLike.createElement("div");
      empty.className = "v2-cluster-empty";
      empty.textContent = "当前网站还没有 Topic Cluster。可以先创建一个，再把已选关键词分配进去。";
      clusterList.appendChild(empty);
    }
  }

  function renderClusterSelect(preferredId = null) {
    const current = String(preferredId ?? clusterSelect.value ?? "");
    clusterSelect.replaceChildren();
    const placeholder = documentLike.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "选择 Topic Cluster";
    clusterSelect.appendChild(placeholder);
    keywordClusters.forEach((cluster) => {
      const option = documentLike.createElement("option");
      option.value = String(cluster.id);
      option.textContent = cluster.name;
      clusterSelect.appendChild(option);
    });
    if (keywordClusters.some((cluster) => String(cluster.id) === current)) {
      clusterSelect.value = current;
    }
  }

  async function loadClusters(preferredId = null) {
    const market = context.get();
    if (!market?.domain) {
      keywordClusters = [];
      renderClusterSelect();
      renderClusterList();
      refreshClusterControls();
      return;
    }
    clusterRefreshButton.disabled = true;
    try {
      const response = await fetchImpl(
        KEYWORD_CLUSTERS_URL + "?site_domain=" + encodeURIComponent(market.domain),
        { headers: { accept: "application/json" } },
      );
      const payload = await readJson(response);
      keywordClusters = payload.data?.clusters || [];
      renderClusterSelect(preferredId);
      renderClusterList();
      showClusterStatus();
    } catch (error) {
      showClusterStatus(error.message || "Topic Cluster 读取失败", "error");
    } finally {
      clusterRefreshButton.disabled = false;
      refreshClusterControls();
    }
  }

  refreshClusterControls = () => {
    const market = context.get();
    const selectedItems = [...selectedLibraryItems.values()];
    const previousPrimary = clusterPrimarySelect.value;
    const cluster = keywordClusters.find((item) => String(item.id) === clusterSelect.value);

    clusterPrimarySelect.replaceChildren();
    const placeholder = documentLike.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "选择 Primary Keyword";
    clusterPrimarySelect.appendChild(placeholder);

    const primaryOptions = new Map();
    selectedItems.forEach((item) => {
      const id = Number(item.id);
      if (Number.isInteger(id) && id > 0) {
        primaryOptions.set(id, { id, keyword: item.keyword, existing: false });
      }
    });
    const existingPrimaryId = Number(cluster?.primary?.saved_keyword_id);
    if (Number.isInteger(existingPrimaryId) && existingPrimaryId > 0) {
      primaryOptions.set(existingPrimaryId, {
        id: existingPrimaryId,
        keyword: cluster.primary.keyword,
        existing: true,
      });
    }

    [...primaryOptions.values()]
      .sort((a, b) => String(a.keyword).localeCompare(String(b.keyword)))
      .forEach((item) => {
        const option = documentLike.createElement("option");
        option.value = String(item.id);
        option.textContent = item.existing
          ? `现有 Primary：${item.keyword}`
          : item.keyword;
        clusterPrimarySelect.appendChild(option);
      });

    if (primaryOptions.has(Number(previousPrimary))) {
      clusterPrimarySelect.value = previousPrimary;
    } else if (Number.isInteger(existingPrimaryId) && existingPrimaryId > 0) {
      clusterPrimarySelect.value = String(existingPrimaryId);
    } else if (selectedItems.length === 1) {
      clusterPrimarySelect.value = String(selectedItems[0].id);
    }
    let assignments = [];
    try {
      if (cluster && clusterPrimarySelect.value) {
        assignments = buildKeywordClusterAssignments({
          cluster,
          selectedItems,
          primaryId: clusterPrimarySelect.value,
        });
      }
    } catch {}

    const tooMany = assignments.length > 100 || selectedItems.length > 100;
    clusterCreateButton.disabled = !market?.domain || !clean(clusterNameInput.value);
    clusterAssignButton.disabled = !market?.domain
      || !cluster
      || !selectedItems.length
      || !clusterPrimarySelect.value
      || tooMany;
    clusterAssignButton.title = !market?.domain
      ? "请先在网站管理添加并选择当前网站"
      : !cluster
        ? "请选择 Topic Cluster"
        : !selectedItems.length
          ? "请先在关键词库选择关键词"
          : !clusterPrimarySelect.value
            ? "请选择一个 Primary Keyword"
            : tooMany
              ? "合并现有成员后最多允许 100 个关键词"
              : `把已选 ${selectedItems.length} 个关键词分配到 ${cluster.name}`;
  };

  prefillNewClusterSuggestion = async (suggestion) => {
    const prefill = newClusterSuggestionPrefill({ suggestion });
    selectedLibraryIds.clear();
    selectedLibraryItems.clear();
    selectedLibraryIds.add(prefill.selected_item.id);
    selectedLibraryItems.set(prefill.selected_item.id, prefill.selected_item);
    clusterSelect.value = "";
    clusterNameInput.value = prefill.cluster_name;

    renderRows({
      documentLike,
      body,
      items: currentItems,
      keywordInput,
      locationLike,
      selectedIds: selectedLibraryIds,
      onSelectionChange: handleLibrarySelectionChange,
    });
    updateLibrarySelection();
    refreshClusterControls();
    clusterPrimarySelect.value = String(prefill.primary_id);
    refreshClusterControls();

    showClusterStatus(
      `已预填新 Cluster“${prefill.cluster_name}”，Primary 为“${prefill.selected_item.keyword}”。尚未创建，请检查名称后点击“创建 Cluster”；创建后再点击“分配已选关键词”。`,
      "success",
    );
    showIntelligenceStatus("新 Cluster 建议已预填；尚未创建 Cluster，也未修改数据库。", "success");
    activateLibraryTab("clusters");
    clusterNameInput.focus?.();
    clusterNameInput.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };

  prefillClusterSuggestion = async (suggestion) => {
    const clusterId = Number(suggestion?.suggested_cluster?.id);
    if (!Number.isInteger(clusterId) || clusterId < 1) {
      throw new Error("此建议没有可预填的现有 Topic Cluster。");
    }

    let cluster = keywordClusters.find((item) => Number(item.id) === clusterId);
    if (!cluster) {
      await loadClusters(clusterId);
      cluster = keywordClusters.find((item) => Number(item.id) === clusterId);
    }
    if (!cluster) throw new Error("建议 Cluster 当前不可用，请刷新后重试。");

    const prefill = clusterSuggestionPrefill({ suggestion, cluster });
    selectedLibraryIds.add(prefill.selected_item.id);
    selectedLibraryItems.set(prefill.selected_item.id, prefill.selected_item);
    clusterSelect.value = String(prefill.cluster_id);

    renderRows({
      documentLike,
      body,
      items: currentItems,
      keywordInput,
      locationLike,
      selectedIds: selectedLibraryIds,
      onSelectionChange: handleLibrarySelectionChange,
    });
    updateLibrarySelection();
    refreshClusterControls();
    clusterPrimarySelect.value = String(prefill.primary_id);
    refreshClusterControls();

    const roleText = prefill.suggested_role === "primary" ? "Primary" : "Supporting";
    showClusterStatus(
      `已预填“${prefill.selected_item.keyword}” → “${cluster.name}” 为 ${roleText}。尚未保存，请检查后点击“分配已选关键词”。`,
      "success",
    );
    showIntelligenceStatus("建议已预填到手动分配区；尚未修改数据库。", "success");
    activateLibraryTab("clusters");
    clusterSelect.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };

  clusterRefreshButton.addEventListener("click", () => loadClusters());
  intelligenceRunButton.addEventListener("click", async () => {
    const market = context.get();
    if (!market?.domain) {
      showIntelligenceStatus("请先在网站管理添加并选择当前网站。", "error");
      return;
    }

    intelligenceRunButton.disabled = true;
    intelligenceRunButton.textContent = "分析中…";
    showIntelligenceStatus("正在读取 D1 中的 Saved Keywords、Cluster、已缓存 Intent 与已有 SERP 证据；不会调用 DataForSEO。");
    try {
      const response = await fetchImpl(
        CLUSTER_INTELLIGENCE_URL + "?site_domain=" + encodeURIComponent(market.domain),
        { headers: { accept: "application/json" } },
      );
      const payload = await readJson(response);
      renderClusterIntelligence(payload.data || {});
      showIntelligenceStatus("Cluster 建议已生成 · 本次 $0 · 未修改任何 Cluster。", "success");
    } catch (error) {
      showIntelligenceStatus(error.message || "Cluster Intelligence 分析失败", "error");
    } finally {
      intelligenceRunButton.textContent = "分析 Cluster 建议";
      intelligenceRunButton.disabled = false;
    }
  });
  clusterNameInput.addEventListener("input", refreshClusterControls);
  clusterSelect.addEventListener("change", refreshClusterControls);
  clusterPrimarySelect.addEventListener("change", refreshClusterControls);

  clusterCreateButton.addEventListener("click", async () => {
    const market = context.get();
    const name = clean(clusterNameInput.value).replace(/\s+/g, " ");
    if (!market?.domain || !name) {
      refreshClusterControls();
      return;
    }
    clusterCreateButton.disabled = true;
    clusterCreateButton.textContent = "创建中…";
    try {
      const result = await readJson(await fetchImpl(KEYWORD_CLUSTERS_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          site_domain: market.domain,
          name,
          source: "manual",
        }),
      }));
      clusterNameInput.value = "";
      await loadClusters(result.data?.id);
      showClusterStatus(`已创建 Topic Cluster“${result.data?.name || name}” · 本次 $0`, "success");
    } catch (error) {
      showClusterStatus(error.message || "Topic Cluster 创建失败", "error");
    } finally {
      clusterCreateButton.textContent = "创建 Cluster";
      refreshClusterControls();
    }
  });

  clusterAssignButton.addEventListener("click", async () => {
    const market = context.get();
    const cluster = keywordClusters.find((item) => String(item.id) === clusterSelect.value);
    const selectedItems = [...selectedLibraryItems.values()];
    if (!market?.domain || !cluster || !selectedItems.length || !clusterPrimarySelect.value) {
      refreshClusterControls();
      return;
    }

    let assignments;
    try {
      assignments = buildKeywordClusterAssignments({
        cluster,
        selectedItems,
        primaryId: clusterPrimarySelect.value,
      });
    } catch (error) {
      showClusterStatus(error.message || "Cluster 分配参数无效", "error");
      return;
    }
    if (assignments.length > 100) {
      showClusterStatus("合并现有成员后最多允许 100 个关键词。", "error");
      return;
    }

    clusterAssignButton.disabled = true;
    clusterAssignButton.textContent = "分配中…";
    try {
      const result = await readJson(await fetchImpl(KEYWORD_CLUSTERS_URL, {
        method: "PATCH",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          site_domain: market.domain,
          cluster_id: cluster.id,
          assignments,
        }),
      }));
      selectedLibraryIds.clear();
      selectedLibraryItems.clear();
      await loadClusters(cluster.id);
      await load();
      showClusterStatus(
        `已更新“${result.data?.name || cluster.name}”：Primary 1 个，Supporting ${Math.max(0, (result.data?.member_count || assignments.length) - 1)} 个 · 本次 $0`,
        "success",
      );
    } catch (error) {
      showClusterStatus(error.message || "Topic Cluster 分配失败", "error");
    } finally {
      clusterAssignButton.textContent = "分配已选关键词";
      refreshClusterControls();
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
      selectedLibraryItems.delete(Number(button.dataset.savedKeywordId));
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
    selectedLibraryItems.clear();
    keywordClusters = [];
    clearClusterIntelligence();
    updateLibrarySelection();
    updateSaveButton();
    refreshResearchSurfaceButtons();
    resetAndLoad();
    loadClusters();
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

  activateLibraryTab("keywords");
  renderClusterSelect();
  renderClusterList();
  clearClusterIntelligence();
  refreshClusterControls();
  updateLibrarySelection();
  updateSaveButton();
  if (context.get()?.domain) loadClusters();
  resumeClusterIntelligence();

  return () => {
    unsubscribe?.();
    surfaceObservers.forEach((observer) => observer.disconnect?.());
    keywordInput?.removeEventListener("input", handleKeywordInput);
    windowLike?.removeEventListener?.("hashchange", resumeClusterIntelligence);
  };
}
