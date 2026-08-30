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

function initializeSites(shell) {
  const storage = window.localStorage;
  let profiles = loadSiteProfiles(storage);
  const select = shell.querySelector("[data-v2-site-select]");
  const list = shell.querySelector("[data-v2-site-list]");

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
      const remove = createElement("button", "secondary", "删除");
      remove.type = "button";
      remove.dataset.v2SiteRemove = profile.domain;
      remove.disabled = profiles.length <= 1;
      item.append(fields, rename, remove);
      return item;
    }));
    const active = normalizeDomain(storage.getItem(ACTIVE_SITE_KEY)) || profiles[0].domain;
    select.value = profiles.some((profile) => profile.domain === active) ? active : profiles[0].domain;
    applyActiveDomain(shell, select.value);
    shell.querySelector("#v2ActiveSiteTitle").textContent = select.value;
  };

  select.addEventListener("change", () => {
    storage.setItem(ACTIVE_SITE_KEY, select.value);
    applyActiveDomain(shell, select.value);
    shell.querySelector("#v2ActiveSiteTitle").textContent = select.value;
  });
  shell.querySelector("[data-v2-site-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const profile = normalizeSiteProfile({ domain: form.elements.domain.value, label: form.elements.label.value });
    if (!profile) return;
    profiles = dedupeSiteProfiles([...profiles.filter((item) => item.domain !== profile.domain), profile]);
    storage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    storage.setItem(ACTIVE_SITE_KEY, profile.domain);
    form.reset();
    render();
  });
  list.addEventListener("click", (event) => {
    const rename = event.target.closest("[data-v2-site-rename]");
    const remove = event.target.closest("[data-v2-site-remove]");
    if (rename) {
      const label = rename.closest("li").querySelector("input").value;
      profiles = renameSiteProfile(profiles, rename.dataset.v2SiteRename, label);
    } else if (remove) {
      profiles = removeSiteProfile(profiles, remove.dataset.v2SiteRemove);
    } else return;
    storage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    render();
  });
  render();
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
  const sites = createPlaceholder("sites", "网站管理", "这些网站资料保存在当前浏览器中；切换网站不会自动发起分析。"), form = document.createElement("form");
  form.className = "v2-site-form"; form.dataset.v2SiteForm = "";
  form.innerHTML = `<input name="label" maxlength="80" placeholder="网站名称（可选）"><input name="domain" required placeholder="example.com"><button type="submit">添加网站</button>`;
  const list = document.createElement("ul"); list.dataset.v2SiteList = ""; list.className = "v2-site-list";
  sites.append(form, list); content.append(sites);

  const shell = createElement("div", "v2-app-shell");
  shell.innerHTML = `<aside class="v2-sidebar" data-v2-sidebar><div class="v2-brand">SEO Pro <span>V2</span></div><label class="v2-site-picker">当前网站<select data-v2-site-select aria-label="当前网站"></select></label><nav data-v2-nav-list aria-label="SEO Pro V2 主导航"></nav></aside><div class="v2-workspace"><header class="v2-workspace-header"><button type="button" class="v2-menu" data-v2-menu aria-label="打开导航">☰</button><div><span class="label">SEO PRO V2</span><h2 data-v2-view-title>总览</h2></div><span class="alpha">ALPHA · PREVIEW</span></header></div>`;
  document.body.prepend(shell);
  shell.querySelector(".v2-workspace").append(content);
  renderNavigation(shell);
  initializeSites(shell);
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
