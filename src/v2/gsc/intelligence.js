function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentChange(current, previous) {
  const now = finite(current);
  const before = finite(previous);
  if (now === null || before === null || before === 0) return null;
  return Math.round(((now - before) / Math.abs(before)) * 10000) / 100;
}

function actionForQuery(row) {
  const impressions = finite(row.impressions) ?? 0;
  const clicks = finite(row.clicks) ?? 0;
  const ctr = finite(row.ctr) ?? 0;
  const position = finite(row.position);
  if (position !== null && position <= 3 && clicks > 0) {
    return { code: "protect", label: "Protect", reason: "Already ranking in the Top 3 with real GSC clicks." };
  }
  if (position !== null && position <= 10 && impressions >= 100 && ctr < 0.03) {
    return { code: "ctr_opportunity", label: "Improve CTR", reason: "Top-10 visibility is meaningful but stored GSC CTR is below 3%." };
  }
  if (position !== null && position >= 4 && position <= 15 && impressions >= 50) {
    return { code: "quick_win", label: "Quick Win", reason: "Real impressions plus a 4–15 average position create a striking-distance opportunity." };
  }
  if (position !== null && position > 15 && position <= 30 && impressions >= 100) {
    return { code: "expand", label: "Expand", reason: "The query has meaningful impressions but still sits outside the first page." };
  }
  return { code: "monitor", label: "Monitor", reason: "No strong stored GSC action signal is present." };
}

function actionForPage(row, comparisonAvailable) {
  const impressions = finite(row.impressions) ?? 0;
  const ctr = finite(row.ctr) ?? 0;
  const position = finite(row.position);
  const clicksChange = percentChange(row.clicks, row.previous_clicks);

  if (comparisonAvailable && clicksChange !== null && clicksChange <= -20 && impressions >= 50) {
    return { code: "recover", label: "Recover", reason: "Clicks are down at least 20% versus the stored comparison period." };
  }
  if (comparisonAvailable && clicksChange !== null && clicksChange >= 20 && impressions >= 50) {
    return { code: "scale", label: "Scale", reason: "Clicks are up at least 20% versus the stored comparison period." };
  }
  if (position !== null && position <= 10 && impressions >= 100 && ctr < 0.03) {
    return { code: "ctr_opportunity", label: "Improve CTR", reason: "The page has Top-10 visibility and meaningful impressions but CTR below 3%." };
  }
  if (position !== null && position <= 10 && (finite(row.clicks) ?? 0) > 0) {
    return { code: "protect", label: "Protect", reason: "The page has first-page visibility and real GSC clicks." };
  }
  return { code: "monitor", label: "Monitor", reason: "No strong stored GSC page action signal is present." };
}

export function enrichGscIntelligenceRows(rows = [], { view = "queries", comparisonAvailable = false } = {}) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const clicks = finite(row.clicks) ?? 0;
    const impressions = finite(row.impressions) ?? 0;
    const previousClicks = finite(row.previous_clicks);
    const previousImpressions = finite(row.previous_impressions);
    return {
      ...row,
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : 0,
      previous_ctr: previousImpressions && previousImpressions > 0 && previousClicks !== null
        ? previousClicks / previousImpressions
        : null,
      change: {
        clicks_percent: comparisonAvailable ? percentChange(clicks, previousClicks) : null,
        impressions_percent: comparisonAvailable ? percentChange(impressions, previousImpressions) : null,
      },
      action: view === "pages"
        ? actionForPage({ ...row, clicks, impressions, ctr: impressions > 0 ? clicks / impressions : 0 }, comparisonAvailable)
        : actionForQuery({ ...row, clicks, impressions, ctr: impressions > 0 ? clicks / impressions : 0 }),
    };
  });
}

export function summarizeGscStoredMetrics(metrics = {}, coverage = {}) {
  const clicks = finite(metrics.clicks) ?? 0;
  const impressions = finite(metrics.impressions) ?? 0;
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: finite(metrics.position),
    current_days: Number(coverage.current_days ?? 0),
    previous_days: Number(coverage.previous_days ?? 0),
    requested_days: Number(coverage.requested_days ?? 0),
    comparison_available: Number(coverage.current_days ?? 0) > 0 && Number(coverage.previous_days ?? 0) > 0,
    comparison_complete:
      Number(coverage.requested_days ?? 0) > 0 &&
      Number(coverage.current_days ?? 0) === Number(coverage.requested_days) &&
      Number(coverage.previous_days ?? 0) === Number(coverage.requested_days),
  };
}
