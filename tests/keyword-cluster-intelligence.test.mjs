import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  CLUSTER_INTELLIGENCE_CONTRACT_VERSION,
  normalizeClusterIntelligenceQuery,
} from "../src/v2/contracts/keyword-cluster-intelligence.js";
import {
  CLUSTER_INTELLIGENCE_VERSION,
  buildClusterIntelligence,
  clusterKeywordTokens,
  normalizeClusterKeyword,
} from "../src/v2/intelligence/keyword-cluster-intelligence.js";
import {
  compareSerpOverlap,
  normalizeSerpUrl,
} from "../src/v2/intelligence/serp-overlap.js";
import {
  SERP_VERIFICATION_PRIORITY_VERSION,
  buildSerpVerificationPriority,
} from "../src/v2/intelligence/serp-verification-priority.js";

test("Cluster Intelligence query is site scoped and bounded to 250 saved keywords", () => {
  assert.equal(CLUSTER_INTELLIGENCE_CONTRACT_VERSION, "cluster-intelligence-v0.2");
  assert.deepEqual(
    normalizeClusterIntelligenceQuery(new URLSearchParams({ site_domain: "www.example.com" })),
    { site_domain: "example.com", limit: 250 },
  );
  assert.deepEqual(
    normalizeClusterIntelligenceQuery(new URLSearchParams({ site_domain: "example.com", limit: "100" })),
    { site_domain: "example.com", limit: 100 },
  );
  assert.throws(
    () => normalizeClusterIntelligenceQuery(new URLSearchParams({ site_domain: "example.com", limit: "251" })),
    /between 1 and 250/,
  );
});

test("Cluster Intelligence keyword normalization is deterministic and singularizes common variants", () => {
  assert.equal(normalizeClusterKeyword("  Waterproof-Membranes Supplier "), "waterproof membranes supplier");
  assert.deepEqual(
    clusterKeywordTokens("Best Waterproof Membranes Suppliers"),
    ["waterproof", "membrane", "supplier"],
  );
});

test("Cluster Intelligence suggests a strong existing cluster with explainable potential cannibalization", () => {
  const result = buildClusterIntelligence({
    site_domain: "example.com",
    total_saved_keywords: 4,
    keywords: [
      { saved_keyword_id: 1, keyword: "waterproof membrane", intent_primary: "commercial" },
      { saved_keyword_id: 2, keyword: "bitumen membrane", intent_primary: "commercial" },
      { saved_keyword_id: 3, keyword: "waterproof membrane supplier", intent_primary: "commercial" },
      { saved_keyword_id: 4, keyword: "epoxy floor coating", intent_primary: "commercial" },
    ],
    clusters: [
      {
        id: 10,
        name: "Waterproof Membrane",
        primary: { saved_keyword_id: 1, keyword: "waterproof membrane", role: "primary", intent_primary: "commercial" },
        supporting: [{ saved_keyword_id: 2, keyword: "bitumen membrane", role: "supporting", intent_primary: "commercial" }],
      },
    ],
  });

  assert.equal(result.version, CLUSTER_INTELLIGENCE_VERSION);
  assert.equal(result.summary.assigned_keywords, 2);
  assert.equal(result.summary.unassigned_keywords, 2);

  const membrane = result.suggestions.find((item) => item.saved_keyword_id === 3);
  assert.equal(membrane.decision.code, "assign_to_existing");
  assert.equal(membrane.suggested_cluster.id, 10);
  assert.equal(membrane.components.best_member_similarity, 100);
  assert.equal(membrane.components.intent_relation, "same");
  assert.equal(membrane.cannibalization.level, "high");
  assert.match(membrane.reasons.join(" "), /waterproof|membrane/);

  const epoxy = result.suggestions.find((item) => item.saved_keyword_id === 4);
  assert.equal(epoxy.decision.code, "new_cluster_candidate");
  assert.equal(epoxy.cannibalization.level, "none");
});

test("Cluster Intelligence lowers confidence when intent conflicts even with lexical overlap", () => {
  const result = buildClusterIntelligence({
    keywords: [
      { saved_keyword_id: 2, keyword: "roof coating guide", intent_primary: "informational" },
    ],
    clusters: [
      {
        id: 5,
        name: "Roof Coating",
        primary: { saved_keyword_id: 1, keyword: "roof coating", role: "primary", intent_primary: "transactional" },
        supporting: [],
      },
    ],
  });
  const suggestion = result.suggestions[0];
  assert.equal(suggestion.components.best_member_similarity, 100);
  assert.equal(suggestion.components.intent_relation, "different");
  assert.ok(suggestion.suggested_cluster.score < 90);
});

test("Cluster Intelligence API is rules-only, read-only, and zero provider cost", async () => {
  const apiSource = await readFile(new URL("../functions/api/v2/keywords/cluster-intelligence.js", import.meta.url), "utf8");
  const storageSource = await readFile(new URL("../src/v2/storage/keyword-cluster-intelligence.js", import.meta.url), "utf8");
  assert.match(apiSource, /actual_cost_usd:\s*0/);
  assert.match(apiSource, /provider_requests:\s*0/);
  assert.match(apiSource, /rules_based:\s*true/);
  assert.doesNotMatch(apiSource, /DataForSEO|submitSeoResearchRequest|\bfetch\s*\(|onRequestPost|onRequestPatch|onRequestDelete/);
  assert.doesNotMatch(storageSource, /DataForSEO|\bfetch\s*\(|INSERT INTO|UPDATE |DELETE FROM/);
});

test("Cluster Intelligence API reads D1 input and returns deterministic advice without mutation", async () => {
  globalThis.__CLUSTER_INTELLIGENCE_STORAGE_FOR_TESTS__ = {
    async loadClusterIntelligenceInput(_db, input) {
      return {
        site_domain: input.site_domain,
        total_saved_keywords: 2,
        truncated: false,
        keywords: [
          { saved_keyword_id: 1, keyword: "roof coating", intent_primary: "commercial" },
          { saved_keyword_id: 2, keyword: "roof coating supplier", intent_primary: "commercial" },
        ],
        clusters: [
          {
            id: 3,
            name: "Roof Coating",
            primary: { saved_keyword_id: 1, keyword: "roof coating", role: "primary", intent_primary: "commercial" },
            supporting: [],
          },
        ],
      };
    },
  };

  const api = await import("../functions/api/v2/keywords/cluster-intelligence.js?test=" + Date.now());
  const response = await api.onRequestGet({
    request: new Request("https://preview.example/api/v2/keywords/cluster-intelligence?site_domain=example.com", {
      headers: { "cf-access-jwt-assertion": "test-token" },
    }),
    env: { DB: {} },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.meta.actual_cost_usd, 0);
  assert.equal(body.meta.provider_requests, 0);
  assert.equal(body.data.suggestions[0].decision.code, "assign_to_existing");
  delete globalThis.__CLUSTER_INTELLIGENCE_STORAGE_FOR_TESTS__;
});


test("SERP overlap normalizes URLs and produces strong evidence from three shared Top 10 pages", () => {
  assert.equal(normalizeSerpUrl("https://www.Example.com/page/?utm_source=x#top"), "example.com/page");
  const evidence = compareSerpOverlap(
    {
      location_code: 2840,
      language_code: "en",
      serp: {
        fetched_at: "2026-09-10T00:00:00Z",
        urls: [
          "https://a.com/1","https://b.com/2","https://c.com/3","https://d.com/4","https://e.com/5",
          "https://f.com/6","https://g.com/7","https://h.com/8","https://i.com/9","https://j.com/10",
        ],
      },
    },
    {
      location_code: 2840,
      language_code: "en",
      serp: {
        fetched_at: "2026-09-11T00:00:00Z",
        urls: [
          "https://a.com/1","https://b.com/2","https://c.com/3","https://x.com/4","https://y.com/5",
          "https://z.com/6","https://q.com/7","https://r.com/8","https://s.com/9","https://t.com/10",
        ],
      },
    },
    { analysisTime: "2026-09-18T00:00:00Z" },
  );
  assert.equal(evidence.status, "available");
  assert.equal(evidence.shared_url_count, 3);
  assert.equal(evidence.score, 30);
  assert.equal(evidence.strength, "strong");
});

test("Cluster Intelligence v0.2 uses cached SERP overlap to strengthen an otherwise borderline cluster match", () => {
  const candidateUrls = [
    "https://a.com/p","https://b.com/p","https://c.com/p","https://d.com/p","https://e.com/p",
    "https://f.com/p","https://g.com/p","https://h.com/p","https://i.com/p","https://j.com/p",
  ];
  const memberUrls = [
    "https://a.com/p","https://b.com/p","https://c.com/p","https://d.com/p","https://x.com/p",
    "https://y.com/p","https://z.com/p","https://q.com/p","https://r.com/p","https://s.com/p",
  ];
  const result = buildClusterIntelligence({
    analysis_time: "2026-09-18T00:00:00Z",
    keywords: [{
      saved_keyword_id: 2,
      keyword: "roof waterproofing supplier",
      intent_primary: "commercial",
      location_code: 2840,
      language_code: "en",
      serp: { fetched_at: "2026-09-12T00:00:00Z", urls: candidateUrls },
    }],
    clusters: [{
      id: 8,
      name: "Roof Membrane",
      primary: {
        saved_keyword_id: 1,
        keyword: "roof membrane supplier",
        role: "primary",
        intent_primary: "commercial",
        location_code: 2840,
        language_code: "en",
        serp: { fetched_at: "2026-09-12T00:00:00Z", urls: memberUrls },
      },
      supporting: [],
    }],
  });
  assert.equal(result.version, "cluster-intelligence-v0.2");
  const suggestion = result.suggestions[0];
  assert.equal(suggestion.serp_overlap.status, "available");
  assert.equal(suggestion.serp_overlap.strength, "strong");
  assert.equal(suggestion.serp_overlap.shared_url_count, 4);
  assert.equal(suggestion.confidence.level, "high");
  assert.equal(suggestion.cannibalization.evidence_source, "serp_overlap");
  assert.equal(result.summary.serp_evidence_available, 1);
  assert.equal(result.summary.serp_evidence_coverage_pct, 100);
});

test("stale SERP snapshots are reported but never affect the final match score", () => {
  const result = buildClusterIntelligence({
    analysis_time: "2026-09-18T00:00:00Z",
    keywords: [{
      saved_keyword_id: 2,
      keyword: "roof coating guide",
      intent_primary: "informational",
      location_code: 2840,
      language_code: "en",
      serp: {
        fetched_at: "2026-07-01T00:00:00Z",
        urls: ["https://a.com/1","https://b.com/2","https://c.com/3","https://d.com/4","https://e.com/5"],
      },
    }],
    clusters: [{
      id: 5,
      name: "Roof Coating",
      primary: {
        saved_keyword_id: 1,
        keyword: "roof coating",
        role: "primary",
        intent_primary: "transactional",
        location_code: 2840,
        language_code: "en",
        serp: {
          fetched_at: "2026-07-01T00:00:00Z",
          urls: ["https://a.com/1","https://b.com/2","https://c.com/3","https://d.com/4","https://e.com/5"],
        },
      },
      supporting: [],
    }],
  });
  const suggestion = result.suggestions[0];
  assert.equal(suggestion.serp_overlap.status, "stale");
  assert.equal(suggestion.components.final_match_score, suggestion.components.lexical_intent_score);
  assert.equal(suggestion.confidence.level, "low");
});

test("Cluster Intelligence storage reads latest persisted SERP pages but never writes or calls a provider", async () => {
  const storageSource = await readFile(new URL("../src/v2/storage/keyword-cluster-intelligence.js", import.meta.url), "utf8");
  assert.match(storageSource, /serp_competitor_snapshots/);
  assert.match(storageSource, /serp_competitor_pages/);
  assert.match(storageSource, /ORDER BY latest\.fetched_at DESC/);
  assert.doesNotMatch(storageSource, /INSERT INTO|UPDATE |DELETE FROM|DataForSEO|\bfetch\s*\(/);
});


test("SERP Verification Priority v0.1 is deterministic and explainable", () => {
  const score = buildSerpVerificationPriority({
    decision_code: "assign_to_existing",
    match_score: 82,
    search_volume: 1900,
    keyword_difficulty: 28,
    intent_primary: "commercial",
  });
  assert.equal(score.version, SERP_VERIFICATION_PRIORITY_VERSION);
  assert.equal(score.version, "serp-verification-priority-v0.1");
  assert.ok(score.score >= 75);
  assert.equal(score.code, "high");
  assert.equal(score.label, "高优先");
  assert.deepEqual(Object.keys(score.factors), [
    "decision_impact",
    "cluster_match",
    "search_demand",
    "commercial_intent",
    "seo_feasibility",
  ]);
  assert.equal(score.factors.decision_impact, 100);
  assert.equal(score.factors.cluster_match, 82);
  assert.equal(score.factors.commercial_intent, 90);
  assert.equal(score.factors.seo_feasibility, 72);
  assert.match(score.disclaimer, /不代表排名概率、流量或收入/);
});

test("SERP Verification Priority keeps missing metrics neutral instead of treating them as opportunity", () => {
  const score = buildSerpVerificationPriority({
    decision_code: "review_cluster_fit",
    match_score: 60,
    search_volume: null,
    keyword_difficulty: null,
    intent_primary: null,
  });
  assert.equal(score.factors.search_demand, 50);
  assert.equal(score.factors.seo_feasibility, 50);
  assert.equal(score.factors.commercial_intent, 50);
});

test("Cluster Intelligence attaches candidate and matched-member verification priorities without provider calls", () => {
  const result = buildClusterIntelligence({
    analysis_time: "2026-09-18T00:00:00Z",
    keywords: [{
      saved_keyword_id: 2,
      keyword: "waterproof membrane supplier",
      intent_primary: "commercial",
      metrics: { search_volume: 1600, keyword_difficulty: 32, cpc_usd: 3.2 },
      location_code: 2840,
      language_code: "en",
      serp: null,
    }],
    clusters: [{
      id: 2,
      name: "Waterproof Membrane",
      primary: {
        saved_keyword_id: 1,
        keyword: "waterproof membrane",
        role: "primary",
        intent_primary: "commercial",
        metrics: { search_volume: 5400, keyword_difficulty: 41, cpc_usd: 2.8 },
        location_code: 2840,
        language_code: "en",
        serp: null,
      },
      supporting: [],
    }],
  });
  const suggestion = result.suggestions[0];
  assert.equal(suggestion.verification_priority.version, "serp-verification-priority-v0.1");
  assert.ok(suggestion.verification_priority.score > 0);
  assert.equal(suggestion.serp_overlap.matched_verification_priority.version, "serp-verification-priority-v0.1");
  assert.equal(suggestion.metrics.search_volume, 1600);
  assert.ok(result.summary.verification_priority_high + result.summary.verification_priority_medium + result.summary.verification_priority_low >= 1);
});

test("Cluster Intelligence storage loads latest search volume and KD for verification priority but remains read-only", async () => {
  const storageSource = await readFile(new URL("../src/v2/storage/keyword-cluster-intelligence.js", import.meta.url), "utf8");
  assert.match(storageSource, /km\.search_volume/);
  assert.match(storageSource, /km\.keyword_difficulty/);
  assert.match(storageSource, /km\.cpc_usd/);
  assert.match(storageSource, /metrics:\s*\{/);
  assert.doesNotMatch(storageSource, /INSERT INTO|UPDATE |DELETE FROM|DataForSEO|\bfetch\s*\(/);
});
