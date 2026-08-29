import assert from "node:assert/strict";
import test from "node:test";

async function loadIntelligence() {
  try {
    return await import("../src/v2/intelligence/backlink-gap-opportunity.js");
  } catch {
    return {};
  }
}

test("scores a multi-competitor referring domain with transparent components", async () => {
  const module = await loadIntelligence();
  assert.equal(typeof module.enrichBacklinkGapItem, "function");

  const item = module.enrichBacklinkGapItem({
    domain: "industry-journal.com",
    competitors: [
      {
        domain: "competitor-a.com",
        rank: 80,
        backlinks: 99,
        referring_pages: 100,
        referring_pages_nofollow: 20,
        spam_score: 10,
        broken_backlinks: 0,
      },
      {
        domain: "competitor-b.com",
        rank: 60,
        backlinks: 9,
        referring_pages: 10,
        referring_pages_nofollow: 5,
        spam_score: 20,
        broken_backlinks: 2,
      },
    ],
  }, { competitorCount: 2 });

  assert.deepEqual(item.metrics, {
    coverage_count: 2,
    coverage_percent: 100,
    strongest_rank: 80,
    total_backlinks: 108,
    total_referring_pages: 110,
    nofollow_share_percent: 22.7,
    average_spam_score: 15,
    broken_backlinks: 2,
    broken_share_percent: 1.8,
  });
  assert.deepEqual(item.opportunity, {
    score: 83,
    label: "High priority",
    version: "backlink-gap-v0.1",
    components: {
      authority: 80,
      competitor_coverage: 100,
      evidence: 61,
      quality: 83,
    },
  });
});

test("summarizes and orders opportunities without mutating provider items", async () => {
  const { enrichBacklinkGapPage } = await loadIntelligence();
  assert.equal(typeof enrichBacklinkGapPage, "function");
  const raw = {
    own_domain: "own-site.com",
    competitor_domains: ["competitor-a.com", "competitor-b.com"],
    items: [
      { domain: "weak-source.com", competitors: [{ domain: "competitor-a.com", rank: 15, backlinks: 1, referring_pages: 1, referring_pages_nofollow: 1, spam_score: 70, broken_backlinks: 1 }] },
      { domain: "strong-source.com", competitors: [{ domain: "competitor-a.com", rank: 75, backlinks: 30, referring_pages: 30, referring_pages_nofollow: 4, spam_score: 5, broken_backlinks: 0 }, { domain: "competitor-b.com", rank: 70, backlinks: 20, referring_pages: 20, referring_pages_nofollow: 2, spam_score: 8, broken_backlinks: 0 }] },
    ],
  };
  const before = structuredClone(raw);

  const enriched = enrichBacklinkGapPage(raw);

  assert.deepEqual(raw, before);
  assert.deepEqual(enriched.items.map((item) => item.domain), ["strong-source.com", "weak-source.com"]);
  assert.deepEqual(enriched.summary, {
    returned_domains: 2,
    high_priority_domains: 1,
    multi_competitor_domains: 1,
    average_opportunity_score: 52,
  });
});
