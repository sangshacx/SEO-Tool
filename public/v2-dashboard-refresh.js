export const DASHBOARD_REFRESH_ENDPOINT = "/api/v2/dashboard/refresh";
export const DASHBOARD_REFRESH_PREVIEW_ENDPOINT = "/api/v2/dashboard/refresh-preview";
export const DASHBOARD_REFRESH_MODULES = Object.freeze([
  "organic",
  "backlinks",
  "competitors",
  "keyword_opportunities",
  "backlink_opportunities",
]);

const MODULE_LABELS = Object.freeze({
  organic: "Organic Overview + Top Keywords",
  backlinks: "Backlink Overview",
  competitors: "Competitor Summary",
  keyword_opportunities: "Keyword Opportunities",
  backlink_opportunities: "Backlink Opportunities",
});
const REVIEW_STATUSES = new Set(["ready", "confirmation_required", "skip"]);
const RESULT_STATUSES = new Set(["success", "partial_failure", "error", "skip"]);

const DEFAULT_FLIGHT_SCOPE = {};
const inFlightRefreshes = new WeakMap();
let dialogSequence = 0;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function scopeBody(scope = {}) {
  const locationCode = Number(scope.location_code);
  return {
    site: String(scope.site || scope.domain || "").trim().toLowerCase(),
    location_code: Number.isInteger(locationCode) ? locationCode : scope.location_code,
    language_code: String(scope.language_code || "").trim().toLowerCase(),
  };
}

function sameScope(left, right) {
  const a = scopeBody(left);
  const b = scopeBody(right);
  return a.site === b.site && a.location_code === b.location_code && a.language_code === b.language_code;
}

function validCost(value, allowUnknown = false) {
  return (typeof value === "number" && Number.isFinite(value) && value >= 0) || (allowUnknown && value === null);
}

function money(value) {
  return validCost(value) ? `$${value.toFixed(5)}` : "费用未知";
}

function node(documentImpl, tagName, value = "") {
  const element = documentImpl.createElement(tagName);
  if (value !== "") element.textContent = value;
  return element;
}

function controls(dialog) {
  return [...dialog.querySelectorAll("[data-v2-dashboard-refresh-module]")];
}

function setBusy(dialog, busy) {
  const submit = dialog.querySelector("[data-v2-dashboard-refresh-submit]");
  if (submit) submit.disabled = busy || !controls(dialog).some((control) => control.dataset.v2DashboardRefreshSelectable === "true");
  controls(dialog).forEach((control) => {
    control.disabled = busy || control.dataset.v2DashboardRefreshSelectable !== "true";
  });
  dialog.dataset.v2DashboardRefreshBusy = busy ? "true" : "false";
}

function dialogStatus(dialog, value) {
  const status = dialog.querySelector("[data-v2-dashboard-refresh-status]");
  if (status) status.textContent = value;
}

function moduleState(result = {}) {
  if (result.status === "confirmation_required") return { live: true, selectable: true, label: "需要实时更新 · 可能付费" };
  if (result.status === "ready") return { live: false, selectable: true, label: "缓存可用 · $0" };
  return { live: false, selectable: false, label: "暂不更新" };
}

function selectedModuleIds(inputs) {
  const selected = new Set((Array.isArray(inputs) ? inputs : []).filter((input) => input.checked).map((input) => input.value));
  return DASHBOARD_REFRESH_MODULES.filter((moduleId) => selected.has(moduleId));
}

function selectedModuleMap(modules, selectedModules) {
  if (!isObject(modules)) return null;
  const keys = Object.keys(modules);
  if (keys.length !== selectedModules.length || keys.some((key) => !selectedModules.includes(key))) return null;
  return modules;
}

function validReviewModule(moduleId, result) {
  if (!isObject(result) || !REVIEW_STATUSES.has(result.status)) return false;
  if (result.actual_cost_usd !== 0 || result.task_count !== 0 || result.cache_write_ok !== true) return false;
  if (result.status === "ready") return result.cached === true;
  if (result.status === "skip") {
    return ["competitors", "keyword_opportunities", "backlink_opportunities"].includes(moduleId)
      && result.cached === true
      && result.error?.code === "NO_PROVIDER";
  }
  return result.cached === false && result.error?.code === "LIVE_REQUEST_CONFIRMATION_REQUIRED";
}

function validateReviewPayload(payload, expectedScope, status) {
  const selected = DASHBOARD_REFRESH_MODULES;
  if (!isObject(payload) || !isObject(payload.data) || !sameScope(payload.data.scope, expectedScope)) return null;
  if (!isObject(payload.meta) || payload.meta.preview_only !== true || payload.meta.actual_cost_usd !== 0 || payload.meta.total_actual_cost_usd !== 0 || payload.meta.task_count !== 0) return null;
  const modules = selectedModuleMap(payload.data.modules, selected);
  if (!modules) return null;
  if (status !== 200 || payload.ok !== true) return null;
  return selected.every((moduleId) => validReviewModule(moduleId, modules[moduleId])) ? modules : null;
}

function validResultModule(result) {
  if (!isObject(result) || !RESULT_STATUSES.has(result.status)) return false;
  if (typeof result.cached !== "boolean" || !validCost(result.actual_cost_usd, true)) return false;
  if (!(result.task_count === null || (Number.isInteger(result.task_count) && result.task_count >= 0))) return false;
  if (typeof result.cache_write_ok !== "boolean") return false;
  if (["partial_failure", "error"].includes(result.status) && !isObject(result.error)) return false;
  return true;
}

function validateRefreshPayload(payload, expectedScope, selectedModules) {
  if (!isObject(payload) || payload.ok !== true || !isObject(payload.data) || !sameScope(payload.data.scope, expectedScope)) return false;
  const modules = selectedModuleMap(payload.data.modules, selectedModules);
  if (!modules || !Object.values(modules).every(validResultModule)) return false;
  const meta = payload.meta;
  if (!isObject(meta) || !validCost(meta.actual_cost_usd, true) || !validCost(meta.total_actual_cost_usd, true)) return false;
  if (!(meta.task_count === null || (Number.isInteger(meta.task_count) && meta.task_count >= 0))) return false;
  if (typeof meta.actual_cost_usd === "number" && typeof meta.total_actual_cost_usd === "number" && Math.abs(meta.actual_cost_usd - meta.total_actual_cost_usd) > 1e-9) return false;
  const knownCosts = Object.values(modules).map((module) => module.actual_cost_usd);
  if (knownCosts.every((cost) => typeof cost === "number") && typeof meta.total_actual_cost_usd === "number") {
    const sum = knownCosts.reduce((total, cost) => total + cost, 0);
    if (Math.abs(sum - meta.total_actual_cost_usd) > 1e-9) return false;
  }
  return true;
}

export function buildRefreshReviewRequest(scope) {
  return { url: DASHBOARD_REFRESH_PREVIEW_ENDPOINT, body: { ...scopeBody(scope), modules: [...DASHBOARD_REFRESH_MODULES] } };
}

export function buildRefreshSubmitRequest(scope, inputs) {
  const list = Array.isArray(inputs) ? inputs : [];
  const selected = selectedModuleIds(list);
  const confirmedLiveModules = selected.filter((moduleId) => list.some((input) => input.value === moduleId && input.checked && input.dataset.v2DashboardRefreshLive === "true"));
  const body = { ...scopeBody(scope), modules: selected };
  if (confirmedLiveModules.length) {
    body.confirmed_live_modules = confirmedLiveModules;
    body.allow_live_request = true;
  }
  return body;
}

export function createRefreshReviewDialog(documentImpl = document) {
  const dialog = node(documentImpl, "dialog");
  const titleId = `v2DashboardRefreshTitle-${++dialogSequence}`;
  dialog.className = "v2-dashboard-refresh-dialog";
  dialog.dataset.v2DashboardRefreshDialog = "";
  dialog.hidden = true;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", titleId);

  const header = node(documentImpl, "div"); header.className = "v2-dashboard-refresh-head";
  const title = node(documentImpl, "h2", "更新总览数据"); title.setAttribute("id", titleId);
  const close = node(documentImpl, "button", "关闭"); close.type = "button"; close.dataset.v2DashboardRefreshClose = "";
  header.append(title, close);
  const description = node(documentImpl, "p", "先检查缓存状态：此步骤费用 $0，不会发起实时请求。"); description.className = "v2-dashboard-refresh-copy";
  const reviewedScope = node(documentImpl, "p", ""); reviewedScope.className = "v2-dashboard-refresh-scope"; reviewedScope.dataset.v2DashboardRefreshScope = "";
  const status = node(documentImpl, "p", ""); status.dataset.v2DashboardRefreshStatus = ""; status.setAttribute("role", "status");
  const modules = node(documentImpl, "div"); modules.dataset.v2DashboardRefreshModules = ""; modules.className = "v2-dashboard-refresh-modules";
  const results = node(documentImpl, "div"); results.dataset.v2DashboardRefreshResults = ""; results.className = "v2-dashboard-refresh-results";
  const actions = node(documentImpl, "div"); actions.className = "v2-dashboard-refresh-actions";
  const submit = node(documentImpl, "button", "按所选项更新"); submit.type = "button"; submit.dataset.v2DashboardRefreshSubmit = ""; submit.disabled = true;
  actions.append(submit);
  dialog.append(header, description, reviewedScope, status, modules, results, actions);
  return dialog;
}

export function renderRefreshReview(dialog, modules, documentImpl = document, reviewedScope = null) {
  const list = dialog.querySelector("[data-v2-dashboard-refresh-modules]");
  if (!list) return [];
  list.replaceChildren();
  const scope = dialog.querySelector("[data-v2-dashboard-refresh-scope]");
  if (scope) scope.textContent = reviewedScope ? `审核范围：${reviewedScope.site} · ${reviewedScope.location_code} · ${reviewedScope.language_code}` : "";
  const inputs = [];
  for (const moduleId of DASHBOARD_REFRESH_MODULES.filter((id) => Object.hasOwn(modules || {}, id))) {
    const state = moduleState(modules[moduleId]);
    const row = node(documentImpl, "label"); row.className = "v2-dashboard-refresh-module";
    const input = node(documentImpl, "input");
    input.type = "checkbox";
    input.value = moduleId;
    input.checked = false;
    input.disabled = !state.selectable;
    input.dataset.v2DashboardRefreshModule = "";
    input.dataset.v2DashboardRefreshLive = state.live ? "true" : "false";
    input.dataset.v2DashboardRefreshSelectable = state.selectable ? "true" : "false";
    input.setAttribute("aria-label", `${MODULE_LABELS[moduleId]}：${state.label}`);
    const copy = node(documentImpl, "span"); copy.className = "v2-dashboard-refresh-module-copy";
    const label = node(documentImpl, "strong", MODULE_LABELS[moduleId]);
    const detail = node(documentImpl, "small", state.label);
    copy.append(label, detail);
    row.append(input, copy);
    list.append(row);
    inputs.push(input);
  }
  const submit = dialog.querySelector("[data-v2-dashboard-refresh-submit]");
  if (submit) submit.disabled = inputs.every((input) => input.disabled);
  return inputs;
}

export function resetPaidModuleToggles(dialog) {
  controls(dialog).filter((input) => input.dataset.v2DashboardRefreshLive === "true").forEach((input) => {
    input.checked = false;
    input.disabled = true;
    input.dataset.v2DashboardRefreshSelectable = "false";
  });
}

export function renderRefreshResults(dialog, modules, meta = {}, documentImpl = document) {
  const root = dialog.querySelector("[data-v2-dashboard-refresh-results]");
  if (!root) return;
  root.replaceChildren();
  let unknownModuleCost = false;
  for (const moduleId of DASHBOARD_REFRESH_MODULES.filter((id) => Object.hasOwn(modules || {}, id))) {
    const result = modules[moduleId] || {};
    if (!validCost(result.actual_cost_usd)) unknownModuleCost = true;
    const row = node(documentImpl, "div"); row.className = "v2-dashboard-refresh-result";
    const heading = node(documentImpl, "strong", MODULE_LABELS[moduleId]);
    const details = node(documentImpl, "span", `${result.status || "unknown"} · ${Number.isInteger(result.task_count) ? `${result.task_count} 个任务` : "任务数未知"} · ${money(result.actual_cost_usd)}`);
    row.append(heading, details);
    if (result.cache_write_ok === false) {
      const warning = node(documentImpl, "small", "缓存写入失败：下次更新可能再次产生费用。"); warning.className = "v2-dashboard-refresh-cache-warning"; row.append(warning);
    }
    if (typeof result.warning === "string") row.append(node(documentImpl, "small", result.warning));
    if (typeof result.error?.message === "string") row.append(node(documentImpl, "small", result.error.message));
    root.append(row);
  }
  const totalCost = unknownModuleCost ? null : meta.total_actual_cost_usd;
  const total = node(documentImpl, "p", `实际总费用：${money(totalCost)}`);
  total.className = "v2-dashboard-refresh-total";
  root.append(total);
}

async function postRefresh(fetchImpl, body, endpoint = DASHBOARD_REFRESH_ENDPOINT) {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

export async function reviewDashboardRefresh({ fetchImpl = globalThis.fetch, scope } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("Fetch is not available.");
  const request = buildRefreshReviewRequest(scope);
  const { response, payload } = await postRefresh(fetchImpl, request.body, request.url);
  if (response.status !== 200 || !response.ok) {
    throw new Error(payload?.error?.message || "无法检查更新状态。");
  }
  const modules = validateReviewPayload(payload, request.body, response.status);
  if (!modules) throw new Error("刷新检查响应无效，未授权任何实时模块。");
  return modules;
}

export function submitDashboardRefresh({
  fetchImpl = globalThis.fetch,
  scope,
  selectedModules,
  review,
  onDashboardReload = () => {},
  onRequestSettled = () => {},
  flightScope = DEFAULT_FLIGHT_SCOPE,
} = {}) {
  if (typeof fetchImpl !== "function") return Promise.reject(new TypeError("Fetch is not available."));
  const selected = DASHBOARD_REFRESH_MODULES.filter((moduleId) => Array.isArray(selectedModules) && selectedModules.includes(moduleId));
  const live = selected.filter((moduleId) => review?.[moduleId]?.status === "confirmation_required");
  const body = { ...scopeBody(scope), modules: selected };
  if (live.length) {
    body.confirmed_live_modules = live;
    body.allow_live_request = true;
  }
  const scopeKey = flightScope && (typeof flightScope === "object" || typeof flightScope === "function") ? flightScope : DEFAULT_FLIGHT_SCOPE;
  let scopeFlights = inFlightRefreshes.get(scopeKey);
  if (!scopeFlights) {
    scopeFlights = new WeakMap();
    inFlightRefreshes.set(scopeKey, scopeFlights);
  }
  let fetchFlights = scopeFlights.get(fetchImpl);
  if (!fetchFlights) {
    fetchFlights = new Map();
    scopeFlights.set(fetchImpl, fetchFlights);
  }
  const requestKey = JSON.stringify(body);
  const existing = fetchFlights.get(requestKey);
  if (existing) return existing;
  const request = postRefresh(fetchImpl, body)
    .then(({ response, payload }) => {
      if (!response.ok || response.status !== 200) throw new Error(payload?.error?.message || "总览更新失败。");
      if (!validateRefreshPayload(payload, body, selected)) throw new Error("总览更新响应无效，未重新读取数据。");
      return payload;
    });
  const pending = request
    .finally(() => Promise.resolve(onRequestSettled()).catch(() => {}))
    .then(async (payload) => {
      await Promise.resolve(onDashboardReload()).catch(() => {});
      return payload;
    });
  fetchFlights.set(requestKey, pending);
  pending.finally(() => {
    if (fetchFlights.get(requestKey) === pending) fetchFlights.delete(requestKey);
    if (!fetchFlights.size) scopeFlights.delete(fetchImpl);
  }).catch(() => {});
  return pending;
}

function focusableControls(dialog) {
  const candidates = [
    dialog.querySelector("[data-v2-dashboard-refresh-close]"),
    ...controls(dialog),
    dialog.querySelector("[data-v2-dashboard-refresh-submit]"),
  ].filter(Boolean);
  return [...new Set(candidates)].filter((control) => !control.disabled && !control.hidden);
}

export function mountDashboardRefresh({ root, fetchImpl = globalThis.fetch, getScope, onDashboardReload = () => {}, onStatus = () => {} } = {}) {
  if (!root || typeof getScope !== "function" || typeof fetchImpl !== "function") return { open: () => Promise.resolve(), destroy: () => {} };
  const documentImpl = root.ownerDocument || globalThis.document;
  const host = documentImpl.body || root;
  const dialog = createRefreshReviewDialog(documentImpl);
  host.append(dialog);
  const close = dialog.querySelector("[data-v2-dashboard-refresh-close]");
  const submit = dialog.querySelector("[data-v2-dashboard-refresh-submit]");
  const results = dialog.querySelector("[data-v2-dashboard-refresh-results]");
  const nativeDialog = typeof dialog.showModal === "function" && typeof dialog.close === "function";
  let review = {};
  let reviewedScope = null;
  let opener = null;
  let isolated = [];
  let destroyed = false;
  const flightScope = {};

  const restoreBackground = () => {
    isolated.forEach(({ element, inert, ariaHidden, pointerEvents }) => {
      element.inert = inert;
      if (element.style) element.style.pointerEvents = pointerEvents;
      if (ariaHidden === null) element.removeAttribute?.("aria-hidden");
      else element.setAttribute?.("aria-hidden", ariaHidden);
    });
    isolated = [];
  };

  const isolateBackground = () => {
    restoreBackground();
    isolated = [...(host.children || [])].filter((element) => element !== dialog).map((element) => ({
      element,
      inert: Boolean(element.inert),
      ariaHidden: element.getAttribute?.("aria-hidden") ?? null,
      pointerEvents: element.style?.pointerEvents || "",
    }));
    isolated.forEach(({ element }) => {
      element.inert = true;
      if (element.style) element.style.pointerEvents = "none";
      element.setAttribute?.("aria-hidden", "true");
    });
  };

  const finishClose = (restoreFocus = true) => {
    dialog.hidden = true;
    dialog.removeAttribute?.("open");
    restoreBackground();
    if (restoreFocus && opener && typeof opener.focus === "function") opener.focus();
  };

  const closeDialog = (restoreFocus = true) => {
    if (nativeDialog && dialog.open) dialog.close();
    finishClose(restoreFocus);
  };

  const handleClose = () => closeDialog(true);
  const handleNativeClose = () => finishClose(true);
  const handleCancel = (event) => { event.preventDefault(); closeDialog(true); };
  const handleKeydown = (event) => {
    if (dialog.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog(true);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = focusableControls(dialog);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && documentImpl.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && documentImpl.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!dialog.contains?.(documentImpl.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  };

  const open = (trigger = null) => {
    if (destroyed || dialog.dataset.v2DashboardRefreshBusy === "true") return Promise.resolve();
    opener = trigger && typeof trigger.focus === "function" ? trigger : documentImpl.activeElement;
    reviewedScope = null;
    review = {};
    resetPaidModuleToggles(dialog);
    renderRefreshReview(dialog, {}, documentImpl, null);
    results?.replaceChildren();
    const requestedScope = scopeBody(getScope());
    dialog.hidden = false;
    isolateBackground();
    if (nativeDialog && !dialog.open) dialog.showModal();
    else if (!nativeDialog) dialog.setAttribute("open", "");
    close?.focus?.();
    setBusy(dialog, true);
    dialogStatus(dialog, "正在检查缓存状态；本次费用 $0。");
    return reviewDashboardRefresh({ fetchImpl, scope: requestedScope })
      .then((nextReview) => {
        if (destroyed) return;
        review = nextReview;
        reviewedScope = requestedScope;
        renderRefreshReview(dialog, review, documentImpl, reviewedScope);
        dialogStatus(dialog, "请选择要更新的模块。仅明确勾选的实时模块才会执行付费请求。");
      })
      .catch((error) => { if (!destroyed) dialogStatus(dialog, error.message || "无法检查更新状态。"); })
      .finally(() => { if (!destroyed) setBusy(dialog, false); });
  };

  const handleSubmit = () => {
    if (!reviewedScope) { dialogStatus(dialog, "请先完成当前范围的缓存检查。"); return Promise.resolve(); }
    const selected = selectedModuleIds(controls(dialog));
    if (!selected.length) { dialogStatus(dialog, "请至少选择一个模块。"); return Promise.resolve(); }
    setBusy(dialog, true);
    dialogStatus(dialog, "正在更新已选模块；当前总览数据会保持显示。");
    return submitDashboardRefresh({
      fetchImpl,
      scope: reviewedScope,
      selectedModules: selected,
      review,
      onDashboardReload: () => destroyed ? Promise.resolve() : onDashboardReload(),
      onRequestSettled: () => resetPaidModuleToggles(dialog),
      flightScope,
    })
      .then((payload) => {
        if (destroyed) return;
        renderRefreshResults(dialog, payload.data.modules, payload.meta, documentImpl);
        dialogStatus(dialog, "更新已完成；总览已重新读取缓存数据。");
        onStatus("总览更新已完成，正在读取缓存结果。");
      })
      .catch((error) => { if (!destroyed) dialogStatus(dialog, error.message || "总览更新失败。"); })
      .finally(() => { if (!destroyed) setBusy(dialog, false); });
  };

  close?.addEventListener("click", handleClose);
  submit?.addEventListener("click", handleSubmit);
  dialog.addEventListener("cancel", handleCancel);
  dialog.addEventListener("close", handleNativeClose);
  documentImpl.addEventListener?.("keydown", handleKeydown);

  return {
    open,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      closeDialog(false);
      close?.removeEventListener("click", handleClose);
      submit?.removeEventListener("click", handleSubmit);
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleNativeClose);
      documentImpl.removeEventListener?.("keydown", handleKeydown);
      dialog.remove();
      review = {};
      reviewedScope = null;
      opener = null;
    },
  };
}
