import {
  DataForSEOProviderError,
  fetchKeywordOverview,
} from "../../../../src/v2/providers/dataforseo.js";
import {
  scoreSerpWeakness,
} from "../../../../src/v2/scoring/serp-weakness.js";
import {
  recordApiUsage,
} from "../../../../src/v2/storage/keyword-overview.js";

const ENDPOINT = "/v3/dataforseo_labs/google/keyword_overview/live";
const OPERATION = "serp_weakness";
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function validationError(message, field) {
  return jsonResponse({
    ok: false,
    error: { code: "VALIDATION_ERROR", message, field },
  }, 400);
}

function normalizeKeyword(value) {
  return typeof value === "string"
    ? value.trim().replace(/s+/g, " ")
    : "";
}

function cacheKey(keyword, locationCode, languageCode) {
  return [
    "v2",
    "keywords",
    "serp-weakness",
    "v1",
    locationCode,
    languageCode,
    encodeURIComponent(keyword.toLowerCase()),
  ].join(":");
}

async function readCache(cache, key) {
  return cache.get(key, { type: "json" });
}

async function writeCache(cache, key, data) {
  await cache.put(
    key,
    JSON.stringify({
      data,
      cached_at: new Date().toISOString(),
    }),
    {
      expirationTtl: data
        ? CACHE_TTL_SECONDS
        : 24 * 60 * 60,
    },
  );
}

async function persistSnapshot({
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

  const keywordSql =
    "INSERT INTO keywords (" +
    "keyword, normalized_keyword, language_code, location_code" +
    ") VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(normalized_keyword, language_code, location_code) " +
    "DO UPDATE SET keyword = excluded.keyword, " +
    "updated_at = CURRENT_TIMESTAMP RETURNING id";

  const keywordRow = await db
    .prepare(keywordSql)
    .bind(
      keyword,
      normalizedKeyword,
      languageCode,
      locationCode,
    )
    .first();

  if (!keywordRow?.id) {
    throw new Error("Unable to persist keyword identity.");
  }

  const snapshotSql =
    "INSERT INTO serp_weakness_snapshots (" +
    "keyword_id, score_version, ranking_weakness, " +
    "organic_click_opportunity, confidence_score, decision_code, " +
    "serp_features_json, penalized_features_json, " +
    "average_referring_domains, average_page_rank, " +
    "average_main_domain_rank, serp_results_count, " +
    "serp_updated_at, backlinks_updated_at, actual_cost_usd" +
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

  await db
    .prepare(snapshotSql)
    .bind(
      keywordRow.id,
      data.version,
      data.ranking_weakness,
      data.organic_click_opportunity,
      data.confidence_score,
      data.decision.code,
      JSON.stringify(data.serp_features.detected),
      JSON.stringify(data.serp_features.penalized),
      data.source_metrics.average_referring_domains,
      data.source_metrics.average_page_rank,
      data.source_metrics.average_main_domain_rank,
      data.source_metrics.serp_results_count,
      data.data_freshness.serp_updated_at,
      data.data_freshness.backlinks_updated_at,
      actualCostUsd ?? null,
    )
    .run();
}

async function safelyRecordUsage(options) {
  try {
    await recordApiUsage(options);
  } catch {
    // Cost logging must not expose infrastructure details.
  }
}

export async function onRequestPost({ request, env }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  let body;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({
      ok: false,
      error: {
        code: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      },
    }, 400);
  }

  const keyword = normalizeKeyword(body?.keyword);
  const normalizedKeyword = keyword.toLowerCase();
  const locationCode = body?.location_code ?? 2840;
  const languageCode = body?.language_code ?? "en";

  if (!keyword) {
    return validationError("Keyword is required.", "keyword");
  }

  if (keyword.length > 80) {
    return validationError(
      "Keyword must not exceed 80 characters.",
      "keyword",
    );
  }

  if (keyword.split(" ").length > 10) {
    return validationError(
      "Keyword must not exceed 10 words.",
      "keyword",
    );
  }

  if (!Number.isInteger(locationCode) || locationCode <= 0) {
    return validationError(
      "location_code must be a positive integer.",
      "location_code",
    );
  }

  if (
    typeof languageCode !== "string" ||
    !/^[a-z]{2,3}$/.test(languageCode)
  ) {
    return validationError(
      "language_code must be a 2-3 letter lowercase code.",
      "language_code",
    );
  }

  if (!env.DB || !env.CACHE) {
    return jsonResponse({
      ok: false,
      error: {
        code: "INFRASTRUCTURE_NOT_CONFIGURED",
        message: "SERP weakness storage is not configured.",
      },
    }, 503);
  }

  const key = cacheKey(keyword, locationCode, languageCode);

  try {
    const cachedEntry = await readCache(env.CACHE, key);

    if (cachedEntry && Object.hasOwn(cachedEntry, "data")) {
      const data = cachedEntry.data;
      const durationMs = Date.now() - startedAt;

      await recordApiUsage({
        db: env.DB,
        requestId,
        endpoint: ENDPOINT,
        operation: OPERATION,
        resultCount: data ? 1 : 0,
        cacheHit: true,
        status: "success",
        httpStatus: 200,
        durationMs,
      });

      return jsonResponse({
        ok: true,
        data,
        meta: {
          request_id: requestId,
          source: "dataforseo",
          cached: true,
          actual_cost_usd: 0,
          result_found: data !== null,
          duration_ms: Date.now() - startedAt,
        },
      });
    }

    const providerResponse = await fetchKeywordOverview({
      env,
      keyword,
      locationCode,
      languageCode,
      includeSerpInfo: true,
    });
    const item = providerResponse.result?.items?.[0] ?? null;
    const data = item ? scoreSerpWeakness(item) : null;
    const actualCostUsd =
      providerResponse.usage.actual_cost_usd ?? 0;

    await persistSnapshot({
      db: env.DB,
      keyword,
      normalizedKeyword,
      languageCode,
      locationCode,
      data,
      actualCostUsd,
    });

    await writeCache(env.CACHE, key, data);

    const durationMs = Date.now() - startedAt;

    await recordApiUsage({
      db: env.DB,
      requestId,
      endpoint: ENDPOINT,
      operation: OPERATION,
      taskCount: providerResponse.usage.task_count,
      resultCount: providerResponse.usage.result_count,
      actualCostUsd,
      cacheHit: false,
      status: "success",
      httpStatus: 200,
      durationMs,
    });

    return jsonResponse({
      ok: true,
      data,
      meta: {
        request_id: requestId,
        source: "dataforseo",
        cached: false,
        actual_cost_usd: actualCostUsd,
        result_found: data !== null,
        duration_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const isProviderError =
      error instanceof DataForSEOProviderError;

    await safelyRecordUsage({
      db: env.DB,
      requestId,
      endpoint: ENDPOINT,
      operation: OPERATION,
      status: isProviderError
        ? "provider_error"
        : "infrastructure_error",
      httpStatus: isProviderError ? error.httpStatus : 500,
      durationMs,
    });

    if (isProviderError) {
      return jsonResponse({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          provider_status: error.providerStatus,
        },
        meta: {
          request_id: requestId,
          cached: false,
          actual_cost_usd: 0,
          duration_ms: durationMs,
        },
      }, error.httpStatus);
    }

    return jsonResponse({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Unable to complete SERP weakness analysis.",
      },
      meta: {
        request_id: requestId,
        cached: false,
        actual_cost_usd: 0,
        duration_ms: durationMs,
      },
    }, 500);
  }
}

export async function onRequestGet() {
  return jsonResponse({
    ok: false,
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "Use POST for SERP weakness analysis.",
    },
  }, 405, { Allow: "POST" });
}
