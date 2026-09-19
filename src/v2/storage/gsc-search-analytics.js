const INSERT_CHUNK_SIZE = 250;

function analyticsRow(row = {}) {
  return {
    query_text: String(row.query ?? ""),
    page_url: String(row.page ?? ""),
    country: String(row.country ?? ""),
    device: String(row.device ?? ""),
    clicks: Number.isFinite(Number(row.clicks)) ? Number(row.clicks) : 0,
    impressions: Number.isFinite(Number(row.impressions)) ? Number(row.impressions) : 0,
    ctr: Number.isFinite(Number(row.ctr)) ? Number(row.ctr) : 0,
    position: Number.isFinite(Number(row.position)) ? Number(row.position) : 0,
  };
}

function insertStatement(db, { siteProfileId, property, date, dimensionSet, rows, syncedAt }) {
  const sql =
    "INSERT INTO gsc_search_analytics_daily (" +
    "site_profile_id, property, date, dimension_set, query_text, page_url, country, device, clicks, impressions, ctr, position, synced_at" +
    ") SELECT ?, ?, ?, ?, " +
    "COALESCE(json_extract(value, '$.query_text'), ''), " +
    "COALESCE(json_extract(value, '$.page_url'), ''), " +
    "COALESCE(json_extract(value, '$.country'), ''), " +
    "COALESCE(json_extract(value, '$.device'), ''), " +
    "COALESCE(json_extract(value, '$.clicks'), 0), " +
    "COALESCE(json_extract(value, '$.impressions'), 0), " +
    "COALESCE(json_extract(value, '$.ctr'), 0), " +
    "COALESCE(json_extract(value, '$.position'), 0), ? " +
    "FROM json_each(?)";

  return db.prepare(sql).bind(
    siteProfileId,
    property,
    date,
    dimensionSet,
    syncedAt,
    JSON.stringify(rows.map(analyticsRow)),
  );
}

export async function replaceGscAnalyticsPartition(
  db,
  { siteProfileId, property, date, dimensionSet, rows, syncedAt = new Date().toISOString() },
) {
  const clean = Array.isArray(rows) ? rows : [];
  const statements = [
    db.prepare(
      "DELETE FROM gsc_search_analytics_daily WHERE site_profile_id = ? AND date = ? AND dimension_set = ?",
    ).bind(siteProfileId, date, dimensionSet),
  ];

  for (let index = 0; index < clean.length; index += INSERT_CHUNK_SIZE) {
    statements.push(insertStatement(db, {
      siteProfileId,
      property,
      date,
      dimensionSet,
      rows: clean.slice(index, index + INSERT_CHUNK_SIZE),
      syncedAt,
    }));
  }

  const results = await db.batch(statements);
  if (!Array.isArray(results) || results.some((result) => result?.success === false)) {
    throw new Error("GSC analytics partition could not be persisted.");
  }
  return { rows_written: clean.length, statements: statements.length };
}

export async function getGscSiteMapping(db, siteDomain) {
  return db.prepare(
    "SELECT gm.site_profile_id, gm.property, gm.property_type, gm.permission_level " +
    "FROM gsc_site_mappings gm JOIN site_profiles sp ON sp.id = gm.site_profile_id " +
    "WHERE sp.domain = ? LIMIT 1",
  ).bind(siteDomain).first();
}

export async function recordGscSyncRun(db, input) {
  const result = await db.prepare(
    "INSERT INTO gsc_sync_runs (" +
    "site_profile_id, property, target_date, dimension_sets_json, row_limit_per_set, provider_requests, " +
    "rows_received, rows_written, truncated_sets_json, status, error_code, started_at, completed_at" +
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
  ).bind(
    input.site_profile_id,
    input.property,
    input.target_date,
    JSON.stringify(input.dimension_sets || []),
    input.row_limit_per_set,
    input.provider_requests ?? 0,
    input.rows_received ?? 0,
    input.rows_written ?? 0,
    JSON.stringify(input.truncated_sets || []),
    input.status,
    input.error_code ?? null,
    input.started_at,
    input.completed_at,
  ).first();
  return { id: result?.id ?? null };
}

export async function latestGscSyncRun(db, siteDomain) {
  return db.prepare(
    "SELECT sr.id, sr.property, sr.target_date, sr.dimension_sets_json, sr.row_limit_per_set, sr.provider_requests, " +
    "sr.rows_received, sr.rows_written, sr.truncated_sets_json, sr.status, sr.error_code, sr.started_at, sr.completed_at " +
    "FROM gsc_sync_runs sr JOIN site_profiles sp ON sp.id = sr.site_profile_id " +
    "WHERE sp.domain = ? ORDER BY sr.id DESC LIMIT 1",
  ).bind(siteDomain).first();
}
