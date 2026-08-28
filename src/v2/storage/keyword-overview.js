const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const PROVIDER = "dataforseo";
const ENDPOINT = "/v3/dataforseo_labs/google/keyword_overview/live";
const OPERATION = "keyword_overview";

export function buildKeywordOverviewCacheKey({
  keyword,
  languageCode,
  locationCode,
}) {
  const normalizedKeyword = keyword.toLowerCase();
  return [
    "v2",
    "keywords",
    "overview",
    "v1",
    locationCode,
    languageCode,
    encodeURIComponent(normalizedKeyword),
  ].join(":");
}

export async function readKeywordOverviewCache(cache, key) {
  return cache.get(key, { type: "json" });
}

export async function writeKeywordOverviewCache(cache, key, data) {
  await cache.put(
    key,
    JSON.stringify({
      data,
      cached_at: new Date().toISOString(),
    }),
    { expirationTtl: CACHE_TTL_SECONDS },
  );
}

export async function persistKeywordOverview({
  db,
  keyword,
  normalizedKeyword,
  languageCode,
  locationCode,
  data,
  actualCostUsd,
}) {
  if (!data) {
    return;
  }

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

  if (!keywordRow?.id) {
    throw new Error("Unable to persist keyword identity.");
  }

  await db
    .prepare(
      `INSERT INTO keyword_metrics (
        keyword_id,
        provider,
        search_volume,
        keyword_difficulty,
        cpc_usd,
        competition,
        competition_level,
        intent_primary,
        intent_secondary_json,
        monthly_searches_json,
        trend_monthly,
        trend_quarterly,
        trend_yearly,
        provider_updated_at,
        actual_cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      keywordRow.id,
      PROVIDER,
      data.metrics?.search_volume ?? null,
      data.metrics?.keyword_difficulty ?? null,
      data.metrics?.cpc_usd ?? null,
      data.metrics?.competition ?? null,
      data.metrics?.competition_level ?? null,
      data.intent?.primary ?? null,
      JSON.stringify(data.intent?.secondary ?? []),
      JSON.stringify(data.trend?.monthly_searches ?? []),
      data.trend?.change?.monthly ?? null,
      data.trend?.change?.quarterly ?? null,
      data.trend?.change?.yearly ?? null,
      data.data_freshness?.keyword_metrics_updated_at ?? null,
      actualCostUsd ?? null,
    )
    .run();
}

export async function recordApiUsage({
  db,
  requestId,
  provider = PROVIDER,
  endpoint = ENDPOINT,
  operation = OPERATION,
  taskCount = 0,
  resultCount = 0,
  actualCostUsd = 0,
  cacheHit = false,
  status,
  httpStatus,
  durationMs,
}) {
  await db
    .prepare(
      `INSERT INTO api_usage (
        request_id,
        provider,
        endpoint,
        operation,
        task_count,
        result_count,
        actual_cost_usd,
        cache_hit,
        status,
        http_status,
        duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      requestId,
      provider,
      endpoint,
      operation,
      taskCount,
      resultCount,
      actualCostUsd,
      cacheHit ? 1 : 0,
      status,
      httpStatus,
      durationMs,
    )
    .run();
}
