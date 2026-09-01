import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { onRequestPost as competitorSnapshot } from "../functions/api/v2/competitors/snapshot.js";

function request(body) {
  return new Request("https://preview.example/api/v2/competitors/snapshot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function dbStub() {
  return {
    prepare() {
      return {
        bind() { return this; },
        async run() { return { success: true }; },
      };
    },
  };
}

test("competitor snapshot requests 50 ranked keywords in one paid provider task", async () => {
  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_url, init) => {
    providerBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      status_code: 20000,
      tasks_count: 1,
      cost: 0.02,
      tasks: [{ status_code: 20000, result: [{ metrics: { organic: {} }, items: [] }] }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const response = await competitorSnapshot({
      request: request({ domain: "competitor.example", location_code: 2840, language_code: "en" }),
      env: {
        DATAFORSEO_LOGIN: "configured-login",
        DATAFORSEO_PASSWORD: "configured-password",
        CACHE: { async get() { return null; }, async put() {} },
        DB: dbStub(),
      },
    });
    assert.equal(response.status, 200);
    assert.equal(providerBody.length, 1);
    assert.equal(providerBody[0].limit, 50);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("competitor keywords paginate locally in groups of 10", async () => {
  const module = await import("../public/v2-competitor-keywords.js").catch(() => null);
  assert.ok(module, "competitor keyword pagination module must exist");
  const rows = Array.from({ length: 23 }, (_, index) => ({ keyword: `keyword-${index + 1}` }));

  assert.deepEqual(module.paginateCompetitorKeywords(rows, 1), {
    rows: rows.slice(0, 10),
    page: 1,
    page_size: 10,
    total_rows: 23,
    total_pages: 3,
    has_previous: false,
    has_next: true,
  });
  assert.deepEqual(module.paginateCompetitorKeywords(rows, 3), {
    rows: rows.slice(20),
    page: 3,
    page_size: 10,
    total_rows: 23,
    total_pages: 3,
    has_previous: true,
    has_next: false,
  });
});

test("clicking a competitor keyword only prefills Keyword Explorer and never submits", async () => {
  const { prefillKeywordExplorer } = await import("../public/v2-competitor-keywords.js");
  let focused = 0;
  let scrolled = 0;
  let submitted = 0;
  const input = {
    value: "",
    focus() { focused += 1; },
    scrollIntoView() { scrolled += 1; },
  };
  const locationLike = { hash: "#competitors" };

  const changed = prefillKeywordExplorer(" waterproof membrane ", {
    input,
    locationLike,
    requestAnimationFrameImpl(callback) { callback(); },
    submit() { submitted += 1; },
  });

  assert.equal(changed, true);
  assert.equal(input.value, "waterproof membrane");
  assert.equal(locationLike.hash, "keywords");
  assert.equal(focused, 1);
  assert.equal(scrolled, 1);
  assert.equal(submitted, 0);
});

function fakeElement(tagName = "div") {
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    listeners: {},
    disabled: false,
    textContent: "",
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    click() { this.listeners.click?.({ preventDefault() {} }); },
  };
}

test("competitor table renders 10 linked rows and changes pages locally", async () => {
  const { createCompetitorKeywordTable } = await import("../public/v2-competitor-keywords.js");
  const body = fakeElement("tbody");
  const previous = fakeElement("button");
  const next = fakeElement("button");
  const label = fakeElement("span");
  const input = fakeElement("input");
  const locationLike = { hash: "#competitors" };
  const documentLike = { createElement: fakeElement };
  const rows = Array.from({ length: 23 }, (_, index) => ({
    keyword: `keyword-${index + 1}`,
    position: index + 1,
    search_volume: 100 - index,
    keyword_difficulty: 20,
    cpc_usd: 1,
    intent: "commercial",
  }));

  const table = createCompetitorKeywordTable({
    body,
    previousButton: previous,
    nextButton: next,
    pageLabel: label,
    keywordInput: input,
    locationLike,
    documentLike,
    requestAnimationFrameImpl(callback) { callback(); },
  });
  table.setRows(rows);

  assert.equal(body.children.length, 10);
  assert.equal(body.children[0].children[1].children[0].tagName, "A");
  assert.equal(body.children[0].children[1].children[0].textContent, "keyword-1");
  assert.equal(label.textContent, "第 1 / 3 页 · 23 条关键词");
  assert.equal(previous.disabled, true);
  assert.equal(next.disabled, false);

  next.click();
  assert.equal(body.children.length, 10);
  assert.equal(body.children[0].children[0].textContent, 11);
  assert.equal(label.textContent, "第 2 / 3 页 · 23 条关键词");

  body.children[0].children[1].children[0].click();
  assert.equal(input.value, "keyword-11");
  assert.equal(locationLike.hash, "keywords");
});

test("V2 competitor snapshot mounts the local pager and describes the 50-keyword cache", async () => {
  const html = await readFile(new URL("../public/v2.html", import.meta.url), "utf8");
  assert.match(html, /id="competitorPrev"/);
  assert.match(html, /id="competitorPageLabel"/);
  assert.match(html, /id="competitorNext"/);
  assert.match(html, /v2-competitor-keywords\.js/);
  assert.match(html, /competitorKeywordTable\.setRows\(data\.top_keywords\|\|\[\]\)/);
  assert.match(html, /最多 50 个排名关键词/);

  const pagerSource = await readFile(new URL("../public/v2-competitor-keywords.js", import.meta.url), "utf8");
  assert.doesNotMatch(pagerSource, /\bfetch\s*\(|submitSeoResearchRequest|\/api\//);
});
