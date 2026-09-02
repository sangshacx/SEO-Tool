import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { onRequestPost as keywordGap } from "../functions/api/v2/competitors/keyword-gap.js";

function request(body) {
  return new Request("https://preview.example/api/v2/competitors/keyword-gap", {
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

test("keyword gap requests 50 opportunities in one paid provider task", async () => {
  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_url, init) => {
    providerBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      status_code: 20000,
      tasks_count: 1,
      cost: 0.02,
      tasks: [{ status_code: 20000, result: [{ total_count: 0, items: [] }] }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const response = await keywordGap({
      request: request({
        own_domain: "own.example",
        competitor_domain: "competitor.example",
        location_code: 2840,
        language_code: "en",
      }),
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

test("keyword gap opportunities paginate locally after global scoring order", async () => {
  const module = await import("../public/v2-keyword-gap.js").catch(() => null);
  assert.ok(module, "keyword gap pagination module must exist");
  const rows = Array.from({ length: 24 }, (_, index) => ({
    keyword: `gap-${index + 1}`,
    intelligence: { gap_priority: { score: 100 - index } },
  }));

  const secondPage = module.paginateKeywordGap(rows, 2);
  assert.deepEqual(secondPage.rows, rows.slice(10, 20));
  assert.equal(secondPage.page, 2);
  assert.equal(secondPage.page_size, 10);
  assert.equal(secondPage.total_rows, 24);
  assert.equal(secondPage.total_pages, 3);
  assert.equal(secondPage.has_previous, true);
  assert.equal(secondPage.has_next, true);
});

function fakeElement(tagName = "div") {
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    listeners: {},
    checked: false,
    disabled: false,
    textContent: "",
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    click() { this.listeners.click?.({ preventDefault() {} }); },
    change() { this.listeners.change?.(); },
    setAttribute() {},
  };
}

test("keyword gap table pages 10 rows while selection remains global", async () => {
  const { createKeywordGapTable } = await import("../public/v2-keyword-gap.js");
  const body = fakeElement("tbody");
  const previous = fakeElement("button");
  const next = fakeElement("button");
  const label = fakeElement("span");
  const selected = new Set(["gap-12"]);
  let selectionUpdates = 0;
  const rows = Array.from({ length: 23 }, (_, index) => ({
    keyword: `gap-${index + 1}`,
    competitor_position: index + 1,
    competitor_url: `https://competitor.example/${index + 1}`,
    metrics: { search_volume: 100 - index, keyword_difficulty: 20, cpc_usd: 1 },
    intent: { primary: "commercial" },
    intelligence: { gap_priority: { score: 90 - index, label: "High" } },
  }));

  const table = createKeywordGapTable({
    body,
    previousButton: previous,
    nextButton: next,
    pageLabel: label,
    selectedKeywords: selected,
    onSelectionChange() { selectionUpdates += 1; },
    documentLike: { createElement: fakeElement },
  });
  table.setRows(rows);

  assert.equal(body.children.length, 10);
  assert.equal(body.children[0].children[1].textContent, 1);
  assert.equal(label.textContent, "第 1 / 3 页 · 23 条机会");

  next.click();
  assert.equal(body.children[0].children[1].textContent, 11);
  assert.equal(body.children[1].children[0].children[0].checked, true);

  const firstVisibleCheck = body.children[0].children[0].children[0];
  firstVisibleCheck.checked = true;
  firstVisibleCheck.change();
  assert.equal(selected.has("gap-11"), true);
  assert.equal(selected.has("gap-12"), true);
  assert.equal(selectionUpdates, 1);
});

test("V2 mounts the zero-request pager while bulk actions keep all gap rows", async () => {
  const html = await readFile(new URL("../public/v2.html", import.meta.url), "utf8");
  assert.match(html, /id="gapPrev"/);
  assert.match(html, /id="gapPageLabel"/);
  assert.match(html, /id="gapNext"/);
  assert.match(html, /v2-keyword-gap\.js/);
  assert.match(html, /keywordGapTable\.setRows\(gapRows\)/);
  assert.match(html, /最多返回 50 个高价值机会/);
  assert.match(html, /gapRows\.forEach\(item=>selectedGap\.add\(item\.keyword\)\)/);
  assert.match(html, /header,\.\.\.gapRows\.map/);

  const pagerSource = await readFile(new URL("../public/v2-keyword-gap.js", import.meta.url), "utf8");
  assert.doesNotMatch(pagerSource, /\bfetch\s*\(|submitSeoResearchRequest|\/api\//);
});
