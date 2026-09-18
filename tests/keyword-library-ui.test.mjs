import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  BATCH_SAVE_SURFACES,
  CLUSTER_INTELLIGENCE_RETURN_SESSION_KEY,
  CLUSTER_SERP_VERIFICATION_SESSION_KEY,
  RESEARCH_SAVE_SURFACES,
  buildClusterSerpVerificationQueue,
  clearClusterSerpVerificationContext,
  consumeClusterIntelligenceReturn,
  buildKeywordClusterAssignments,
  buildSavedKeywordListUrl,
  clusterConfidencePresentation,
  clusterIntelligenceDecisionLabel,
  clusterIntelligenceRiskLabel,
  clusterSerpEvidencePresentation,
  clusterSuggestionPrefill,
  handoffClusterSerpVerification,
  readClusterSerpVerificationContext,
  requestClusterIntelligenceReturn,
  newClusterSuggestionPrefill,
  normalizeBatchTagInput,
  researchSurfaceKeyword,
  savedKeywordCreatePayload,
  saveKeywordSelection,
  selectedResearchKeywords,
  writeClusterSerpVerificationContext,
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


test("Keyword Library redesign uses three workspace tabs without changing backend contracts", async () => {
  const source = await readFile(new URL("../public/v2-keyword-library.js", import.meta.url), "utf8");
  assert.match(source, /data-v2-library-tab="keywords"/);
  assert.match(source, /data-v2-library-tab="clusters"/);
  assert.match(source, /data-v2-library-tab="intelligence"/);
  assert.match(source, /data-v2-library-panel="keywords"/);
  assert.match(source, /data-v2-library-panel="clusters"/);
  assert.match(source, /data-v2-library-panel="intelligence"/);
  assert.match(source, /activateLibraryTab\("keywords"\)/);
  assert.match(source, /activateLibraryTab\("clusters"\)/);
  assert.match(source, /保存、筛选和组织值得持续跟踪的关键词/);
  assert.match(source, /D1 管理 · \$0/);
});


test("Cluster Intelligence v0.2 presents SERP evidence and confidence explicitly", () => {
  assert.deepEqual(clusterSerpEvidencePresentation({
    status: "available",
    strength: "strong",
    score: 40,
    shared_url_count: 4,
    shared_urls: ["a.com/page", "b.com/page"],
  }), {
    status: "available",
    strength: "strong",
    label: "强 · 40%",
    shared_label: "4 个",
    shared_urls: ["a.com/page", "b.com/page"],
  });
  assert.equal(clusterSerpEvidencePresentation({ status: "stale" }).label, "已过期");
  assert.equal(clusterSerpEvidencePresentation({ status: "insufficient" }).label, "证据不足");
  assert.deepEqual(clusterConfidencePresentation({
    level: "high",
    score: 90,
    reason: "真实 SERP 证据",
  }), {
    level: "high",
    label: "高",
    score: 90,
    reason: "真实 SERP 证据",
  });
});

test("Cluster Intelligence table exposes SERP overlap, shared URLs, confidence, and evidence coverage without paid calls", async () => {
  const source = await readFile(new URL("../public/v2-keyword-library.js", import.meta.url), "utf8");
  assert.match(source, /<th>SERP Overlap<\/th>/);
  assert.match(source, /<th>Shared URLs<\/th>/);
  assert.match(source, /<th>Confidence<\/th>/);
  assert.match(source, /SERP 证据 .*覆盖/);
  assert.match(source, /dataset\.evidenceStatus/);
  assert.match(source, /evidence\.shared_urls\.join/);
  assert.match(source, /dataset\.confidence/);
  assert.match(source, /colSpan = 11/);
  assert.doesNotMatch(source, /submitSeoResearchRequest|dataforseo\.com/i);
});


test("SERP Evidence Coverage queue targets the keyword side that actually needs verification", () => {
  const queue = buildClusterSerpVerificationQueue({
    analysisTime: "2026-09-18T00:00:00Z",
    suggestions: [
      {
        keyword: "waterproof membrane supplier",
        decision: { code: "assign_to_existing" },
        suggested_cluster: { id: 3, name: "Waterproof Membrane", score: 78 },
        components: { final_match_score: 78 },
        serp_overlap: {
          status: "unavailable",
          matched_keyword: "waterproof membrane",
          candidate_result_count: 8,
          member_result_count: 0,
          candidate_fetched_at: "2026-09-15T00:00:00Z",
          member_fetched_at: null,
        },
      },
      {
        keyword: "roof coating guide",
        decision: { code: "new_cluster_candidate" },
        suggested_cluster: { id: 4, name: "Roof Coating", score: 48 },
        components: { final_match_score: 48 },
        serp_overlap: {
          status: "insufficient",
          matched_keyword: "roof coating",
          candidate_result_count: 3,
          member_result_count: 7,
          candidate_fetched_at: "2026-09-15T00:00:00Z",
          member_fetched_at: "2026-09-15T00:00:00Z",
        },
      },
    ],
  });
  assert.deepEqual(queue.map((item) => [item.keyword, item.priority, item.evidence_status]), [
    ["waterproof membrane", "high", "unavailable"],
    ["roof coating guide", "normal", "insufficient"],
  ]);
});

test("SERP Evidence Coverage deduplicates stale keywords and only sends a manual prefill handoff", () => {
  const queue = buildClusterSerpVerificationQueue({
    analysisTime: "2026-09-18T00:00:00Z",
    suggestions: [
      {
        keyword: "membrane manufacturer",
        decision: { code: "review_cluster_fit" },
        suggested_cluster: { id: 2, name: "Membrane", score: 65 },
        components: { final_match_score: 65 },
        serp_overlap: {
          status: "stale",
          matched_keyword: "waterproof membrane",
          candidate_result_count: 8,
          member_result_count: 8,
          candidate_fetched_at: "2026-07-01T00:00:00Z",
          member_fetched_at: "2026-09-10T00:00:00Z",
        },
      },
      {
        keyword: "membrane manufacturer",
        decision: { code: "review_cluster_fit" },
        suggested_cluster: { id: 5, name: "Waterproofing", score: 60 },
        components: { final_match_score: 60 },
        serp_overlap: {
          status: "stale",
          matched_keyword: "bitumen membrane",
          candidate_result_count: 8,
          member_result_count: 8,
          candidate_fetched_at: "2026-07-01T00:00:00Z",
          member_fetched_at: "2026-09-10T00:00:00Z",
        },
      },
    ],
  });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].keyword, "membrane manufacturer");

  const keywordInput = { value: "", focused: false, focus() { this.focused = true; } };
  const locationLike = { hash: "" };
  assert.deepEqual(handoffClusterSerpVerification({
    keyword: "  membrane   manufacturer ",
    keywordInput,
    locationLike,
  }), {
    keyword: "membrane manufacturer",
    view: "keywords",
    submitted: false,
  });
  assert.equal(keywordInput.value, "membrane manufacturer");
  assert.equal(keywordInput.focused, true);
  assert.equal(locationLike.hash, "keywords");
});

test("Cluster Intelligence UI exposes a manual SERP Evidence Coverage queue without automatic provider requests", async () => {
  const source = await readFile(new URL("../public/v2-keyword-library.js", import.meta.url), "utf8");
  assert.match(source, /SERP Evidence Coverage/);
  assert.match(source, /data-v2-serp-verification-count/);
  assert.match(source, /data-v2-serp-verification-list/);
  assert.match(source, /去验证 SERP/);
  assert.match(source, /不会自动提交或产生 DataForSEO 费用/);
  assert.match(source, /handoffClusterSerpVerification/);
  assert.doesNotMatch(source, /\.requestSubmit\(|\.submit\(\)|submitSeoResearchRequest|dataforseo\.com/i);
});


test("controlled SERP verification context is session-scoped, expiring, and site-aware", () => {
  const map = new Map();
  const storageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
  const saved = writeClusterSerpVerificationContext({
    storageLike,
    keyword: " waterproof membrane ",
    siteDomain: "great-ocean-waterproof.com",
    verification: {
      evidence_status: "stale",
      evidence_label: "SERP 已过期",
      priority: "high",
      priority_label: "优先验证",
      reason: "候选关键词的 SERP 快照超过 30 天。",
      suggested_cluster: "Waterproof Membrane",
    },
    now: "2026-09-18T10:00:00Z",
  });
  assert.equal(saved.keyword, "waterproof membrane");
  assert.ok(map.has(CLUSTER_SERP_VERIFICATION_SESSION_KEY));
  assert.equal(readClusterSerpVerificationContext({
    storageLike,
    now: Date.parse("2026-09-18T11:00:00Z"),
  }).suggested_cluster, "Waterproof Membrane");
  assert.equal(readClusterSerpVerificationContext({
    storageLike,
    now: Date.parse("2026-09-18T13:01:00Z"),
  }), null);
  assert.equal(map.has(CLUSTER_SERP_VERIFICATION_SESSION_KEY), false);
});

test("SERP verification return marker is consumed once and rejects a different active site", () => {
  const map = new Map();
  const storageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
  requestClusterIntelligenceReturn({
    storageLike,
    keyword: "roof membrane",
    siteDomain: "great-ocean-waterproof.com",
    now: "2026-09-18T10:00:00Z",
  });
  assert.ok(map.has(CLUSTER_INTELLIGENCE_RETURN_SESSION_KEY));
  assert.equal(consumeClusterIntelligenceReturn({
    storageLike,
    siteDomain: "other-example.com",
  }), null);
  assert.equal(map.has(CLUSTER_INTELLIGENCE_RETURN_SESSION_KEY), false);

  requestClusterIntelligenceReturn({
    storageLike,
    keyword: "roof membrane",
    siteDomain: "great-ocean-waterproof.com",
  });
  assert.equal(consumeClusterIntelligenceReturn({
    storageLike,
    siteDomain: "great-ocean-waterproof.com",
  }).keyword, "roof membrane");
  assert.equal(consumeClusterIntelligenceReturn({
    storageLike,
    siteDomain: "great-ocean-waterproof.com",
  }), null);
  clearClusterSerpVerificationContext(storageLike);
});

test("SERP verification handoff stores context but still never submits the keyword form", () => {
  const map = new Map();
  const storageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
  const keywordInput = { value: "", focus() {} };
  const locationLike = { hash: "" };
  const result = handoffClusterSerpVerification({
    keyword: "waterproof membrane",
    keywordInput,
    locationLike,
    storageLike,
    siteDomain: "great-ocean-waterproof.com",
    verification: {
      evidence_status: "unavailable",
      reason: "缺少 SERP",
      suggested_cluster: "Membrane",
    },
  });
  assert.deepEqual(result, {
    keyword: "waterproof membrane",
    view: "keywords",
    submitted: false,
  });
  assert.equal(locationLike.hash, "keywords");
  assert.equal(JSON.parse(map.get(CLUSTER_SERP_VERIFICATION_SESSION_KEY)).suggested_cluster, "Membrane");
});


test("SERP Evidence Coverage orders work by backend Verification Priority Score", () => {
  const queue = buildClusterSerpVerificationQueue({
    analysisTime: "2026-09-18T00:00:00Z",
    suggestions: [
      {
        keyword: "low priority term",
        decision: { code: "new_cluster_candidate" },
        suggested_cluster: { id: 1, name: "Low", score: 42 },
        components: { final_match_score: 42 },
        verification_priority: {
          score: 38, code: "low", label: "低优先",
          factors: { decision_impact: 40, cluster_match: 42, search_demand: 30, commercial_intent: 45, seo_feasibility: 50 },
          reasons: ["低优先原因"],
        },
        serp_overlap: {
          status: "unavailable",
          matched_keyword: "low cluster member",
          candidate_result_count: 0,
          member_result_count: 7,
          candidate_fetched_at: null,
          member_fetched_at: "2026-09-15T00:00:00Z",
        },
      },
      {
        keyword: "high priority supplier",
        decision: { code: "review_cluster_fit" },
        suggested_cluster: { id: 2, name: "High", score: 68 },
        components: { final_match_score: 68 },
        verification_priority: {
          score: 81, code: "high", label: "高优先",
          factors: { decision_impact: 90, cluster_match: 68, search_demand: 80, commercial_intent: 90, seo_feasibility: 75 },
          reasons: ["高优先原因"],
        },
        serp_overlap: {
          status: "unavailable",
          matched_keyword: "high cluster member",
          candidate_result_count: 0,
          member_result_count: 7,
          candidate_fetched_at: null,
          member_fetched_at: "2026-09-15T00:00:00Z",
        },
      },
    ],
  });
  assert.equal(queue[0].keyword, "high priority supplier");
  assert.equal(queue[0].verification_priority.score, 81);
  assert.equal(queue[0].priority_label, "高优先 · 81");
  assert.equal(queue[1].verification_priority.score, 38);
});

test("cluster-member verification uses the member-specific backend priority score", () => {
  const queue = buildClusterSerpVerificationQueue({
    suggestions: [{
      keyword: "candidate term",
      decision: { code: "assign_to_existing" },
      suggested_cluster: { id: 9, name: "Membrane", score: 80 },
      components: { final_match_score: 80 },
      verification_priority: { score: 60, code: "medium", label: "中优先", factors: {}, reasons: [] },
      serp_overlap: {
        status: "unavailable",
        matched_keyword: "waterproof membrane",
        candidate_result_count: 8,
        member_result_count: 0,
        candidate_fetched_at: "2026-09-15T00:00:00Z",
        member_fetched_at: null,
        matched_verification_priority: {
          score: 88, code: "high", label: "高优先", factors: {}, reasons: ["核心 Cluster 成员"],
        },
      },
    }],
  });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].keyword, "waterproof membrane");
  assert.equal(queue[0].verification_priority.score, 88);
  assert.equal(queue[0].priority_label, "高优先 · 88");
});

test("SERP Evidence Coverage UI exposes explainable priority factors without provider calls", async () => {
  const source = await readFile(new URL("../public/v2-keyword-library.js", import.meta.url), "utf8");
  assert.match(source, /Decision Impact .*30%/);
  assert.match(source, /Cluster Match .*25%/);
  assert.match(source, /Search Demand .*20%/);
  assert.match(source, /Commercial Intent .*15%/);
  assert.match(source, /SEO Feasibility .*10%/);
  assert.match(source, /verification_priority_score/);
  assert.doesNotMatch(source, /submitSeoResearchRequest|dataforseo\.com/i);
});
