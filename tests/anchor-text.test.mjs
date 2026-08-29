import assert from "node:assert/strict";
import test from "node:test";

async function loadAnchorIntelligence() {
  try {
    return await import("../src/v2/intelligence/anchor-text.js");
  } catch {
    return {};
  }
}

test("classifies a target keyword anchor as an exact match", async () => {
  const module = await loadAnchorIntelligence();
  assert.equal(typeof module.classifyAnchorText, "function");
  assert.deepEqual(
    module.classifyAnchorText("Waterproof Membrane", {
      keyword: "waterproof membrane",
      domain: "great-ocean-waterproof.com",
    }),
    { code: "exact", label: "Exact Match" },
  );
});

test("classifies the remaining anchor categories with deterministic precedence", async () => {
  const { classifyAnchorText } = await loadAnchorIntelligence();
  const context = {
    keyword: "waterproof membrane supplier",
    domain: "great-ocean-waterproof.com",
  };
  const cases = [
    ["Waterproof membrane", { code: "partial", label: "Partial Match" }],
    ["Great Ocean Waterproof", { code: "branded", label: "Branded" }],
    ["https://great-ocean-waterproof.com/products", { code: "naked", label: "Naked URL" }],
    ["Click here", { code: "generic", label: "Generic" }],
    ["", { code: "empty", label: "Empty / Image" }],
    ["Industry resource", { code: "other", label: "Other" }],
  ];

  for (const [anchor, expected] of cases) {
    assert.deepEqual(classifyAnchorText(anchor, context), expected, anchor || "empty anchor");
  }
});

test("enriches a cached anchor page without mutating the provider payload", async () => {
  const { enrichAnchorPage } = await loadAnchorIntelligence();
  assert.equal(typeof enrichAnchorPage, "function");
  const raw = {
    target: "great-ocean-waterproof.com",
    items: [
      { anchor: "waterproof membrane", backlinks: 10, referring_pages: 10, referring_pages_nofollow: 2, broken_backlinks: 0, spam_score: 5 },
      { anchor: "Great Ocean Waterproof", backlinks: 5, referring_pages: 5, referring_pages_nofollow: 0, broken_backlinks: 0, spam_score: 8 },
      { anchor: "Click here", backlinks: 3, referring_pages: 3, referring_pages_nofollow: 3, broken_backlinks: 1, spam_score: 60 },
    ],
  };
  const before = structuredClone(raw);

  const enriched = enrichAnchorPage(raw, { keyword: "waterproof membrane" });

  assert.deepEqual(raw, before);
  assert.deepEqual(enriched.items.map((item) => item.classification.code), ["exact", "branded", "generic"]);
  assert.deepEqual(enriched.items.map((item) => item.nofollow_share_percent), [20, 0, 100]);
  assert.deepEqual(enriched.summary, {
    returned_anchors: 3,
    represented_backlinks: 18,
    exact_partial_backlinks: 10,
    exact_partial_share_percent: 55.6,
    branded_backlinks: 5,
    branded_share_percent: 27.8,
    generic_naked_backlinks: 3,
    generic_naked_share_percent: 16.7,
    risky_anchors: 1,
  });
});

test("derives a brand from domains that use a common two-part public suffix", async () => {
  const { classifyAnchorText } = await loadAnchorIntelligence();
  assert.deepEqual(
    classifyAnchorText("Great Ocean Waterproof", { domain: "great-ocean-waterproof.co.uk" }),
    { code: "branded", label: "Branded" },
  );
});
