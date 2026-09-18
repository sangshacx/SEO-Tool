import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  BATCH_SAVE_SURFACES,
  RESEARCH_SAVE_SURFACES,
  buildKeywordClusterAssignments,
  buildSavedKeywordListUrl,
  clusterIntelligenceDecisionLabel,
  clusterIntelligenceRiskLabel,
  clusterSuggestionPrefill,
  newClusterSuggestionPrefill,
  normalizeBatchTagInput,
  researchSurfaceKeyword,
  savedKeywordCreatePayload,
  saveKeywordSelection,
  selectedResearchKeywords,
} from "../public/v2-keyword-library.js";

test("Keyword Library list URL is site scoped and keeps filters explicit", () => {
  const url = buildSavedKeywordListUrl({
    siteDomain: "great-ocean-waterproof.com",
    q: "waterproof membrane",
    tag: "Commercial",
    page: 2,
    pageSize: 50,
    sort: "keyword_difficulty",
    order: "asc",
  });
  const parsed = new URL(url, "https://preview.example");
  assert.equal(parsed.pathname, "/api/v2/keywords/saved");
  assert.equal(parsed.searchParams.get("site_domain"), "great-ocean-waterproof.com");
  assert.equal(parsed.searchParams.get("q"), "waterproof membrane");
  assert.equal(parsed.searchParams.get("tag"), "Commercial");
  assert.equal(parsed.searchParams.get("page"), "2");
  assert.equal(parsed.searchParams.get("sort"), "keyword_difficulty");
  assert.equal(parsed.searchParams.get("order"), "asc");
});

test("Keyword Explorer save payload reuses current site and market without a provider request", () => {
  const payload = savedKeywordCreatePayload({
    market: {
      domain: "great-ocean-waterproof.com",
      location_code: 2840,
      language_code: "en",
    },
    keyword: "  waterproof   membrane ",
  });
  assert.deepEqual(payload, {
    site_domain: "great-ocean-waterproof.com",
    keyword: "waterproof membrane",
    location_code: 2840,
    language_code: "en",
    source: "keyword_explorer",
    tags: [],
  });
  assert.throws(
    () => savedKeywordCreatePayload({
      market: { location_code: 2840, language_code: "en" },
      keyword: "waterproof membrane",
    }),
    /网站管理/,
  );
});

test("Keyword Library UI only calls the internal Saved Keywords API", async () => {
  const source = await readFile(new URL("../public/v2-keyword-library.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/v2\/keywords\/saved/);
  assert.match(source, /保存到关键词库/);
  assert.match(source, /本次费用 \$0/);
  assert.doesNotMatch(source, /submitSeoResearchRequest|\/api\/v2\/keywords\/overview|\/api\/v2\/keywords\/ideas|dataforseo\.com/i);
});

test("V2 shell exposes Keyword Library as a first-class research view", async () => {
  const source = await readFile(new URL("../public/v2-shell.js", import.meta.url), "utf8");
  assert.match(source, /v2-keyword-library\.js/);
  assert.match(source, /id: "keyword-library", label: "关键词库"/);
  assert.match(source, /createKeywordLibrarySection/);
  assert.match(source, /mountKeywordLibrary/);
});


test("research surfaces map to the Saved Keywords contract sources", () => {
  assert.deepEqual(RESEARCH_SAVE_SURFACES, {
    ideasBody: { source: "keyword_ideas", keyword_cell_index: 2 },
    competitorBody: { source: "competitor_snapshot", keyword_cell_index: 1 },
    gapBody: { source: "keyword_gap", keyword_cell_index: 2 },
  });
});

test("researchSurfaceKeyword reads linked and direct keyword cells deterministically", () => {
  const linkedCell = {
    querySelector(selector) {
      if (selector === ".emptyrow") return null;
      if (selector === "a") return { textContent: " waterproof membrane " };
      return null;
    },
    childNodes: [],
    textContent: "ignored",
  };
  const linkedRow = { children: [{}, linkedCell] };
  assert.equal(researchSurfaceKeyword(linkedRow, RESEARCH_SAVE_SURFACES.competitorBody), "waterproof membrane");

  const directCell = {
    querySelector() { return null; },
    childNodes: [{ nodeType: 3, textContent: " roof   coating " }],
    textContent: "roof coating",
  };
  const directRow = { children: [{}, {}, directCell] };
  assert.equal(researchSurfaceKeyword(directRow, RESEARCH_SAVE_SURFACES.ideasBody), "roof coating");
});

test("research surface saves stay on the zero-provider-cost Saved Keywords API", async () => {
  const source = await readFile(new URL("../public/v2-keyword-library.js", import.meta.url), "utf8");
  assert.match(source, /ideasBody[\s\S]*keyword_ideas/);
  assert.match(source, /competitorBody[\s\S]*competitor_snapshot/);
  assert.match(source, /gapBody[\s\S]*keyword_gap/);
  assert.match(source, /data-v2-inline-save-keyword/);
  assert.doesNotMatch(source, /submitSeoResearchRequest|dataforseo\.com/i);
});


test("batch-save surfaces are limited to selectable Ideas and Keyword Gap results", () => {
  assert.deepEqual(BATCH_SAVE_SURFACES, {
    ideasBody: {
      source: "keyword_ideas",
      controls_selector: ".ideasselection",
      label: "保存已选到关键词库",
    },
    gapBody: {
      source: "keyword_gap",
      controls_selector: ".gapactions",
      label: "保存已选到关键词库",
    },
  });
});

test("selectedResearchKeywords returns checked keywords once", () => {
  const row = (keyword, checked) => ({
    children: [
      { querySelector: () => ({ checked }) },
      {},
      {
        querySelector(selector) {
          if (selector === ".emptyrow") return null;
          if (selector === "a") return { textContent: keyword };
          return null;
        },
        childNodes: [],
        textContent: keyword,
      },
    ],
  });
  const body = {
    children: [
      row("waterproof membrane", true),
      row("roof coating", false),
      row("Waterproof Membrane", true),
      row("bitumen membrane", true),
    ],
  };
  assert.deepEqual(
    selectedResearchKeywords(body, RESEARCH_SAVE_SURFACES.ideasBody),
    ["waterproof membrane", "bitumen membrane"],
  );
});

test("saveKeywordSelection bounds concurrency, deduplicates, and reports partial failures", async () => {
  let active = 0;
  let maxActive = 0;
  const seen = [];
  const result = await saveKeywordSelection({
    keywords: ["a", "b", "A", "c", "d", "e", "f"],
    concurrency: 3,
    async saveOne(keyword) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      seen.push(keyword);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (keyword === "d") throw new Error("failed d");
    },
  });
  assert.equal(result.attempted, 6);
  assert.equal(result.saved, 5);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.failures, [{ keyword: "d", message: "failed d" }]);
  assert.ok(maxActive <= 3);
  assert.deepEqual(new Set(seen), new Set(["a", "b", "c", "d", "e", "f"]));
});

test("batch saves use only the zero-cost Saved Keywords API and refresh library once", async () => {
  const source = await readFile(new URL("../public/v2-keyword-library.js", import.meta.url), "utf8");
  assert.match(source, /data-v2-batch-save-keywords/);
  assert.match(source, /保存已选到关键词库/);
  assert.match(source, /saveKeywordSelection/);
  assert.match(source, /本次 \$0/);
  assert.doesNotMatch(source, /submitSeoResearchRequest|dataforseo\.com/i);
});


test("Keyword Library batch Tag input trims and deduplicates case-insensitively", () => {
  assert.deepEqual(
    normalizeBatchTagInput(" Commercial, commercial ; Saudi\nHigh Intent "),
    ["Commercial", "Saudi", "High Intent"],
  );
  assert.deepEqual(normalizeBatchTagInput("   "), []);
});

test("Keyword Library batch Tag UI uses PATCH on the zero-cost Saved Keywords API", async () => {
  const source = await readFile(new URL("../public/v2-keyword-library.js", import.meta.url), "utf8");
  assert.match(source, /data-v2-library-selected/);
  assert.match(source, /data-v2-library-select-page/);
  assert.match(source, /data-v2-library-batch-tags/);
  assert.match(source, /method:\s*"PATCH"/);
  assert.match(source, /批量添加 Tag/);
  assert.match(source, /本次 \$0/);
  assert.doesNotMatch(source, /submitSeoResearchRequest|dataforseo\.com/i);
});


test("Keyword Library batch delete is explicit, bounded, and stays on the zero-cost Saved Keywords API", async () => {
  const source = await readFile(new URL("../public/v2-keyword-library.js", import.meta.url), "utf8");
  assert.match(source, /data-v2-library-delete-selected/);
  assert.match(source, /每次最多批量删除 100 个关键词/);
  assert.match(source, /method:\s*"DELETE"/);
  assert.match(source, /ids,/);
  assert.match(source, /确定从当前网站关键词库删除已选的/);
  assert.match(source, /已删除 .* 个关键词 · 本次 \$0/);
  assert.doesNotMatch(source, /submitSeoResearchRequest|dataforseo\.com/i);
});


test("Keyword Library cluster assignments preserve existing members and promote the chosen selected keyword", () => {
  const assignments = buildKeywordClusterAssignments({
    cluster: {
      primary: { saved_keyword_id: 1, keyword: "waterproof membrane" },
      supporting: [
        { saved_keyword_id: 2, keyword: "bitumen membrane" },
        { saved_keyword_id: 4, keyword: "roof membrane" },
      ],
    },
    selectedItems: [
      { id: 2, keyword: "bitumen membrane" },
      { id: 3, keyword: "self adhesive membrane" },
    ],
    primaryId: 3,
  });
  assert.deepEqual(assignments, [
    { saved_keyword_id: 1, role: "supporting" },
    { saved_keyword_id: 2, role: "supporting" },
    { saved_keyword_id: 3, role: "primary" },
    { saved_keyword_id: 4, role: "supporting" },
  ]);
  assert.throws(
    () => buildKeywordClusterAssignments({
      cluster: null,
      selectedItems: [{ id: 5, keyword: "roof coating" }],
      primaryId: 6,
    }),
    /必须来自已选关键词或当前 Cluster 现有成员/,
  );

  assert.deepEqual(buildKeywordClusterAssignments({
    cluster: {
      primary: { saved_keyword_id: 9, keyword: "roof coating" },
      supporting: [],
    },
    selectedItems: [{ id: 10, keyword: "roof coating supplier" }],
    primaryId: 9,
  }), [
    { saved_keyword_id: 9, role: "primary" },
    { saved_keyword_id: 10, role: "supporting" },
  ]);
});

test("Keyword Library exposes manual Topic Cluster creation, primary selection, assignment, and overview at zero provider cost", async () => {
  const source = await readFile(new URL("../public/v2-keyword-library.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/v2\/keywords\/clusters/);
  assert.match(source, /data-v2-cluster-select/);
  assert.match(source, /data-v2-cluster-name/);
  assert.match(source, /data-v2-cluster-primary/);
  assert.match(source, /data-v2-cluster-assign/);
  assert.match(source, /method:\s*"POST"/);
  assert.match(source, /method:\s*"PATCH"/);
  assert.match(source, /Primary：/);
  assert.match(source, /Supporting：/);
  assert.match(source, /本次 \$0/);
  assert.doesNotMatch(source, /dataforseo\.com|submitSeoResearchRequest/i);
});


test("Cluster Intelligence UI labels deterministic decisions and potential-risk levels clearly", () => {
  assert.equal(clusterIntelligenceDecisionLabel("assign_to_existing"), "建议归入现有 Cluster");
  assert.equal(clusterIntelligenceDecisionLabel("review_cluster_fit"), "需要人工复核");
  assert.equal(clusterIntelligenceDecisionLabel("new_cluster_candidate"), "更适合新建 Cluster");
  assert.equal(clusterIntelligenceRiskLabel("high"), "高");
  assert.equal(clusterIntelligenceRiskLabel("medium"), "中");
  assert.equal(clusterIntelligenceRiskLabel("none"), "无明显风险");
});

test("Keyword Library Cluster Intelligence UI is read-only and zero-provider-cost", async () => {
  const source = await readFile(new URL("../public/v2-keyword-library.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/v2\/keywords\/cluster-intelligence/);
  assert.match(source, /data-v2-cluster-intelligence-run/);
  assert.match(source, /data-v2-cluster-intelligence-summary/);
  assert.match(source, /data-v2-cluster-intelligence-body/);
  assert.match(source, /Match/);
  assert.match(source, /Cannibalization/);
  assert.match(source, /未修改任何 Cluster/);
  assert.match(source, /本次 \$0/);
  assert.doesNotMatch(source, /dataforseo\.com|submitSeoResearchRequest/i);
});


test("Cluster Intelligence suggestion prefill preserves an existing Primary and makes the suggested keyword Supporting", () => {
  assert.deepEqual(clusterSuggestionPrefill({
    suggestion: {
      saved_keyword_id: 12,
      keyword: "waterproof membrane supplier",
      suggested_cluster: { id: 4, name: "Waterproof Membrane" },
    },
    cluster: {
      id: 4,
      primary: { saved_keyword_id: 3, keyword: "waterproof membrane" },
      supporting: [],
    },
  }), {
    selected_item: { id: 12, keyword: "waterproof membrane supplier" },
    cluster_id: 4,
    primary_id: 3,
    suggested_role: "supporting",
  });

  assert.equal(clusterSuggestionPrefill({
    suggestion: {
      saved_keyword_id: 20,
      keyword: "epoxy floor coating",
      suggested_cluster: { id: 7, name: "Floor Coating" },
    },
    cluster: { id: 7, primary: null, supporting: [] },
  }).suggested_role, "primary");
});

test("Adopting Cluster Intelligence advice only prefills the manual assignment UI before explicit confirmation", async () => {
  const source = await readFile(new URL("../public/v2-keyword-library.js", import.meta.url), "utf8");
  assert.match(source, /采用此建议/);
  assert.match(source, /尚未保存，请检查后点击“分配已选关键词”/);
  assert.match(source, /尚未修改数据库/);
  assert.match(source, /现有 Primary：/);
  assert.match(source, /dataset\.v2ClusterAdopt/);
});


test("new Cluster candidate prefill uses the suggested keyword as an editable Cluster name and Primary", () => {
  assert.deepEqual(newClusterSuggestionPrefill({
    suggestion: {
      saved_keyword_id: 31,
      keyword: "  epoxy   floor coating ",
      decision: { code: "new_cluster_candidate" },
    },
  }), {
    selected_item: { id: 31, keyword: "epoxy floor coating" },
    cluster_name: "epoxy floor coating",
    primary_id: 31,
  });
});

test("new Cluster candidate action only prefills creation and still requires explicit create and assignment clicks", async () => {
  const source = await readFile(new URL("../public/v2-keyword-library.js", import.meta.url), "utf8");
  assert.match(source, /按建议新建 Cluster/);
  assert.match(source, /dataset\.v2ClusterCreatePrefill/);
  assert.match(source, /尚未创建，请检查名称后点击“创建 Cluster”/);
  assert.match(source, /尚未创建 Cluster，也未修改数据库/);
  assert.match(source, /decisionCode === "new_cluster_candidate"/);
});
