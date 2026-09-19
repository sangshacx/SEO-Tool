import { buildGscCannibalizationCandidates } from "../gsc/cannibalization.js";

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

function gscWindow(latestDate, days) {
  const end = new Date(latestDate + "T00:00:00Z");
  const currentStart = new Date(end);
  currentStart.setUTCDate(currentStart.getUTCDate() - days + 1);
  const previousEnd = new Date(currentStart);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - days + 1);
  return {
    current_start: currentStart.toISOString().slice(0, 10),
    current_end: latestDate,
    previous_start: previousStart.toISOString().slice(0, 10),
    previous_end: previousEnd.toISOString().slice(0, 10),
  };
}

const GSC_VIEW_CONFIG = Object.freeze({
  queries: { dimension_set: "query", primary: "query_text", secondary: null },
  pages: { dimension_set: "page", primary: "page_url", secondary: null },
  query_page: { dimension_set: "query_page", primary: "query_text", secondary: "page_url" },
});

export async function readGscIntelligence(db, {
  siteDomain,
  view = "queries",
  days = 28,
  limit = 100,
  pageUrl = null,
}) {
  const config = GSC_VIEW_CONFIG[view];
  if (!config) throw new TypeError("Unsupported GSC intelligence view.");
  const requestedDays = Number(days);
  if (![7, 28, 90].includes(requestedDays)) throw new TypeError("Choose a 7, 28, or 90 day GSC window.");
  const rowLimit = Math.max(1, Math.min(200, Number(limit) || 100));

  const site = await db.prepare("SELECT id FROM site_profiles WHERE domain = ? LIMIT 1").bind(siteDomain).first();
  if (!site?.id) {
    const error = new Error("SITE_PROFILE_NOT_FOUND");
    error.code = "SITE_PROFILE_NOT_FOUND";
    error.httpStatus = 404;
    throw error;
  }

  const latest = await db.prepare(
    "SELECT MAX(date) AS latest_date FROM gsc_search_analytics_daily WHERE site_profile_id = ? AND dimension_set = ?",
  ).bind(site.id, config.dimension_set).first();
  if (!latest?.latest_date) {
    return {
      site_profile_id: site.id,
      latest_date: null,
      window: null,
      coverage: { current_days: 0, previous_days: 0, requested_days: requestedDays },
      metrics: { clicks: 0, impressions: 0, ctr: 0, position: null },
      rows: [],
    };
  }

  const window = gscWindow(latest.latest_date, requestedDays);
  const filterSql = view === "query_page" && pageUrl ? " AND page_url = ?" : "";
  const filterValues = view === "query_page" && pageUrl ? [pageUrl] : [];

  const primary = config.primary;
  const secondarySelect = config.secondary ? ", " + config.secondary + " AS secondary_key" : ", '' AS secondary_key";
  const secondaryGroup = config.secondary ? ", " + config.secondary : "";

  const rowsSql =
    "SELECT " + primary + " AS primary_key" + secondarySelect + ", " +
    "SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) AS clicks, " +
    "SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) AS impressions, " +
    "CASE WHEN SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) > 0 " +
    "THEN SUM(CASE WHEN date BETWEEN ? AND ? THEN position * impressions ELSE 0 END) / " +
    "SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) ELSE NULL END AS position, " +
    "SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) AS previous_clicks, " +
    "SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) AS previous_impressions, " +
    "CASE WHEN SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) > 0 " +
    "THEN SUM(CASE WHEN date BETWEEN ? AND ? THEN position * impressions ELSE 0 END) / " +
    "SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) ELSE NULL END AS previous_position " +
    "FROM gsc_search_analytics_daily WHERE site_profile_id = ? AND dimension_set = ? " +
    "AND date BETWEEN ? AND ?" + filterSql +
    " GROUP BY " + primary + secondaryGroup +
    " HAVING SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) > 0 " +
    "ORDER BY impressions DESC, clicks DESC LIMIT ?";

  const current = [window.current_start, window.current_end];
  const previous = [window.previous_start, window.previous_end];
  const range = [window.previous_start, window.current_end];
  const rowValues = [
    ...current, ...current,
    ...current, ...current, ...current,
    ...previous, ...previous,
    ...previous, ...previous, ...previous,
    site.id, config.dimension_set, ...range,
    ...filterValues,
    ...current,
    rowLimit,
  ];
  const rowsResult = await db.prepare(rowsSql).bind(...rowValues).all();

  const coverageSql =
    "SELECT " +
    "COUNT(DISTINCT CASE WHEN date BETWEEN ? AND ? THEN date END) AS current_days, " +
    "COUNT(DISTINCT CASE WHEN date BETWEEN ? AND ? THEN date END) AS previous_days, " +
    "SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) AS clicks, " +
    "SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) AS impressions, " +
    "CASE WHEN SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) > 0 " +
    "THEN SUM(CASE WHEN date BETWEEN ? AND ? THEN position * impressions ELSE 0 END) / " +
    "SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) ELSE NULL END AS position " +
    "FROM gsc_search_analytics_daily WHERE site_profile_id = ? AND dimension_set = ? " +
    "AND date BETWEEN ? AND ?" + filterSql;
  const coverageValues = [
    ...current, ...previous, ...current, ...current,
    ...current, ...current, ...current,
    site.id, config.dimension_set, ...range, ...filterValues,
  ];
  const coverage = await db.prepare(coverageSql).bind(...coverageValues).first();

  return {
    site_profile_id: site.id,
    latest_date: latest.latest_date,
    window,
    coverage: {
      current_days: Number(coverage?.current_days ?? 0),
      previous_days: Number(coverage?.previous_days ?? 0),
      requested_days: requestedDays,
    },
    metrics: {
      clicks: Number(coverage?.clicks ?? 0),
      impressions: Number(coverage?.impressions ?? 0),
      position: coverage?.position == null ? null : Number(coverage.position),
    },
    rows: rowsResult.results ?? [],
  };
}


export async function completedGscSyncDates(db, {
  siteProfileId,
  dates,
  dimensionSets,
  minimumRowLimit,
}) {
  const requestedDates = [...new Set((Array.isArray(dates) ? dates : []).filter(Boolean))];
  if (!requestedDates.length) return new Set();
  const placeholders = requestedDates.map(() => "?").join(",");
  const result = await db.prepare(
    "SELECT target_date, dimension_sets_json, row_limit_per_set, status " +
    "FROM gsc_sync_runs WHERE site_profile_id = ? AND target_date IN (" + placeholders + ") " +
    "AND status = 'success' ORDER BY id DESC",
  ).bind(siteProfileId, ...requestedDates).all();

  const completed = new Set();
  const required = new Set(dimensionSets ?? []);
  for (const row of result.results ?? []) {
    if (completed.has(row.target_date)) continue;
    if (Number(row.row_limit_per_set ?? 0) < Number(minimumRowLimit ?? 0)) continue;
    let sets = [];
    try { sets = JSON.parse(row.dimension_sets_json); } catch { sets = []; }
    if (!Array.isArray(sets)) continue;
    const available = new Set(sets);
    if ([...required].every((set) => available.has(set))) completed.add(row.target_date);
  }
  return completed;
}


export async function readGscCannibalizationCandidates(db, {
  siteDomain,
  days = 28,
  limit = 50,
} = {}) {
  const requestedDays = Number(days);
  if (![7, 28, 90].includes(requestedDays)) throw new TypeError("Choose a 7, 28, or 90 day GSC window.");
  const rowLimit = Math.max(1, Math.min(100, Number(limit) || 50));

  const site = await db.prepare(
    "SELECT id FROM site_profiles WHERE domain = ? LIMIT 1",
  ).bind(siteDomain).first();
  if (!site?.id) {
    const error = new Error("SITE_PROFILE_NOT_FOUND");
    error.code = "SITE_PROFILE_NOT_FOUND";
    error.httpStatus = 404;
    throw error;
  }

  const latest = await db.prepare(
    "SELECT MAX(date) AS latest_date FROM gsc_search_analytics_daily " +
    "WHERE site_profile_id = ? AND dimension_set = 'query_page'",
  ).bind(site.id).first();

  if (!latest?.latest_date) {
    return {
      site_profile_id: site.id,
      latest_date: null,
      window: null,
      coverage: { current_days: 0, previous_days: 0, requested_days: requestedDays },
      metrics: { clicks: 0, impressions: 0, ctr: 0, position: null },
      rows: [],
    };
  }

  const window = gscWindow(latest.latest_date, requestedDays);
  const candidatePoolLimit = Math.min(500, Math.max(100, rowLimit * 5));

  const rowsResult = await db.prepare(
    "WITH query_totals AS (" +
    " SELECT query_text, SUM(impressions) AS total_impressions" +
    " FROM gsc_search_analytics_daily" +
    " WHERE site_profile_id = ? AND dimension_set = 'query_page'" +
    " AND date BETWEEN ? AND ? AND query_text <> '' AND page_url <> ''" +
    " GROUP BY query_text" +
    " HAVING SUM(impressions) >= 100" +
    " ORDER BY total_impressions DESC" +
    " LIMIT ?" +
    "), page_rows AS (" +
    " SELECT d.query_text, d.page_url," +
    " SUM(d.clicks) AS clicks, SUM(d.impressions) AS impressions," +
    " CASE WHEN SUM(d.impressions) > 0" +
    " THEN SUM(d.position * d.impressions) / SUM(d.impressions) ELSE NULL END AS position" +
    " FROM gsc_search_analytics_daily d" +
    " JOIN query_totals q ON q.query_text = d.query_text" +
    " WHERE d.site_profile_id = ? AND d.dimension_set = 'query_page'" +
    " AND d.date BETWEEN ? AND ? AND d.page_url <> ''" +
    " GROUP BY d.query_text, d.page_url" +
    ")" +
    " SELECT query_text, page_url, clicks, impressions, position" +
    " FROM page_rows" +
    " ORDER BY query_text ASC, impressions DESC, position ASC",
  ).bind(
    site.id,
    window.current_start,
    window.current_end,
    candidatePoolLimit,
    site.id,
    window.current_start,
    window.current_end,
  ).all();

  const coverage = await db.prepare(
    "SELECT " +
    "COUNT(DISTINCT CASE WHEN date BETWEEN ? AND ? THEN date END) AS current_days, " +
    "COUNT(DISTINCT CASE WHEN date BETWEEN ? AND ? THEN date END) AS previous_days, " +
    "SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) AS clicks, " +
    "SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) AS impressions, " +
    "CASE WHEN SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) > 0 " +
    "THEN SUM(CASE WHEN date BETWEEN ? AND ? THEN position * impressions ELSE 0 END) / " +
    "SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) ELSE NULL END AS position " +
    "FROM gsc_search_analytics_daily " +
    "WHERE site_profile_id = ? AND dimension_set = 'query_page' AND date BETWEEN ? AND ?",
  ).bind(
    window.current_start, window.current_end,
    window.previous_start, window.previous_end,
    window.current_start, window.current_end,
    window.current_start, window.current_end,
    window.current_start, window.current_end,
    window.current_start, window.current_end,
    window.current_start, window.current_end,
    site.id,
    window.previous_start,
    window.current_end,
  ).first();

  const rows = buildGscCannibalizationCandidates(rowsResult?.results ?? [], { limit: rowLimit });
  const clicks = Number(coverage?.clicks ?? 0);
  const impressions = Number(coverage?.impressions ?? 0);

  return {
    site_profile_id: site.id,
    latest_date: latest.latest_date,
    window,
    coverage: {
      current_days: Number(coverage?.current_days ?? 0),
      previous_days: Number(coverage?.previous_days ?? 0),
      requested_days: requestedDays,
    },
    metrics: {
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : 0,
      position: coverage?.position == null ? null : Number(coverage.position),
    },
    rows,
  };
}
