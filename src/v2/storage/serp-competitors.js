const FRESHNESS_DAYS = 7;

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function readFreshSerpCompetitors({
  db,
  normalizedKeyword,
  languageCode,
  locationCode,
}) {
  const snapshot = await db
    .prepare(
      `SELECT
        s.id,
        s.provider,
        s.search_engine_domain,
        s.checked_at,
        s.serp_features_json,
        s.actual_cost_usd,
        s.fetched_at,
        k.keyword
      FROM keywords k
      JOIN serp_competitor_snapshots s ON s.keyword_id = k.id
      WHERE k.normalized_keyword = ?
        AND k.language_code = ?
        AND k.location_code = ?
        AND s.fetched_at >= datetime('now', '-${FRESHNESS_DAYS} days')
      ORDER BY s.fetched_at DESC
      LIMIT 1`,
    )
    .bind(normalizedKeyword, languageCode, locationCode)
    .first();

  if (!snapshot?.id) return null;

  const pages = await db
    .prepare(
      `SELECT
        organic_position,
        absolute_position,
        domain,
        url,
        title,
        description,
        breadcrumb,
        website_name,
        is_featured_snippet,
        is_web_story
      FROM serp_competitor_pages
      WHERE snapshot_id = ?
      ORDER BY organic_position ASC, absolute_position ASC`,
    )
    .bind(snapshot.id)
    .all();

  const items = (pages?.results ?? []).map((row) => ({
    position: row.organic_position,
    absolute_position: row.absolute_position,
    domain: row.domain,
    url: row.url,
    title: row.title,
    description: row.description,
    breadcrumb: row.breadcrumb,
    website_name: row.website_name,
    is_featured_snippet: row.is_featured_snippet === 1,
    is_web_story: row.is_web_story === 1,
  }));

  return {
    keyword: snapshot.keyword,
    location_code: locationCode,
    language_code: languageCode,
    search_engine_domain: snapshot.search_engine_domain,
    checked_at: snapshot.checked_at,
    serp_features: parseJsonArray(snapshot.serp_features_json),
    items,
    result_count: items.length,
    disclaimer:
      "Page-level Google organic results only. Domain/Page authority and backlink strength are not included in this request.",
    fetched_at: snapshot.fetched_at,
  };
}

export async function persistSerpCompetitors({
  db,
  keyword,
  normalizedKeyword,
  languageCode,
  locationCode,
  data,
  actualCostUsd,
}) {
  const keywordRow = await db
    .prepare(
      `INSERT INTO keywords (
        keyword,
        normalized_keyword,
        language_code,
        location_code
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(normalized_keyword, language_code, location_code)
      DO UPDATE SET
        keyword = excluded.keyword,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id`,
    )
    .bind(keyword, normalizedKeyword, languageCode, locationCode)
    .first();

  if (!keywordRow?.id) throw new Error("Unable to persist keyword identity.");

  const snapshotId = crypto.randomUUID();
  const statements = [
    db.prepare(
      `INSERT INTO serp_competitor_snapshots (
        id,
        keyword_id,
        provider,
        search_engine_domain,
        checked_at,
        serp_features_json,
        actual_cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      snapshotId,
      keywordRow.id,
      "dataforseo",
      data.search_engine_domain ?? null,
      data.checked_at ?? null,
      JSON.stringify(data.serp_features ?? []),
      actualCostUsd ?? null,
    ),
    ...(data.items ?? []).map((item) =>
      db.prepare(
        `INSERT INTO serp_competitor_pages (
          snapshot_id,
          organic_position,
          absolute_position,
          domain,
          url,
          title,
          description,
          breadcrumb,
          website_name,
          is_featured_snippet,
          is_web_story
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        snapshotId,
        item.position,
        item.absolute_position ?? null,
        item.domain,
        item.url,
        item.title ?? null,
        item.description ?? null,
        item.breadcrumb ?? null,
        item.website_name ?? null,
        item.is_featured_snippet ? 1 : 0,
        item.is_web_story ? 1 : 0,
      ),
    ),
  ];

  await db.batch(statements);
  return snapshotId;
}
