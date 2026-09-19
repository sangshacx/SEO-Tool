import {
  applyMarketToRoot,
  compatibleLanguages,
  composeMarketWarnings,
  createProfileMarketSync,
  createMarketContext,
  findMarket,
  loadMarketCatalog,
  loadSiteProfilesD1First,
  importSiteProfileEnvelope,
  orderedLocations,
  profileExportUrl,
  parseSiteProfileImportText,
  resolveActiveProfile,
  resolveProfileMarket,
  siteProfileFormPayload,
  marketRequestFields,
} from "./v2-market-context.js";
import { createDashboardOverview, mountDashboard, mountDashboardDecision } from "./v2-dashboard.js";
import {
  clearClusterSerpVerificationContext,
  createKeywordLibrarySection,
  mountKeywordLibrary,
  readClusterSerpVerificationContext,
  requestClusterIntelligenceReturn,
} from "./v2-keyword-library.js";
import { mountCompetitorIntelligence } from "./v2-competitor-intelligence-ui.js";
import { createOrganicIntelligenceWorkspace, mountOrganicIntelligence } from "./v2-organic-intelligence.js";
import { createGscSettingsWorkspace, mountGscSettings } from "./v2-gsc-settings.js";

export const V2_VIEWS = Object.freeze([
  { id: "overview", label: "总览", group: "primary" },
  { id: "website", label: "Site Explorer", group: "research" },
  { id: "competitors", label: "竞争对手", group: "research" },
  { id: "keywords", label: "关键词研究", group: "research" },
  { id: "keyword-library", label: "关键词库", group: "research" },
  { id: "backlinks", label: "外链", group: "research" },
  { id: "opportunities", label: "机会清单", group: "action" },
  { id: "more", label: "更多工具", group: "secondary" },
  { id: "sites", label: "网站管理", group: "system" },
  { id: "settings", label: "费用与设置", group: "system" },
]);

const VIEW_IDS = new Set(V2_VIEWS.map((view) => view.id));
const STORAGE_KEY = "seo-pro-v2.site-profiles.v1";
const ACTIVE_SITE_KEY = "seo-pro-v2.active-site.v1";

export const SEO_RESEARCH_ENDPOINTS = Object.freeze({
  keywordOverview: "/api/v2/keywords/overview",
  keywordIdeas: "/api/v2/keywords/ideas",
  serpWeakness: "/api/v2/keywords/serp-weakness",
  serpCompetitors: "/api/v2/keywords/serp-competitors",
  seoOpportunity: "/api/v2/keywords/opportunity",
  competitorSnapshot: "/api/v2/competitors/snapshot",
  keywordGap: "/api/v2/competitors/keyword-gap",
});

export function setResearchControlsReady(root, ready) {
  const controls = [...root.querySelectorAll("[data-v2-market-research]")];
  controls.forEach((control) => {
    control.disabled = !ready;
    control.dataset.v2MarketReady = ready ? "true" : "false";
  });
  return controls.length;
}

export function createMarketInitializationCoordinator({ initialize, onReady, onFailure }) {
  let ready = false;
  let inFlight = null;
  const start = () => {
    if (ready) return Promise.resolve({ ready: true, skipped: true });
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(initialize)
      .then((result) => {
        ready = true;
        onReady(result);
        return result;
      })
      .catch((error) => {
        onFailure(error);
        throw error;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
  return Object.freeze({ start, retry: start, isReady: () => ready });
}

export function buildSeoResearchRequestBody(fields, context = globalThis.window?.seoProV2MarketContext) {
  if (!context) throw new Error("Market context is not ready.");
  return { ...fields, ...marketRequestFields(context) };
}

export function submitSeoResearchRequest(workflow, fields, {
  context = globalThis.window?.seoProV2MarketContext,
  fetchImpl = globalThis.window?.fetch?.bind(globalThis.window),
} = {}) {
  const endpoint = SEO_RESEARCH_ENDPOINTS[workflow];
  if (!endpoint) throw new TypeError(`Unknown SEO research workflow: ${workflow}`);
  if (typeof fetchImpl !== "function") throw new Error("Fetch is not available.");
  return fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSeoResearchRequestBody(fields, context)),
  });
}

export function normalizeView(value) {
  const candidate = String(value || "").trim().replace(/^#/, "").toLowerCase();
  return VIEW_IDS.has(candidate) ? candidate : "overview";
}

export function readHashView(locationLike) {
  return normalizeView(locationLike?.hash);
}

export function writeHashView(locationLike, view) {
  const normalized = normalizeView(view);
  locationLike.hash = normalized;
  return normalized;
}

function normalizeDomain(value) {
  let raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  try {
    if (!/^https?:\/\//.test(raw)) raw = `https://${raw}`;
    const url = new URL(raw);
    let host = url.hostname.replace(/^www\./, "").replace(/\.$/, "");
    if (!host.includes(".") || /^\d+(?:\.\d+){3}$/.test(host)) return null;
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

export function normalizeSiteProfile(input) {
  const domain = normalizeDomain(input?.domain);
  if (!domain) return null;
  const label = String(input?.label || domain).trim().slice(0, 80) || domain;
  return { domain, label };
}

export function dedupeSiteProfiles(profiles) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(profiles) ? profiles : []) {
    const profile = normalizeSiteProfile(raw);
    if (!profile || seen.has(profile.domain)) continue;
    seen.add(profile.domain);
    output.push(profile);
  }
  return output.slice(0, 50);
}

export function renameSiteProfile(profiles, domain, label) {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedLabel = String(label || "").trim().slice(0, 80);
  if (!normalizedDomain || !normalizedLabel) return dedupeSiteProfiles(profiles);
  return dedupeSiteProfiles(profiles).map((profile) => profile.domain === normalizedDomain ? { ...profile, label: normalizedLabel } : profile);
}

export function removeSiteProfile(profiles, domain) {
  const current = dedupeSiteProfiles(profiles);
  if (current.length <= 1) return current;
  const normalizedDomain = normalizeDomain(domain);
  return current.filter((profile) => profile.domain !== normalizedDomain);
}

export function loadSiteProfiles(storage) {
  try {
    const stored = dedupeSiteProfiles(JSON.parse(storage.getItem(STORAGE_KEY) || "[]"));
    return stored.length ? stored : [{ domain: "great-ocean-waterproof.com", label: "Great Ocean Waterproof" }];
  } catch {
    return [{ domain: "great-ocean-waterproof.com", label: "Great Ocean Waterproof" }];
  }
}

export function applyActiveDomain(root, domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;
  root.querySelectorAll("[data-v2-domain-field]").forEach((field) => {
    field.value = normalized;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return true;
}

export function activateSiteProfile({ root, select, title, context, profile, market }) {
  if (!profile || !market) return false;
  select.value = profile.domain;
  applyActiveDomain(root, profile.domain);
  if (title) title.textContent = profile.domain;
  applyMarketToRoot(root, market);
  context.set({ domain: profile.domain, ...market });
  return true;
}

export function bindSiteSelection({
  shell,
  select,
  storage,
  context,
  activeProfile,
  marketForProfile,
  activate = activateSiteProfile,
} = {}) {
  if (!select || typeof select.addEventListener !== "function") return () => {};
  const handleChange = () => {
    storage?.setItem?.(ACTIVE_SITE_KEY, select.value);
    const profile = activeProfile?.();
    activate({
      root: shell,
      select,
      title: shell?.querySelector?.("#v2DashboardSite") || shell?.querySelector?.("#v2ActiveSiteTitle") || null,
      context,
      profile,
      market: profile ? marketForProfile?.(profile) : null,
    });
  };
  select.addEventListener("change", handleChange);
  return handleChange;
}

const TOOL_GROUPS = Object.freeze({
  website: [".backlinks", ".backlinkhistory"],
  competitors: [".competitor", ".keywordgap", ".backlinkcompare"],
  keywords: ["#form", ".ideas", ".contentplan"],
  backlinks: [".backlinkbatch", ".refdomains", ".backlinkdetails", ".anchoranalysis"],
  opportunities: [".backlinkgap", ".backlinkprospects"],
});

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function annotateExistingTools(root) {
  for (const [view, selectors] of Object.entries(TOOL_GROUPS)) {
    for (const selector of selectors) {
      let element = root.querySelector(selector);
      if (selector === "#form") element = element?.closest("section");
      if (element) element.dataset.v2View = view;
    }
  }
  root.querySelector(".money")?.setAttribute("data-v2-view", "overview settings");
  root.querySelector(".foot")?.setAttribute("data-v2-view", "overview");
}

function createOverview() {
  return createDashboardOverview();
}

export function createKeywordResearchWorkspace(root) {
  const overview = root.querySelector("#form")?.closest("section");
  const ideas = root.querySelector(".ideas");
  const plan = root.querySelector(".contentplan");
  if (!overview || !ideas || !plan) return null;

  const workspace = createElement("section", "v2-keyword-research-workspace");
  workspace.dataset.v2View = "keywords";

  const hero = createElement("div", "v2-keyword-research-hero");
  hero.innerHTML = `
    <div>
      <div class="v2-keyword-research-eyebrow">KEYWORD RESEARCH</div>
      <h2>关键词研究</h2>
      <p>先判断一个关键词值不值得做，再按需验证 SERP、扩展关键词机会和整理内容计划。</p>
    </div>
    <div class="v2-keyword-research-hero-meta">
      <span>Cache First</span>
      <span>Cost Guard</span>
    </div>
  `;

  const tabs = createElement("div", "v2-keyword-research-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "关键词研究视图");
  const tabConfig = [
    ["overview", "关键词概览"],
    ["ideas", "Keyword Ideas"],
    ["plan", "Content Plan"],
  ];
  tabConfig.forEach(([id, label], index) => {
    const button = createElement("button", index === 0 ? "active" : "", label);
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", index === 0 ? "true" : "false");
    button.dataset.v2KeywordResearchTab = id;
    tabs.appendChild(button);
  });

  const stage = createElement("div", "v2-keyword-research-stage");

  overview.classList.add("v2-keyword-research-panel", "v2-keyword-overview-panel", "active");
  ideas.classList.add("v2-keyword-research-panel", "v2-keyword-ideas-panel");
  plan.classList.add("v2-keyword-research-panel", "v2-keyword-plan-panel");
  overview.dataset.v2KeywordResearchPanel = "overview";
  ideas.dataset.v2KeywordResearchPanel = "ideas";
  plan.dataset.v2KeywordResearchPanel = "plan";
  delete overview.dataset.v2View;
  delete ideas.dataset.v2View;
  delete plan.dataset.v2View;

  const activateTab = (tabId) => {
    const target = tabConfig.some(([id]) => id === tabId) ? tabId : "overview";
    tabs.querySelectorAll("[data-v2-keyword-research-tab]").forEach((button) => {
      const active = button.dataset.v2KeywordResearchTab === target;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    stage.querySelectorAll("[data-v2-keyword-research-panel]").forEach((panel) => {
      const active = panel.dataset.v2KeywordResearchPanel === target;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    return target;
  };

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-v2-keyword-research-tab]");
    if (button) activateTab(button.dataset.v2KeywordResearchTab);
  });

  overview.before(workspace);
  workspace.append(hero, tabs, stage);
  stage.append(overview, ideas, plan);
  activateTab("overview");
  return { workspace, activateTab };
}


export function createCompetitorResearchWorkspace(root) {
  const snapshot = root.querySelector(".competitor");
  const gap = root.querySelector(".keywordgap");
  const backlinks = root.querySelector(".backlinkcompare");
  if (!snapshot || !gap || !backlinks) return null;

  const workspace = createElement("section", "v2-competitor-workspace");
  workspace.dataset.v2View = "competitors";

  const hero = createElement("div", "v2-competitor-hero");
  hero.innerHTML = `
    <div>
      <div class="v2-competitor-eyebrow">COMPETITOR RESEARCH</div>
      <h2>竞争对手研究</h2>
      <p>先看竞争对手的自然搜索规模和排名关键词，再验证 Keyword Gap 与外链差距。</p>
    </div>
    <div class="v2-competitor-hero-meta">
      <span>7 天缓存</span>
      <span>Cost Guard</span>
    </div>
  `;

  const tabs = createElement("div", "v2-competitor-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "竞争对手研究视图");
  const tabConfig = [
    ["snapshot", "自然搜索概览"],
    ["gap", "Keyword Gap"],
    ["backlinks", "外链比较"],
  ];
  tabConfig.forEach(([id, label], index) => {
    const button = createElement("button", index === 0 ? "active" : "", label);
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", index === 0 ? "true" : "false");
    button.dataset.v2CompetitorTab = id;
    tabs.appendChild(button);
  });

  const stage = createElement("div", "v2-competitor-stage");
  const panels = [
    [snapshot, "snapshot", "v2-competitor-snapshot-panel"],
    [gap, "gap", "v2-competitor-gap-panel"],
    [backlinks, "backlinks", "v2-competitor-backlink-panel"],
  ];
  panels.forEach(([panel, id, className], index) => {
    panel.classList.add("v2-competitor-panel", className);
    panel.dataset.v2CompetitorPanel = id;
    delete panel.dataset.v2View;
    panel.hidden = index !== 0;
  });

  const activateTab = (tabId) => {
    const target = tabConfig.some(([id]) => id === tabId) ? tabId : "snapshot";
    tabs.querySelectorAll("[data-v2-competitor-tab]").forEach((button) => {
      const active = button.dataset.v2CompetitorTab === target;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    stage.querySelectorAll("[data-v2-competitor-panel]").forEach((panel) => {
      const active = panel.dataset.v2CompetitorPanel === target;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    return target;
  };

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-v2-competitor-tab]");
    if (button) activateTab(button.dataset.v2CompetitorTab);
  });

  snapshot.before(workspace);
  workspace.append(hero, tabs, stage);
  stage.append(snapshot, gap, backlinks);
  activateTab("snapshot");
  return { workspace, activateTab };
}


export function createBacklinkResearchWorkspace(root) {
  const batch = root.querySelector(".backlinkbatch");
  const referring = root.querySelector(".refdomains");
  const details = root.querySelector(".backlinkdetails");
  const anchors = root.querySelector(".anchoranalysis");
  if (!batch || !referring || !details || !anchors) return null;

  const workspace = createElement("section", "v2-backlink-workspace");
  workspace.dataset.v2View = "backlinks";

  const hero = createElement("div", "v2-backlink-hero");
  hero.innerHTML = `
    <div>
      <div class="v2-backlink-eyebrow">BACKLINK RESEARCH</div>
      <h2>外链研究</h2>
      <p>从批量域名概览进入引用域、具体 Backlink 和 Anchor Text，按需读取缓存或明确确认付费查询。</p>
    </div>
    <div class="v2-backlink-hero-meta">
      <span>Cache First</span>
      <span>Cost Guard</span>
    </div>
  `;

  const tabs = createElement("div", "v2-backlink-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "外链研究视图");
  const tabConfig = [
    ["batch", "批量概览"],
    ["referring", "Referring Domains"],
    ["details", "Backlink Details"],
    ["anchors", "Anchor Text"],
  ];
  tabConfig.forEach(([id, label], index) => {
    const button = createElement("button", index === 0 ? "active" : "", label);
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", index === 0 ? "true" : "false");
    button.dataset.v2BacklinkTab = id;
    tabs.appendChild(button);
  });

  const stage = createElement("div", "v2-backlink-stage");
  const panels = [
    [batch, "batch", "v2-backlink-batch-panel"],
    [referring, "referring", "v2-backlink-referring-panel"],
    [details, "details", "v2-backlink-details-panel"],
    [anchors, "anchors", "v2-backlink-anchor-panel"],
  ];
  panels.forEach(([panel, id, className], index) => {
    panel.classList.add("v2-backlink-panel", className);
    panel.dataset.v2BacklinkPanel = id;
    delete panel.dataset.v2View;
    panel.hidden = index !== 0;
  });

  const activateTab = (tabId) => {
    const target = tabConfig.some(([id]) => id === tabId) ? tabId : "batch";
    tabs.querySelectorAll("[data-v2-backlink-tab]").forEach((button) => {
      const active = button.dataset.v2BacklinkTab === target;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    stage.querySelectorAll("[data-v2-backlink-panel]").forEach((panel) => {
      const active = panel.dataset.v2BacklinkPanel === target;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    return target;
  };

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-v2-backlink-tab]");
    if (button) activateTab(button.dataset.v2BacklinkTab);
  });

  batch.before(workspace);
  workspace.append(hero, tabs, stage);
  stage.append(batch, referring, details, anchors);
  activateTab("batch");
  return { workspace, activateTab };
}


export function createOpportunityWorkspace(root) {
  const gap = root.querySelector(".backlinkgap");
  const prospects = root.querySelector(".backlinkprospects");
  if (!gap || !prospects) return null;

  const workspace = createElement("section", "v2-opportunity-workspace");
  workspace.dataset.v2View = "opportunities";

  const hero = createElement("div", "v2-opportunity-hero");
  hero.innerHTML = `
    <div>
      <div class="v2-opportunity-eyebrow">OPPORTUNITY WORKSPACE</div>
      <h2>机会清单</h2>
      <p>从竞争对手外链中发现可争取的引用域，筛选高价值机会，再保存到 D1 持续推进。</p>
    </div>
    <div class="v2-opportunity-pipeline" aria-label="机会工作流">
      <span><b>1</b>发现</span>
      <i>→</i>
      <span><b>2</b>保存</span>
      <i>→</i>
      <span><b>3</b>推进</span>
    </div>
  `;

  const tabs = createElement("div", "v2-opportunity-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "机会清单视图");
  const tabConfig = [
    ["discover", "发现外链机会"],
    ["saved", "Saved Link Prospects"],
  ];
  tabConfig.forEach(([id, label], index) => {
    const button = createElement("button", index === 0 ? "active" : "", label);
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", index === 0 ? "true" : "false");
    button.dataset.v2OpportunityTab = id;
    tabs.appendChild(button);
  });

  const stage = createElement("div", "v2-opportunity-stage");
  const panels = [
    [gap, "discover", "v2-opportunity-discover-panel"],
    [prospects, "saved", "v2-opportunity-saved-panel"],
  ];
  panels.forEach(([panel, id, className], index) => {
    panel.classList.add("v2-opportunity-panel", className);
    panel.dataset.v2OpportunityPanel = id;
    delete panel.dataset.v2View;
    panel.hidden = index !== 0;
  });

  const activateTab = (tabId) => {
    const target = tabConfig.some(([id]) => id === tabId) ? tabId : "discover";
    tabs.querySelectorAll("[data-v2-opportunity-tab]").forEach((button) => {
      const active = button.dataset.v2OpportunityTab === target;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    stage.querySelectorAll("[data-v2-opportunity-panel]").forEach((panel) => {
      const active = panel.dataset.v2OpportunityPanel === target;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    return target;
  };

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-v2-opportunity-tab]");
    if (button) activateTab(button.dataset.v2OpportunityTab);
  });

  gap.before(workspace);
  workspace.append(hero, tabs, stage);
  stage.append(gap, prospects);
  activateTab("discover");
  return { workspace, activateTab };
}


export function createWebsiteDataWorkspace(root) {
  const snapshot = root.querySelector(".backlinks");
  const history = root.querySelector(".backlinkhistory");
  if (!snapshot || !history) return null;

  const workspace = createElement("section", "v2-website-data-workspace");
  workspace.dataset.v2View = "website";

  const hero = createElement("div", "v2-website-data-hero");
  hero.innerHTML = `
    <div>
      <div class="v2-website-data-eyebrow">SITE OVERVIEW</div>
      <h2>Link Profile</h2>
      <p>查看当前站点的外链健康、核心引用域和历史变化；Organic Intelligence 与机会判断统一在上方 Site Explorer 工作区。</p>
    </div>
    <div class="v2-website-data-hero-meta">
      <span>7 天快照</span>
      <span>历史读取 $0</span>
    </div>
  `;

  const tabs = createElement("div", "v2-website-data-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "网站数据视图");
  const tabConfig = [
    ["overview", "Link Profile Overview"],
    ["history", "历史与提醒"],
  ];
  tabConfig.forEach(([id, label], index) => {
    const button = createElement("button", index === 0 ? "active" : "", label);
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", index === 0 ? "true" : "false");
    button.dataset.v2WebsiteDataTab = id;
    tabs.appendChild(button);
  });

  const stage = createElement("div", "v2-website-data-stage");
  const panels = [
    [snapshot, "overview", "v2-website-overview-panel"],
    [history, "history", "v2-website-history-panel"],
  ];
  panels.forEach(([panel, id, className], index) => {
    panel.classList.add("v2-website-data-panel", className);
    panel.dataset.v2WebsiteDataPanel = id;
    delete panel.dataset.v2View;
    panel.hidden = index !== 0;
  });

  const activateTab = (tabId) => {
    const target = tabConfig.some(([id]) => id === tabId) ? tabId : "overview";
    tabs.querySelectorAll("[data-v2-website-data-tab]").forEach((button) => {
      const active = button.dataset.v2WebsiteDataTab === target;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    stage.querySelectorAll("[data-v2-website-data-panel]").forEach((panel) => {
      const active = panel.dataset.v2WebsiteDataPanel === target;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    return target;
  };

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-v2-website-data-tab]");
    if (button) activateTab(button.dataset.v2WebsiteDataTab);
  });

  const toSnapshot = history.querySelector("#historyToSnapshot");
  toSnapshot?.addEventListener("click", () => activateTab("overview"));

  snapshot.before(workspace);
  workspace.append(hero, tabs, stage);
  stage.append(snapshot, history);
  activateTab("overview");
  return { workspace, activateTab };
}

export function mountClusterSerpVerificationFlow({
  root,
  keywordResearchWorkspace,
  context,
  storageLike = globalThis.sessionStorage,
  locationLike = globalThis.location,
  windowLike = globalThis.window,
  documentLike = globalThis.document,
  MutationObserverImpl = globalThis.MutationObserver,
} = {}) {
  const workspace = root?.querySelector?.(".v2-keyword-research-workspace");
  const tabs = workspace?.querySelector?.(".v2-keyword-research-tabs");
  const keywordInput = root?.querySelector?.("#keyword");
  const serpButton = root?.querySelector?.("#serpCompetitorsBtn");
  const costGuard = root?.querySelector?.("#serpCompetitorsAllowPaid");
  const sourceStatus = root?.querySelector?.("#serpCompetitorsStatus");
  const sourceResult = root?.querySelector?.("#serpCompetitorsResult");
  const sourceMeta = root?.querySelector?.("#serpCompetitorsMeta");
  if (!workspace || !tabs || !keywordInput || !serpButton || !costGuard || !sourceStatus || !sourceResult) {
    return () => {};
  }

  const card = documentLike.createElement("section");
  card.className = "v2-cluster-serp-flow";
  card.dataset.v2ClusterSerpFlow = "";
  card.hidden = true;
  card.innerHTML = `
    <div class="v2-cluster-serp-flow-head">
      <div>
        <div class="v2-cluster-serp-flow-eyebrow">CLUSTER INTELLIGENCE · SERP VERIFICATION</div>
        <b data-v2-cluster-serp-flow-title>补充 SERP 证据</b>
        <p data-v2-cluster-serp-flow-context></p>
      </div>
      <button type="button" class="secondary-action" data-v2-cluster-serp-flow-cancel>取消</button>
    </div>
    <div class="v2-cluster-serp-flow-steps">
      <span data-v2-cluster-serp-step="keyword"><b>1</b>关键词已预填</span>
      <span data-v2-cluster-serp-step="guard"><b>2</b>Cost Guard</span>
      <span data-v2-cluster-serp-step="return"><b>3</b>返回重算</span>
    </div>
    <div class="v2-cluster-serp-flow-actions">
      <button type="button" class="primary-action" data-v2-cluster-serp-run>检查 Top 10 SERP</button>
      <label class="v2-cluster-serp-paid">
        <input type="checkbox" data-v2-cluster-serp-allow-paid>
        无新鲜快照时，允许本次付费 DataForSEO SERP 请求
      </label>
      <button type="button" class="secondary-action" data-v2-cluster-serp-return disabled>返回 Cluster Intelligence 并重新分析</button>
    </div>
    <div class="v2-cluster-serp-flow-status" data-v2-cluster-serp-flow-status>
      先点击“检查 Top 10 SERP”。未勾选付费确认时只读取 D1，费用为 $0。
    </div>
    <div class="v2-cluster-serp-flow-meta" data-v2-cluster-serp-flow-meta></div>
  `;
  tabs.after(card);

  const title = card.querySelector("[data-v2-cluster-serp-flow-title]");
  const contextText = card.querySelector("[data-v2-cluster-serp-flow-context]");
  const runButton = card.querySelector("[data-v2-cluster-serp-run]");
  const paidCheckbox = card.querySelector("[data-v2-cluster-serp-allow-paid]");
  const returnButton = card.querySelector("[data-v2-cluster-serp-return]");
  const cancelButton = card.querySelector("[data-v2-cluster-serp-flow-cancel]");
  const flowStatus = card.querySelector("[data-v2-cluster-serp-flow-status]");
  const flowMeta = card.querySelector("[data-v2-cluster-serp-flow-meta]");
  const returnStep = card.querySelector('[data-v2-cluster-serp-step="return"]');
  let activeContext = null;
  let attemptStarted = false;
  let completed = false;

  const keywordMatches = () =>
    Boolean(activeContext?.keyword)
    && keywordInput.value.trim().toLowerCase() === String(activeContext.keyword).trim().toLowerCase();

  const syncControls = () => {
    const market = context?.get?.();
    const siteMatches = !activeContext?.site_domain || !market?.domain || activeContext.site_domain === market.domain;
    runButton.disabled = !activeContext || !keywordMatches() || !siteMatches || serpButton.disabled;
    returnButton.disabled = !completed;
    if (!siteMatches) {
      flowStatus.textContent = "当前网站与这条 Cluster Intelligence 验证任务不一致，请切回原网站后继续。";
      flowStatus.dataset.state = "warning";
    } else if (activeContext && !keywordMatches()) {
      flowStatus.textContent = `验证任务要求关键词“${activeContext.keyword}”。请恢复该关键词后再继续。`;
      flowStatus.dataset.state = "warning";
    }
  };

  const syncSourceState = () => {
    if (!activeContext || !attemptStarted) {
      syncControls();
      return;
    }
    const sourceMessage = sourceStatus.textContent.trim();
    if (sourceMessage) flowStatus.textContent = sourceMessage;
    const success = /Top 10 页面读取成功/.test(sourceMessage) && !sourceResult.classList.contains("hidden");
    if (success) {
      completed = true;
      paidCheckbox.checked = false;
      returnStep?.classList.add("complete");
      flowStatus.dataset.state = "success";
      flowMeta.textContent = sourceMeta?.textContent?.trim()
        ? `${sourceMeta.textContent.trim()} · 已写入/复用 D1，可返回 Cluster Intelligence 重算。`
        : "Top 10 SERP 证据已写入/复用 D1，可返回 Cluster Intelligence 重算。";
    } else if (/没有 7 天内 Top 10 快照/.test(sourceMessage)) {
      flowStatus.dataset.state = "warning";
      flowMeta.textContent = "如需实时验证，请明确勾选上方付费确认后再次点击；否则不会调用 DataForSEO。";
    } else if (sourceStatus.classList.contains("error")) {
      flowStatus.dataset.state = "error";
    } else {
      flowStatus.dataset.state = "info";
    }
    syncControls();
  };

  const render = () => {
    const view = String(locationLike?.hash || "").replace(/^#/, "");
    activeContext = readClusterSerpVerificationContext({ storageLike });
    const market = context?.get?.();
    const visible = view === "keywords" && activeContext;
    card.hidden = !visible;
    if (!visible) return;
    keywordResearchWorkspace?.activateTab?.("overview");
    keywordInput.value = activeContext.keyword;
    title.textContent = `补充“${activeContext.keyword}”的 SERP 证据`;
    contextText.textContent = [
      activeContext.priority_label,
      activeContext.evidence_label,
      activeContext.suggested_cluster ? `影响 Cluster：${activeContext.suggested_cluster}` : null,
      activeContext.reason,
    ].filter(Boolean).join(" · ");
    completed = false;
    attemptStarted = false;
    returnStep?.classList.remove("complete");
    paidCheckbox.checked = false;
    flowMeta.textContent = market?.domain ? `当前网站：${market.domain}` : "";
    flowStatus.textContent = "先点击“检查 Top 10 SERP”。未勾选付费确认时只读取 D1，费用为 $0。";
    flowStatus.dataset.state = "info";
    syncControls();
  };

  runButton.addEventListener("click", () => {
    if (!activeContext || !keywordMatches()) return;
    attemptStarted = true;
    completed = false;
    returnStep?.classList.remove("complete");
    sourceResult.classList.add("hidden");
    costGuard.checked = paidCheckbox.checked;
    flowStatus.textContent = paidCheckbox.checked
      ? "已明确允许本次实时 SERP 请求；正在先检查缓存，再按现有 Cost Guard 规则执行。"
      : "正在检查 D1 7 天 Top 10 快照；本次不会调用 DataForSEO。";
    flowStatus.dataset.state = "info";
    flowMeta.textContent = "";
    returnButton.disabled = true;
    serpButton.click();
  });

  paidCheckbox.addEventListener("change", () => {
    flowStatus.textContent = paidCheckbox.checked
      ? "你已明确允许：仅当没有新鲜 D1 快照时，本次验证可以调用 DataForSEO SERP。"
      : "付费确认已关闭；再次检查时只读取 D1，不会调用 DataForSEO。";
    flowStatus.dataset.state = paidCheckbox.checked ? "warning" : "info";
  });

  returnButton.addEventListener("click", () => {
    if (!completed || !activeContext) return;
    requestClusterIntelligenceReturn({
      storageLike,
      keyword: activeContext.keyword,
      siteDomain: activeContext.site_domain || context?.get?.()?.domain,
    });
    clearClusterSerpVerificationContext(storageLike);
    activeContext = null;
    card.hidden = true;
    locationLike.hash = "keyword-library";
  });

  cancelButton.addEventListener("click", () => {
    clearClusterSerpVerificationContext(storageLike);
    activeContext = null;
    card.hidden = true;
  });

  const handleKeywordInput = () => syncControls();
  const handleHashChange = () => render();
  keywordInput.addEventListener("input", handleKeywordInput);
  windowLike?.addEventListener?.("hashchange", handleHashChange);

  const observers = [];
  if (typeof MutationObserverImpl === "function") {
    const sourceObserver = new MutationObserverImpl(syncSourceState);
    sourceObserver.observe(sourceStatus, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    sourceObserver.observe(sourceResult, { attributes: true, attributeFilter: ["class"] });
    sourceObserver.observe(serpButton, { attributes: true, attributeFilter: ["disabled"] });
    observers.push(sourceObserver);
  }

  render();
  return () => {
    observers.forEach((observer) => observer.disconnect?.());
    keywordInput.removeEventListener("input", handleKeywordInput);
    windowLike?.removeEventListener?.("hashchange", handleHashChange);
    card.remove?.();
  };
}

function createPlaceholder(view, title, description) {
  const section = createElement("section", "panel v2-placeholder");
  section.dataset.v2View = view;
  section.innerHTML = `<div class="section-title">${title}</div><p class="lead">${description}</p>`;
  return section;
}

function renderNavigation(shell) {
  const nav = shell.querySelector("[data-v2-nav-list]");
  const groupNames = { research: "研究", action: "行动", secondary: "其他", system: "系统" };
  let previousGroup = null;
  for (const view of V2_VIEWS) {
    if (view.group !== "primary" && view.group !== previousGroup) {
      nav.append(createElement("div", "v2-nav-label", groupNames[view.group]));
    }
    previousGroup = view.group;
    const link = createElement("a", "v2-nav-link", view.label);
    link.href = `#${view.id}`;
    link.dataset.v2Nav = view.id;
    nav.append(link);
  }
}

function markDomainFields(root) {
  const ownIds = ["backlinkDomain", "compareOwnDomain", "historyDomain", "refDomain", "detailDomain", "anchorDomain", "backlinkGapOwn", "prospectOwn", "ownDomain"];
  ownIds.forEach((id) => root.querySelector(`#${id}`)?.setAttribute("data-v2-domain-field", ""));
}

export function activateView(root, viewValue) {
  const view = normalizeView(viewValue);
  root.querySelectorAll("[data-v2-view]").forEach((element) => {
    element.hidden = !element.dataset.v2View.split(/\s+/).includes(view);
  });
  root.querySelectorAll("[data-v2-nav]").forEach((link) => {
    const active = link.dataset.v2Nav === view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  });
  const entry = V2_VIEWS.find((item) => item.id === view);
  root.querySelector("[data-v2-view-title]").textContent = entry?.label || "总览";
  root.querySelector("[data-v2-sidebar]").classList.remove("open");
  return view;
}

export function toggleMobileNavigation(root) {
  const sidebar = root.querySelector("[data-v2-sidebar]");
  sidebar?.classList.toggle("open");
  return Boolean(sidebar?.classList.contains("open"));
}

export function bindHashRouting(windowLike, root) {
  const route = () => activateView(root, readHashView(windowLike.location));
  windowLike.addEventListener("hashchange", route);
  route();
  return route;
}

function siteApi(fetchImpl, method, body) {
  return fetchImpl("/api/v2/sites", {
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || "网站配置保存失败");
    return payload.data;
  });
}

export function persistSiteMarket(fetchImpl, domain, market) {
  return siteApi(fetchImpl, "PATCH", {
    domain,
    location_code: market.location_code,
    language_code: market.language_code,
  });
}

function selectedCompetitors(form) {
  return [...form.querySelectorAll("[data-v2-competitor]")].map((input) => input.value.trim()).filter(Boolean);
}

function validateCompetitors(values, ownDomain) {
  const normalized = values.map(normalizeDomain);
  if (normalized.some((domain) => !domain)) return { error: "竞争对手必须是有效根域名，例如 competitor.com。" };
  if (normalized.includes(ownDomain)) return { error: "竞争对手不能与当前网站相同。" };
  if (new Set(normalized).size !== normalized.length) return { error: "竞争对手不能重复。" };
  return { competitors: normalized };
}

function marketControlsMarkup() {
  return `<div class="v2-market-controls" aria-label="关键词市场">
    <label class="v2-market-field">国家或地区<input type="search" data-v2-market-country list="v2CountryOptions" autocomplete="off"><datalist id="v2CountryOptions"></datalist></label>
    <label class="v2-market-field">语言<input type="search" data-v2-market-language list="v2LanguageOptions" autocomplete="off"><datalist id="v2LanguageOptions"></datalist></label>
    <span class="v2-market-summary" data-v2-market-summary aria-live="polite"></span>
  </div>`;
}

function updateDatalist(list, records, valueKey, labelKey) {
  list.replaceChildren(...records.map((record) => {
    const option = document.createElement("option");
    option.value = record[labelKey];
    option.dataset.code = String(record[valueKey]);
    return option;
  }));
}

async function initializeSites(shell) {
  const storage = window.localStorage;
  const fetchImpl = window.fetch.bind(window);
  const select = shell.querySelector("[data-v2-site-select]");
  const list = shell.querySelector("[data-v2-site-list]");
  const warning = shell.querySelector("[data-v2-sync-warning]");
  const error = shell.querySelector("[data-v2-site-error]");
  const countryInput = shell.querySelector("[data-v2-market-country]");
  const languageInput = shell.querySelector("[data-v2-market-language]");
  const countryList = shell.querySelector("#v2CountryOptions");
  const languageList = shell.querySelector("#v2LanguageOptions");
  const form = shell.querySelector("[data-v2-site-form]");
  const retrySync = shell.querySelector("[data-v2-retry-sync]");
  let catalog;
  let profiles = [];
  let source = "d1";
  let context;
  let profileSync;
  let baseWarning = "";
  let compatibilityWarning = "";
  let renderSyncState = () => {};

  const showError = (message = "") => { error.textContent = message; };
  try {
    catalog = await loadMarketCatalog(fetchImpl);
  } catch {
    throw new Error("MARKET_CATALOG_UNAVAILABLE");
  }
  updateDatalist(countryList, orderedLocations(catalog), "location_code", "location_name");

  const sync = await loadSiteProfilesD1First({ fetchImpl, storage, catalog });
  profiles = sync.profiles;
  source = sync.source;
  baseWarning = sync.warning || "";
  warning.textContent = baseWarning;

  const activeProfile = () => profiles.find((profile) => profile.domain === select.value) || profiles[0] || null;
  const marketForProfile = (profile) => {
    const resolved = resolveProfileMarket(catalog, profile);
    compatibilityWarning = resolved.warning;
    renderSyncState();
    return resolved.market;
  };

  const setMarketControls = (market) => {
    const languages = compatibleLanguages(catalog, market.location_code);
    updateDatalist(languageList, languages, "language_code", "language_name");
    countryInput.value = market.location_name;
    languageInput.value = market.language_name;
    shell.querySelector("[data-v2-market-summary]").textContent = `${market.country_iso_code || market.location_name} · ${market.language_name}`;
    applyMarketToRoot(shell, market);
  };

  const restoredProfile = resolveActiveProfile(profiles, normalizeDomain(storage.getItem(ACTIVE_SITE_KEY)));
  context = createMarketContext({ domain: restoredProfile?.domain, ...marketForProfile(restoredProfile) });
  window.seoProV2MarketContext = context;
  context.subscribe(setMarketControls);

  let currentSyncState = { dirty_domains: [], failed_domains: [] };
  renderSyncState = (state = currentSyncState) => {
    currentSyncState = state;
    warning.textContent = composeMarketWarnings({ base: baseWarning, compatibility: compatibilityWarning, dirtyDomains: state.dirty_domains });
    retrySync.hidden = state.failed_domains.length === 0;
    retrySync.dataset.v2RetryDomains = state.failed_domains.join(",");
  };
  profileSync = createProfileMarketSync({
    write: (domain, market) => persistSiteMarket(fetchImpl, domain, market),
    onStateChange: renderSyncState,
  });
  renderSyncState();

  function persistActiveMarket(market) {
    const profile = activeProfile();
    if (!profile) return;
    const updated = { ...profile, ...market };
    profiles = profiles.map((item) => item.domain === profile.domain ? updated : item);
    if (source !== "d1") {
      baseWarning = "当前为本机临时模式；市场修改尚未同步到服务器。";
      renderSyncState();
      return;
    }
    profileSync.save(profile.domain, market);
  }

  const commitCountry = () => {
    const location = catalog.locations.find((item) => item.location_name.toLowerCase() === countryInput.value.trim().toLowerCase() || String(item.location_code) === countryInput.value.trim());
    if (!location) {
      countryInput.setCustomValidity("请选择目录中的国家或地区");
      countryInput.reportValidity();
      countryInput.value = context.get().location_name;
      return;
    }
    countryInput.setCustomValidity("");
    const currentLanguage = compatibleLanguages(catalog, location.location_code).find((item) => item.language_code === context.get().language_code) || compatibleLanguages(catalog, location.location_code)[0];
    const market = findMarket(catalog, location.location_code, currentLanguage?.language_code);
    if (!market) return;
    context.set({ domain: activeProfile()?.domain, ...market });
    persistActiveMarket(market);
  };

  const commitLanguage = () => {
    const languages = compatibleLanguages(catalog, context.get().location_code);
    const language = languages.find((item) => item.language_name.toLowerCase() === languageInput.value.trim().toLowerCase() || item.language_code === languageInput.value.trim());
    if (!language) {
      languageInput.setCustomValidity("请选择该国家支持的语言");
      languageInput.reportValidity();
      languageInput.value = context.get().language_name;
      return;
    }
    languageInput.setCustomValidity("");
    const market = findMarket(catalog, context.get().location_code, language.language_code);
    context.set({ domain: activeProfile()?.domain, ...market });
    persistActiveMarket(market);
  };

  countryInput.addEventListener("input", () => countryInput.setCustomValidity(""));
  countryInput.addEventListener("change", commitCountry);
  languageInput.addEventListener("input", () => languageInput.setCustomValidity(""));
  languageInput.addEventListener("change", commitLanguage);

  const render = () => {
    select.replaceChildren(...profiles.map((profile) => new Option(profile.label, profile.domain)));
    list.replaceChildren(...profiles.map((profile) => {
      const item = createElement("li", "v2-site-row");
      const fields = createElement("div", "v2-site-fields");
      const label = document.createElement("input");
      label.value = profile.label;
      label.maxLength = 80;
      label.setAttribute("aria-label", `重命名 ${profile.domain}`);
      fields.append(label, createElement("span", "", profile.domain));
      const rename = createElement("button", "", "保存名称");
      rename.type = "button";
      rename.dataset.v2SiteRename = profile.domain;
      rename.textContent = "编辑";
      const remove = createElement("button", "secondary", "删除");
      remove.type = "button";
      remove.dataset.v2SiteRemove = profile.domain;
      remove.disabled = profiles.length <= 1;
      const meta = createElement("div", "v2-site-profile-meta", `${profile.location_name || "United States"} · ${profile.language_name || "English"} · ${profile.competitors?.length || 0} 个竞争对手`);
      fields.append(meta);
      item.append(fields, rename, remove);
      return item;
    }));
    if (!profiles.length) list.replaceChildren(createElement("li", "v2-sites-empty", "尚未添加网站，请在上方创建第一个网站资料。"));
    if (!profiles.length) {
      select.replaceChildren(new Option("尚未添加网站", ""));
      select.disabled = true;
      return;
    }
    select.disabled = false;
    const profile = resolveActiveProfile(profiles, normalizeDomain(storage.getItem(ACTIVE_SITE_KEY)));
    activateSiteProfile({ root: shell, select, title: shell.querySelector("#v2DashboardSite"), context, profile, market: marketForProfile(profile) });
  };

  bindSiteSelection({ shell, select, storage, context, activeProfile, marketForProfile });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError();
    const base = normalizeSiteProfile({ domain: form.elements.domain.value, label: form.elements.label.value });
    if (!base) return showError("请输入有效的根域名，例如 example.com。");
    const market = context.get();
    const competitorValidation = validateCompetitors(selectedCompetitors(form), base.domain);
    if (competitorValidation.error) return showError(competitorValidation.error);
    const existing = profiles.find((item) => item.domain === base.domain);
    const profile = siteProfileFormPayload(existing, { ...base, location_code: market.location_code, language_code: market.language_code, competitors: competitorValidation.competitors });
    if (source !== "d1") return showError("当前未连接 D1，无法保存；请恢复连接后重试。");
    try {
      const saved = await siteApi(fetchImpl, "POST", profile);
      profiles = [...profiles.filter((item) => item.domain !== saved.domain), saved];
      storage.setItem(ACTIVE_SITE_KEY, saved.domain);
      form.reset();
      render();
      select.value = saved.domain;
      select.dispatchEvent(new Event("change"));
      showError(`保存成功：服务器规范化后的根域名为 ${saved.domain}。`);
    } catch (failure) { showError(failure.message); }
  });
  list.addEventListener("click", async (event) => {
    const rename = event.target.closest("[data-v2-site-rename]");
    const remove = event.target.closest("[data-v2-site-remove]");
    if (rename) {
      const profile = profiles.find((item) => item.domain === rename.dataset.v2SiteRename);
      if (!profile) return;
      select.value = profile.domain;
      select.dispatchEvent(new Event("change"));
      form.elements.label.value = profile.label;
      form.elements.domain.value = profile.domain;
      [...form.querySelectorAll("[data-v2-competitor]")].forEach((input, index) => { input.value = profile.competitors?.[index] || ""; });
      form.elements.label.focus();
    } else if (remove) {
      if (source !== "d1") return showError("当前未连接 D1，无法删除。");
      try {
        await siteApi(fetchImpl, "DELETE", { domain: remove.dataset.v2SiteRemove });
        profiles = profiles.filter((profile) => profile.domain !== remove.dataset.v2SiteRemove);
        render();
        if (profiles.length) select.dispatchEvent(new Event("change"));
      } catch (failure) { showError(failure.message); }
    } else return;
  });
  shell.querySelector("[data-v2-export-sites]").addEventListener("click", () => {
    const anchor = document.createElement("a");
    anchor.href = profileExportUrl();
    anchor.download = `seo-pro-v2-sites-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
  });
  const importFile = shell.querySelector("[data-v2-import-file]");
  const importButton = shell.querySelector("[data-v2-import-sites]");
  importButton.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    showError();
    if (source !== "d1") { showError("当前未连接 D1，无法导入网站配置。"); importFile.value = ""; return; }
    try {
      const envelope = parseSiteProfileImportText(await file.text());
      if (!window.confirm(`将导入 ${envelope.profiles.length} 个网站配置；同域名配置会被覆盖。是否继续？`)) return;
      importButton.disabled = true;
      const imported = await importSiteProfileEnvelope(fetchImpl, envelope);
      profiles = imported.profiles;
      const preferred = profiles.find((profile) => profile.domain === select.value)?.domain || profiles[0]?.domain || "";
      if (preferred) storage.setItem(ACTIVE_SITE_KEY, preferred);
      render();
      if (preferred) { select.value = preferred; select.dispatchEvent(new Event("change")); }
      showError(`导入完成：已保存 ${profiles.length} 个网站。列表显示的是服务器规范化后的根域名。`);
    } catch (failure) {
      showError(`导入失败：${failure.message || "文件无效，数据库未更改。"}`);
    } finally {
      importButton.disabled = false;
      importFile.value = "";
    }
  });
  retrySync.addEventListener("click", async () => {
    const failed = profileSync.dirtyDomains().filter((domain) => profileSync.get(domain)?.status === "failed");
    retrySync.disabled = true;
    await Promise.all(failed.map((domain) => profileSync.retry(domain)));
    retrySync.disabled = false;
  });
  render();
  return { context, fetchImpl };
}

function buildShell() {
  const content = document.querySelector("main.wrap");
  if (!content || document.querySelector(".v2-app-shell")) return;
  annotateExistingTools(content);
  markDomainFields(content);
  const keywordResearchWorkspace = createKeywordResearchWorkspace(content);
  const competitorWorkspace = createCompetitorResearchWorkspace(content);
  createBacklinkResearchWorkspace(content);
  createOpportunityWorkspace(content);
  createWebsiteDataWorkspace(content);
  content.prepend(createOrganicIntelligenceWorkspace());
  content.querySelector(".top")?.classList.add("v2-legacy-heading");
  content.querySelector("h1")?.classList.add("v2-legacy-heading");
  content.querySelector("h1 + .lead")?.classList.add("v2-legacy-heading");
  content.prepend(createOverview());
  content.append(createKeywordLibrarySection());
  content.append(
    createPlaceholder("more", "更多工具", "Content Brief 已按项目决定暂停，现有代码和数据继续保留，但不占用主工作区。"),
    createGscSettingsWorkspace(),
  );
  const sites = createElement("section", "panel v2-sites-workspace");
  sites.dataset.v2View = "sites";
  sites.innerHTML = `
    <div class="v2-sites-hero">
      <div>
        <div class="v2-sites-eyebrow">SITE WORKSPACE</div>
        <h2>网站配置</h2>
        <p>管理站点、默认研究市场和竞争对手。所有站点资料保存到 D1。</p>
      </div>
      <div class="v2-sites-hero-note">D1 · 可迁移配置</div>
    </div>
  `;

  const form = document.createElement("form");
  form.className = "v2-site-form";
  form.dataset.v2SiteForm = "";
  form.innerHTML = `
    <div class="v2-site-form-head">
      <div>
        <b>添加或编辑网站</b>
        <span>域名会自动规范化为可注册根域名，例如 great-ocean-waterproof.com。</span>
      </div>
      <button type="submit" class="v2-site-save">保存网站</button>
    </div>
    <div class="v2-site-core-fields">
      <label>
        <span>网站名称</span>
        <input name="label" maxlength="80" placeholder="例如 Great Ocean Waterproof" aria-label="网站名称">
      </label>
      <label>
        <span>根域名</span>
        <input name="domain" required placeholder="example.com" aria-label="网站根域名">
      </label>
    </div>
    <details class="v2-site-competitor-details">
      <summary>
        <span>竞争对手（可选）</span>
        <small>最多 5 个，可稍后在竞争对手研究中补充</small>
      </summary>
      <div class="v2-competitors" aria-label="竞争对手（最多五个）">
        <label>竞争对手 1<input data-v2-competitor="1" placeholder="competitor.com"></label>
        <label>竞争对手 2<input data-v2-competitor="2" placeholder="competitor.com"></label>
        <label>竞争对手 3<input data-v2-competitor="3" placeholder="competitor.com"></label>
        <label>竞争对手 4<input data-v2-competitor="4" placeholder="competitor.com"></label>
        <label>竞争对手 5<input data-v2-competitor="5" placeholder="competitor.com"></label>
      </div>
    </details>
  `;

  const syncWarning = createElement("div", "v2-sync-warning");
  syncWarning.dataset.v2SyncWarning = "";
  syncWarning.setAttribute("role", "status");
  const retryMarket = createElement("button", "v2-retry-sync", "重试加载市场");
  retryMarket.type = "button";
  retryMarket.dataset.v2RetryMarket = "";
  retryMarket.hidden = true;
  const retrySync = createElement("button", "v2-retry-sync", "重试同步");
  retrySync.type = "button";
  retrySync.dataset.v2RetrySync = "";
  retrySync.hidden = true;
  const siteError = createElement("div", "v2-site-error");
  siteError.dataset.v2SiteError = "";
  siteError.setAttribute("role", "alert");

  const actions = createElement("div", "v2-site-portability");
  actions.innerHTML = `
    <div>
      <b>配置迁移</b>
      <span>导出版本化 JSON，或导入已有网站配置。导入会覆盖同域名配置，请确认后操作。</span>
    </div>
    <div class="v2-site-portability-actions">
      <button type="button" data-v2-export-sites>导出 JSON</button>
      <button type="button" data-v2-import-sites>导入 JSON</button>
      <input type="file" accept="application/json,.json" data-v2-import-file hidden>
    </div>
  `;

  const list = document.createElement("ul");
  list.dataset.v2SiteList = "";
  list.className = "v2-site-list";
  const listSection = createElement("div", "v2-sites-list-section");
  listSection.innerHTML = `
    <div class="v2-sites-list-head">
      <div>
        <b>已保存网站</b>
        <span>切换当前网站后，关键词库、Cluster、竞争对手和机会数据都会归属到对应站点。</span>
      </div>
    </div>
  `;
  listSection.append(list);

  const editorGrid = createElement("div", "v2-sites-editor-grid");
  editorGrid.append(form, actions);
  sites.append(syncWarning, retryMarket, retrySync, editorGrid, siteError, listSection);
  content.append(sites);

  const shell = createElement("div", "v2-app-shell");
  shell.innerHTML = `<aside class="v2-sidebar" data-v2-sidebar><div class="v2-brand">SEO Pro <span>V2</span></div><label class="v2-site-picker">当前网站<select data-v2-site-select aria-label="当前网站"></select></label><nav data-v2-nav-list aria-label="SEO Pro V2 主导航"></nav></aside><div class="v2-workspace"><header class="v2-workspace-header"><div class="v2-header-main"><button type="button" class="v2-menu" data-v2-menu aria-label="打开导航">☰</button><div><span class="label">SEO PRO V2</span><h2 data-v2-view-title>总览</h2></div></div>${marketControlsMarkup()}<span class="alpha">ALPHA · PREVIEW</span></header></div>`;
  document.body.prepend(shell);
  shell.querySelector(".v2-workspace").append(content);
  renderNavigation(shell);
  setResearchControlsReady(shell, false);
  const marketInputs = [shell.querySelector("[data-v2-market-country]"), shell.querySelector("[data-v2-market-language]")].filter(Boolean);
  marketInputs.forEach((input) => { input.disabled = true; });
  const gate = window.__seoProV2ResearchGate;
  let dashboardCleanup = () => {};
  let dashboardDecisionCleanup = () => {};
  let keywordLibraryCleanup = () => {};
  let competitorIntelligenceCleanup = () => {};
  let organicIntelligenceCleanup = () => {};
  let clusterSerpVerificationCleanup = () => {};
  let gscSettingsCleanup = () => {};
  const marketInitialization = createMarketInitializationCoordinator({
    initialize: () => initializeSites(shell),
    onReady: ({ context, fetchImpl }) => {
      gate.ready = true;
      gate.submit = (workflow, fields) => submitSeoResearchRequest(workflow, fields, { context, fetchImpl });
      dashboardCleanup();
      dashboardCleanup = mountDashboard({ root: shell, context, fetchImpl });
      dashboardDecisionCleanup();
      dashboardDecisionCleanup = mountDashboardDecision({ root: shell, context, fetchImpl });
      keywordLibraryCleanup();
      keywordLibraryCleanup = mountKeywordLibrary({ root: shell, context, fetchImpl });
      competitorIntelligenceCleanup();
      competitorIntelligenceCleanup = mountCompetitorIntelligence({ root: shell, competitorWorkspace });
      organicIntelligenceCleanup();
      organicIntelligenceCleanup = mountOrganicIntelligence({ root: shell, context, fetchImpl });
      clusterSerpVerificationCleanup();
      clusterSerpVerificationCleanup = mountClusterSerpVerificationFlow({
        root: shell,
        keywordResearchWorkspace,
        context,
      });
      gscSettingsCleanup();
      gscSettingsCleanup = mountGscSettings({ root: shell, context, fetchImpl });
      setResearchControlsReady(shell, true);
      marketInputs.forEach((input) => { input.disabled = false; });
      retryMarket.hidden = true;
    },
    onFailure: () => {
      gate.ready = false;
      gate.submit = null;
      setResearchControlsReady(shell, false);
      marketInputs.forEach((input) => { input.disabled = true; });
      syncWarning.textContent = "关键词市场目录加载失败。请检查网络后点击“重试加载市场”；加载成功前研究查询保持关闭。";
      retryMarket.hidden = false;
    },
  });
  retryMarket.addEventListener("click", () => {
    retryMarket.disabled = true;
    syncWarning.textContent = "正在重新加载关键词市场…";
    marketInitialization.retry().catch(() => {}).finally(() => { retryMarket.disabled = false; });
  });
  marketInitialization.start().catch(() => {});
  shell.querySelector("[data-v2-menu]").addEventListener("click", () => toggleMobileNavigation(shell));
  shell.addEventListener("click", (event) => {
    const shortcut = event.target.closest("[data-v2-go]");
    if (shortcut) writeHashView(window.location, shortcut.dataset.v2Go);
  });
  bindHashRouting(window, shell);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildShell);
  else buildShell();
}
