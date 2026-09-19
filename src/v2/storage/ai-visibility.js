function periodMonth(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return null;
  return value + "-01";
}

function periodDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function resolveManagedSite(db, domain) {
  if (!db || typeof domain !== "string" || !domain) return null;
  return db.prepare(
    "SELECT id, domain FROM site_profiles WHERE domain = ? LIMIT 1",
  ).bind(domain).first();
}

export async function persistAiVisibilityHistorical({
  db,
  target,
  platform,
  locationCode,
  languageCode,
  points = [],
  providerFetchedAt = new Date().toISOString(),
}) {
  const site = await resolveManagedSite(db, target);
  if (!site?.id) return { persisted: false, reason: "unmanaged_site", rows: 0 };

  const valid = (Array.isArray(points) ? points : [])
    .map((point) => ({
      period: periodMonth(point?.period),
      mentions: point?.mentions == null ? null : Number(point.mentions),
      ai_search_volume: point?.ai_search_volume == null ? null : Number(point.ai_search_volume),
    }))
    .filter((point) =>
      point.period &&
      (point.mentions === null || Number.isFinite(point.mentions)) &&
      (point.ai_search_volume === null || Number.isFinite(point.ai_search_volume))
    );

  if (!valid.length) return { persisted: true, rows: 0 };

  await db.batch(valid.map((point) =>
    db.prepare(`
      INSERT INTO ai_visibility_history (
        site_profile_id, platform, location_code, language_code, period,
        mentions, ai_search_volume, source, provider_fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'dataforseo_historical', ?)
      ON CONFLICT(site_profile_id, platform, location_code, language_code, period, source)
      DO UPDATE SET
        mentions = excluded.mentions,
        ai_search_volume = excluded.ai_search_volume,
        provider_fetched_at = excluded.provider_fetched_at,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      site.id,
      platform,
      Number(locationCode),
      String(languageCode),
      point.period,
      point.mentions,
      point.ai_search_volume,
      providerFetchedAt,
    )
  ));

  return { persisted: true, rows: valid.length };
}

export async function persistAiVisibilityNewLost({
  db,
  target,
  platform,
  locationCode,
  languageCode,
  points = [],
  providerFetchedAt = new Date().toISOString(),
}) {
  const site = await resolveManagedSite(db, target);
  if (!site?.id) return { persisted: false, reason: "unmanaged_site", rows: 0 };

  const valid = (Array.isArray(points) ? points : [])
    .map((point) => ({
      period: periodDate(point?.date),
      new_mentions: Number(point?.new_mentions ?? 0),
      lost_mentions: Number(point?.lost_mentions ?? 0),
      new_ai_search_volume: Number(point?.new_ai_search_volume ?? 0),
      lost_ai_search_volume: Number(point?.lost_ai_search_volume ?? 0),
    }))
    .filter((point) =>
      point.period &&
      [
        point.new_mentions,
        point.lost_mentions,
        point.new_ai_search_volume,
        point.lost_ai_search_volume,
      ].every(Number.isFinite)
    );

  if (!valid.length) return { persisted: true, rows: 0 };

  await db.batch(valid.map((point) =>
    db.prepare(`
      INSERT INTO ai_visibility_new_lost (
        site_profile_id, platform, location_code, language_code, period,
        new_mentions, lost_mentions, new_ai_search_volume, lost_ai_search_volume,
        source, provider_fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'dataforseo_new_lost', ?)
      ON CONFLICT(site_profile_id, platform, location_code, language_code, period, source)
      DO UPDATE SET
        new_mentions = excluded.new_mentions,
        lost_mentions = excluded.lost_mentions,
        new_ai_search_volume = excluded.new_ai_search_volume,
        lost_ai_search_volume = excluded.lost_ai_search_volume,
        provider_fetched_at = excluded.provider_fetched_at,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      site.id,
      platform,
      Number(locationCode),
      String(languageCode),
      point.period,
      point.new_mentions,
      point.lost_mentions,
      point.new_ai_search_volume,
      point.lost_ai_search_volume,
      providerFetchedAt,
    )
  ));

  return { persisted: true, rows: valid.length };
}

export async function readAiVisibilityHistorical(db, {
  target,
  platform,
  locationCode,
  languageCode,
  limit = 24,
} = {}) {
  const rows = await db.prepare(`
    SELECT
      h.period,
      h.mentions,
      h.ai_search_volume,
      h.provider_fetched_at,
      h.updated_at
    FROM ai_visibility_history h
    JOIN site_profiles sp ON sp.id = h.site_profile_id
    WHERE sp.domain = ?
      AND h.platform = ?
      AND h.location_code = ?
      AND h.language_code = ?
      AND h.source = 'dataforseo_historical'
    ORDER BY h.period DESC
    LIMIT ?
  `).bind(
    target,
    platform,
    Number(locationCode),
    String(languageCode),
    Math.max(1, Math.min(60, Number(limit) || 24)),
  ).all();

  return (rows?.results ?? []).reverse().map((row) => ({
    period: String(row.period).slice(0, 7),
    mentions: row.mentions == null ? null : Number(row.mentions),
    ai_search_volume: row.ai_search_volume == null ? null : Number(row.ai_search_volume),
    provider_fetched_at: row.provider_fetched_at,
    updated_at: row.updated_at,
  }));
}

export async function readAiVisibilityNewLost(db, {
  target,
  platform,
  locationCode,
  languageCode,
  limit = 24,
} = {}) {
  const rows = await db.prepare(`
    SELECT
      e.period,
      e.new_mentions,
      e.lost_mentions,
      e.new_ai_search_volume,
      e.lost_ai_search_volume,
      e.provider_fetched_at,
      e.updated_at
    FROM ai_visibility_new_lost e
    JOIN site_profiles sp ON sp.id = e.site_profile_id
    WHERE sp.domain = ?
      AND e.platform = ?
      AND e.location_code = ?
      AND e.language_code = ?
      AND e.source = 'dataforseo_new_lost'
    ORDER BY e.period DESC
    LIMIT ?
  `).bind(
    target,
    platform,
    Number(locationCode),
    String(languageCode),
    Math.max(1, Math.min(60, Number(limit) || 24)),
  ).all();

  return (rows?.results ?? []).reverse().map((row) => {
    const newMentions = Number(row.new_mentions ?? 0);
    const lostMentions = Number(row.lost_mentions ?? 0);
    const newVolume = Number(row.new_ai_search_volume ?? 0);
    const lostVolume = Number(row.lost_ai_search_volume ?? 0);
    return {
      date: row.period,
      new_mentions: newMentions,
      lost_mentions: lostMentions,
      net_mentions: newMentions - lostMentions,
      new_ai_search_volume: newVolume,
      lost_ai_search_volume: lostVolume,
      net_ai_search_volume: newVolume - lostVolume,
      provider_fetched_at: row.provider_fetched_at,
      updated_at: row.updated_at,
    };
  });
}
