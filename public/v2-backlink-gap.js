function number(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const SORTERS = {
  opportunity: (left, right) => number(right.opportunity?.score) - number(left.opportunity?.score),
  coverage: (left, right) => number(right.metrics?.coverage_count) - number(left.metrics?.coverage_count),
  rank: (left, right) => number(right.metrics?.strongest_rank) - number(left.metrics?.strongest_rank),
  backlinks: (left, right) => number(right.metrics?.total_backlinks) - number(left.metrics?.total_backlinks),
  spam: (left, right) => number(left.metrics?.average_spam_score, 101) - number(right.metrics?.average_spam_score, 101),
};

export function visibleBacklinkGapRows(items, { query = "", priority = "all", sort = "opportunity" } = {}) {
  const normalizedQuery = String(query).trim().toLowerCase();
  const rows = (Array.isArray(items) ? items : []).filter((item) => {
    const score = number(item?.opportunity?.score);
    const coverage = number(item?.metrics?.coverage_count);
    const matchesQuery = !normalizedQuery
      || String(item?.domain ?? "").toLowerCase().includes(normalizedQuery)
      || (item?.competitors ?? []).some((competitor) => String(competitor?.domain ?? "").toLowerCase().includes(normalizedQuery));
    const matchesPriority = priority === "high" ? score >= 80
      : priority === "good" ? score >= 60
        : priority === "multi" ? coverage >= 2
          : true;
    return matchesQuery && matchesPriority;
  });
  return rows.sort(SORTERS[sort] ?? SORTERS.opportunity);
}

export function backlinkGapScoreBreakdown(item) {
  const components = item?.opportunity?.components ?? {};
  return [
    `Authority ${number(components.authority)} × 35%`,
    `Coverage ${number(components.competitor_coverage)} × 30%`,
    `Evidence ${number(components.evidence)} × 20%`,
    `Quality ${number(components.quality)} × 15%`,
  ].join(" · ");
}

export function createBacklinkGapRequestGate() {
  let inFlight = null;
  return {
    get busy() {
      return inFlight !== null;
    },
    run(task) {
      if (inFlight) return inFlight;
      let operation;
      try {
        operation = Promise.resolve(task());
      } catch (error) {
        operation = Promise.reject(error);
      }
      inFlight = operation.finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

export function backlinkGapStatusMessage(meta = {}) {
  if (meta.cached) return "外链机会读取成功：缓存命中，本次费用 $0。";
  if (meta.cache_stored === false) {
    return "外链机会读取成功：实际费用已记录，但缓存写入失败；重复查询可能再次计费。";
  }
  return "外链机会读取成功：实际费用已记录，当前页已缓存 7 天。";
}

function quote(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function backlinkGapCsv(rows) {
  const header = [
    "Referring Domain",
    "Opportunity Score",
    "Opportunity Label",
    "Authority (35%)",
    "Competitor Coverage (30%)",
    "Evidence (20%)",
    "Quality (15%)",
    "Competitor Coverage",
    "Competitors",
    "Strongest Rank",
    "Backlinks",
    "Spam Score",
  ];
  const lines = [header, ...(Array.isArray(rows) ? rows : []).map((item) => [
    item?.domain,
    item?.opportunity?.score,
    item?.opportunity?.label,
    item?.opportunity?.components?.authority,
    item?.opportunity?.components?.competitor_coverage,
    item?.opportunity?.components?.evidence,
    item?.opportunity?.components?.quality,
    item?.metrics?.coverage_count,
    (item?.competitors ?? []).map((competitor) => competitor?.domain).filter(Boolean).join("; "),
    item?.metrics?.strongest_rank,
    item?.metrics?.total_backlinks,
    item?.metrics?.average_spam_score,
  ])];
  return lines.map((row) => row.map(quote).join(",")).join("\n");
}

if (typeof window !== "undefined") {
  window.BacklinkGapView = {
    visibleBacklinkGapRows,
    backlinkGapScoreBreakdown,
    createBacklinkGapRequestGate,
    backlinkGapStatusMessage,
    backlinkGapCsv,
  };
}
