const METRICS = [
  "domain_rank",
  "backlinks",
  "referring_domains",
  "referring_ips",
  "health_score",
  "spam_score",
  "broken_backlinks",
];

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function change(currentValue, previousValue) {
  const current = finite(currentValue);
  const previous = finite(previousValue);
  if (current === null || previous === null) return { absolute: null, percent: null, direction: "unknown" };
  const absolute = rounded(current - previous);
  const percent = previous === 0 ? null : rounded((absolute / Math.abs(previous)) * 100);
  return { absolute, percent, direction: absolute > 0 ? "up" : absolute < 0 ? "down" : "flat" };
}

function alertsFor(changes) {
  const alerts = [];
  const domains = changes.referring_domains;
  const backlinks = changes.backlinks;
  const health = changes.health_score;
  const spam = changes.spam_score;
  const broken = changes.broken_backlinks;

  if (domains.absolute !== null && domains.absolute < 0) {
    alerts.push({ severity: domains.percent !== null && domains.percent <= -10 ? "high" : "medium", code: "REFERRING_DOMAINS_LOST", label: `引用域减少 ${Math.abs(domains.absolute)}`, detail: domains.percent === null ? "请检查近期流失来源。" : `较上次下降 ${Math.abs(domains.percent)}%。` });
  }
  if (backlinks.percent !== null && backlinks.percent <= -5) {
    alerts.push({ severity: backlinks.percent <= -15 ? "high" : "medium", code: "BACKLINKS_LOST", label: "外链数量明显下降", detail: `较上次下降 ${Math.abs(backlinks.percent)}%。` });
  }
  if (health.absolute !== null && health.absolute <= -5) {
    alerts.push({ severity: health.absolute <= -12 ? "high" : "medium", code: "HEALTH_DECLINE", label: "外链健康度下降", detail: `Health Score 较上次下降 ${Math.abs(health.absolute)} 分。` });
  }
  if (spam.absolute !== null && spam.absolute >= 5) {
    alerts.push({ severity: spam.absolute >= 15 ? "high" : "medium", code: "SPAM_INCREASE", label: "Spam Score 上升", detail: `较上次增加 ${spam.absolute} 分。` });
  }
  if (broken.absolute !== null && broken.absolute > 0) {
    alerts.push({ severity: "low", code: "BROKEN_LINKS_INCREASE", label: "失效外链增加", detail: `较上次增加 ${broken.absolute} 条。` });
  }
  return alerts;
}

function statusFor(changes, alerts) {
  if (alerts.some((item) => item.severity === "high")) return "declining";
  const positive = (changes.referring_domains.absolute ?? 0) > 0
    || (changes.domain_rank.absolute ?? 0) > 0
    || (changes.health_score.absolute ?? 0) > 0;
  return positive ? "improving" : alerts.length ? "watch" : "stable";
}

export function analyzeBacklinkHistory(domain, rows = []) {
  const points = rows.map((row) => ({
    snapshot_at: row.snapshot_at,
    source: row.source,
    ...Object.fromEntries(METRICS.map((key) => [key, finite(row[key])])),
  }));
  const latest = points.at(-1) ?? null;
  const previous = points.at(-2) ?? null;
  const changes = Object.fromEntries(METRICS.map((key) => [key, change(latest?.[key], previous?.[key])]));
  const alerts = latest && previous ? alertsFor(changes) : [];

  return {
    domain,
    points,
    latest,
    previous,
    changes,
    summary: {
      snapshots: points.length,
      period_start: points[0]?.snapshot_at ?? null,
      period_end: latest?.snapshot_at ?? null,
      status: statusFor(changes, alerts),
    },
    alerts,
    disclaimer: "变化基于已保存的 DataForSEO 外链快照；两次快照之间的增减不等于 Google 排名变化。",
  };
}
