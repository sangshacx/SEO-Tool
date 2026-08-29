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
