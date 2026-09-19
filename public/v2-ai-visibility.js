const ENDPOINTS = Object.freeze({
  overview: "/api/v2/ai/visibility",
  compare: "/api/v2/ai/compare",
  pages: "/api/v2/ai/pages",
});

function cleanDomain(value) {
  let raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  try {
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    const url = new URL(raw);
    const domain = url.hostname.replace(/^www\./, "").replace(/\.$/, "");
    return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)
      ? domain
      : null;
  } catch {
    return null;
  }
}

export function parseAiCompetitorDomains(value, ownDomain) {
  const own = cleanDomain(ownDomain);
  const tokens = String(value ?? "")
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const output = own ? [own] : [];
  const seen = new Set(output);
  for (const token of tokens) {
    const domain = cleanDomain(token);
    if (!domain) {
      const error = new Error("竞争对手域名格式无效：" + token);
      error.code = "INVALID_COMPETITOR_DOMAIN";
      throw error;
    }
    if (seen.has(domain)) continue;
    seen.add(domain);
    output.push(domain);
  }
  if (output.length < 2) {
    const error = new Error("至少填写 1 个竞争对手域名。");
    error.code = "COMPETITOR_REQUIRED";
    throw error;
  }
  if (output.length > 10) {
    const error = new Error("当前一次最多比较 10 个域名（包含自己的网站）。");
    error.code = "TOO_MANY_COMPETITORS";
    throw error;
  }
  return output;
}

export function buildAiVisibilityBody(scope, platform, fields = {}) {
  return {
    target: scope?.domain ?? "",
    location_code: scope?.location_code ?? null,
    language_code: scope?.language_code ?? "",
    platform,
    ...fields,
  };
}

export function aiPlatformAvailability(scope, platform) {
  if (platform !== "chat_gpt") return { available: true, message: "" };
  const available = Number(scope?.location_code) === 2840 && String(scope?.language_code ?? "").toLowerCase() === "en";
  return {
    available,
    message: available ? "" : "ChatGPT LLM Mentions 当前仅支持 United States / English。切换顶部市场后再读取。",
  };
}

function numberLabel(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("en-US").format(number) : "—";
}

function dateLabel(value) {
  if (!value) return "缓存时间未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

function setText(node, value) {
  if (node) node.textContent = value == null || value === "" ? "—" : String(value);
}

function emptyList(node, message) {
  if (!node) return;
  node.replaceChildren();
  const item = document.createElement("li");
  item.className = "v2-ai-empty";
  item.textContent = message;
  node.append(item);
}

function renderSourceList(node, rows = []) {
  if (!node) return;
  node.replaceChildren();
  const items = Array.isArray(rows) ? rows.slice(0, 8) : [];
  if (!items.length) return emptyList(node, "当前缓存没有 source-domain 数据。");
  items.forEach((row) => {
    const item = document.createElement("li");
    const domain = document.createElement("b");
    domain.textContent = row?.key ?? "Unknown source";
    const metrics = document.createElement("span");
    metrics.textContent = numberLabel(row?.mentions) + " mentions · AI SV " + numberLabel(row?.ai_search_volume);
    item.append(domain, metrics);
    node.append(item);
  });
}

function renderComparison(body, rows = []) {
  body.replaceChildren();
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "v2-ai-empty";
    cell.textContent = "暂无竞品 AI Visibility 数据。";
    row.append(cell);
    body.append(row);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("tr");
    const total = item?.metrics?.total ?? {};
    const sources = item?.metrics?.source_domains ?? [];
    [
      item?.target,
      numberLabel(total.mentions),
      numberLabel(total.ai_search_volume),
      sources[0]?.key ?? "—",
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value ?? "—";
      row.append(cell);
    });
    body.append(row);
  });
}

function renderPages(body, rows = []) {
  body.replaceChildren();
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "v2-ai-empty";
    cell.textContent = "暂无 Top Mentioned Pages 数据。";
    row.append(cell);
    body.append(row);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("tr");
    const page = document.createElement("td");
    const link = document.createElement("a");
    link.href = item.page;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = item.page;
    page.append(link);
    const mentions = document.createElement("td");
    mentions.textContent = numberLabel(item.mentions);
    const volume = document.createElement("td");
    volume.textContent = numberLabel(item.ai_search_volume);
    const source = document.createElement("td");
    source.textContent = item?.source_domains?.[0]?.key ?? "—";
    row.append(page, mentions, volume, source);
    body.append(row);
  });
}

async function post(fetchImpl, endpoint, body) {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

export function createAiVisibilityWorkspace() {
  const section = document.createElement("section");
  section.className = "v2-ai-visibility";
  section.dataset.v2View = "ai-visibility";
  section.innerHTML = `
    <div class="v2-ai-hero">
      <div>
        <div class="v2-ai-eyebrow">AI SEARCH VISIBILITY · PHASE 12</div>
        <h2>AI 可见度</h2>
        <p>查看网站在 Google AI Overview / ChatGPT 中的 mentions、潜在 AI 搜索需求、引用来源和竞品差距。</p>
      </div>
      <div class="v2-ai-hero-meta">
        <span>Cache First · 14d</span>
        <span>Paid Refresh Guard</span>
      </div>
    </div>

    <div class="v2-ai-toolbar">
      <label>平台
        <select data-v2-ai-platform>
          <option value="google">Google AI Overview</option>
          <option value="chat_gpt">ChatGPT</option>
        </select>
      </label>
      <div class="v2-ai-active-scope">
        <span>当前网站</span>
        <b data-v2-ai-domain>—</b>
        <small data-v2-ai-market>—</small>
      </div>
      <label class="v2-ai-cost-guard">
        <input type="checkbox" data-v2-ai-allow-paid>
        <span>允许本次付费刷新</span>
      </label>
    </div>
    <p class="v2-ai-status" data-v2-ai-status role="status"></p>

    <section class="v2-ai-panel">
      <div class="v2-ai-panel-head">
        <div><span>OVERVIEW</span><h3>Domain AI Visibility</h3></div>
        <div class="v2-ai-actions">
          <button type="button" class="secondary-action" data-v2-ai-read-overview>读取缓存</button>
          <button type="button" data-v2-ai-refresh-overview>付费刷新</button>
        </div>
      </div>
      <div class="v2-ai-metrics">
        <article><span>Mentions</span><b data-v2-ai-mentions>—</b></article>
        <article><span>AI Search Volume</span><b data-v2-ai-volume>—</b></article>
        <article><span>Platform</span><b data-v2-ai-platform-label>—</b></article>
        <article><span>Freshness</span><b data-v2-ai-freshness>—</b></article>
      </div>
      <div class="v2-ai-sources">
        <div>
          <span class="v2-ai-subhead">Top cited source domains</span>
          <ul data-v2-ai-sources></ul>
        </div>
        <div class="v2-ai-explain">
          <b>如何理解</b>
          <p>Mentions 表示 DataForSEO 观察到的 AI 搜索提及；AI Search Volume 是提供商估算指标。两者都不等于网站访问量或询盘。</p>
        </div>
      </div>
    </section>

    <section class="v2-ai-panel">
      <div class="v2-ai-panel-head">
        <div><span>COMPETITOR GAP</span><h3>AI Visibility Comparison</h3></div>
        <div class="v2-ai-actions">
          <button type="button" class="secondary-action" data-v2-ai-read-compare>读取竞品缓存</button>
          <button type="button" data-v2-ai-refresh-compare>付费刷新</button>
        </div>
      </div>
      <label class="v2-ai-competitors">竞争对手（每行一个，最多 9 个）
        <textarea data-v2-ai-competitors placeholder="competitor1.com\ncompetitor2.com"></textarea>
      </label>
      <div class="v2-ai-tablewrap">
        <table>
          <thead><tr><th>Domain</th><th>Mentions</th><th>AI Search Volume</th><th>Top Source</th></tr></thead>
          <tbody data-v2-ai-compare-body></tbody>
        </table>
      </div>
    </section>

    <section class="v2-ai-panel">
      <div class="v2-ai-panel-head">
        <div><span>CITATION INTELLIGENCE</span><h3>Top Mentioned Pages</h3></div>
        <div class="v2-ai-actions">
          <select data-v2-ai-page-limit aria-label="Top Mentioned Pages 数量">
            <option value="10">Top 10</option>
            <option value="25" selected>Top 25</option>
            <option value="50">Top 50</option>
            <option value="100">Top 100</option>
          </select>
          <button type="button" class="secondary-action" data-v2-ai-read-pages>读取页面缓存</button>
          <button type="button" data-v2-ai-refresh-pages>付费刷新</button>
        </div>
      </div>
      <div class="v2-ai-tablewrap">
        <table>
          <thead><tr><th>Page</th><th>Mentions</th><th>AI Search Volume</th><th>Top Source</th></tr></thead>
          <tbody data-v2-ai-pages-body></tbody>
        </table>
      </div>
    </section>
  `;
  return section;
}

export function mountAiVisibility({
  root,
  context,
  fetchImpl = globalThis.fetch,
} = {}) {
  const section = root?.querySelector?.(".v2-ai-visibility");
  if (!section || !context || typeof fetchImpl !== "function") return () => {};

  const platform = section.querySelector("[data-v2-ai-platform]");
  const paid = section.querySelector("[data-v2-ai-allow-paid]");
  const status = section.querySelector("[data-v2-ai-status]");
  const domain = section.querySelector("[data-v2-ai-domain]");
  const market = section.querySelector("[data-v2-ai-market]");
  const competitorInput = section.querySelector("[data-v2-ai-competitors]");
  const pageLimit = section.querySelector("[data-v2-ai-page-limit]");
  const compareBody = section.querySelector("[data-v2-ai-compare-body]");
  const pagesBody = section.querySelector("[data-v2-ai-pages-body]");
  let scope = context.get?.() ?? {};
  let requestId = 0;
  let destroyed = false;

  const buttons = [...section.querySelectorAll("button")];
  const busy = (value) => buttons.forEach((button) => { button.disabled = value; });
  const setStatus = (message, state = "") => {
    status.textContent = message;
    status.dataset.state = state;
  };

  const availability = () => aiPlatformAvailability(scope, platform.value);
  const syncScope = () => {
    setText(domain, scope?.domain);
    setText(market, [scope?.location_name, scope?.language_name].filter(Boolean).join(" · "));
    const check = availability();
    if (!check.available) setStatus(check.message, "warning");
  };

  const ensureLive = () => {
    if (!paid.checked) {
      setStatus("付费刷新未执行：先勾选“允许本次付费刷新”。", "warning");
      return false;
    }
    const check = availability();
    if (!check.available) {
      setStatus(check.message, "warning");
      return false;
    }
    return true;
  };

  const loadOverview = async ({ live = false } = {}) => {
    if (live && !ensureLive()) return;
    const check = availability();
    if (!check.available) return setStatus(check.message, "warning");
    const current = ++requestId;
    busy(true);
    setStatus(live ? "正在请求付费 AI Visibility 数据…" : "正在读取 AI Visibility 缓存…", "loading");
    try {
      const { response, payload } = await post(fetchImpl, ENDPOINTS.overview, buildAiVisibilityBody(scope, platform.value, live ? {
        allow_live_request: true,
        force_refresh: true,
      } : {}));
      if (destroyed || current !== requestId) return;
      if (response.status === 409 && payload?.error?.code === "LIVE_REQUEST_CONFIRMATION_REQUIRED") {
        setStatus("当前没有可用缓存。需要数据时勾选付费确认，再点击“付费刷新”。", "warning");
        return;
      }
      if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || "AI Visibility 读取失败。");
      const metrics = payload.data?.metrics ?? {};
      setText(section.querySelector("[data-v2-ai-mentions]"), numberLabel(metrics?.total?.mentions));
      setText(section.querySelector("[data-v2-ai-volume]"), numberLabel(metrics?.total?.ai_search_volume));
      setText(section.querySelector("[data-v2-ai-platform-label]"), payload.data?.platform === "chat_gpt" ? "ChatGPT" : "Google AI Overview");
      setText(section.querySelector("[data-v2-ai-freshness]"), dateLabel(payload.meta?.cached_at ?? payload.data?.generated_at));
      renderSourceList(section.querySelector("[data-v2-ai-sources]"), metrics?.source_domains);
      setStatus(payload.meta?.cached ? "已读取 14 天缓存，本次费用 $0。" : "AI Visibility 已刷新并写入 14 天缓存。", "success");
    } catch (error) {
      if (!destroyed && current === requestId) setStatus(error?.message || "AI Visibility 读取失败。", "error");
    } finally {
      if (!destroyed && current === requestId) busy(false);
    }
  };

  const loadComparison = async ({ live = false } = {}) => {
    if (live && !ensureLive()) return;
    const check = availability();
    if (!check.available) return setStatus(check.message, "warning");
    let targets;
    try { targets = parseAiCompetitorDomains(competitorInput.value, scope.domain); }
    catch (error) { return setStatus(error.message, "warning"); }
    busy(true);
    setStatus(live ? "正在刷新 AI 竞品对比…" : "正在读取 AI 竞品对比缓存…", "loading");
    try {
      const { response, payload } = await post(fetchImpl, ENDPOINTS.compare, {
        targets,
        location_code: scope.location_code,
        language_code: scope.language_code,
        platform: platform.value,
        ...(live ? { allow_live_request: true, force_refresh: true } : {}),
      });
      if (response.status === 409 && payload?.error?.code === "LIVE_REQUEST_CONFIRMATION_REQUIRED") {
        setStatus("这组竞品还没有缓存。勾选付费确认后再刷新。", "warning");
        return;
      }
      if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || "AI 竞品对比读取失败。");
      renderComparison(compareBody, payload.data?.items);
      setStatus(payload.meta?.cached ? "已读取竞品缓存，本次费用 $0。" : "竞品 AI Visibility 已刷新。", "success");
    } catch (error) {
      setStatus(error?.message || "AI 竞品对比读取失败。", "error");
    } finally {
      busy(false);
    }
  };

  const loadPages = async ({ live = false } = {}) => {
    if (live && !ensureLive()) return;
    const check = availability();
    if (!check.available) return setStatus(check.message, "warning");
    busy(true);
    setStatus(live ? "正在刷新 Top Mentioned Pages…" : "正在读取页面缓存…", "loading");
    try {
      const { response, payload } = await post(fetchImpl, ENDPOINTS.pages, buildAiVisibilityBody(scope, platform.value, {
        limit: Number(pageLimit.value),
        ...(live ? { allow_live_request: true, force_refresh: true } : {}),
      }));
      if (response.status === 409 && payload?.error?.code === "LIVE_REQUEST_CONFIRMATION_REQUIRED") {
        setStatus("当前深度没有页面缓存。勾选付费确认后再刷新。", "warning");
        return;
      }
      if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || "Top Mentioned Pages 读取失败。");
      renderPages(pagesBody, payload.data?.items);
      setStatus(payload.meta?.cached ? "已读取页面缓存，本次费用 $0。" : "Top Mentioned Pages 已刷新。", "success");
    } catch (error) {
      setStatus(error?.message || "Top Mentioned Pages 读取失败。", "error");
    } finally {
      busy(false);
    }
  };

  const listeners = [
    [section.querySelector("[data-v2-ai-read-overview]"), "click", () => loadOverview()],
    [section.querySelector("[data-v2-ai-refresh-overview]"), "click", () => loadOverview({ live: true })],
    [section.querySelector("[data-v2-ai-read-compare]"), "click", () => loadComparison()],
    [section.querySelector("[data-v2-ai-refresh-compare]"), "click", () => loadComparison({ live: true })],
    [section.querySelector("[data-v2-ai-read-pages]"), "click", () => loadPages()],
    [section.querySelector("[data-v2-ai-refresh-pages]"), "click", () => loadPages({ live: true })],
    [platform, "change", () => {
      renderComparison(compareBody, []);
      renderPages(pagesBody, []);
      syncScope();
      loadOverview();
    }],
  ];
  listeners.forEach(([node, type, handler]) => node?.addEventListener(type, handler));

  const unsubscribe = context.subscribe((next) => {
    scope = next;
    syncScope();
    loadOverview();
  });

  emptyList(section.querySelector("[data-v2-ai-sources]"), "先读取当前网站的 AI Visibility 缓存。");
  renderComparison(compareBody, []);
  renderPages(pagesBody, []);

  return () => {
    destroyed = true;
    requestId += 1;
    unsubscribe?.();
    listeners.forEach(([node, type, handler]) => node?.removeEventListener(type, handler));
  };
}
