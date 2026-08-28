import {
  DataForSEOProviderError,
  fetchKeywordOverview,
} from "../../../../src/v2/providers/dataforseo.js";
import {
  normalizeKeywordOverview,
} from "../../../../src/v2/normalizers/keyword-overview.js";
import {
  KEYWORD_POTENTIAL_SCORE_VERSION,
  scoreKeywordPotential,
} from "../../../../src/v2/scoring/keyword-potential.js";
import {
  buildKeywordOverviewCacheKey,
  persistKeywordOverview,
  readKeywordOverviewCache,
  recordApiUsage,
  writeKeywordOverviewCache,
} from "../../../../src/v2/storage/keyword-overview.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
  });
}

function validationError(message, field) {
  return jsonResponse(
    {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message,
        field,
      },
    },
    400,
  );
}

function normalizeKeyword(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ")
    : "";
}

function ensureKeywordPotential(data) {
  if (!data) {
    return data;
  }

  const existingScore = data.intelligence?.keyword_potential;

  if (existingScore?.version === KEYWORD_POTENTIAL_SCORE_VERSION) {
    return data;
  }

  return {
    ...data,
    intelligence: {
      ...(data.intelligence ?? {}),
      keyword_potential: scoreKeywordPotential(data),
    },
  };
}

async function safelyRecordUsage(options) {
  try {
    await recordApiUsage(options);
  } catch {
    // Usage logging must never expose infrastructure details to API clients.
  }
}

export async function onRequestPost({ request, env }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  let body;

  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "INVALID_JSON",
          message: "Request body must be valid JSON.",
        },
      },
      400,
    );
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
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "INFRASTRUCTURE_NOT_CONFIGURED",
          message: "Keyword storage is not configured.",
        },
      },
      503,
    );
  }

  const cacheKey = buildKeywordOverviewCacheKey({
    keyword,
    languageCode,
    locationCode,
  });

  try {
    const cachedEntry = await readKeywordOverviewCache(env.CACHE, cacheKey);

    if (cachedEntry && Object.hasOwn(cachedEntry, "data")) {
      const cachedData = ensureKeywordPotential(cachedEntry.data);

      if (cachedData !== cachedEntry.data) {
        await writeKeywordOverviewCache(env.CACHE, cacheKey, cachedData);
      }

      const durationMs = Date.now() - startedAt;

      await recordApiUsage({
        db: env.DB,
        requestId,
        taskCount: 0,
        resultCount: cachedData ? 1 : 0,
        actualCostUsd: 0,
        cacheHit: true,
        status: "success",
        httpStatus: 200,
        durationMs,
      });

      return jsonResponse({
        ok: true,
        data: cachedData,
        meta: {
          request_id: requestId,
          source: "dataforseo",
          cached: true,
          actual_cost_usd: 0,
          task_count: 0,
          result_count: cachedData ? 1 : 0,
          result_found: cachedData !== null,
          duration_ms: Date.now() - startedAt,
        },
      });
    }

    const providerResponse = await fetchKeywordOverview({
      env,
      keyword,
      locationCode,
      languageCode,
    });
    const data = normalizeKeywordOverview(providerResponse.result);

    await persistKeywordOverview({
      db: env.DB,
      keyword,
      normalizedKeyword,
      languageCode,
      locationCode,
      data,
      actualCostUsd: providerResponse.usage.actual_cost_usd,
    });

    await writeKeywordOverviewCache(env.CACHE, cacheKey, data);

    const durationMs = Date.now() - startedAt;

    await recordApiUsage({
      db: env.DB,
      requestId,
      taskCount: providerResponse.usage.task_count,
      resultCount: providerResponse.usage.result_count,
      actualCostUsd: providerResponse.usage.actual_cost_usd,
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
        actual_cost_usd: providerResponse.usage.actual_cost_usd,
        task_count: providerResponse.usage.task_count,
        result_count: providerResponse.usage.result_count,
        result_found: data !== null,
        duration_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    if (error instanceof DataForSEOProviderError) {
      const durationMs = Date.now() - startedAt;

      await safelyRecordUsage({
        db: env.DB,
        requestId,
        status: "provider_error",
        httpStatus: error.httpStatus,
        durationMs,
      });

      return jsonResponse(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            provider_status: error.providerStatus,
          },
          meta: {
            request_id: requestId,
            source: "dataforseo",
            cached: false,
            actual_cost_usd: 0,
            duration_ms: durationMs,
          },
        },
        error.httpStatus,
      );
    }

    const durationMs = Date.now() - startedAt;

    await safelyRecordUsage({
      db: env.DB,
      requestId,
      status: "infrastructure_error",
      httpStatus: 500,
      durationMs,
    });

    return jsonResponse(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Unable to complete keyword overview.",
        },
        meta: {
          request_id: requestId,
          source: "dataforseo",
          cached: false,
          actual_cost_usd: 0,
          duration_ms: durationMs,
        },
      },
      500,
    );
  }
}

export async function onRequestGet() {
  return jsonResponse(
    {
      ok: false,
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Use POST for keyword overview requests.",
      },
    },
    405,
    { Allow: "POST" },
  );
}
