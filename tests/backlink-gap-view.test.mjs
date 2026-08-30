import assert from "node:assert/strict";
import test from "node:test";

async function loadView() {
  try {
    return await import("../public/v2-backlink-gap.js");
  } catch {
    return {};
  }
}

const items = [
  {
    domain: "directory.example",
    competitors: [{ domain: "competitor-a.com" }],
    metrics: { coverage_count: 1, strongest_rank: 45, total_backlinks: 30, average_spam_score: 22 },
    opportunity: {
      score: 61,
      label: "Good opportunity",
      components: { authority: 45, competitor_coverage: 50, evidence: 45, quality: 68 },
    },
  },
  {
    domain: "industry-journal.com",
    competitors: [{ domain: "competitor-a.com" }, { domain: "competitor-b.com" }],
    metrics: { coverage_count: 2, strongest_rank: 78, total_backlinks: 18, average_spam_score: 5 },
    opportunity: {
      score: 87,
      label: "High priority",
      components: { authority: 78, competitor_coverage: 100, evidence: 64, quality: 86 },
    },
  },
];

test("filters current-page gap rows and sorts them without mutating input", async () => {
  const { visibleBacklinkGapRows } = await loadView();
  assert.equal(typeof visibleBacklinkGapRows, "function");
  const before = structuredClone(items);

  assert.deepEqual(
    visibleBacklinkGapRows(items, { query: "journal", priority: "high", sort: "opportunity" }).map((item) => item.domain),
    ["industry-journal.com"],
  );
  assert.deepEqual(
    visibleBacklinkGapRows(items, { priority: "all", sort: "spam" }).map((item) => item.domain),
    ["industry-journal.com", "directory.example"],
  );
  assert.deepEqual(items, before);
});

test("exports the visible opportunity rows as an escaped CSV", async () => {
  const { backlinkGapCsv } = await loadView();
  assert.equal(typeof backlinkGapCsv, "function");
  const csv = backlinkGapCsv([items[1]]);

  assert.equal(csv, [
    '"Referring Domain","Opportunity Score","Opportunity Label","Authority (35%)","Competitor Coverage (30%)","Evidence (20%)","Quality (15%)","Competitor Coverage","Competitors","Strongest Rank","Backlinks","Spam Score"',
    '"industry-journal.com","87","High priority","78","100","64","86","2","competitor-a.com; competitor-b.com","78","18","5"',
  ].join("\n"));
});

test("formats the score components with their published weights", async () => {
  const { backlinkGapScoreBreakdown } = await loadView();
  assert.equal(typeof backlinkGapScoreBreakdown, "function");

  assert.equal(
    backlinkGapScoreBreakdown(items[1]),
    "Authority 78 × 35% · Coverage 100 × 30% · Evidence 64 × 20% · Quality 86 × 15%",
  );
});

test("coalesces concurrent gap actions into one in-flight operation", async () => {
  const { createBacklinkGapRequestGate } = await loadView();
  assert.equal(typeof createBacklinkGapRequestGate, "function");
  const gate = createBacklinkGapRequestGate();
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  let calls = 0;

  const first = gate.run(async () => {
    calls += 1;
    await blocker;
    return "first";
  });
  const second = gate.run(async () => {
    calls += 1;
    return "second";
  });

  assert.equal(first, second);
  assert.equal(gate.busy, true);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, "first");
  assert.equal(gate.busy, false);
  assert.equal(await gate.run(async () => { calls += 1; return "third"; }), "third");
  assert.equal(calls, 2);
});

test("warns when a paid result could not be stored in cache", async () => {
  const { backlinkGapStatusMessage } = await loadView();
  assert.equal(typeof backlinkGapStatusMessage, "function");

  assert.equal(
    backlinkGapStatusMessage({ cached: false, cache_stored: false }),
    "外链机会读取成功：实际费用已记录，但缓存写入失败；重复查询可能再次计费。",
  );
  assert.equal(
    backlinkGapStatusMessage({ cached: true }),
    "外链机会读取成功：缓存命中，本次费用 $0。",
  );
});

test("creates normalized save payloads only for selected backlink opportunities", async () => {
  const { selectedBacklinkOpportunityItems } = await loadView();
  assert.equal(typeof selectedBacklinkOpportunityItems, "function");

  assert.deepEqual(
    selectedBacklinkOpportunityItems(items, new Set(["industry-journal.com"])),
    [{
      referring_domain: "industry-journal.com",
      competitor_domains: ["competitor-a.com", "competitor-b.com"],
      opportunity_score: 87,
      opportunity_label: "High priority",
    }],
  );
});

test("labels prospect workflow statuses and exports saved rows as CSV", async () => {
  const { backlinkProspectStatusLabel, backlinkProspectsCsv } = await loadView();
  assert.equal(typeof backlinkProspectStatusLabel, "function");
  assert.equal(typeof backlinkProspectsCsv, "function");
  assert.equal(backlinkProspectStatusLabel("outreach"), "Outreach Planned");
  assert.equal(backlinkProspectStatusLabel("all"), "全部");
  assert.equal(backlinkProspectStatusLabel("unknown"), "unknown");

  const csv = backlinkProspectsCsv([{
    own_domain: "own-site.com",
    referring_domain: "industry-journal.com",
    competitor_domains: ["competitor-a.com", "competitor-b.com"],
    opportunity_score: 87,
    opportunity_label: "High priority",
    status: "researching",
    notes: "Ask \"editor\"",
    first_discovered_at: "2026-08-29 10:00:00",
    updated_at: "2026-08-29 11:00:00",
  }]);

  assert.equal(csv, [
    '"Own Domain","Referring Domain","Competitors","Opportunity Score","Opportunity Label","Status","Notes","Outreach Recommendation","Quality Score","Relevance Score","Confidence","Reasons","First Discovered","Updated At"',
    '"own-site.com","industry-journal.com","competitor-a.com; competitor-b.com","87","High priority","Researching","Ask ""editor""","","","","","","2026-08-29 10:00:00","2026-08-29 11:00:00"',
  ].join("\n"));
});

test("neutralizes spreadsheet formulas in exported prospect text", async () => {
  const { backlinkProspectsCsv } = await loadView();
  const csv = backlinkProspectsCsv([
    { notes: "=HYPERLINK(\"https://evil.example\")" },
    { notes: " \t@SUM(1,2)" },
  ]);

  const rows = csv.split("\n");
  assert.match(rows[1], /,"'=HYPERLINK\(""https:\/\/evil\.example""\)",/);
  assert.match(rows[2], /,"' \t@SUM\(1,2\)",/);
});

test("filters skip recommendations and prepares relevance-check batches", async () => {
  const { visibleBacklinkGapRows, selectedRelevanceCheckDomains } = await loadView();
  assert.equal(typeof selectedRelevanceCheckDomains, "function");
  const assessed = structuredClone(items);
  assessed[0].outreach = { recommendation: "skip", quality_score: 20 };
  assessed[1].outreach = { recommendation: "research_first", quality_score: 86 };

  assert.deepEqual(
    visibleBacklinkGapRows(assessed, { priority: "all", sort: "outreach", hideSkip: true }).map((item) => item.domain),
    ["industry-journal.com"],
  );
  assert.deepEqual(
    selectedRelevanceCheckDomains(assessed, new Set(["directory.example", "industry-journal.com"])),
    ["directory.example", "industry-journal.com"],
  );
});

test("includes transparent outreach intelligence when saving and exporting prospects", async () => {
  const { selectedBacklinkOpportunityItems, backlinkProspectsCsv } = await loadView();
  const assessed = structuredClone(items[1]);
  assessed.outreach = {
    quality_score: 86,
    relevance_score: 92,
    recommendation: "research_first",
    confidence: 82,
    risk_types: [],
    reasons: ["权威度信号较强", "公开页面匹配目标主题"],
  };
  const payload = selectedBacklinkOpportunityItems([assessed], new Set([assessed.domain]));

  assert.equal(payload[0].outreach_recommendation, "research_first");
  assert.equal(payload[0].relevance_score, 92);
  assert.deepEqual(payload[0].outreach_reasons, ["权威度信号较强", "公开页面匹配目标主题"]);

  const csv = backlinkProspectsCsv([{ ...payload[0], own_domain: "own-site.com", status: "new" }]);
  assert.match(csv.split("\n")[0], /Outreach Recommendation.*Quality Score.*Relevance Score.*Confidence.*Reasons/);
  assert.match(csv, /Research First.*86.*92.*82.*权威度信号较强/);
});

test("merges relevance results into current gap rows without mutating unrelated domains", async () => {
  const { mergeBacklinkOutreachResults, backlinkOutreachLabel } = await loadView();
  assert.equal(typeof mergeBacklinkOutreachResults, "function");
  assert.equal(backlinkOutreachLabel("research_first"), "Research First");
  assert.equal(backlinkOutreachLabel("skip"), "Skip");
  const original = structuredClone(items);
  const merged = mergeBacklinkOutreachResults(original, [{
    domain: "industry-journal.com",
    outreach: { quality_score: 86, relevance_score: 92, recommendation: "research_first", confidence: 82, reasons: ["Topic match"] },
  }]);

  assert.equal(merged[1].outreach.relevance_score, 92);
  assert.equal(merged[0].outreach, undefined);
  assert.deepEqual(original, items);
});
