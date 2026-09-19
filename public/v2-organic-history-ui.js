const HISTORY_ENDPOINT = "/api/v2/organic/history";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value) {
  const number = finite(value);
  return number === null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(number);
}

function formatMoney(value) {
  const number = finite(value);
  return number === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(number);
}

function formatPercent(value) {
  const number = finite(value);
  if (number === null) return "—";
  return (number > 0 ? "+" : "") + number.toFixed(2) + "%";
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

function pointDate(point) {
  if (point?.period) return point.period;
  if (point?.captured_at && Number.isFinite(Date.parse(point.captured_at))) return new Date(point.captured_at).toISOString().slice(0, 10);
  return "—";
}

export function historyMetricValue(point, metric) {
  if (metric === "keywords") return finite(point?.organic_keywords);
  if (metric === "value") return finite(point?.traffic_value ?? point?.traffic_value_usd);
  if (metric === "top10") return finite(point?.positions?.top_10);
  return finite(point?.organic_traffic);
}

export function buildHistoryChartPoints(points, metric, width = 840, height = 220) {
  const rows = (Array.isArray(points) ? points : [])
    .map((point) => ({ point, value: historyMetricValue(point, metric) }))
    .filter((row) => row.value !== null);
  if (!rows.length) return { rows: [], path: "", min: null, max: null };

  const values = rows.map((row) => row.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;
  const padding = spread === 0 ? Math.max(1, Math.abs(max) * 0.05) : spread * 0.08;
  const low = min - padding;
  const high = max + padding;
  const left = 42;
  const right = width - 14;
  const top = 18;
  const bottom = height - 30;
  const x = (index) => rows.length === 1 ? (left + right) / 2 : left + (index / (rows.length - 1)) * (right - left);
  const y = (value) => bottom - ((value - low) / (high - low || 1)) * (bottom - top);
  const plotted = rows.map((row, index) => ({
    ...row,
    x: x(index),
    y: y(row.value),
  }));
  return {
    rows: plotted,
    path: plotted.map((row, index) => (index ? "L" : "M") + row.x.toFixed(2) + " " + row.y.toFixed(2)).join(" "),
    min,
    max,
  };
}

export function organicHistoryPanelMarkup() {
  return `
    <div class="v2-organic-panel" data-v2-organic-panel="history" hidden>
      <div class="v2-organic-history-head">
        <div>
          <b>Organic History</b>
          <span>Project History 来自 SEO Pro V2 自己积累的 D1 快照；Provider History 用 DataForSEO 回补长期月度历史。</span>
        </div>
        <div class="v2-organic-history-source" data-v2-history-source-label>PROJECT HISTORY · $0</div>
      </div>

      <div class="v2-organic-history-controls">
        <div class="v2-organic-history-control-group">
          <label>Project range
            <select data-v2-history-project-days>
              <option value="90">90 days</option>
              <option value="180">180 days</option>
              <option value="365" selected>1 year</option>
              <option value="730">2 years</option>
              <option value="0">All project history</option>
            </select>
          </label>
          <button type="button" data-v2-history-project-load>Load Project History · $0</button>
        </div>
        <div class="v2-organic-history-control-group provider">
          <label>Provider range
            <select data-v2-history-provider-months>
              <option value="6">6 months</option>
              <option value="12" selected>12 months</option>
              <option value="24">24 months</option>
              <option value="36">36 months</option>
              <option value="60">60 months</option>
            </select>
          </label>
          <button type="button" data-v2-history-provider-load>Load Provider History</button>
        </div>
        <label>Chart metric
          <select data-v2-history-metric>
            <option value="traffic">Organic Traffic</option>
            <option value="keywords">Organic Keywords</option>
            <option value="value">Traffic Value</option>
            <option value="top10">Top 10 Keywords</option>
          </select>
        </label>
      </div>

      <div class="v2-organic-history-note">
        Provider History 不会自动请求。无 30 天兼容缓存时，只有勾选页面顶部的“允许本次付费请求”后才会调用 DataForSEO。
      </div>

      <div class="v2-organic-history-source-tabs">
        <button type="button" class="active" data-v2-history-source="project">Project History</button>
        <button type="button" data-v2-history-source="provider">Provider History</button>
      </div>

      <div class="v2-organic-history-metrics">
        <article><span>Latest Keywords</span><b data-v2-history-summary="keywords">—</b><small data-v2-history-change="keywords">—</small></article>
        <article><span>Latest Traffic</span><b data-v2-history-summary="traffic">—</b><small data-v2-history-change="traffic">—</small></article>
        <article><span>Latest Value</span><b data-v2-history-summary="value">—</b><small data-v2-history-change="value">—</small></article>
        <article><span>Latest Top 10</span><b data-v2-history-summary="top10">—</b><small data-v2-history-change="top10">—</small></article>
      </div>

      <div class="v2-organic-history-chart-wrap">
        <svg viewBox="0 0 840 220" role="img" aria-label="Organic history trend" data-v2-history-chart>
          <text x="420" y="112" text-anchor="middle">Load history to view trend</text>
        </svg>
        <div class="v2-organic-history-chart-meta" data-v2-history-chart-meta>—</div>
      </div>

      <div class="v2-organic-table-shell">
        <table class="v2-organic-table v2-organic-history-table">
          <thead><tr><th>Period</th><th>Keywords</th><th>Traffic</th><th>Traffic Value</th><th>Top 10</th><th>New</th><th>Up</th><th>Down</th><th>Lost</th></tr></thead>
          <tbody data-v2-history-body><tr><td colspan="9" class="v2-organic-empty">尚未加载历史数据。</td></tr></tbody>
        </table>
      </div>
      <div class="v2-organic-summary" data-v2-history-meta>Project History $0 · Provider History 30-day cache-first</div>
    </div>
  `;
}

function svgNode(name, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

export function mountOrganicHistoryTab({
  section,
  target,
  allowPaid,
  context,
  fetchImpl,
  signal,
  activateTab,
  setStatus,
} = {}) {
  if (!section) return () => {};

  const projectDays = section.querySelector("[data-v2-history-project-days]");
  const providerMonths = section.querySelector("[data-v2-history-provider-months]");
  const projectLoad = section.querySelector("[data-v2-history-project-load]");
  const providerLoad = section.querySelector("[data-v2-history-provider-load]");
  const metric = section.querySelector("[data-v2-history-metric]");
  const chart = section.querySelector("[data-v2-history-chart]");
  const chartMeta = section.querySelector("[data-v2-history-chart-meta]");
  const body = section.querySelector("[data-v2-history-body]");
  const meta = section.querySelector("[data-v2-history-meta]");
  const sourceLabel = section.querySelector("[data-v2-history-source-label]");
  const sourceButtons = [...section.querySelectorAll("[data-v2-history-source]")];
  const historyTab = section.querySelector('[data-v2-organic-tab="history"]');

  const dataBySource = { project: null, provider: null };
  let activeSource = "project";
  let projectLoadedOnce = false;

  const setSource = (source) => {
    activeSource = source;
    sourceButtons.forEach((button) => button.classList.toggle("active", button.dataset.v2HistorySource === source));
    sourceLabel.textContent = source === "project" ? "PROJECT HISTORY · $0" : "PROVIDER HISTORY · CACHE FIRST";
    render();
  };

  const renderChart = (data) => {
    const points = data?.points ?? [];
    const metricName = metric.value;
    const plotted = buildHistoryChartPoints(points, metricName);
    chart.replaceChildren();
    [45, 105, 165].forEach((y) => chart.append(svgNode("line", { x1: 42, y1: y, x2: 826, y2: y, class: "v2-history-grid" })));
    if (!plotted.rows.length) {
      const empty = svgNode("text", { x: 420, y: 112, "text-anchor": "middle" });
      empty.textContent = "No history points for this metric";
      chart.append(empty);
      chartMeta.textContent = "—";
      return;
    }
    chart.append(svgNode("path", { d: plotted.path, class: "v2-history-line" }));
    plotted.rows.forEach((row) => {
      const point = svgNode("circle", { cx: row.x, cy: row.y, r: 4.5, class: "v2-history-point" });
      const title = svgNode("title");
      title.textContent = pointDate(row.point) + " · " + formatNumber(row.value);
      point.append(title);
      chart.append(point);
    });
    const first = plotted.rows[0]?.point;
    const last = plotted.rows.at(-1)?.point;
    chartMeta.textContent = pointDate(first) + " → " + pointDate(last) + " · min " + formatNumber(plotted.min) + " · max " + formatNumber(plotted.max);
  };

  const renderTable = (data) => {
    const points = data?.points ?? [];
    body.replaceChildren();
    if (!points.length) {
      const row = document.createElement("tr"), cell = document.createElement("td");
      cell.colSpan = 9; cell.className = "v2-organic-empty"; cell.textContent = "当前来源没有历史点。"; row.append(cell); body.append(row);
      return;
    }
    [...points].reverse().forEach((point) => {
      const row = document.createElement("tr");
      const values = [
        pointDate(point),
        formatNumber(point.organic_keywords),
        formatNumber(point.organic_traffic),
        formatMoney(point.traffic_value ?? point.traffic_value_usd),
        formatNumber(point.positions?.top_10),
        formatNumber(point.changes?.new),
        formatNumber(point.changes?.up),
        formatNumber(point.changes?.down),
        formatNumber(point.changes?.lost),
      ];
      values.forEach((value, index) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        if (index === 0) cell.className = "v2-organic-history-period";
        row.append(cell);
      });
      body.append(row);
    });
  };

  const renderSummary = (data) => {
    const summary = data?.summary ?? {};
    const latest = summary.latest ?? {};
    const change = summary.change ?? {};
    const values = {
      keywords: formatNumber(latest.organic_keywords),
      traffic: formatNumber(latest.organic_traffic),
      value: formatMoney(latest.traffic_value),
      top10: formatNumber(latest.top_10),
    };
    const changes = {
      keywords: formatPercent(change.organic_keywords_percent),
      traffic: formatPercent(change.organic_traffic_percent),
      value: formatPercent(change.traffic_value_percent),
      top10: formatPercent(change.top_10_percent),
    };
    Object.entries(values).forEach(([key, value]) => {
      const node = section.querySelector('[data-v2-history-summary="' + key + '"]');
      if (node) node.textContent = value;
    });
    Object.entries(changes).forEach(([key, value]) => {
      const node = section.querySelector('[data-v2-history-change="' + key + '"]');
      if (node) {
        node.textContent = value === "—" ? "No baseline" : value + " vs first point";
        const field = key === "keywords" ? "organic_keywords_percent" : key === "traffic" ? "organic_traffic_percent" : key === "value" ? "traffic_value_percent" : "top_10_percent";
        const numeric = finite(change[field]);
        node.dataset.direction = numeric === null ? "neutral" : numeric > 0 ? "up" : numeric < 0 ? "down" : "neutral";
      }
    });
  };

  const render = () => {
    const data = dataBySource[activeSource];
    renderSummary(data);
    renderChart(data);
    renderTable(data);
    if (!data) {
      meta.textContent = activeSource === "project"
        ? "Project History 尚未加载 · D1 only · $0"
        : "Provider History 尚未加载 · 30-day cache-first · explicit paid confirmation";
      return;
    }
    const summary = data.summary ?? {};
    meta.textContent = [
      activeSource === "project" ? "D1 Project History" : "DataForSEO Provider History",
      (summary.points ?? data.points?.length ?? 0) + " points",
      data.disclaimer,
    ].filter(Boolean).join(" · ");
  };

  const loadProject = async () => {
    const market = context?.get?.();
    const domain = hostname(target.value);
    if (!domain || !market?.location_code || !market?.language_code) return;
    projectLoad.disabled = true;
    setStatus?.("正在读取 D1 Project History，本次费用 $0…", "info");
    try {
      const query = new URLSearchParams({
        target: domain,
        location_code: String(market.location_code),
        language_code: market.language_code,
        days: projectDays.value,
      });
      const response = await fetchImpl(HISTORY_ENDPOINT + "?" + query.toString(), { headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || "Project History 查询失败");
      dataBySource.project = payload.data;
      projectLoadedOnce = true;
      setSource("project");
      setStatus?.("Project History 已读取：D1 only，本次费用 $0。", "success");
    } catch (error) {
      setStatus?.(error?.message || "Project History 查询失败", "error");
    } finally {
      projectLoad.disabled = false;
    }
  };

  const loadProvider = async () => {
    const market = context?.get?.();
    const domain = hostname(target.value);
    if (!domain || !market?.location_code || !market?.language_code) return;
    providerLoad.disabled = true;
    setStatus?.("正在检查 Provider History 的 30 天缓存…", "info");
    try {
      const response = await fetchImpl(HISTORY_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          target: domain,
          location_code: market.location_code,
          language_code: market.language_code,
          months: Number(providerMonths.value),
          allow_live_request: allowPaid.checked,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 && payload?.error?.code === "LIVE_REQUEST_CONFIRMATION_REQUIRED") {
        setStatus?.("Provider History 没有兼容缓存。勾选页面顶部“允许本次付费请求”后再次加载，才会调用 DataForSEO。", "warning");
        return;
      }
      if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || "Provider History 查询失败");
      dataBySource.provider = payload.data;
      allowPaid.checked = false;
      setSource("provider");
      setStatus?.(
        payload.meta?.cached
          ? "Provider History 已读取：30 天缓存命中，本次费用 $0。"
          : "Provider History 已更新：实际 API 费用已记录，结果缓存 30 天。",
        "success",
      );
    } catch (error) {
      setStatus?.(error?.message || "Provider History 查询失败", "error");
    } finally {
      providerLoad.disabled = false;
    }
  };

  projectLoad.addEventListener("click", loadProject, { signal });
  providerLoad.addEventListener("click", loadProvider, { signal });
  projectDays.addEventListener("change", () => { projectLoadedOnce = false; }, { signal });
  metric.addEventListener("change", render, { signal });
  sourceButtons.forEach((button) => button.addEventListener("click", () => setSource(button.dataset.v2HistorySource), { signal }));
  historyTab?.addEventListener("click", () => {
    activateTab?.(section, "history");
    if (!projectLoadedOnce) loadProject();
  }, { signal });

  render();
  return () => {};
}
