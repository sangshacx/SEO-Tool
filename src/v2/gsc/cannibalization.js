function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedPage(page = {}) {
  return {
    page_url: String(page.page_url || page.url || ""),
    clicks: finite(page.clicks) ?? 0,
    impressions: finite(page.impressions) ?? 0,
    position: finite(page.position),
  };
}

export function classifyGscQueryOverlap({
  query,
  pages = [],
  minimumTotalImpressions = 100,
} = {}) {
  const ranked = (Array.isArray(pages) ? pages : [])
    .map(normalizedPage)
    .filter((page) => page.page_url && page.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions || (a.position ?? 999) - (b.position ?? 999));

  const totalImpressions = ranked.reduce((sum, page) => sum + page.impressions, 0);
  const totalClicks = ranked.reduce((sum, page) => sum + page.clicks, 0);
  if (ranked.length < 2 || totalImpressions < minimumTotalImpressions) return null;

  const primary = ranked[0];
  const secondary = ranked[1];
  const primaryShare = totalImpressions > 0 ? primary.impressions / totalImpressions : 0;
  const secondaryShare = totalImpressions > 0 ? secondary.impressions / totalImpressions : 0;
  const bothRelevant =
    primary.position !== null &&
    secondary.position !== null &&
    primary.position <= 30 &&
    secondary.position <= 30;

  if (!bothRelevant || secondaryShare < 0.15) return null;

  let severity = "review";
  if (secondaryShare >= 0.30 && primary.position <= 20 && secondary.position <= 20) severity = "high_overlap";
  else if (secondaryShare >= 0.20) severity = "moderate_overlap";

  return {
    query: String(query || ""),
    page_count: ranked.length,
    total_clicks: totalClicks,
    total_impressions: totalImpressions,
    primary_page: {
      ...primary,
      impression_share: primaryShare,
    },
    competing_page: {
      ...secondary,
      impression_share: secondaryShare,
    },
    severity,
    action: {
      code: "review_cannibalization",
      label: "Review overlap",
      reason:
        "Multiple pages receive meaningful impressions for the same query. Review intent, internal linking, canonicals, and content overlap before considering consolidation.",
    },
  };
}

export function buildGscCannibalizationCandidates(rows = [], { limit = 50 } = {}) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const query = String(row.query_text ?? row.primary_key ?? "").trim();
    if (!query) continue;
    const current = grouped.get(query) ?? [];
    current.push(row);
    grouped.set(query, current);
  }

  const candidates = [];
  for (const [query, pages] of grouped) {
    const candidate = classifyGscQueryOverlap({ query, pages });
    if (candidate) candidates.push(candidate);
  }

  const weight = { high_overlap: 3, moderate_overlap: 2, review: 1 };
  candidates.sort((a, b) =>
    (weight[b.severity] ?? 0) - (weight[a.severity] ?? 0) ||
    b.total_impressions - a.total_impressions ||
    b.competing_page.impression_share - a.competing_page.impression_share ||
    a.query.localeCompare(b.query)
  );
  return candidates.slice(0, Math.max(1, Math.min(100, Number(limit) || 50)));
}
