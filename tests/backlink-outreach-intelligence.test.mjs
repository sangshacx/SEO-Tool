import assert from "node:assert/strict";
import test from "node:test";

async function loadIntelligence() {
  try {
    return await import("../src/v2/intelligence/backlink-outreach.js");
  } catch {
    return {};
  }
}

test("marks obvious directory and website-value domains as skip with reasons", async () => {
  const { assessBacklinkOutreach } = await loadIntelligence();
  assert.equal(typeof assessBacklinkOutreach, "function");

  const result = assessBacklinkOutreach({
    domain: "getwebsiteworth.com",
    metrics: {
      strongest_rank: 0,
      total_backlinks: 2,
      nofollow_share_percent: 0,
      average_spam_score: 60,
      broken_share_percent: 0,
    },
  });

  assert.equal(result.recommendation, "skip");
  assert.ok(result.quality_score <= 25);
  assert.ok(result.risk_types.includes("website_value"));
  assert.ok(result.reasons.some((reason) => /估值|价值/.test(reason)));
});

test("does not reject a domain only because it uses an info suffix", async () => {
  const { assessBacklinkOutreach } = await loadIntelligence();
  const result = assessBacklinkOutreach({
    domain: "waterproofing.info",
    metrics: {
      strongest_rank: 72,
      total_backlinks: 25,
      nofollow_share_percent: 20,
      average_spam_score: 3,
      broken_share_percent: 0,
    },
  });

  assert.notEqual(result.recommendation, "skip");
  assert.equal(result.risk_types.includes("suspicious_tld"), false);
});

test("promotes a strong relevant industry site to research first", async () => {
  const { assessBacklinkOutreach, classifyWebsiteRelevance, combineOutreachAssessment } = await loadIntelligence();
  const quality = assessBacklinkOutreach({
    domain: "construction-journal.com",
    metrics: {
      strongest_rank: 76,
      total_backlinks: 35,
      nofollow_share_percent: 15,
      average_spam_score: 4,
      broken_share_percent: 0,
    },
  });
  const relevance = classifyWebsiteRelevance({
    domain: "construction-journal.com",
    title: "Waterproofing membranes and construction materials journal",
    description: "Technical guidance for roofing, waterproofing and building products.",
    text: "Explore bituminous membranes, liquid coatings, insulation and civil engineering products.",
  }, ["waterproofing", "construction materials"]);
  const result = combineOutreachAssessment(quality, relevance);

  assert.ok(relevance.score >= 75);
  assert.equal(result.recommendation, "research_first");
  assert.ok(result.confidence >= 75);
  assert.ok(result.reasons.some((reason) => /主题/.test(reason)));
});

test("keeps confidence low when public page evidence is unavailable", async () => {
  const { classifyWebsiteRelevance } = await loadIntelligence();
  const result = classifyWebsiteRelevance({ domain: "example.com", unavailable_reason: "timeout" }, ["waterproofing"]);

  assert.equal(result.score, null);
  assert.ok(result.confidence <= 25);
  assert.equal(result.evidence_status, "unavailable");
});

test("flags matching cross-domain templates as a possible network footprint", async () => {
  const { detectPossibleSiteNetwork } = await loadIntelligence();
  assert.equal(typeof detectPossibleSiteNetwork, "function");
  const result = detectPossibleSiteNetwork([
    { domain: "alpha-one.com", title: "Best website directory", description: "Submit your website to our global directory today" },
    { domain: "beta-two.net", title: "Best website directory", description: "Submit your website to our global directory today" },
    { domain: "industry-journal.com", title: "Construction Journal", description: "Technical building research" },
  ]);

  assert.deepEqual(result["alpha-one.com"].risk_type, "possible_site_network");
  assert.deepEqual(result["beta-two.net"].matched_domains, ["alpha-one.com"]);
  assert.equal(result["industry-journal.com"], undefined);
});

