import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

await import("../public/v2-serp-reality.js");

test("SERP Reality exposes truthful top-10 aggregate signals without inventing pages", () => {
  const view = globalThis.SerpRealityView;
  const summary = view.serpRealitySummary({
    ranking_weakness: 72,
    organic_click_opportunity: 80,
    confidence_score: 85,
    decision: { code: "weak_serp", label: "Weak SERP opportunity" },
    serp_features: { detected: ["organic", "people_also_ask"] },
    source_metrics: {
      average_referring_domains: 18,
      average_page_rank: 244,
      average_main_domain_rank: 391,
      serp_results_count: 1230000,
    },
  });

  assert.equal(summary.version, "serp-reality-ui-v0.1");
  assert.equal(summary.competition_label, "SERP 较弱");
  assert.equal(summary.average_referring_domains, 18);
  assert.equal(summary.average_page_rank, 244);
  assert.equal(summary.average_main_domain_rank, 391);
  assert.equal(summary.serp_results_count, 1230000);
  assert.equal(summary.page_level_results_available, false);
  assert.match(summary.limitation, /不包含逐页 Top 10 URL/);
  assert.match(summary.next_action, /具体 Top 10 页面/);
});

test("SERP Reality keeps missing aggregate metrics missing and has no network path", async () => {
  const summary = globalThis.SerpRealityView.serpRealitySummary({
    ranking_weakness: null,
    source_metrics: { average_referring_domains: null },
  });
  assert.equal(summary.ranking_weakness, null);
  assert.equal(summary.average_referring_domains, null);
  assert.equal(summary.competition_label, "数据不足");

  const source = await readFile(new URL("../public/v2-serp-reality.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|submitSeoResearchRequest|\/api\//);
});


test("SERP Reality UI is wired to existing SERP analysis without another request", async () => {
  const html = await readFile(new URL("../public/v2.html", import.meta.url), "utf8");
  assert.match(html, /src="\.\/v2-serp-reality\.js"/);
  assert.match(html, />SERP Reality</);
  assert.match(html, /id="serpAvgDomainRank"/);
  assert.match(html, /id="serpAvgPageRank"/);
  assert.match(html, /id="serpAvgRefDomains"/);
  assert.match(html, /id="serpResultCount"/);
  assert.match(html, /id="serpLimitation"/);
  assert.match(html, /SerpRealityView\?\.serpRealitySummary/);
  const calls = [...html.matchAll(/submitSeoResearchRequest\("serpWeakness"/g)];
  assert.equal(calls.length, 1);
  assert.match(html, /当前请求不包含逐页 Top 10 URL/);
});
