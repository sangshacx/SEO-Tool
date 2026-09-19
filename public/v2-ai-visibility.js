const ENDPOINTS = Object.freeze({
  overview: "/api/v2/ai/visibility",
  compare: "/api/v2/ai/compare",
  pages: "/api/v2/ai/pages",
  history: "/api/v2/ai/history",
  mentions: "/api/v2/ai/mentions",
  promptModels: "/api/v2/ai/prompt-models",
  promptTest: "/api/v2/ai/prompt-test",
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

export function pickDefaultPromptModel(models = [], platform = "chat_gpt") {
  const items = Array.isArray(models) ? models.filter((item) => item?.model_name) : [];
  if (!items.length) return null;
  const preferred = {
    chat_gpt: ["mini", "nano"],
    claude: ["haiku", "sonnet"],
    gemini: ["flash", "lite"],
    perplexity: ["sonar"],
  }[platform] ?? [];
  for (const token of preferred) {
    const match = items.find((item) =>
      String(item.model_name).toLowerCase().includes(token) &&
      item.reasoning !== true
    );
    if (match) return match;
  }
  return items.find((item) => item.reasoning !== true) ?? items[0];
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

function renderHistory(body, historical = [], newLost = []) {
  body.replaceChildren();
  const historyMap = new Map((Array.isArray(historical) ? historical : []).map((row) => [String(row.period).slice(0, 7), row]));
  const changeMap = new Map((Array.isArray(newLost) ? newLost : []).map((row) => [String(row.date).slice(0, 7), row]));
  const periods = [...new Set([...historyMap.keys(), ...changeMap.keys()])].sort().reverse();
  if (!periods.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "v2-ai-empty";
    cell.textContent = "D1 还没有 AI Visibility 历史。可分别回填 Historical 和 New/Lost。";
    row.append(cell);
    body.append(row);
    return;
  }
  periods.forEach((period) => {
    const history = historyMap.get(period) ?? {};
    const change = changeMap.get(period) ?? {};
    const row = document.createElement("tr");
    [
      period,
      numberLabel(history.mentions),
      numberLabel(history.ai_search_volume),
      numberLabel(change.new_mentions),
      numberLabel(change.lost_mentions),
      numberLabel(change.net_mentions),
      numberLabel(change.net_ai_search_volume),
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    });
    body.append(row);
  });
}

function citationDateLabel(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString("zh-CN");
}

function renderCitationExplorer(node, rows = []) {
  node.replaceChildren();
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "v2-ai-citation-empty v2-ai-empty";
    empty.textContent = "暂无 Citation Explorer 缓存。读取缓存不会产生费用；只有明确点击付费刷新才会调用 DataForSEO。";
    node.append(empty);
    return;
  }

  items.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "v2-ai-citation-card";

    const head = document.createElement("div");
    head.className = "v2-ai-citation-head";
    const titleWrap = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.textContent = "#" + (index + 1) + " · " + (item?.model_name || item?.platform || "AI response");
    const title = document.createElement("h4");
    title.textContent = item?.question || "AI question unavailable";
    titleWrap.append(eyebrow, title);

    const demand = document.createElement("div");
    demand.className = "v2-ai-citation-demand";
    const demandLabel = document.createElement("span");
    demandLabel.textContent = "AI Search Volume";
    const demandValue = document.createElement("b");
    demandValue.textContent = numberLabel(item?.ai_search_volume);
    demand.append(demandLabel, demandValue);
    head.append(titleWrap, demand);

    const meta = document.createElement("div");
    meta.className = "v2-ai-citation-meta";
    [
      "Target citations " + numberLabel(item?.target_source_count),
      "First " + citationDateLabel(item?.first_response_at),
      "Last " + citationDateLabel(item?.last_response_at),
      item?.is_web_search_based === true ? "Web-search based" : null,
    ].filter(Boolean).forEach((value) => {
      const chip = document.createElement("span");
      chip.textContent = value;
      meta.append(chip);
    });

    const answer = document.createElement("p");
    answer.className = "v2-ai-citation-answer";
    answer.textContent = item?.answer_excerpt || "No bounded answer excerpt was returned.";

    const sourceWrap = document.createElement("div");
    sourceWrap.className = "v2-ai-citation-sources";
    const sourceTitle = document.createElement("b");
    sourceTitle.textContent = "Cited sources";
    const sourceList = document.createElement("ul");
    const sources = Array.isArray(item?.sources) ? item.sources.slice(0, 8) : [];
    if (!sources.length) {
      const sourceItem = document.createElement("li");
      sourceItem.className = "v2-ai-empty";
      sourceItem.textContent = "No source rows returned.";
      sourceList.append(sourceItem);
    } else {
      sources.forEach((source) => {
        const sourceItem = document.createElement("li");
        const sourceTop = document.createElement("div");
        const sourceLink = document.createElement(source?.url ? "a" : "span");
        if (source?.url) {
          sourceLink.href = source.url;
          sourceLink.target = "_blank";
          sourceLink.rel = "noopener noreferrer";
        }
        sourceLink.textContent = source?.title || source?.domain || "Source";
        const sourceDomain = document.createElement("small");
        sourceDomain.textContent = [source?.domain, source?.rank != null ? "rank " + source.rank : null].filter(Boolean).join(" · ");
        sourceTop.append(sourceLink, sourceDomain);
        const snippet = document.createElement("p");
        snippet.textContent = source?.snippet || "";
        sourceItem.append(sourceTop);
        if (source?.snippet) sourceItem.append(snippet);
        sourceList.append(sourceItem);
      });
    }
    sourceWrap.append(sourceTitle, sourceList);

    const extras = document.createElement("div");
    extras.className = "v2-ai-citation-extras";
    const brands = (Array.isArray(item?.brand_entities) ? item.brand_entities : [])
      .map((row) => row?.title)
      .filter(Boolean)
      .slice(0, 6);
    const fanOut = (Array.isArray(item?.fan_out_queries) ? item.fan_out_queries : []).slice(0, 6);
    if (brands.length) {
      const brandsText = document.createElement("p");
      brandsText.textContent = "Brand entities: " + brands.join(" · ");
      extras.append(brandsText);
    }
    if (fanOut.length) {
      const fanText = document.createElement("p");
      fanText.textContent = "Fan-out queries: " + fanOut.join(" · ");
      extras.append(fanText);
    }

    card.append(head, meta, answer, sourceWrap);
    if (extras.childNodes.length) card.append(extras);
    node.append(card);
  });
}

function boolLabel(value) {
  if (value === true) return "YES";
  if (value === false) return "NO";
  return "—";
}

function usdLabel(value) {
  const number = Number(value);
  return Number.isFinite(number) ? "$" + number.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") : "—";
}

function renderPromptTestResult(section, data = null, meta = {}) {
  const result = section.querySelector("[data-v2-ai-prompt-result]");
  const answer = section.querySelector("[data-v2-ai-prompt-answer]");
  const citations = section.querySelector("[data-v2-ai-prompt-citations]");
  const fanOut = section.querySelector("[data-v2-ai-prompt-fanout]");
  if (!result || !answer || !citations || !fanOut) return;

  if (!data) {
    result.hidden = true;
    answer.textContent = "";
    citations.replaceChildren();
    fanOut.replaceChildren();
    return;
  }

  result.hidden = false;
  setText(section.querySelector("[data-v2-ai-prompt-result-model]"), data.model_name);
  setText(section.querySelector("[data-v2-ai-prompt-result-mentioned]"), boolLabel(data.target_domain_mentioned));
  setText(section.querySelector("[data-v2-ai-prompt-result-cited]"), boolLabel(data.target_domain_cited));
  setText(section.querySelector("[data-v2-ai-prompt-result-cost]"), meta?.cached ? "$0" : usdLabel(meta?.actual_cost_usd));
  setText(section.querySelector("[data-v2-ai-prompt-result-tokens]"),
    [numberLabel(data.input_tokens), numberLabel(data.output_tokens)].join(" / ")
  );
  setText(section.querySelector("[data-v2-ai-prompt-result-web]"), data.web_search === true ? "Used" : data.web_search === false ? "Not used" : "—");

  answer.textContent = data.answer || "No answer text returned.";

  citations.replaceChildren();
  const rows = Array.isArray(data.annotations) ? data.annotations : [];
  if (!rows.length) {
    const empty = document.createElement("li");
    empty.className = "v2-ai-empty";
    empty.textContent = "No citation annotations returned.";
    citations.append(empty);
  } else {
    rows.forEach((row) => {
      const item = document.createElement("li");
      const link = document.createElement(row?.url ? "a" : "span");
      if (row?.url) {
        link.href = row.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      link.textContent = row?.title || row?.domain || row?.url || "Citation";
      const domain = document.createElement("small");
      domain.textContent = row?.domain || "";
      item.append(link, domain);
      if (row?.text) {
        const excerpt = document.createElement("p");
        excerpt.textContent = row.text;
        item.append(excerpt);
      }
      citations.append(item);
    });
  }

  fanOut.replaceChildren();
  const queries = Array.isArray(data.fan_out_queries) ? data.fan_out_queries : [];
  queries.forEach((value) => {
    const chip = document.createElement("span");
    chip.textContent = value;
    fanOut.append(chip);
  });
  fanOut.hidden = queries.length === 0;
}

async function getJson(fetchImpl, endpoint, params) {
  const query = new URLSearchParams(params);
  const response = await fetchImpl(endpoint + "?" + query.toString(), {
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
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
        <div><span>HISTORY · D1</span><h3>AI Visibility History & New/Lost</h3></div>
        <div class="v2-ai-actions">
          <select data-v2-ai-history-months aria-label="AI Visibility 历史范围">
            <option value="6">6 months</option>
            <option value="12" selected>12 months</option>
            <option value="0">All available</option>
          </select>
          <button type="button" class="secondary-action" data-v2-ai-read-history>读取 D1 · $0</button>
          <button type="button" data-v2-ai-refresh-history>回填 Historical</button>
          <button type="button" data-v2-ai-refresh-new-lost>回填 New/Lost</button>
        </div>
      </div>
      <div class="v2-ai-history-note">
        D1 读取始终 $0。Historical 与 New/Lost 是两个独立的 DataForSEO 付费请求，只会在勾选上方 Cost Guard 后执行。
      </div>
      <div class="v2-ai-tablewrap">
        <table>
          <thead><tr><th>Month</th><th>Mentions</th><th>AI Search Volume</th><th>New</th><th>Lost</th><th>Net Mentions</th><th>Net AI SV</th></tr></thead>
          <tbody data-v2-ai-history-body></tbody>
        </table>
      </div>
    </section>

    <section class="v2-ai-panel v2-ai-prompt-tracker">
      <div class="v2-ai-panel-head">
        <div>
          <span>CUSTOM PROMPT TRACKER</span>
          <h3>Single Prompt Test</h3>
        </div>
        <div class="v2-ai-prompt-free-label">Models list · $0</div>
      </div>
      <div class="v2-ai-prompt-form">
        <label>AI 平台
          <select data-v2-ai-prompt-platform>
            <option value="chat_gpt">ChatGPT</option>
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
            <option value="perplexity">Perplexity</option>
          </select>
        </label>
        <label>模型
          <select data-v2-ai-prompt-model>
            <option value="">正在读取免费模型列表…</option>
          </select>
        </label>
        <label class="v2-ai-prompt-web">
          <span>Web Search</span>
          <span class="v2-ai-prompt-toggle"><input type="checkbox" data-v2-ai-prompt-web-search checked> 启用网页搜索 / citations</span>
          <small data-v2-ai-prompt-web-note>模型支持时启用。</small>
        </label>
        <label class="v2-ai-prompt-input">Prompt
          <textarea maxlength="500" data-v2-ai-prompt-text placeholder="例如：Which companies are reliable manufacturers of waterproof membranes for commercial roofing projects?"></textarea>
          <small><span data-v2-ai-prompt-count>0</span>/500 · Prompt 使用你输入的语言；当前市场用于可支持模型的 web-search 国家定位。</small>
        </label>
        <div class="v2-ai-prompt-buttons">
          <button type="button" class="secondary-action" data-v2-ai-prompt-read-cache>读取相同 Prompt 缓存 · $0</button>
          <button type="button" data-v2-ai-prompt-run>运行 Prompt Test · 付费</button>
        </div>
      </div>
      <div class="v2-ai-prompt-guidance">
        第一版只运行单个 Prompt，不自动批量或定时执行。模型列表免费；真实 Prompt Test 使用 LLM Responses Live，成本取决于模型与 token 使用。
      </div>
      <div class="v2-ai-prompt-result" data-v2-ai-prompt-result hidden>
        <div class="v2-ai-prompt-metrics">
          <article><span>Model</span><b data-v2-ai-prompt-result-model>—</b></article>
          <article><span>Domain Mentioned</span><b data-v2-ai-prompt-result-mentioned>—</b></article>
          <article><span>Domain Cited</span><b data-v2-ai-prompt-result-cited>—</b></article>
          <article><span>Actual Cost</span><b data-v2-ai-prompt-result-cost>—</b></article>
          <article><span>Input / Output Tokens</span><b data-v2-ai-prompt-result-tokens>—</b></article>
          <article><span>Web Search</span><b data-v2-ai-prompt-result-web>—</b></article>
        </div>
        <div class="v2-ai-prompt-output">
          <div>
            <span class="v2-ai-subhead">AI answer</span>
            <pre data-v2-ai-prompt-answer></pre>
          </div>
          <div>
            <span class="v2-ai-subhead">Citations</span>
            <ul data-v2-ai-prompt-citations></ul>
          </div>
        </div>
        <div class="v2-ai-prompt-fanout" data-v2-ai-prompt-fanout hidden></div>
        <p class="v2-ai-prompt-disclaimer">这是单次模型观察，回答可能随时间、模型和检索结果变化；不会保存或展示 reasoning 内容。</p>
      </div>
    </section>

    <section class="v2-ai-panel">
      <div class="v2-ai-panel-head">
        <div>
          <span>CITATION EXPLORER</span>
          <h3>Questions, Answers & Cited Sources</h3>
        </div>
        <div class="v2-ai-actions">
          <select data-v2-ai-mention-limit aria-label="Citation Explorer 数量">
            <option value="10">Top 10</option>
            <option value="25" selected>Top 25</option>
            <option value="50">Top 50</option>
          </select>
          <button type="button" class="secondary-action" data-v2-ai-read-mentions>读取 Citation 缓存</button>
          <button type="button" data-v2-ai-refresh-mentions>付费刷新</button>
        </div>
      </div>
      <div class="v2-ai-citation-note">
        这里只显示“当前网站被 AI 回答引用为 source”的问题与引用上下文。Answer 只缓存截断摘要，不把超长原始回答写入长期存储。
      </div>
      <div class="v2-ai-citation-list" data-v2-ai-mentions-list></div>
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
  const historyBody = section.querySelector("[data-v2-ai-history-body]");
  const historyMonths = section.querySelector("[data-v2-ai-history-months]");
  const mentionLimit = section.querySelector("[data-v2-ai-mention-limit]");
  const mentionsList = section.querySelector("[data-v2-ai-mentions-list]");
  const promptPlatform = section.querySelector("[data-v2-ai-prompt-platform]");
  const promptModel = section.querySelector("[data-v2-ai-prompt-model]");
  const promptText = section.querySelector("[data-v2-ai-prompt-text]");
  const promptCount = section.querySelector("[data-v2-ai-prompt-count]");
  const promptWebSearch = section.querySelector("[data-v2-ai-prompt-web-search]");
  const promptWebNote = section.querySelector("[data-v2-ai-prompt-web-note]");
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

  const loadStoredHistory = async () => {
    const check = availability();
    if (!check.available) return setStatus(check.message, "warning");
    busy(true);
    setStatus("正在从 D1 读取 AI Visibility 历史，本次费用 $0…", "loading");
    try {
      const { response, payload } = await getJson(fetchImpl, ENDPOINTS.history, {
        target: scope.domain ?? "",
        location_code: String(scope.location_code ?? ""),
        language_code: scope.language_code ?? "",
        platform: platform.value,
      });
      if (destroyed) return;
      if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || "AI Visibility 历史读取失败。");
      renderHistory(historyBody, payload.data?.historical, payload.data?.new_lost);
      setStatus(
        payload.data?.ready
          ? "已从 D1 读取 AI Visibility 历史，本次费用 $0。"
          : "D1 暂无 AI Visibility 历史；需要时可手动回填。",
        payload.data?.ready ? "success" : "warning",
      );
    } catch (error) {
      if (!destroyed) setStatus(error?.message || "AI Visibility 历史读取失败。", "error");
    } finally {
      if (!destroyed) busy(false);
    }
  };

  const refreshHistorySeries = async (series) => {
    if (!ensureLive()) return;
    busy(true);
    setStatus(
      series === "new_lost" ? "正在付费回填 AI New/Lost…" : "正在付费回填 AI Historical…",
      "loading",
    );
    try {
      const { response, payload } = await post(fetchImpl, ENDPOINTS.history, buildAiVisibilityBody(scope, platform.value, {
        months: Number(historyMonths.value),
        series,
        allow_live_request: true,
        force_refresh: true,
      }));
      if (destroyed) return;
      if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || "AI Visibility 历史回填失败。");
      paid.checked = false;
      await loadStoredHistory();
    } catch (error) {
      if (!destroyed) setStatus(error?.message || "AI Visibility 历史回填失败。", "error");
    } finally {
      if (!destroyed) busy(false);
    }
  };

  const loadMentions = async ({ live = false } = {}) => {
    if (live && !ensureLive()) return;
    const check = availability();
    if (!check.available) return setStatus(check.message, "warning");
    busy(true);
    setStatus(live ? "正在刷新 Citation Explorer…" : "正在读取 Citation Explorer 缓存…", "loading");
    try {
      const { response, payload } = await post(fetchImpl, ENDPOINTS.mentions, buildAiVisibilityBody(scope, platform.value, {
        limit: Number(mentionLimit.value),
        ...(live ? { allow_live_request: true, force_refresh: true } : {}),
      }));
      if (response.status === 409 && payload?.error?.code === "LIVE_REQUEST_CONFIRMATION_REQUIRED") {
        setStatus("当前深度没有 Citation Explorer 缓存。需要数据时勾选付费确认后再刷新。", "warning");
        return;
      }
      if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || "Citation Explorer 读取失败。");
      renderCitationExplorer(mentionsList, payload.data?.items);
      if (live) paid.checked = false;
      setStatus(
        payload.meta?.cached
          ? "已读取 Citation Explorer 缓存，本次费用 $0。"
          : "Citation Explorer 已刷新并写入 14 天缓存。",
        "success",
      );
    } catch (error) {
      setStatus(error?.message || "Citation Explorer 读取失败。", "error");
    } finally {
      busy(false);
    }
  };

  const syncPromptModelCapability = () => {
    const option = promptModel?.selectedOptions?.[0] ?? null;
    const supported = option?.dataset?.webSearchSupported === "true";
    if (promptPlatform.value === "perplexity") {
      promptWebSearch.checked = true;
      promptWebSearch.disabled = true;
      promptWebNote.textContent = "Perplexity Sonar 使用 web search；此开关固定开启。";
      return;
    }
    promptWebSearch.disabled = !supported;
    if (!supported) promptWebSearch.checked = false;
    promptWebNote.textContent = supported
      ? "当前模型支持 web search，可返回 citations。"
      : "当前模型不支持 web search；已自动关闭。";
  };

  const loadPromptModels = async () => {
    promptModel.disabled = true;
    promptModel.replaceChildren();
    const loading = document.createElement("option");
    loading.value = "";
    loading.textContent = "正在读取免费模型列表…";
    promptModel.append(loading);
    try {
      const { response, payload } = await getJson(fetchImpl, ENDPOINTS.promptModels, {
        platform: promptPlatform.value,
      });
      if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || "模型列表读取失败。");
      const models = Array.isArray(payload.data?.models) ? payload.data.models : [];
      promptModel.replaceChildren();
      models.forEach((model) => {
        const option = document.createElement("option");
        option.value = model.model_name;
        option.textContent = model.model_name + [
          model.reasoning ? "reasoning" : null,
          model.web_search_supported ? "web" : null,
        ].filter(Boolean).map((value) => " · " + value).join("");
        option.dataset.reasoning = String(model.reasoning === true);
        option.dataset.webSearchSupported = String(model.web_search_supported === true);
        promptModel.append(option);
      });
      const preferred = pickDefaultPromptModel(models, promptPlatform.value);
      if (preferred) promptModel.value = preferred.model_name;
      promptModel.disabled = models.length === 0;
      syncPromptModelCapability();
      if (!models.length) setStatus("当前平台没有返回可用模型。", "warning");
    } catch (error) {
      promptModel.replaceChildren();
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "模型列表不可用";
      promptModel.append(option);
      promptModel.disabled = true;
      setStatus(error?.message || "模型列表读取失败。", "error");
    }
  };

  const loadPromptTest = async ({ live = false } = {}) => {
    const prompt = String(promptText.value || "").trim();
    if (!prompt) return setStatus("先输入一个 Prompt。", "warning");
    if (!promptModel.value) return setStatus("先选择一个可用模型。", "warning");
    if (live && !paid.checked) {
      setStatus("Prompt Test 未执行：先勾选上方“允许本次付费刷新”。", "warning");
      return;
    }

    busy(true);
    setStatus(live ? "正在运行付费 Prompt Test；LLM Live 最长可能需要约 120 秒…" : "正在读取相同 Prompt 的缓存…", "loading");
    try {
      const { response, payload } = await post(fetchImpl, ENDPOINTS.promptTest, {
        target: scope.domain ?? "",
        location_code: scope.location_code,
        language_code: scope.language_code,
        platform: promptPlatform.value,
        model_name: promptModel.value,
        prompt,
        web_search: promptWebSearch.checked,
        ...(live ? { allow_live_request: true, force_refresh: true } : {}),
      });
      if (response.status === 409 && payload?.error?.code === "LIVE_REQUEST_CONFIRMATION_REQUIRED") {
        setStatus("当前没有相同 Prompt / 模型 / 市场的缓存。需要测试时勾选 Cost Guard 后运行。", "warning");
        return;
      }
      if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || "Prompt Test 失败。");
      renderPromptTestResult(section, payload.data, payload.meta);
      if (live) paid.checked = false;
      setStatus(
        payload.meta?.cached
          ? "已读取相同 Prompt 的 7 天缓存，本次费用 $0。"
          : "Prompt Test 已完成并写入 7 天缓存；实际费用已显示。",
        "success",
      );
    } catch (error) {
      setStatus(error?.message || "Prompt Test 失败。", "error");
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
    [section.querySelector("[data-v2-ai-read-history]"), "click", () => loadStoredHistory()],
    [section.querySelector("[data-v2-ai-refresh-history]"), "click", () => refreshHistorySeries("historical")],
    [section.querySelector("[data-v2-ai-refresh-new-lost]"), "click", () => refreshHistorySeries("new_lost")],
    [section.querySelector("[data-v2-ai-read-mentions]"), "click", () => loadMentions()],
    [section.querySelector("[data-v2-ai-refresh-mentions]"), "click", () => loadMentions({ live: true })],
    [section.querySelector("[data-v2-ai-prompt-read-cache]"), "click", () => loadPromptTest()],
    [section.querySelector("[data-v2-ai-prompt-run]"), "click", () => loadPromptTest({ live: true })],
    [promptPlatform, "change", () => {
      renderPromptTestResult(section, null);
      loadPromptModels();
    }],
    [promptModel, "change", () => syncPromptModelCapability()],
    [promptText, "input", () => {
      promptCount.textContent = String(promptText.value.length);
      renderPromptTestResult(section, null);
    }],
    [platform, "change", () => {
      renderComparison(compareBody, []);
      renderPages(pagesBody, []);
      renderCitationExplorer(mentionsList, []);
  renderPromptTestResult(section, null);
  loadPromptModels();
      syncScope();
      loadOverview();
      loadStoredHistory();
    }],
  ];
  listeners.forEach(([node, type, handler]) => node?.addEventListener(type, handler));

  const unsubscribe = context.subscribe((next) => {
    scope = next;
    syncScope();
    loadOverview();
    loadStoredHistory();
  });

  emptyList(section.querySelector("[data-v2-ai-sources]"), "先读取当前网站的 AI Visibility 缓存。");
  renderComparison(compareBody, []);
  renderPages(pagesBody, []);
  renderHistory(historyBody, [], []);
  renderCitationExplorer(mentionsList, []);

  return () => {
    destroyed = true;
    requestId += 1;
    unsubscribe?.();
    listeners.forEach(([node, type, handler]) => node?.removeEventListener(type, handler));
  };
}
