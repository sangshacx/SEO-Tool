function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function snapshotTime(value) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export async function recordBacklinkSnapshot({ db, snapshot, source, actualCostUsd }) {
  const metrics = snapshot?.metrics ?? {};
  const health = snapshot?.intelligence?.link_profile_health ?? {};
  const normalizedSource = source === "live" ? "live" : "cache";
  const recordedSnapshotTime = snapshotTime(snapshot?.generated_at);
  if (!recordedSnapshotTime || typeof snapshot?.target !== "string") {
    return { inserted: false, reason: "snapshot_identity_missing" };
  }
  const result = await db.prepare(
    "INSERT INTO backlink_snapshots (domain, provider, source, domain_rank, backlinks, referring_domains, " +
    "referring_ips, dofollow_pages, nofollow_share_percent, spam_score, broken_backlinks, health_score, " +
    "health_grade, score_version, snapshot_at, actual_cost_usd) VALUES (?, 'dataforseo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(domain, snapshot_at) DO NOTHING",
  ).bind(
    snapshot.target,
    normalizedSource,
    finite(metrics.domain_rank),
    finite(metrics.backlinks),
    finite(metrics.referring_domains),
    finite(metrics.referring_ips),
    finite(metrics.referring_pages_dofollow),
    finite(metrics.nofollow_share_percent),
    finite(metrics.backlink_spam_score),
    finite(metrics.broken_backlinks),
    finite(health.score),
    typeof health.grade === "string" ? health.grade : null,
    typeof health.version === "string" ? health.version : null,
    recordedSnapshotTime,
    finite(actualCostUsd),
  ).run();

  return { inserted: Number(result?.meta?.changes ?? 0) > 0 };
}
