import assert from "node:assert/strict";
import test from "node:test";

import {
  V2_VIEWS,
  normalizeView,
  readHashView,
  writeHashView,
  normalizeSiteProfile,
  dedupeSiteProfiles,
  renameSiteProfile,
  removeSiteProfile,
  applyActiveDomain,
  activateView,
  toggleMobileNavigation,
  bindHashRouting,
  activateSiteProfile,
} from "../public/v2-shell.js";

test("registers the approved navigation without promoting Content Brief", () => {
  assert.deepEqual(
    V2_VIEWS.map((view) => view.id),
    ["overview", "website", "competitors", "keywords", "backlinks", "opportunities", "more", "sites", "settings"],
  );
  assert.equal(V2_VIEWS.some((view) => /content brief/i.test(view.label)), false);
});

test("normalizes direct hashes and falls back to overview", () => {
  assert.equal(normalizeView("#backlinks"), "backlinks");
  assert.equal(normalizeView(" competitors "), "competitors");
  assert.equal(normalizeView("#not-a-view"), "overview");
  assert.equal(normalizeView(""), "overview");
  assert.equal(readHashView({ hash: "#website" }), "website");
  const location = { hash: "" };
  assert.equal(writeHashView(location, "opportunities"), "opportunities");
  assert.equal(location.hash, "opportunities");
});

test("normalizes safe root-domain site profiles", () => {
  assert.deepEqual(normalizeSiteProfile({ domain: "https://WWW.Example.COM/path", label: " Example " }), {
    domain: "example.com",
    label: "Example",
  });
  assert.equal(normalizeSiteProfile({ domain: "localhost" }), null);
  assert.equal(normalizeSiteProfile({ domain: "127.0.0.1" }), null);
});

test("deduplicates site profiles by normalized domain", () => {
  assert.deepEqual(
    dedupeSiteProfiles([
      { domain: "Example.com", label: "First" },
      { domain: "https://example.com", label: "Second" },
      { domain: "competitor.test", label: "Competitor" },
    ]),
    [
      { domain: "example.com", label: "First" },
      { domain: "competitor.test", label: "Competitor" },
    ],
  );
});

test("renames and removes profiles without changing domains", () => {
  const profiles = [{ domain: "example.com", label: "Old" }, { domain: "second.com", label: "Second" }];
  assert.deepEqual(renameSiteProfile(profiles, "example.com", "New name"), [
    { domain: "example.com", label: "New name" }, { domain: "second.com", label: "Second" },
  ]);
  assert.deepEqual(removeSiteProfile(profiles, "example.com"), [{ domain: "second.com", label: "Second" }]);
  assert.deepEqual(removeSiteProfile([{ domain: "example.com", label: "Only" }], "example.com"), [{ domain: "example.com", label: "Only" }]);
});

test("active site propagation changes only explicitly compatible fields", () => {
  const compatible = { value: "old.test", events: [], dispatchEvent(event) { this.events.push(event.type); } };
  const batch = { value: "old.test\ncompetitor.test" };
  const root = { querySelectorAll(selector) { return selector === "[data-v2-domain-field]" ? [compatible] : []; } };
  assert.equal(applyActiveDomain(root, "new.test"), true);
  assert.equal(compatible.value, "new.test");
  assert.deepEqual(compatible.events, ["input", "change"]);
  assert.equal(batch.value, "old.test\ncompetitor.test");
});

test("saved active site aligns select, domain, title, controls and context without submission", () => {
  let submits = 0;
  const domain = { value: "", events: [], dispatchEvent(event) { this.events.push(event.type); } };
  const country = { value: "" };
  const language = { value: "" };
  const root = {
    querySelectorAll(selector) {
      if (selector === "[data-v2-domain-field]") return [domain];
      if (selector === "[data-v2-location-code]") return [country];
      if (selector === "[data-v2-language-code]") return [language];
      return [];
    },
    dispatchEvent() { submits += 1; },
  };
  const select = { value: "" };
  const title = { textContent: "" };
  let current;
  const context = { set(value) { current = value; return value; } };
  const profile = { domain: "second.example" };
  const market = { location_code: 2682, location_name: "Saudi Arabia", country_iso_code: "SA", language_code: "ar", language_name: "Arabic" };
  activateSiteProfile({ root, select, title, context, profile, market });
  assert.equal(select.value, "second.example");
  assert.equal(domain.value, "second.example");
  assert.equal(title.textContent, "second.example");
  assert.equal(current.domain, "second.example");
  assert.deepEqual([country.value, language.value], ["2682", "ar"]);
  assert.equal(submits, 0);
});

test("activates one route while keeping shared usage visible", () => {
  const views = [
    { dataset: { v2View: "overview" }, hidden: false },
    { dataset: { v2View: "website" }, hidden: false },
    { dataset: { v2View: "overview settings" }, hidden: false },
  ];
  const classList = () => ({ values: new Set(), toggle(name, force) { force ? this.values.add(name) : this.values.delete(name); }, remove(name) { this.values.delete(name); }, contains(name) { return this.values.has(name); } });
  const navs = ["overview", "website", "settings"].map((id) => ({ dataset: { v2Nav: id }, classList: classList(), setAttribute() {}, removeAttribute() {} }));
  const title = { textContent: "" };
  const sidebar = { classList: classList() };
  const root = {
    querySelectorAll(selector) { return selector === "[data-v2-view]" ? views : navs; },
    querySelector(selector) { return selector === "[data-v2-view-title]" ? title : sidebar; },
  };
  assert.equal(activateView(root, "settings"), "settings");
  assert.deepEqual(views.map((view) => view.hidden), [true, true, false]);
  assert.equal(navs[2].classList.contains("active"), true);
  assert.equal(title.textContent, "费用与设置");
});

test("mobile navigation toggles and closes after route activation", () => {
  const values = new Set();
  const sidebar = { classList: { toggle(name) { values.has(name) ? values.delete(name) : values.add(name); }, contains: (name) => values.has(name), remove: (name) => values.delete(name) } };
  const root = { querySelector: () => sidebar };
  assert.equal(toggleMobileNavigation(root), true);
  assert.equal(toggleMobileNavigation(root), false);
});

test("registered hash routing follows forward and back history events", () => {
  const values = new Set(["open"]);
  const sidebar = { classList: { remove: (name) => values.delete(name), contains: (name) => values.has(name) } };
  const title = { textContent: "" };
  const views = ["overview", "website"].map((id) => ({ dataset: { v2View: id }, hidden: false }));
  const navs = ["overview", "website"].map((id) => ({
    dataset: { v2Nav: id },
    classList: { toggle() {} },
    setAttribute() {},
    removeAttribute() {},
  }));
  const root = {
    querySelectorAll: (selector) => selector === "[data-v2-view]" ? views : navs,
    querySelector: (selector) => selector === "[data-v2-view-title]" ? title : sidebar,
  };
  const listeners = new Map();
  const windowLike = { location: { hash: "#overview" }, addEventListener: (name, handler) => listeners.set(name, handler) };
  bindHashRouting(windowLike, root);
  assert.deepEqual(views.map((view) => view.hidden), [false, true]);
  assert.equal(values.has("open"), false);

  windowLike.location.hash = "#website";
  listeners.get("hashchange")();
  assert.deepEqual(views.map((view) => view.hidden), [true, false]);
  assert.equal(title.textContent, "网站数据");

  windowLike.location.hash = "#overview";
  listeners.get("hashchange")();
  assert.deepEqual(views.map((view) => view.hidden), [false, true]);
  assert.equal(title.textContent, "总览");
});
