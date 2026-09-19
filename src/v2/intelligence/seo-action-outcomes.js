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

function normalizedMetrics(metrics = {}) {
  const clicks = finite(metrics.clicks) ?? 0;
  const impressions = finite(metrics.impressions) ?? 0;
  return {
    days: Number(metrics.days ?? 0),
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: finite(metrics.position),
  };
}

function observedChange(pre, post) {
  if (pre.days < 3 || post.days < 3) {
    return {
      code: "insufficient_data",
      label: "Insufficient data",
      positive_signals: 0,
      negative_signals: 0,
    };
  }

  const clicks = percentChange(post.clicks, pre.clicks);
  const impressions = percentChange(post.impressions, pre.impressions);
  const position = pre.position !== null && post.position !== null
    ? Math.round((pre.position - post.position) * 100) / 100
    : null;
  const ctrPoints = Math.round((post.ctr - pre.ctr) * 10000) / 100;

  const positive = [
    clicks !== null && clicks >= 10,
    impressions !== null && impressions >= 10,
    position !== null && position >= 2,
    ctrPoints >= 1,
  ].filter(Boolean).length;
  const negative = [
    clicks !== null && clicks <= -10,
    impressions !== null && impressions <= -10,
    position !== null && position <= -2,
    ctrPoints <= -1,
  ].filter(Boolean).length;

  if (positive > 0 && negative === 0) {
    return { code: "improved", label: "Improved after completion", positive_signals: positive, negative_signals: negative };
  }
  if (negative > 0 && positive === 0) {
    return { code: "declined", label: "Declined after completion", positive_signals: positive, negative_signals: negative };
  }
  if (positive > 0 && negative > 0) {
    return { code: "mixed", label: "Mixed change", positive_signals: positive, negative_signals: negative };
  }
  return { code: "stable", label: "No material change yet", positive_signals: 0, negative_signals: 0 };
}

export function summarizeSeoActionOutcome({
  event,
  pre = {},
  post = {},
  windowDays = 7,
  scope = "page",
} = {}) {
  const before = normalizedMetrics(pre);
  const after = normalizedMetrics(post);
  let status = "ready";
  if (before.days < 3) status = "insufficient_baseline";
  else if (after.days === 0) status = "waiting_for_post_data";
  else if (after.days < windowDays) status = "collecting_post_data";

  const clicksPercent = percentChange(after.clicks, before.clicks);
  const impressionsPercent = percentChange(after.impressions, before.impressions);
  const positionImprovement = before.position !== null && after.position !== null
    ? Math.round((before.position - after.position) * 100) / 100
    : null;
  const ctrDeltaPoints = Math.round((after.ctr - before.ctr) * 10000) / 100;

  return {
    workflow_id: Number(event?.workflow_id ?? event?.id ?? 0),
    event_id: Number(event?.event_id ?? event?.id ?? 0),
    page_url: event?.page_url ?? null,
    action_code: event?.action_code ?? null,
    query: event?.query_text || event?.query || null,
    completed_at: event?.created_at ?? null,
    priority_score: finite(event?.priority_score),
    scope,
    window_days: windowDays,
    status,
    coverage: {
      before_days: before.days,
      after_days: after.days,
      target_days: windowDays,
    },
    before,
    after,
    change: {
      clicks_percent: clicksPercent,
      impressions_percent: impressionsPercent,
      ctr_points: ctrDeltaPoints,
      position_improvement: positionImprovement,
    },
    observed: observedChange(before, after),
    disclaimer: "Observed GSC changes after completion are not proof that the SEO action caused the change.",
  };
}
