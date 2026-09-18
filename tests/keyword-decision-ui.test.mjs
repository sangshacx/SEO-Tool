import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

await import("../public/v2-keyword-decision.js");

test("keyword decision UI maps potential decisions into deterministic next actions", () => {
  const view = globalThis.KeywordDecisionView;
  assert.equal(view.KEYWORD_DECISION_UI_VERSION, "keyword-decision-ui-v0.1");

  const promising = view.keywordDecisionSummary({
    score: 78,
    confidence_score: 72,
    decision: { code: "promising_validate_serp" },
    components: {
      demand: { score: 80, available: true },
      feasibility: { score: 70, available: true },
      commercial_value: { score: 76, available: true },
      trend: { score: 65, available: true },
    },
  });

  assert.equal(promising.label, "优先验证");
  assert.equal(promising.requires_serp_validation, true);
  assert.match(promising.next_action, /SERP 弱度/);
  assert.match(promising.reason, /Potential 78\/100/);
  assert.equal(promising.is_estimate, true);
  assert.equal(promising.available_components, 4);

  const monitor = view.keywordDecisionSummary({
    score: 42,
    confidence_score: 64,
    decision: { code: "monitor" },
  });
  assert.equal(monitor.label, "暂缓 / 观察");
  assert.equal(monitor.requires_serp_validation, false);

  const insufficient = view.keywordDecisionSummary({
    score: null,
    confidence_score: 0,
    decision: { code: "insufficient_data" },
  });
  assert.equal(insufficient.label, "数据不足");
  assert.equal(insufficient.score, null);
  assert.match(insufficient.reason, /缺少/);
});

test("keyword decision UI is local-only and carries no research request path", async () => {
  const source = await readFile(new URL("../public/v2-keyword-decision.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|submitSeoResearchRequest|\/api\//);
});
