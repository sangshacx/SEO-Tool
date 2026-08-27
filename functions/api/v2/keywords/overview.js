import {
  DataForSEOProviderError,
  fetchKeywordOverview,
} from "../../../../src/v2/providers/dataforseo.js";
import {
  normalizeKeywordOverview,
} from "../../../../src/v2/normalizers/keyword-overview.js";

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

export async function onRequestPost({ request, env }) {
  const startedAt = Date.now();
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
  const locationCode = body?.location_code ?? 2840;
  const languageCode = body?.language_code ?? "en";

  if (!keyword) {
    return validationError(
      "Keyword is required.",
      "keyword",
    );
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

  if (
    !Number.isInteger(locationCode) ||
    locationCode <= 0
  ) {
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

  try {
    const providerResponse = await fetchKeywordOverview({
      env,
      keyword,
      locationCode,
      languageCode,
    });

    const data = normalizeKeywordOverview(
      providerResponse.result,
    );

    return jsonResponse({
      ok: true,
      data,
      meta: {
        source: "dataforseo",
        cached: false,
        actual_cost_usd:
          providerResponse.usage.actual_cost_usd,
        task_count:
          providerResponse.usage.task_count,
        result_count:
          providerResponse.usage.result_count,
        result_found: data !== null,
        duration_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    if (error instanceof DataForSEOProviderError) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            provider_status: error.providerStatus,
          },
          meta: {
            source: "dataforseo",
            cached: false,
            duration_ms: Date.now() - startedAt,
          },
        },
        error.httpStatus,
      );
    }

    return jsonResponse(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Unable to complete keyword overview.",
        },
        meta: {
          source: "dataforseo",
          cached: false,
          duration_ms: Date.now() - startedAt,
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
    {
      Allow: "POST",
    },
  );
}
