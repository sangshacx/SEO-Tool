function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function cannibalizationReviewPriority(candidate = {}) {
  const severityBase = {
    high_overlap: 68,
    moderate_overlap: 58,
    review: 48,
  }[candidate.severity] ?? 48;

  const impressions = finite(candidate.total_impressions) ?? 0;
  const demandPoints = impressions >= 2000 ? 12
    : impressions >= 1000 ? 10
      : impressions >= 500 ? 7
        : impressions >= 250 ? 4
          : 2;

  const competingShare = finite(candidate?.competing_page?.impression_share) ?? 0;
  const overlapPoints = competingShare >= 0.4 ? 8
    : competingShare >= 0.3 ? 6
      : competingShare >= 0.2 ? 4
        : 2;

  return Math.min(88, severityBase + demandPoints + overlapPoints);
}

function architectureTask(candidate = {}) {
  const primaryPage = candidate?.primary_page?.page_url;
  const competingPage = candidate?.competing_page?.page_url;
  if (!primaryPage || !competingPage || !candidate?.query) return null;

  const priority = cannibalizationReviewPriority(candidate);
  const primaryShare = finite(candidate.primary_page.impression_share);
  const competingShare = finite(candidate.competing_page.impression_share);
  const why = [
    "Potential GSC query overlap needs architecture review; this is not an automatic merge recommendation.",
    candidate.total_impressions != null ? "query impressions " + candidate.total_impressions : null,
    competingShare !== null ? "competing page share " + Math.round(competingShare * 10000) / 100 + "%" : null,
    primaryShare !== null ? "primary page share " + Math.round(primaryShare * 10000) / 100 + "%" : null,
  ].filter(Boolean).join(" · ");

  return {
    rank: null,
    workstream: "architecture",
    page: primaryPage,
    action: "review_cannibalization",
    action_label: "Review overlap",
    priority_score: priority,
    confidence: candidate.severity === "high_overlap" ? "high" : "medium",
    query: candidate.query,
    query_source: "gsc_query_page",
    why_now: why,
    evidence: {
      severity: candidate.severity ?? "review",
      total_impressions: finite(candidate.total_impressions),
      page_count: finite(candidate.page_count),
      primary_page: primaryPage,
      primary_position: finite(candidate?.primary_page?.position),
      primary_impression_share: primaryShare,
      competing_page: competingPage,
      competing_position: finite(candidate?.competing_page?.position),
      competing_impression_share: competingShare,
    },
  };
}

export function mergeCannibalizationActions(data = {}, candidates = [], { limit = 25 } = {}) {
  const existing = Array.isArray(data.action_queue) ? data.action_queue : [];
  const architecture = (Array.isArray(candidates) ? candidates : [])
    .map(architectureTask)
    .filter(Boolean);

  const combined = [...existing, ...architecture];
  const seen = new Set();
  const unique = combined.filter((item) => {
    const key = [item.page, item.action, item.query || ""].join("\n");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) =>
    (finite(b.priority_score) ?? 0) - (finite(a.priority_score) ?? 0) ||
    String(a.page || "").localeCompare(String(b.page || "")) ||
    String(a.action || "").localeCompare(String(b.action || ""))
  );

  const bounded = unique.slice(0, Math.max(1, Number(limit) || 25))
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    ...data,
    action_queue: bounded,
    next_best_action: bounded[0] ?? data.next_best_action ?? null,
    supplemental_signals: {
      ...(data.supplemental_signals ?? {}),
      cannibalization: {
        candidate_count: architecture.length,
        model: "gsc-query-overlap-v0.1",
        disclaimer: "Review priority is a deterministic architecture triage score, not proof of keyword cannibalization or a recommendation to merge pages.",
      },
    },
  };
}
