import assert from "node:assert/strict";
import test from "node:test";

import {
  DASHBOARD_REFRESH_MODULES,
  buildRefreshReviewRequest,
  createRefreshReviewDialog,
  mountDashboardRefresh,
  renderRefreshReview,
  reviewDashboardRefresh,
  submitDashboardRefresh,
} from "../public/v2-dashboard-refresh.js";

class FakeElement {
  constructor(tagName = "div", ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.style = {};
    this.className = "";
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.inert = false;
    this.type = "";
    this.value = "";
    this.parentNode = null;
    this._text = "";
  }

  set textContent(value) { this._text = value == null ? "" : String(value); this.children = []; }
  get textContent() { return [this._text, ...this.children.map((child) => child.textContent)].join(""); }
  append(...children) {
    children.filter(Boolean).forEach((child) => {
      child.remove?.();
      child.parentNode = this;
      if (!child.ownerDocument) child.ownerDocument = this.ownerDocument;
      this.children.push(child);
    });
  }
  replaceChildren(...children) { this._text = ""; this.children.forEach((child) => { child.parentNode = null; }); this.children = []; this.append(...children); }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, handler) { this.listeners.set(type, [...(this.listeners.get(type) || []), handler]); }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== handler)); }
  dispatchEvent(event = {}) {
    const next = { ...event, type: event.type, target: event.target || this, currentTarget: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    let result;
    for (const handler of this.listeners.get(next.type) || []) result = handler(next);
    return result;
  }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  contains(element) { return element === this || walk(this).includes(element); }
  querySelectorAll(selector) { return walk(this).filter((node) => matches(node, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class FakeDocument {
  constructor({ nativeDialog = false } = {}) {
    this.listeners = new Map();
    this.activeElement = null;
    this.nativeDialog = nativeDialog;
    this.body = new FakeElement("body", this);
  }
  createElement(tagName) {
    const element = new FakeElement(tagName, this);
    if (tagName === "dialog" && this.nativeDialog) {
      element.open = false;
      element.showModalCalls = 0;
      element.closeCalls = 0;
      element.showModal = function showModal() { this.showModalCalls += 1; this.open = true; this.setAttribute("open", ""); };
      element.close = function close() { this.closeCalls += 1; this.open = false; this.removeAttribute("open"); this.dispatchEvent({ type: "close" }); };
    }
    return element;
  }
  addEventListener(type, handler) { this.listeners.set(type, [...(this.listeners.get(type) || []), handler]); }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== handler)); }
  dispatchEvent(event) {
    const next = { ...event, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const handler of this.listeners.get(next.type) || []) handler(next);
    return next;
  }
}

function walk(node) { return node.children.flatMap((child) => [child, ...walk(child)]); }
function dataKey(selector) { return selector.slice(6, -1).split("-").map((part, index) => index ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join(""); }
function matches(node, selector) {
  if (selector.startsWith("[data-")) return Object.hasOwn(node.dataset, dataKey(selector));
  return node.tagName === selector.toUpperCase();
}

function createHarness(options) {
  const documentImpl = new FakeDocument(options);
  const app = documentImpl.createElement("main");
  const root = documentImpl.createElement("section");
  const opener = documentImpl.createElement("button");
  app.append(opener, root);
  documentImpl.body.append(app);
  return { documentImpl, app, root, opener };
}

function tick() { return new Promise((resolve) => setTimeout(resolve, 0)); }

const fakeDocument = new FakeDocument();
const scope = { domain: "example.com", location_code: 2840, language_code: "en" };
const normalizedScope = { site: "example.com", location_code: 2840, language_code: "en" };
const review = {
  organic: { status: "ready", cached: true, actual_cost_usd: 0, task_count: 0, cache_write_ok: true },
  backlinks: { status: "confirmation_required", cached: false, actual_cost_usd: 0, task_count: 0, cache_write_ok: true, error: { code: "LIVE_REQUEST_CONFIRMATION_REQUIRED", message: "Need confirmation." } },
  competitors: { status: "confirmation_required", cached: false, actual_cost_usd: 0, task_count: 0, cache_write_ok: true, error: { code: "LIVE_REQUEST_CONFIRMATION_REQUIRED", message: "Need confirmation." } },
  keyword_opportunities: { status: "skip", cached: true, actual_cost_usd: 0, task_count: 0, cache_write_ok: true, error: { code: "NO_PROVIDER", message: "No competitors." } },
  backlink_opportunities: { status: "ready", cached: true, actual_cost_usd: 0, task_count: 0, cache_write_ok: true },
};

function reviewPayload(overrides = {}) {
  return {
    ok: true,
    data: { scope: normalizedScope, modules: review },
    meta: { preview_only: true, actual_cost_usd: 0, total_actual_cost_usd: 0, task_count: 0 },
    ...overrides,
  };
}

function allCachedExecutionPayload(overrides = {}) {
  return {
    ok: true,
    data: {
      scope: normalizedScope,
      modules: {
        organic: successfulModule(),
        backlinks: successfulModule(),
        competitors: { status: "skip", cached: false, actual_cost_usd: 0, task_count: 0, cache_write_ok: true, error: { code: "NO_PROVIDER", message: "No competitors are configured for this site." } },
        keyword_opportunities: { status: "skip", cached: false, actual_cost_usd: 0, task_count: 0, cache_write_ok: true, error: { code: "NO_PROVIDER", message: "No competitors are configured for this site." } },
        backlink_opportunities: { status: "skip", cached: false, actual_cost_usd: 0, task_count: 0, cache_write_ok: true, error: { code: "NO_PROVIDER", message: "No competitors are configured for this site." } },
      },
    },
    meta: { actual_cost_usd: 0, total_actual_cost_usd: 0, task_count: 0 },
    ...overrides,
  };
}

function response(status, payload) { return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => payload }); }

function successPayload(modules, responseScope = normalizedScope, meta = {}) {
  const total = Object.values(modules).reduce((sum, module) => sum + (typeof module.actual_cost_usd === "number" ? module.actual_cost_usd : 0), 0);
  return { ok: true, data: { scope: responseScope, modules }, meta: { actual_cost_usd: total, total_actual_cost_usd: total, task_count: 0, ...meta } };
}

function successfulModule(overrides = {}) {
  return { status: "success", cached: true, actual_cost_usd: 0, task_count: 0, cache_write_ok: true, updated_at: "2026-09-01T00:00:00.000Z", ...overrides };
}

test("review request uses the pure relative preview endpoint without live confirmation", () => {
  const request = buildRefreshReviewRequest(scope);
  assert.equal(request.url, "/api/v2/dashboard/refresh-preview");
  assert.deepEqual(request.body, { site: "example.com", location_code: 2840, language_code: "en", modules: DASHBOARD_REFRESH_MODULES });
  assert.equal("allow_live_request" in request.body, false);
  assert.deepEqual(buildRefreshReviewRequest({ domain: " EXAMPLE.COM ", location_code: "2840", language_code: "EN" }).body, {
    site: "example.com",
    location_code: 2840,
    language_code: "en",
    modules: DASHBOARD_REFRESH_MODULES,
  });
});

test("opening review accepts only the exact provider-free confirmation contract", async () => {
  const calls = [];
  const modules = await reviewDashboardRefresh({
    scope,
    fetchImpl(url, options) { calls.push({ url, body: JSON.parse(options.body) }); return response(200, reviewPayload()); },
  });
  assert.deepEqual(modules, review);
  assert.deepEqual(calls, [{ url: "/api/v2/dashboard/refresh-preview", body: { ...normalizedScope, modules: DASHBOARD_REFRESH_MODULES } }]);
  for (const payload of [
    reviewPayload({ ok: false, data: { scope: normalizedScope, modules: {} } }),
    reviewPayload({ meta: { actual_cost_usd: null, total_actual_cost_usd: 0, task_count: 0 } }),
    reviewPayload({ data: { scope: normalizedScope, modules: { ...review, organic: { ...review.organic, status: "mystery" } } } }),
    reviewPayload({ data: { scope: normalizedScope, modules: { ...review, keyword_opportunities: { ...review.keyword_opportunities, cached: false } } } }),
    reviewPayload({ data: { scope: normalizedScope, modules: { ...review, organic: { ...review.organic, status: "skip", cached: true, error: { code: "NO_PROVIDER" } } } } }),
    reviewPayload({ data: { scope: normalizedScope, modules: { ...review, backlinks: { ...review.backlinks, status: "skip", cached: true, error: { code: "NO_PROVIDER" } } } } }),
  ]) await assert.rejects(reviewDashboardRefresh({ scope, fetchImpl: () => response(200, payload) }));
});

test("opening review rejects an execution-shaped response even when every module was cached", async () => {
  await assert.rejects(
    reviewDashboardRefresh({ scope, fetchImpl: () => response(200, allCachedExecutionPayload()) }),
    /刷新检查响应无效/,
  );
});

test("review dialog exposes labeled checkboxes, exact states, and the reviewed normalized scope", () => {
  const dialog = createRefreshReviewDialog(fakeDocument);
  const secondDialog = createRefreshReviewDialog(fakeDocument);
  renderRefreshReview(dialog, review, fakeDocument, normalizedScope);
  const inputs = dialog.querySelectorAll("[data-v2-dashboard-refresh-module]");
  assert.equal(inputs.length, 5);
  assert.ok(inputs.every((input) => input.getAttribute("aria-label")));
  assert.equal(inputs.filter((input) => input.dataset.v2DashboardRefreshLive === "true").every((input) => input.checked === false), true);
  assert.match(dialog.textContent, /缓存可用 · \$0/);
  assert.match(dialog.textContent, /需要实时更新 · 可能付费/);
  assert.match(dialog.textContent, /example\.com.*2840.*en/);
  assert.notEqual(dialog.getAttribute("aria-labelledby"), secondDialog.getAttribute("aria-labelledby"));
});

test("mounted submit uses the reviewed scope and confirms only checked live modules after scope drift", async () => {
  const { root, opener } = createHarness();
  let currentScope = scope;
  const requests = [];
  const controller = mountDashboardRefresh({
    root,
    getScope: () => currentScope,
    fetchImpl(_url, options) {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (requests.length === 1) return response(200, reviewPayload());
      return response(200, successPayload({ organic: successfulModule(), backlinks: successfulModule({ cached: false, actual_cost_usd: 0.125, task_count: 1 }) }, normalizedScope, { actual_cost_usd: 0.125, total_actual_cost_usd: 0.125, task_count: 1 }));
    },
  });
  await controller.open(opener);
  currentScope = { domain: "changed.example", location_code: 2036, language_code: "fr" };
  const dialog = root.ownerDocument.body.querySelector("[data-v2-dashboard-refresh-dialog]");
  const organic = dialog.querySelectorAll("[data-v2-dashboard-refresh-module]").find((input) => input.value === "organic");
  const backlinks = dialog.querySelectorAll("[data-v2-dashboard-refresh-module]").find((input) => input.value === "backlinks");
  organic.checked = true;
  backlinks.checked = true;
  dialog.querySelector("[data-v2-dashboard-refresh-submit]").dispatchEvent({ type: "click" });
  await tick();
  assert.deepEqual(requests[1], { ...normalizedScope, modules: ["organic", "backlinks"], confirmed_live_modules: ["backlinks"], allow_live_request: true });
  controller.destroy();
});

test("mounted wrong-409 and malformed-200 flows fail closed without dashboard reload", async () => {
  const wrong = createHarness();
  const wrongController = mountDashboardRefresh({
    root: wrong.root,
    getScope: () => scope,
    fetchImpl: () => response(409, reviewPayload({ error: { code: "REFRESH_ALREADY_RUNNING", message: "Already running." }, data: { scope: normalizedScope, modules: {} } })),
  });
  await wrongController.open(wrong.opener);
  const wrongDialog = wrong.documentImpl.body.querySelector("[data-v2-dashboard-refresh-dialog]");
  assert.match(wrongDialog.textContent, /Already running/);
  assert.equal(wrongDialog.querySelectorAll("[data-v2-dashboard-refresh-module]").length, 0);
  wrongController.destroy();

  const malformed = createHarness();
  let call = 0;
  let reloads = 0;
  const malformedController = mountDashboardRefresh({ root: malformed.root, getScope: () => scope, onDashboardReload: () => { reloads += 1; }, fetchImpl: () => ++call === 1 ? response(200, reviewPayload()) : response(200, {}) });
  await malformedController.open(malformed.opener);
  const malformedDialog = malformed.documentImpl.body.querySelector("[data-v2-dashboard-refresh-dialog]");
  const paid = malformedDialog.querySelectorAll("[data-v2-dashboard-refresh-module]").find((input) => input.value === "backlinks");
  paid.checked = true;
  malformedDialog.querySelector("[data-v2-dashboard-refresh-submit]").dispatchEvent({ type: "click" });
  await tick();
  assert.match(malformedDialog.textContent, /更新响应无效/);
  assert.equal(reloads, 0);
  assert.equal(paid.checked, false);
  assert.equal(paid.disabled, true);
  malformedController.destroy();
});

test("mounted null provider costs render as unknown and are never coerced to zero", async () => {
  const { root, opener, documentImpl } = createHarness();
  let calls = 0;
  const controller = mountDashboardRefresh({
    root,
    getScope: () => scope,
    fetchImpl: () => ++calls === 1
      ? response(200, reviewPayload())
      : response(200, successPayload(
        { competitors: successfulModule({ cached: false, actual_cost_usd: null, task_count: null }) },
        normalizedScope,
        { actual_cost_usd: null, total_actual_cost_usd: null, task_count: null },
      )),
  });
  await controller.open(opener);
  const dialog = documentImpl.body.querySelector("[data-v2-dashboard-refresh-dialog]");
  const paid = dialog.querySelectorAll("[data-v2-dashboard-refresh-module]").find((input) => input.value === "competitors");
  paid.checked = true;
  dialog.querySelector("[data-v2-dashboard-refresh-submit]").dispatchEvent({ type: "click" });
  await tick();
  assert.match(dialog.textContent, /费用未知/);
  assert.match(dialog.textContent, /任务数未知/);
  assert.match(dialog.textContent, /实际总费用：费用未知/);
  assert.doesNotMatch(dialog.textContent, /\$0\.00000/);
  controller.destroy();
});

test("paid toggles reset when POST settles before reload, and reset again before a new review", async () => {
  const { root, opener, documentImpl } = createHarness();
  let requestCount = 0;
  let releaseReload;
  const reload = new Promise((resolve) => { releaseReload = resolve; });
  const controller = mountDashboardRefresh({
    root,
    getScope: () => scope,
    onDashboardReload: () => reload,
    fetchImpl: () => ++requestCount === 1 ? response(200, reviewPayload()) : requestCount === 2 ? response(200, successPayload({ backlinks: successfulModule({ cached: false, actual_cost_usd: 0.1, task_count: 1 }) }, normalizedScope, { actual_cost_usd: 0.1, total_actual_cost_usd: 0.1, task_count: 1 })) : response(200, reviewPayload()),
  });
  await controller.open(opener);
  const dialog = documentImpl.body.querySelector("[data-v2-dashboard-refresh-dialog]");
  let paid = dialog.querySelectorAll("[data-v2-dashboard-refresh-module]").find((input) => input.value === "backlinks");
  paid.checked = true;
  dialog.querySelector("[data-v2-dashboard-refresh-submit]").dispatchEvent({ type: "click" });
  await tick();
  assert.equal(paid.checked, false);
  assert.equal(dialog.dataset.v2DashboardRefreshBusy, "true");
  releaseReload();
  await tick();
  assert.equal(paid.disabled, true);
  paid.checked = true;
  await controller.open(opener);
  paid = dialog.querySelectorAll("[data-v2-dashboard-refresh-module]").find((input) => input.value === "backlinks");
  assert.equal(paid.checked, false);
  controller.destroy();
});

test("fallback modal isolates background, traps focus, closes while pending, and restores opener focus", async () => {
  const { root, opener, app, documentImpl } = createHarness();
  let resolveReview;
  let calls = 0;
  const controller = mountDashboardRefresh({
    root,
    getScope: () => scope,
    fetchImpl: () => ++calls === 1 ? new Promise((resolve) => { resolveReview = resolve; }) : response(200, reviewPayload()),
  });
  opener.focus();
  const pending = controller.open(opener);
  const dialog = documentImpl.body.querySelector("[data-v2-dashboard-refresh-dialog]");
  const close = dialog.querySelector("[data-v2-dashboard-refresh-close]");
  assert.equal(app.inert, true);
  assert.equal(app.style.pointerEvents, "none");
  assert.equal(dialog.hasAttribute("open"), true);
  assert.equal(documentImpl.activeElement, close);
  assert.equal(close.disabled, false);
  close.dispatchEvent({ type: "click" });
  assert.equal(dialog.hidden, true);
  assert.equal(app.inert, false);
  assert.equal(app.style.pointerEvents, "");
  assert.equal(dialog.hasAttribute("open"), false);
  assert.equal(documentImpl.activeElement, opener);
  resolveReview({ ok: true, status: 200, json: async () => reviewPayload() });
  await pending;
  await controller.open(opener);
  const submit = dialog.querySelector("[data-v2-dashboard-refresh-submit]");
  submit.focus();
  const tab = documentImpl.dispatchEvent({ type: "keydown", key: "Tab", shiftKey: false });
  assert.equal(tab.defaultPrevented, true);
  assert.equal(documentImpl.activeElement, close);
  documentImpl.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(dialog.hidden, true);
  assert.equal(documentImpl.activeElement, opener);
  controller.destroy();
});

test("native dialog uses showModal and cancel closes it with opener focus restored", async () => {
  const { root, opener, documentImpl } = createHarness({ nativeDialog: true });
  const controller = mountDashboardRefresh({ root, getScope: () => scope, fetchImpl: () => response(200, reviewPayload()) });
  opener.focus();
  await controller.open(opener);
  const dialog = documentImpl.body.querySelector("[data-v2-dashboard-refresh-dialog]");
  assert.equal(dialog.showModalCalls, 1);
  assert.equal(dialog.open, true);
  dialog.dispatchEvent({ type: "cancel" });
  assert.equal(dialog.closeCalls, 1);
  assert.equal(dialog.hidden, true);
  assert.equal(documentImpl.activeElement, opener);
  controller.destroy();
});

test("destroy removes the dialog and all owned handlers even when remounted", async () => {
  const { root, opener, documentImpl } = createHarness();
  let calls = 0;
  const fetchImpl = () => { calls += 1; return response(200, reviewPayload()); };
  const first = mountDashboardRefresh({ root, getScope: () => scope, fetchImpl });
  await first.open(opener);
  const oldDialog = documentImpl.body.querySelector("[data-v2-dashboard-refresh-dialog]");
  first.destroy();
  assert.equal(oldDialog.parentNode, null);
  assert.equal((documentImpl.listeners.get("keydown") || []).length, 0);
  assert.equal((oldDialog.querySelector("[data-v2-dashboard-refresh-close]").listeners.get("click") || []).length, 0);
  const second = mountDashboardRefresh({ root, getScope: () => scope, fetchImpl });
  await second.open(opener);
  assert.equal(calls, 2);
  assert.equal(documentImpl.body.querySelectorAll("[data-v2-dashboard-refresh-dialog]").length, 1);
  second.destroy();
});

test("destroy suppresses a late refresh reload after the POST settles", async () => {
  const { root, opener, documentImpl } = createHarness();
  let calls = 0;
  let resolveSubmit;
  let reloads = 0;
  const controller = mountDashboardRefresh({
    root,
    getScope: () => scope,
    onDashboardReload: () => { reloads += 1; },
    fetchImpl: () => ++calls === 1 ? response(200, reviewPayload()) : new Promise((resolve) => { resolveSubmit = resolve; }),
  });
  await controller.open(opener);
  const dialog = documentImpl.body.querySelector("[data-v2-dashboard-refresh-dialog]");
  const paid = dialog.querySelectorAll("[data-v2-dashboard-refresh-module]").find((input) => input.value === "backlinks");
  paid.checked = true;
  dialog.querySelector("[data-v2-dashboard-refresh-submit]").dispatchEvent({ type: "click" });
  controller.destroy();
  resolveSubmit({ ok: true, status: 200, json: async () => successPayload({ backlinks: successfulModule({ cached: false }) }) });
  await tick();
  await tick();
  assert.equal(reloads, 0);
});

test("mounted refresh single-flight is controller-scoped across destroy and remount", async () => {
  const { root, opener, documentImpl } = createHarness();
  const secondScope = { domain: "second.example", location_code: 2036, language_code: "fr" };
  const normalizedSecondScope = { site: "second.example", location_code: 2036, language_code: "fr" };
  const posts = [];
  let resolveFirstPost;
  let firstReloads = 0;
  let secondReloads = 0;
  const fetchImpl = (_url, options) => {
    const body = JSON.parse(options.body);
    if (!body.allow_live_request) {
      return response(200, reviewPayload({ data: { scope: body.site === "second.example" ? normalizedSecondScope : normalizedScope, modules: review } }));
    }
    posts.push(body);
    if (body.site === "example.com") return new Promise((resolve) => { resolveFirstPost = resolve; });
    return response(200, successPayload({ backlinks: successfulModule({ cached: false, actual_cost_usd: 0.25, task_count: 1 }) }, normalizedSecondScope, { actual_cost_usd: 0.25, total_actual_cost_usd: 0.25, task_count: 1 }));
  };
  const first = mountDashboardRefresh({ root, getScope: () => scope, fetchImpl, onDashboardReload: () => { firstReloads += 1; } });
  await first.open(opener);
  let dialog = documentImpl.body.querySelector("[data-v2-dashboard-refresh-dialog]");
  dialog.querySelectorAll("[data-v2-dashboard-refresh-module]").find((input) => input.value === "backlinks").checked = true;
  const firstSubmit = dialog.querySelector("[data-v2-dashboard-refresh-submit]");
  firstSubmit.dispatchEvent({ type: "click" });
  firstSubmit.dispatchEvent({ type: "click" });
  await tick();
  assert.equal(posts.length, 1);
  first.destroy();

  const second = mountDashboardRefresh({ root, getScope: () => secondScope, fetchImpl, onDashboardReload: () => { secondReloads += 1; } });
  await second.open(opener);
  dialog = documentImpl.body.querySelector("[data-v2-dashboard-refresh-dialog]");
  const secondPaid = dialog.querySelectorAll("[data-v2-dashboard-refresh-module]").find((input) => input.value === "backlinks");
  secondPaid.checked = true;
  dialog.querySelector("[data-v2-dashboard-refresh-submit]").dispatchEvent({ type: "click" });
  try {
    await tick();
    assert.deepEqual(posts.map((body) => body.site), ["example.com", "second.example"]);
    assert.equal(secondReloads, 1);
    assert.equal(secondPaid.checked, false);
    const completedText = dialog.textContent;

    resolveFirstPost({ ok: true, status: 200, json: async () => successPayload({ backlinks: successfulModule({ cached: false, actual_cost_usd: 0.5, task_count: 1 }) }) });
    await tick();
    await tick();
    assert.equal(firstReloads, 0);
    assert.equal(dialog.textContent, completedText);
  } finally {
    resolveFirstPost?.({ ok: true, status: 200, json: async () => successPayload({ backlinks: successfulModule({ cached: false, actual_cost_usd: 0.5, task_count: 1 }) }) });
    await tick();
    await tick();
    second.destroy();
  }
});

test("valid refresh submissions remain single-flight and reject malformed result statuses", async () => {
  let calls = 0;
  let resolveResponse;
  let reloads = 0;
  const fetchImpl = () => { calls += 1; return new Promise((resolve) => { resolveResponse = resolve; }); };
  const options = { fetchImpl, scope, selectedModules: ["organic"], review, onDashboardReload: () => { reloads += 1; } };
  const first = submitDashboardRefresh(options);
  const second = submitDashboardRefresh(options);
  assert.strictEqual(first, second);
  resolveResponse({ ok: true, status: 200, json: async () => successPayload({ organic: successfulModule() }) });
  await first;
  assert.equal(calls, 1);
  assert.equal(reloads, 1);
  await assert.rejects(submitDashboardRefresh({ ...options, onDashboardReload: () => { reloads += 1; }, fetchImpl: () => response(200, successPayload({ organic: successfulModule({ status: "mystery" }) })) }), /更新响应无效/);
  assert.equal(reloads, 1);
});
