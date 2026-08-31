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

export const V2_VIEWS = Object.freeze([
  { id: "overview", label: "总览", group: "primary" },
  { id: "website", label: "网站数据", group: "research" },
  { id: "competitors", label: "竞争对手", group: "research" },
  { id: "keywords", label: "关键词", group: "research" },
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
  title.textContent = profile.domain;
  applyMarketToRoot(root, market);
  context.set({ domain: profile.domain, ...market });
  return true;
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
  const section = createElement("section", "v2-overview panel");
  section.dataset.v2View = "overview";
  section.innerHTML = `<div class="v2-overview-hero"><div><div class="label">当前网站</div><h1 id="v2ActiveSiteTitle">great-ocean-waterproof.com</h1><p class="lead">先查看网站和竞品概况，再进入需要的分析工具。</p></div><button type="button" data-v2-go="website">查看网站数据</button></div><div class="v2-quick-grid"><button type="button" data-v2-go="website"><b>网站数据</b><span>快照与历史趋势</span></button><button type="button" data-v2-go="competitors"><b>竞争对手</b><span>关键词与外链差距</span></button><button type="button" data-v2-go="keywords"><b>关键词研究</b><span>Explorer、Ideas 与计划</span></button><button type="button" data-v2-go="backlinks"><b>外链分析</b><span>引用域、详情与 Anchor</span></button><button type="button" data-v2-go="opportunities"><b>机会清单</b><span>筛选值得人工研究的域名</span></button></div><div class="note"><b>零费用首页：</b>打开总览不会调用 DataForSEO；只有你在具体工具中明确允许的实时查询才可能产生费用。</div>`;
  return section;
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
    activateSiteProfile({ root: shell, select, title: shell.querySelector("#v2ActiveSiteTitle"), context, profile, market: marketForProfile(profile) });
  };

  select.addEventListener("change", () => {
    storage.setItem(ACTIVE_SITE_KEY, select.value);
    const profile = activeProfile();
    activateSiteProfile({ root: shell, select, title: shell.querySelector("#v2ActiveSiteTitle"), context, profile, market: marketForProfile(profile) });
  });
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
  content.querySelector(".top")?.classList.add("v2-legacy-heading");
  content.querySelector("h1")?.classList.add("v2-legacy-heading");
  content.querySelector("h1 + .lead")?.classList.add("v2-legacy-heading");
  content.prepend(createOverview());
  content.append(
    createPlaceholder("more", "更多工具", "Content Brief 已按项目决定暂停，现有代码和数据继续保留，但不占用主工作区。"),
    createPlaceholder("settings", "费用与设置", "DataForSEO 费用仍由 Cost Guard、7 天缓存和 D1 用量记录共同控制。"),
  );
  const sites = createPlaceholder("sites", "网站管理", "网站、默认市场和竞争对手保存在 D1；可导出版本化 JSON，方便以后迁移到自己的域名。"), form = document.createElement("form");
  form.className = "v2-site-form"; form.dataset.v2SiteForm = "";
  form.innerHTML = `<input name="label" maxlength="80" placeholder="网站名称（可选）" aria-label="网站名称"><input name="domain" required placeholder="example.com" aria-label="网站根域名"><button type="submit">保存网站</button><div class="v2-competitors" aria-label="竞争对手（最多五个）"><label>竞争对手 1<input data-v2-competitor="1" placeholder="competitor.com"></label><label>竞争对手 2<input data-v2-competitor="2" placeholder="competitor.com"></label><label>竞争对手 3<input data-v2-competitor="3" placeholder="competitor.com"></label><label>竞争对手 4<input data-v2-competitor="4" placeholder="competitor.com"></label><label>竞争对手 5<input data-v2-competitor="5" placeholder="competitor.com"></label></div>`;
  const list = document.createElement("ul"); list.dataset.v2SiteList = ""; list.className = "v2-site-list";
  const syncWarning = createElement("div", "v2-sync-warning"); syncWarning.dataset.v2SyncWarning = ""; syncWarning.setAttribute("role", "status");
  const retryMarket = createElement("button", "v2-retry-sync", "重试加载市场"); retryMarket.type = "button"; retryMarket.dataset.v2RetryMarket = ""; retryMarket.hidden = true;
  const retrySync = createElement("button", "v2-retry-sync", "重试同步"); retrySync.type = "button"; retrySync.dataset.v2RetrySync = ""; retrySync.hidden = true;
  const siteError = createElement("div", "v2-site-error"); siteError.dataset.v2SiteError = ""; siteError.setAttribute("role", "alert");
  const actions = createElement("div", "v2-site-actions");
  actions.innerHTML = `<button type="button" data-v2-export-sites>导出网站配置 JSON</button><button type="button" data-v2-import-sites>导入网站配置 JSON</button><input type="file" accept="application/json,.json" data-v2-import-file hidden><span>导入会覆盖同域名配置；完成后显示服务器规范化的根域名。</span>`;
  sites.prepend(syncWarning, retryMarket, retrySync); sites.append(form, siteError, actions, list); content.append(sites);

  const shell = createElement("div", "v2-app-shell");
  shell.innerHTML = `<aside class="v2-sidebar" data-v2-sidebar><div class="v2-brand">SEO Pro <span>V2</span></div><label class="v2-site-picker">当前网站<select data-v2-site-select aria-label="当前网站"></select></label><nav data-v2-nav-list aria-label="SEO Pro V2 主导航"></nav></aside><div class="v2-workspace"><header class="v2-workspace-header"><div class="v2-header-main"><button type="button" class="v2-menu" data-v2-menu aria-label="打开导航">☰</button><div><span class="label">SEO PRO V2</span><h2 data-v2-view-title>总览</h2></div></div>${marketControlsMarkup()}<span class="alpha">ALPHA · PREVIEW</span></header></div>`;
  document.body.prepend(shell);
  shell.querySelector(".v2-workspace").append(content);
  renderNavigation(shell);
  setResearchControlsReady(shell, false);
  const marketInputs = [shell.querySelector("[data-v2-market-country]"), shell.querySelector("[data-v2-market-language]")].filter(Boolean);
  marketInputs.forEach((input) => { input.disabled = true; });
  const gate = window.__seoProV2ResearchGate;
  const marketInitialization = createMarketInitializationCoordinator({
    initialize: () => initializeSites(shell),
    onReady: ({ context, fetchImpl }) => {
      gate.ready = true;
      gate.submit = (workflow, fields) => submitSeoResearchRequest(workflow, fields, { context, fetchImpl });
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
