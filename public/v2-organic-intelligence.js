import { classifyOrganicKeywordAction } from "../src/v2/intelligence/organic-keyword-actions.js";
import { classifyOrganicPageAction } from "../src/v2/intelligence/organic-page-actions.js";

const ENDPOINT = "/api/v2/organic/keywords";
const PAGES_ENDPOINT = "/api/v2/organic/pages";
const PAGE_SIZE = 50;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function number(value) {
  const parsed = finite(value);
  return parsed === null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(parsed);
}

function money(value) {
  const parsed = finite(value);
  return parsed === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(parsed);
}

function hostnameForTarget(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function organicTargetMode(target, ownDomain) {
  const targetHost = hostnameForTarget(target);
  const ownHost = hostnameForTarget(ownDomain);
  return targetHost && ownHost && targetHost === ownHost ? "own" : "competitor";
}

export function formatOrganicMovement(row = {}) {
  const movement = row.movement ?? {};
  if (movement.is_lost) return { code: "lost", label: "Lost", delta: null };
  if (movement.is_new) return { code: "new", label: "New", delta: null };
  if (movement.is_up) return { code: "up", label: "Improved", delta: finite(movement.absolute_delta) };
  if (movement.is_down) return { code: "down", label: "Declined", delta: finite(movement.absolute_delta) };
  return { code: "stable", label: "Stable", delta: finite(movement.absolute_delta) };
}

function positionMatches(position, bucket) {
  const value = finite(position);
  if (!bucket) return true;
  if (value === null) return false;
  if (bucket === "top3") return value <= 3;
  if (bucket === "4-10") return value >= 4 && value <= 10;
  if (bucket === "11-20") return value >= 11 && value <= 20;
  if (bucket === "21-50") return value >= 21 && value <= 50;
  if (bucket === "51-100") return value >= 51 && value <= 100;
  return true;
}

export function filterOrganicKeywordRows(rows, filters = {}, mode = "own") {
  const query = String(filters.query ?? "").trim().toLowerCase();
  const movement = String(filters.movement ?? "");
  const intent = String(filters.intent ?? "");
  const action = String(filters.action ?? "");
  const minVolume = filters.minVolume === "" || filters.minVolume == null ? null : finite(filters.minVolume);
  const maxKd = filters.maxKd === "" || filters.maxKd == null ? null : finite(filters.maxKd);

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (query && !String(row.keyword ?? "").toLowerCase().includes(query) && !String(row.ranking_url ?? "").toLowerCase().includes(query)) return false;
    if (!positionMatches(row.position, filters.position)) return false;
    const movementView = formatOrganicMovement(row);
    if (movement && movementView.code !== movement) return false;
    if (intent && String(row.intent?.primary ?? "") !== intent) return false;
    if (minVolume !== null && (finite(row.search_volume) ?? -Infinity) < minVolume) return false;
    if (maxKd !== null && (finite(row.keyword_difficulty) ?? Infinity) > maxKd) return false;
    if (action && classifyOrganicKeywordAction(row, { mode }).code !== action) return false;
    return true;
  });
}

export function filterOrganicPageRows(rows, filters = {}, mode = "own") {
  const query = String(filters.query ?? "").trim().toLowerCase();
  const action = String(filters.action ?? "");
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (query && !String(row.relative_url ?? row.url ?? "").toLowerCase().includes(query)) return false;
    if (action && classifyOrganicPageAction(row, { mode }).code !== action) return false;
    return true;
  });
}

function ensureStyles(documentLike) {
  if (documentLike.querySelector('link[data-v2-organic-styles]')) return;
  const link = documentLike.createElement("link");
  link.rel = "stylesheet";
  link.href = "./v2-organic-intelligence.css";
  link.dataset.v2OrganicStyles = "";
  documentLike.head.append(link);
}

export function createOrganicIntelligenceWorkspace(documentLike = document) {
  ensureStyles(documentLike);
  const section = documentLike.createElement("section");
  section.className = "v2-organic-workspace";
  section.dataset.v2View = "website";
  section.innerHTML = `
    <div class="v2-organic-hero">
      <div>
        <div class="v2-organic-eyebrow">SITE EXPLORER · ORGANIC INTELLIGENCE</div>
        <h2>Organic Intelligence</h2>
        <p>从网站或单个页面进入自然搜索关键词，先复用 7 天缓存，再由 Cost Guard 明确确认实时 DataForSEO 请求。</p>
      </div>
      <div class="v2-organic-mode" data-v2-organic-mode>OWN SITE</div>
    </div>
    <form class="v2-organic-targetbar" data-v2-organic-form>
      <label class="v2-organic-target"><span>Target</span><input type="text" data-v2-organic-target placeholder="example.com 或 https://example.com/page/" autocomplete="off" required></label>
      <label><span>Depth</span><select data-v2-organic-depth><option value="100">Quick · 100</option><option value="500" selected>Standard · 500</option><option value="1000">Deep · 1000</option></select></label>
      <button type="submit" data-v2-organic-run>Analyze Organic Keywords</button>
      <label class="v2-organic-paid"><input type="checkbox" data-v2-organic-allow-paid><span>无兼容缓存时，允许本次付费请求</span></label>
    </form>
    <div class="v2-organic-status" data-v2-organic-status role="status">输入目标后先检查缓存；未勾选付费确认时不会调用 DataForSEO。</div>
    <div class="v2-organic-tabs" role="tablist" aria-label="Organic Intelligence views">
      <button type="button" class="active" role="tab" aria-selected="true" data-v2-organic-tab="overview">Overview</button>
      <button type="button" role="tab" aria-selected="false" data-v2-organic-tab="keywords">Organic Keywords</button>
      <button type="button" role="tab" aria-selected="false" data-v2-organic-tab="pages">Top Pages</button>
    </div>
    <div class="v2-organic-panel active" data-v2-organic-panel="overview">
      <div class="v2-organic-metrics">
        <article><span>Organic Keywords</span><b data-v2-organic-metric="keywords">—</b></article>
        <article><span>Organic Traffic</span><b data-v2-organic-metric="traffic">—</b></article>
        <article><span>Traffic Value</span><b data-v2-organic-metric="value">—</b></article>
        <article><span>Top 3</span><b data-v2-organic-metric="top3">—</b></article>
        <article><span>Top 10</span><b data-v2-organic-metric="top10">—</b></article>
        <article><span>Top 20</span><b data-v2-organic-metric="top20">—</b></article>
      </div>
      <div class="v2-organic-summary" data-v2-organic-summary>尚未加载 Organic Intelligence。</div>
    </div>
    <div class="v2-organic-panel" data-v2-organic-panel="keywords" hidden>
      <div class="v2-organic-filterbar">
        <input type="search" placeholder="搜索关键词或 Ranking URL" data-v2-organic-filter="query">
        <select data-v2-organic-filter="position"><option value="">All positions</option><option value="top3">Top 3</option><option value="4-10">4–10</option><option value="11-20">11–20</option><option value="21-50">21–50</option><option value="51-100">51–100</option></select>
        <select data-v2-organic-filter="movement"><option value="">All movement</option><option value="new">New</option><option value="up">Improved</option><option value="down">Declined</option><option value="lost">Lost</option><option value="stable">Stable</option></select>
        <select data-v2-organic-filter="intent"><option value="">All intent</option><option value="informational">Informational</option><option value="commercial">Commercial</option><option value="transactional">Transactional</option><option value="navigational">Navigational</option></select>
        <input type="number" min="0" step="1" placeholder="Min volume" data-v2-organic-filter="minVolume">
        <input type="number" min="0" max="100" step="1" placeholder="Max KD" data-v2-organic-filter="maxKd">
        <select data-v2-organic-filter="action"><option value="">All actions</option><option value="protect">Protect</option><option value="quick_win">Quick Win</option><option value="recover">Recover</option><option value="reclaim">Reclaim</option><option value="improve">Improve</option><option value="monitor">Monitor</option><option value="study_winner">Study Winner</option><option value="study_gain">Study Gain</option><option value="competitor_weakness">Competitor Weakness</option><option value="gap_opportunity">Gap Opportunity</option><option value="study">Study</option></select>
      </div>
      <div class="v2-organic-table-shell">
        <table class="v2-organic-table"><thead><tr><th>Keyword</th><th>Intent</th><th>Position</th><th>Movement</th><th>Traffic</th><th>Volume</th><th>KD</th><th>CPC</th><th>Ranking URL</th><th>SERP Features</th><th>Action</th></tr></thead>
          <tbody data-v2-organic-body><tr><td colspan="11" class="v2-organic-empty">尚未加载关键词。</td></tr></tbody>
        </table>
      </div>
      <div class="v2-organic-pager"><span data-v2-organic-count>0 rows</span><div><button type="button" data-v2-organic-prev>Previous</button><span data-v2-organic-page>Page 1</span><button type="button" data-v2-organic-next>Next</button></div></div>
    </div>
    <div class="v2-organic-panel" data-v2-organic-panel="pages" hidden>
      <div class="v2-organic-pages-head">
        <div><b>Top Pages</b><span>按 Organic Traffic 查看最重要的页面；点击关键词数量可直接进入该页面的 Organic Keywords。</span></div>
        <button type="button" data-v2-organic-pages-run>Load Top Pages</button>
      </div>
      <div class="v2-organic-pages-filters">
        <input type="search" placeholder="Filter URL" data-v2-organic-pages-filter="query">
        <select data-v2-organic-pages-filter="action">
          <option value="">All page actions</option>
          <option value="protect">Protect</option>
          <option value="growing">Growing</option>
          <option value="at_risk">At Risk</option>
          <option value="reclaim">Reclaim</option>
          <option value="improve">Improve</option>
          <option value="monitor">Monitor</option>
          <option value="study_winner">Study Winner</option>
          <option value="study_gain">Study Gain</option>
          <option value="competitor_weakness">Competitor Weakness</option>
          <option value="study">Study</option>
        </select>
      </div>
      <div class="v2-organic-table-shell">
        <table class="v2-organic-table v2-organic-pages-table">
          <thead><tr><th>Page</th><th>Traffic</th><th>Keywords</th><th>Top 3</th><th>Top 10</th><th>Top 20</th><th>New</th><th>Up</th><th>Down</th><th>Lost</th><th>Action</th></tr></thead>
          <tbody data-v2-organic-pages-body><tr><td colspan="11" class="v2-organic-empty">尚未加载 Top Pages。</td></tr></tbody>
        </table>
      </div>
      <div class="v2-organic-pager"><span data-v2-organic-pages-count>0 rows</span><div><button type="button" data-v2-organic-pages-prev>Previous</button><span data-v2-organic-pages-page>Page 1</span><button type="button" data-v2-organic-pages-next>Next</button></div></div>
    </div>
  `;
  return section;
}

function activateTab(section, tabId) {
  section.querySelectorAll("[data-v2-organic-tab]").forEach((button) => {
    const active = button.dataset.v2OrganicTab === tabId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  section.querySelectorAll("[data-v2-organic-panel]").forEach((panel) => {
    const active = panel.dataset.v2OrganicPanel === tabId;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
}

function setStatus(section, message, state = "info") {
  const status = section.querySelector("[data-v2-organic-status]");
  status.textContent = message;
  status.dataset.state = state;
}

function filtersFrom(section) {
  return Object.fromEntries([...section.querySelectorAll("[data-v2-organic-filter]")].map((field) => [field.dataset.v2OrganicFilter, field.value]));
}

function movementText(row) {
  const movement = formatOrganicMovement(row);
  if (movement.delta === null || movement.delta === 0) return movement.label;
  return movement.delta > 0 ? movement.label + " +" + movement.delta : movement.label + " " + movement.delta;
}

function featureText(features) {
  const rows = Array.isArray(features) ? features : [];
  if (!rows.length) return "—";
  const shown = rows.slice(0, 3).map((value) => value.replaceAll("_", " "));
  return shown.join(" · ") + (rows.length > 3 ? " +" + (rows.length - 3) : "");
}

export function mountOrganicIntelligence({ root, context, fetchImpl = globalThis.fetch, locationLike = globalThis.location } = {}) {
  const section = root?.querySelector?.(".v2-organic-workspace");
  if (!section || typeof fetchImpl !== "function") return () => {};

  const form = section.querySelector("[data-v2-organic-form]");
  const target = section.querySelector("[data-v2-organic-target]");
  const depth = section.querySelector("[data-v2-organic-depth]");
  const allowPaid = section.querySelector("[data-v2-organic-allow-paid]");
  const run = section.querySelector("[data-v2-organic-run]");
  const body = section.querySelector("[data-v2-organic-body]");
  const previous = section.querySelector("[data-v2-organic-prev]");
  const next = section.querySelector("[data-v2-organic-next]");
  const pageLabel = section.querySelector("[data-v2-organic-page]");
  const countLabel = section.querySelector("[data-v2-organic-count]");
  const modeBadge = section.querySelector("[data-v2-organic-mode]");
  const pagesRun = section.querySelector("[data-v2-organic-pages-run]");
  const pagesBody = section.querySelector("[data-v2-organic-pages-body]");
  const pagesPrevious = section.querySelector("[data-v2-organic-pages-prev]");
  const pagesNext = section.querySelector("[data-v2-organic-pages-next]");
  const pagesPageLabel = section.querySelector("[data-v2-organic-pages-page]");
  const pagesCountLabel = section.querySelector("[data-v2-organic-pages-count]");
  const controller = new AbortController();
  const signal = controller.signal;
  let rows = [];
  let pageRows = [];
  let page = 1;
  let pagesPage = 1;
  let targetDirty = false;

  const currentMode = () => organicTargetMode(target.value, context?.get?.()?.domain);
  const syncMode = () => {
    const mode = currentMode();
    modeBadge.textContent = mode === "own" ? "OWN SITE" : "COMPETITOR RESEARCH";
    modeBadge.dataset.mode = mode;
    return mode;
  };

  const renderTable = () => {
    const mode = syncMode();
    const filtered = filterOrganicKeywordRows(rows, filtersFrom(section), mode);
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    body.replaceChildren();
    if (!visible.length) {
      const row = document.createElement("tr"), cell = document.createElement("td");
      cell.colSpan = 11; cell.className = "v2-organic-empty"; cell.textContent = rows.length ? "当前筛选条件下没有关键词。" : "尚未加载关键词。"; row.append(cell); body.append(row);
    } else {
      visible.forEach((item) => {
        const row = document.createElement("tr");
        const keywordCell = document.createElement("td"), keywordButton = document.createElement("button");
        keywordButton.type = "button"; keywordButton.className = "v2-organic-keyword"; keywordButton.textContent = item.keyword || "—"; keywordButton.dataset.v2OrganicKeyword = item.keyword || ""; keywordCell.append(keywordButton);
        const intentCell = document.createElement("td"); intentCell.textContent = item.intent?.primary || "—";
        const positionCell = document.createElement("td"); positionCell.textContent = number(item.position);
        const movementCell = document.createElement("td"), movement = formatOrganicMovement(item); movementCell.textContent = movementText(item); movementCell.dataset.movement = movement.code;
        const trafficCell = document.createElement("td"); trafficCell.textContent = number(item.estimated_traffic);
        const volumeCell = document.createElement("td"); volumeCell.textContent = number(item.search_volume);
        const kdCell = document.createElement("td"); kdCell.textContent = number(item.keyword_difficulty);
        const cpcCell = document.createElement("td"); cpcCell.textContent = money(item.cpc_usd);
        const urlCell = document.createElement("td");
        if (item.ranking_url) { const link = document.createElement("a"); link.href = item.ranking_url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.className = "v2-organic-url"; link.textContent = item.relative_url || item.ranking_url; urlCell.append(link); } else urlCell.textContent = "—";
        const featuresCell = document.createElement("td"); featuresCell.className = "v2-organic-features"; featuresCell.textContent = featureText(item.serp_features);
        const actionCell = document.createElement("td"), action = classifyOrganicKeywordAction(item, { mode }), badge = document.createElement("span"); badge.className = "v2-organic-action"; badge.dataset.action = action.code; badge.textContent = action.label; badge.title = action.reason; actionCell.append(badge);
        row.append(keywordCell, intentCell, positionCell, movementCell, trafficCell, volumeCell, kdCell, cpcCell, urlCell, featuresCell, actionCell); body.append(row);
      });
    }
    countLabel.textContent = filtered.length + " / " + rows.length + " rows";
    pageLabel.textContent = "Page " + page + " / " + totalPages;
    previous.disabled = page <= 1; next.disabled = page >= totalPages;
  };

  const renderPages = () => {
    const mode = syncMode();
    const filters = Object.fromEntries([...section.querySelectorAll("[data-v2-organic-pages-filter]")].map((field) => [field.dataset.v2OrganicPagesFilter, field.value]));
    const filtered = filterOrganicPageRows(pageRows, filters, mode);
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (pagesPage > totalPages) pagesPage = totalPages;
    const visible = filtered.slice((pagesPage - 1) * PAGE_SIZE, pagesPage * PAGE_SIZE);
    pagesBody.replaceChildren();
    if (!visible.length) {
      const row = document.createElement("tr"), cell = document.createElement("td");
      cell.colSpan = 11; cell.className = "v2-organic-empty"; cell.textContent = pageRows.length ? "当前筛选条件下没有页面。" : "尚未加载 Top Pages。"; row.append(cell); pagesBody.append(row);
    } else {
      visible.forEach((item) => {
        const row = document.createElement("tr");
        const pageCell = document.createElement("td"), link = document.createElement("a");
        link.href = item.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.className = "v2-organic-url v2-organic-page-url"; link.textContent = item.relative_url || item.url; pageCell.append(link);
        const trafficCell = document.createElement("td"); trafficCell.textContent = number(item.organic_traffic);
        const keywordsCell = document.createElement("td"), keywordsButton = document.createElement("button");
        keywordsButton.type = "button"; keywordsButton.className = "v2-organic-page-keywords"; keywordsButton.dataset.v2OrganicPageUrl = item.url; keywordsButton.textContent = number(item.organic_keywords); keywordsButton.title = "查看这个页面排名的 Organic Keywords"; keywordsCell.append(keywordsButton);
        const positions = item.positions ?? {}, changes = item.changes ?? {};
        const cells = [positions.top_3, positions.top_10, positions.top_20, changes.new, changes.up, changes.down, changes.lost].map((value) => { const cell = document.createElement("td"); cell.textContent = number(value); return cell; });
        const actionCell = document.createElement("td"), action = classifyOrganicPageAction(item, { mode }), badge = document.createElement("span");
        badge.className = "v2-organic-action"; badge.dataset.action = action.code; badge.textContent = action.label; badge.title = action.reason; actionCell.append(badge);
        row.append(pageCell, trafficCell, keywordsCell, ...cells, actionCell); pagesBody.append(row);
      });
    }
    pagesCountLabel.textContent = filtered.length + " / " + pageRows.length + " rows";
    pagesPageLabel.textContent = "Page " + pagesPage + " / " + totalPages;
    pagesPrevious.disabled = pagesPage <= 1; pagesNext.disabled = pagesPage >= totalPages;
  };

  const renderOverview = (data, meta) => {
    const organic = data?.organic ?? {}, positions = organic.positions ?? {};
    const values = { keywords:number(organic.ranked_keywords), traffic:number(organic.estimated_monthly_traffic), value:money(organic.estimated_paid_traffic_cost_usd), top3:number(positions.top_3), top10:number(positions.top_10), top20:number(positions.top_20) };
    Object.entries(values).forEach(([key,value]) => { const element = section.querySelector('[data-v2-organic-metric="' + key + '"]'); if (element) element.textContent = value; });
    const source = meta?.cached ? "7-day cache" : "DataForSEO live";
    const update = data?.update_window?.last_updated_at ? " · SERP updated " + new Date(data.update_window.last_updated_at).toLocaleDateString("zh-CN") : "";
    section.querySelector("[data-v2-organic-summary]").textContent = [data?.target, source, "Depth " + (meta?.cached_from_depth ?? data?.depth ?? "—"), "Returned " + (data?.returned_count ?? rows.length), "Total " + (data?.total_count ?? "—")].filter(Boolean).join(" · ") + update;
  };

  const loadPages = async () => {
    const market = context?.get?.();
    const domain = hostnameForTarget(target.value);
    if (!market?.location_code || !market?.language_code || !domain) return;
    pagesRun.disabled = true; setStatus(section, "正在检查 Top Pages 的兼容 7 天缓存…", "info");
    try {
      const response = await fetchImpl(PAGES_ENDPOINT, { method:"POST", headers:{"content-type":"application/json",accept:"application/json"}, body:JSON.stringify({ target:domain, depth:Number(depth.value), location_code:market.location_code, language_code:market.language_code, allow_live_request:allowPaid.checked }) });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 && payload?.error?.code === "LIVE_REQUEST_CONFIRMATION_REQUIRED") { setStatus(section, "当前域名没有兼容 Top Pages 缓存。勾选“允许本次付费请求”后再次加载，才会调用 DataForSEO。", "warning"); return; }
      if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || "Top Pages 查询失败");
      pageRows = Array.isArray(payload.data?.items) ? payload.data.items : []; pagesPage = 1; allowPaid.checked = false; renderPages(); activateTab(section,"pages");
      setStatus(section, payload.meta?.cached ? "Top Pages 已读取：缓存命中，本次费用 $0。" : "Top Pages 已更新：实际 API 费用已记录，结果缓存 7 天。", "success");
    } catch (error) { setStatus(section,error?.message || "Top Pages 查询失败","error"); }
    finally { pagesRun.disabled = false; }
  };

  const load = async () => {
    const market = context?.get?.();
    if (!market?.location_code || !market?.language_code || !target.value.trim()) return;
    run.disabled = true; setStatus(section, "正在检查兼容的 7 天缓存…", "info");
    try {
      const response = await fetchImpl(ENDPOINT, { method:"POST", headers:{"content-type":"application/json",accept:"application/json"}, body:JSON.stringify({ target:target.value.trim(), depth:Number(depth.value), location_code:market.location_code, language_code:market.language_code, allow_live_request:allowPaid.checked }) });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 && payload?.error?.code === "LIVE_REQUEST_CONFIRMATION_REQUIRED") { setStatus(section, "当前目标没有兼容缓存。勾选“允许本次付费请求”后再次分析，才会调用 DataForSEO。", "warning"); return; }
      if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || "Organic Keywords 查询失败");
      rows = Array.isArray(payload.data?.items) ? payload.data.items : []; page = 1; allowPaid.checked = false; renderOverview(payload.data,payload.meta); renderTable(); activateTab(section,"keywords");
      setStatus(section, payload.meta?.cached ? "Organic Keywords 已读取：缓存命中，本次费用 $0。" : "Organic Keywords 已更新：实际 API 费用已记录，结果缓存 7 天。", "success");
    } catch (error) { setStatus(section,error?.message || "Organic Keywords 查询失败","error"); }
    finally { run.disabled = false; }
  };

  form.addEventListener("submit",(event)=>{event.preventDefault();load();},{signal});
  target.addEventListener("input",()=>{targetDirty=true;syncMode();},{signal});
  section.querySelectorAll("[data-v2-organic-tab]").forEach((button)=>button.addEventListener("click",()=>activateTab(section,button.dataset.v2OrganicTab),{signal}));
  section.querySelectorAll("[data-v2-organic-filter]").forEach((field)=>field.addEventListener(field.tagName==="INPUT"?"input":"change",()=>{page=1;renderTable();},{signal}));
  section.querySelectorAll("[data-v2-organic-pages-filter]").forEach((field)=>field.addEventListener(field.tagName==="INPUT"?"input":"change",()=>{pagesPage=1;renderPages();},{signal}));
  pagesRun.addEventListener("click",loadPages,{signal});
  pagesPrevious.addEventListener("click",()=>{if(pagesPage>1){pagesPage-=1;renderPages();}},{signal});
  pagesNext.addEventListener("click",()=>{pagesPage+=1;renderPages();},{signal});
  pagesBody.addEventListener("click",(event)=>{const button=event.target.closest("[data-v2-organic-page-url]");if(!button)return;target.value=button.dataset.v2OrganicPageUrl;targetDirty=true;syncMode();activateTab(section,"keywords");load();},{signal});
  previous.addEventListener("click",()=>{if(page>1){page-=1;renderTable();}},{signal});
  next.addEventListener("click",()=>{page+=1;renderTable();},{signal});
  body.addEventListener("click",(event)=>{const button=event.target.closest("[data-v2-organic-keyword]");if(!button)return;const input=root.querySelector("#keyword");if(input){input.value=button.dataset.v2OrganicKeyword;input.dispatchEvent(new Event("input",{bubbles:true}));}if(locationLike)locationLike.hash="keywords";},{signal});

  const unsubscribe = context?.subscribe?.((market)=>{if(!targetDirty || !target.value.trim()){target.value=market?.domain || "";targetDirty=false;}syncMode();}) ?? (()=>{});
  renderTable();
  renderPages();
  return ()=>{unsubscribe();controller.abort();};
}
