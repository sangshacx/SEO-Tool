const STATUS_ENDPOINT = "/api/v2/gsc/status";
const INTELLIGENCE_ENDPOINT = "/api/v2/gsc/intelligence";
const SYNC_ENDPOINT = "/api/v2/gsc/sync";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function number(value, digits = 0) {
  const parsed = finite(value);
  return parsed === null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(parsed);
}

function percent(value) {
  const parsed = finite(value);
  return parsed === null ? "—" : (parsed * 100).toFixed(2) + "%";
}

function changePercent(value) {
  const parsed = finite(value);
  if (parsed === null) return "—";
  return (parsed > 0 ? "+" : "") + parsed.toFixed(2) + "%";
}

function hostname(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function gscCoverageLabel(coverage = {}) {
  const current = Number(coverage.current_days ?? 0);
  const requested = Number(coverage.requested_days ?? 0);
  const previous = Number(coverage.previous_days ?? 0);
  if (!requested) return "No stored coverage";
  return current + " / " + requested + " current days · " + previous + " / " + requested + " comparison days";
}

export function gscPerformancePanelMarkup() {
  return `
    <div class="v2-organic-panel" data-v2-organic-panel="gsc" hidden>
      <div class="v2-gsc-performance-head">
        <div>
          <b>GSC Performance</b>
          <span>真实 Google Search Console Clicks / Impressions / CTR / Average Position。页面打开只读 D1；只有点击 Sync 才访问 Google。</span>
        </div>
        <div class="v2-gsc-performance-actions">
          <button type="button" data-v2-gsc-performance-sync>Sync latest finalized day · $0</button>
          <button type="button" data-v2-gsc-performance-backfill>Backfill 7 missing days · $0</button>
          <button type="button" class="secondary" data-v2-gsc-performance-settings>GSC Settings</button>
        </div>
      </div>

      <div class="v2-gsc-performance-controls">
        <div class="v2-gsc-performance-tabs">
          <button type="button" class="active" data-v2-gsc-performance-view="queries">Queries</button>
          <button type="button" data-v2-gsc-performance-view="pages">Pages</button>
        </div>
        <label>Window
          <select data-v2-gsc-performance-days>
            <option value="7">7 days</option>
            <option value="28" selected>28 days</option>
            <option value="90">90 days</option>
          </select>
        </label>
      </div>

      <div class="v2-gsc-performance-status" data-v2-gsc-performance-status role="status">
        打开此 Tab 后从 D1 读取，不会自动请求 Google。
      </div>

      <div class="v2-gsc-performance-metrics">
        <article><span>Clicks</span><b data-v2-gsc-performance-metric="clicks">—</b></article>
        <article><span>Impressions</span><b data-v2-gsc-performance-metric="impressions">—</b></article>
        <article><span>CTR</span><b data-v2-gsc-performance-metric="ctr">—</b></article>
        <article><span>Avg Position</span><b data-v2-gsc-performance-metric="position">—</b></article>
        <article class="coverage"><span>Stored Coverage</span><b data-v2-gsc-performance-metric="coverage">—</b><small data-v2-gsc-performance-comparison>—</small></article>
      </div>

      <div class="v2-gsc-performance-note" data-v2-gsc-performance-note>
        Search Console 的 query/page 数据可能受 Google 内部 top-row 限制影响；SEO Pro V2 还会明确标记自身同步行数上限。
      </div>

      <div class="v2-organic-table-shell">
        <table class="v2-organic-table v2-gsc-performance-table">
          <thead data-v2-gsc-performance-head-row></thead>
          <tbody data-v2-gsc-performance-body>
            <tr><td colspan="8" class="v2-organic-empty">尚未读取 GSC 数据。</td></tr>
          </tbody>
        </table>
      </div>
      <div class="v2-organic-summary" data-v2-gsc-performance-meta>D1 only · automatic reads $0</div>

      <div class="v2-gsc-page-query-panel" data-v2-gsc-page-query-panel hidden>
        <div class="v2-gsc-page-query-head">
          <div><b>Page Queries</b><span data-v2-gsc-page-query-url>—</span></div>
          <button type="button" data-v2-gsc-page-query-close>Close</button>
        </div>
        <div class="v2-organic-table-shell">
          <table class="v2-organic-table v2-gsc-page-query-table">
            <thead><tr><th>Query</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th><th>Clicks Change</th><th>Action</th></tr></thead>
            <tbody data-v2-gsc-page-query-body></tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function jsonFetch(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: { accept: "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    const error = new Error(payload?.error?.message || "GSC request failed");
    error.code = payload?.error?.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function actionBadge(documentLike, action = {}) {
  const badge = documentLike.createElement("span");
  badge.className = "v2-organic-action";
  badge.dataset.action = action.code || "monitor";
  badge.textContent = action.label || "Monitor";
  badge.title = action.reason || "";
  return badge;
}

export function mountGscPerformanceTab({
  section,
  target,
  context,
  fetchImpl = globalThis.fetch,
  locationLike = globalThis.location,
  signal,
  activateTab,
} = {}) {
  if (!section || typeof fetchImpl !== "function") return () => {};
  const tab = section.querySelector('[data-v2-organic-tab="gsc"]');
  const sync = section.querySelector("[data-v2-gsc-performance-sync]");
  const backfill = section.querySelector("[data-v2-gsc-performance-backfill]");
  const settings = section.querySelector("[data-v2-gsc-performance-settings]");
  const days = section.querySelector("[data-v2-gsc-performance-days]");
  const status = section.querySelector("[data-v2-gsc-performance-status]");
  const body = section.querySelector("[data-v2-gsc-performance-body]");
  const head = section.querySelector("[data-v2-gsc-performance-head-row]");
  const meta = section.querySelector("[data-v2-gsc-performance-meta]");
  const note = section.querySelector("[data-v2-gsc-performance-note]");
  const viewButtons = [...section.querySelectorAll("[data-v2-gsc-performance-view]")];
  const pageQueryPanel = section.querySelector("[data-v2-gsc-page-query-panel]");
  const pageQueryUrl = section.querySelector("[data-v2-gsc-page-query-url]");
  const pageQueryBody = section.querySelector("[data-v2-gsc-page-query-body]");
  const pageQueryClose = section.querySelector("[data-v2-gsc-page-query-close]");
  let activeView = "queries";
  let loadedKey = null;
  let connection = null;

  const ownDomain = () => hostname(context?.get?.()?.domain);
  const targetDomain = () => hostname(target?.value);
  const isOwnSite = () => ownDomain() && targetDomain() === ownDomain();

  const panelStatus = (message, state = "info") => {
    status.textContent = message;
    status.dataset.state = state;
  };

  const renderHead = () => {
    head.innerHTML = activeView === "pages"
      ? "<tr><th>Page</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th><th>Clicks Change</th><th>Action</th><th>Queries</th></tr>"
      : "<tr><th>Query</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th><th>Clicks Change</th><th>Action</th></tr>";
    viewButtons.forEach((button) => button.classList.toggle("active", button.dataset.v2GscPerformanceView === activeView));
  };

  const renderMetrics = (data) => {
    const summary = data?.summary ?? {};
    const values = {
      clicks: number(summary.clicks),
      impressions: number(summary.impressions),
      ctr: percent(summary.ctr),
      position: number(summary.position, 2),
      coverage: Number(summary.current_days ?? 0) + " / " + Number(summary.requested_days ?? 0),
    };
    Object.entries(values).forEach(([key, value]) => {
      const node = section.querySelector('[data-v2-gsc-performance-metric="' + key + '"]');
      if (node) node.textContent = value;
    });
    const comparison = section.querySelector("[data-v2-gsc-performance-comparison]");
    comparison.textContent = summary.comparison_complete
      ? "Full comparison available"
      : gscCoverageLabel(data?.coverage);
  };

  const renderRows = (data) => {
    renderHead();
    body.replaceChildren();
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = activeView === "pages" ? 8 : 7;
      td.className = "v2-organic-empty";
      td.textContent = data?.latest_date
        ? "当前窗口没有可展示的 GSC 行。"
        : "尚未同步 GSC 数据。先在 Settings 连接并映射 Property，然后点击上方 Sync。";
      tr.append(td);
      body.append(tr);
      return;
    }

    rows.forEach((item) => {
      const tr = document.createElement("tr");
      const primary = document.createElement("td");
      if (activeView === "pages") {
        const link = document.createElement("a");
        link.href = item.primary_key;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "v2-organic-url v2-gsc-page-url";
        link.textContent = item.primary_key;
        primary.append(link);
      } else {
        primary.textContent = item.primary_key || "—";
        primary.className = "v2-gsc-query";
      }

      const clicks = document.createElement("td"); clicks.textContent = number(item.clicks);
      const impressions = document.createElement("td"); impressions.textContent = number(item.impressions);
      const ctr = document.createElement("td"); ctr.textContent = percent(item.ctr);
      const position = document.createElement("td"); position.textContent = number(item.position, 2);
      const change = document.createElement("td"); change.textContent = changePercent(item.change?.clicks_percent);
      change.dataset.direction = finite(item.change?.clicks_percent) === null ? "neutral" : item.change.clicks_percent > 0 ? "up" : item.change.clicks_percent < 0 ? "down" : "neutral";
      const action = document.createElement("td"); action.append(actionBadge(document, item.action));

      if (activeView === "pages") {
        const queries = document.createElement("td");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "v2-gsc-page-queries";
        button.dataset.v2GscPageQueries = item.primary_key;
        button.textContent = "View Queries";
        queries.append(button);
        tr.append(primary, clicks, impressions, ctr, position, change, action, queries);
      } else {
        tr.append(primary, clicks, impressions, ctr, position, change, action);
      }
      body.append(tr);
    });
  };

  const renderData = (data) => {
    renderMetrics(data);
    renderRows(data);
    note.textContent = data?.disclaimer || "Stored finalized Google Search Console data.";
    meta.textContent = [
      "D1 only · $0",
      data?.latest_date ? "Latest stored date " + data.latest_date : "No sync yet",
      gscCoverageLabel(data?.coverage),
      data?.summary?.comparison_complete ? "comparison complete" : "comparison partial",
    ].join(" · ");
  };

  const loadStatus = async () => {
    const payload = await jsonFetch(fetchImpl, STATUS_ENDPOINT);
    connection = payload.data;
    return connection;
  };

  const load = async ({ force = false } = {}) => {
    const domain = ownDomain();
    if (!domain) return;
    if (!isOwnSite()) {
      panelStatus("GSC Performance 只针对当前已保存网站。切回当前 Site Profile 域名后再查看。", "warning");
      body.innerHTML = '<tr><td colspan="8" class="v2-organic-empty">GSC 不用于竞争对手域名。</td></tr>';
      return;
    }
    const key = [domain, activeView, days.value].join(":");
    if (!force && loadedKey === key) return;
    panelStatus("正在从 D1 读取 GSC Performance，本次不会访问 Google…", "info");
    try {
      const current = connection ?? await loadStatus();
      const mapping = current?.mappings?.find((item) => item.site_domain === domain);
      if (!current?.connected) {
        panelStatus("Google Search Console 尚未连接。请到 GSC Settings 完成只读 OAuth。", "warning");
      } else if (!mapping) {
        panelStatus("当前网站尚未映射 Search Console Property。请到 GSC Settings 完成映射。", "warning");
      }
      const query = new URLSearchParams({
        site_domain: domain,
        view: activeView,
        days: days.value,
        limit: "100",
      });
      const payload = await jsonFetch(fetchImpl, INTELLIGENCE_ENDPOINT + "?" + query.toString());
      loadedKey = key;
      renderData(payload.data);
      if (payload.data?.latest_date) {
        panelStatus(
          payload.data.summary?.comparison_complete
            ? "GSC Performance 已从 D1 读取，完整比较窗口可用，本次费用 $0。"
            : "GSC Performance 已从 D1 读取；当前比较窗口尚未同步完整，本次费用 $0。",
          payload.data.summary?.comparison_complete ? "success" : "warning",
        );
      }
    } catch (error) {
      panelStatus(error.message || "GSC Performance 读取失败", "error");
    }
  };

  const loadPageQueries = async (pageUrl) => {
    const domain = ownDomain();
    pageQueryPanel.hidden = false;
    pageQueryUrl.textContent = pageUrl;
    pageQueryBody.innerHTML = '<tr><td colspan="7" class="v2-organic-empty">正在读取页面 Queries…</td></tr>';
    try {
      const query = new URLSearchParams({
        site_domain: domain,
        view: "query_page",
        days: days.value,
        limit: "100",
        page_url: pageUrl,
      });
      const payload = await jsonFetch(fetchImpl, INTELLIGENCE_ENDPOINT + "?" + query.toString());
      pageQueryBody.replaceChildren();
      const rows = payload.data?.rows ?? [];
      if (!rows.length) {
        pageQueryBody.innerHTML = '<tr><td colspan="7" class="v2-organic-empty">当前已存数据没有这个页面的 Query+Page 行。</td></tr>';
        return;
      }
      rows.forEach((item) => {
        const tr = document.createElement("tr");
        const values = [
          item.primary_key || "—",
          number(item.clicks),
          number(item.impressions),
          percent(item.ctr),
          number(item.position, 2),
          changePercent(item.change?.clicks_percent),
        ];
        values.forEach((value, index) => {
          const td = document.createElement("td");
          td.textContent = value;
          if (index === 0) td.className = "v2-gsc-query";
          tr.append(td);
        });
        const action = document.createElement("td");
        action.append(actionBadge(document, item.action));
        tr.append(action);
        pageQueryBody.append(tr);
      });
    } catch (error) {
      pageQueryBody.innerHTML = '<tr><td colspan="7" class="v2-organic-empty">' + (error.message || "Page Queries 读取失败") + "</td></tr>";
    }
  };

  const runSync = async (backfillDays = 1) => {
    const domain = ownDomain();
    if (!domain || !isOwnSite()) {
      panelStatus("只能同步当前 Site Profile 自己的 GSC 数据。", "warning");
      return;
    }
    sync.disabled = true;
    backfill.disabled = true;
    const multiDay = backfillDays > 1;
    panelStatus(
      multiDay
        ? "正在回填最近 7 个 finalized 日期中尚未成功同步的日期；每组最多 1,000 行，Google API 费用 $0…"
        : "正在同步 Google Search Console 最新 finalized 单日数据；Google API 费用 $0…",
      "info",
    );
    try {
      const payload = await jsonFetch(fetchImpl, SYNC_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_domain: domain,
          dimension_sets: ["query", "page", "query_page"],
          row_limit_per_set: multiDay ? 1000 : 2500,
          backfill_days: backfillDays,
        }),
      });
      loadedKey = null;
      connection = null;
      await load({ force: true });
      const truncated = payload.data?.truncated_partitions ?? [];
      const syncedDates = payload.data?.synced_dates ?? [];
      const skippedDates = payload.data?.skipped_dates ?? [];
      if (truncated.length) {
        panelStatus(
          "GSC 已同步 " + syncedDates.length + " 个日期，跳过 " + skippedDates.length +
          " 个已完成日期；" + truncated.length + " 个 date/dimension 分区达到行数上限并标记为 partial。",
          "warning",
        );
      } else if (!syncedDates.length && skippedDates.length) {
        panelStatus("所选日期都已成功同步，本次未访问 Google、未写入 D1。", "success");
      } else {
        panelStatus(
          multiDay
            ? "GSC 回填完成：同步 " + syncedDates.length + " 个日期，跳过 " + skippedDates.length + " 个已完成日期。"
            : "GSC 最新 finalized 单日数据同步完成，已写入 D1。",
          "success",
        );
      }
    } catch (error) {
      panelStatus(error.message || "GSC 同步失败", "error");
    } finally {
      sync.disabled = false;
      backfill.disabled = false;
    }
  };

  tab?.addEventListener("click", () => {
    activateTab?.(section, "gsc");
    load();
  }, { signal });
  viewButtons.forEach((button) => button.addEventListener("click", () => {
    activeView = button.dataset.v2GscPerformanceView;
    loadedKey = null;
    pageQueryPanel.hidden = true;
    load({ force: true });
  }, { signal }));
  days.addEventListener("change", () => {
    loadedKey = null;
    pageQueryPanel.hidden = true;
    load({ force: true });
  }, { signal });
  sync.addEventListener("click", () => runSync(1), { signal });
  backfill.addEventListener("click", () => runSync(7), { signal });
  settings.addEventListener("click", () => {
    if (locationLike) locationLike.hash = "settings";
  }, { signal });
  body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-v2-gsc-page-queries]");
    if (button) loadPageQueries(button.dataset.v2GscPageQueries);
  }, { signal });
  pageQueryClose.addEventListener("click", () => { pageQueryPanel.hidden = true; }, { signal });

  const reset = () => {
    loadedKey = null;
    connection = null;
    pageQueryPanel.hidden = true;
  };
  target?.addEventListener("input", reset, { signal });
  const unsubscribe = context?.subscribe?.(reset) ?? (() => {});
  renderHead();
  return () => unsubscribe();
}
