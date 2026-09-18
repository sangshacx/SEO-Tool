import {
  SerpCompetitorsProviderError,
  fetchSerpCompetitors,
} from "../../../../src/v2/providers/dataforseo-serp-competitors.js";
import {
  persistSerpCompetitors,
  readFreshSerpCompetitors,
} from "../../../../src/v2/storage/serp-competitors.js";
import { recordApiUsage } from "../../../../src/v2/storage/keyword-overview.js";
import { normalizeMarketRequest } from "../../../../src/v2/markets/request-market.js";

const ENDPOINT_NAME = "/v3/serp/google/organic/live/advanced";
const OPERATION = "serp_competitors";
const MAX_BODY_BYTES = 64 * 1024;
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function normalizeKeyword(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

async function logUsage(env, values) {
  try {
    await recordApiUsage({
      db: env.DB,
      ...values,
      provider: "dataforseo",
      endpoint: ENDPOINT_NAME,
      operation: OPERATION,
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "SERP competitors usage logging failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

export async function onRequestPost({ request, env }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Request body must be 64 KB or smaller." } }, 413);
  }
  if (!env?.DB) {
    return json({ ok: false, error: { code: "BINDINGS_MISSING", message: "Preview D1 binding is not configured." } }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400);
  }

  const keyword = normalizeKeyword(body?.keyword);
  if (!keyword) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "keyword", message: "Keyword is required." } }, 400);
  }
  if (keyword.length > 80 || keyword.split(" ").length > 10) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "keyword", message: "Keyword must be 80 characters or fewer and no more than 10 words." } }, 400);
  }

  let locationCode;
  let languageCode;
  try {
    ({ locationCode, languageCode } = normalizeMarketRequest(body));
  } catch {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "market", message: "Select a supported country and language combination." } }, 400);
  }

  const normalizedKeyword = keyword.toLowerCase();

  try {
    const cached = await readFreshSerpCompetitors({
      db: env.DB,
      normalizedKeyword,
      languageCode,
      locationCode,
    });

    if (cached) {
      await logUsage(env, {
        requestId,
        taskCount: 0,
        resultCount: cached.items?.length ?? 0,
        actualCostUsd: 0,
        cacheHit: true,
        status: "success",
        httpStatus: 200,
        durationMs: Date.now() - startedAt,
      });
      return json({
        ok: true,
        data: cached,
        meta: {
          request_id: requestId,
          source: "d1",
          cached: true,
          actual_cost_usd: 0,
          cache_ttl_days: 7,
          duration_ms: Date.now() - startedAt,
        },
      });
    }

    if (body?.allow_live_request !== true) {
      return json({
        ok: false,
        error: {
          code: "LIVE_REQUEST_CONFIRMATION_REQUIRED",
          message: "No fresh Top 10 SERP snapshot exists. Explicitly allow one live DataForSEO request to continue.",
        },
        meta: {
          request_id: requestId,
          cached: false,
          actual_cost_usd: 0,
          cache_ttl_days: 7,
        },
      }, 409);
    }

    const provider = await fetchSerpCompetitors({
      login: env.DATAFORSEO_LOGIN,
      password: env.DATAFORSEO_PASSWORD,
      keyword,
      locationCode,
      languageCode,
    });

    await persistSerpCompetitors({
      db: env.DB,
      keyword,
      normalizedKeyword,
      languageCode,
      locationCode,
      data: provider.data,
      actualCostUsd: provider.actualCostUsd,
    });

    await logUsage(env, {
      requestId,
      taskCount: provider.taskCount,
      resultCount: provider.data.items?.length ?? 0,
      actualCostUsd: provider.actualCostUsd,
      cacheHit: false,
      status: "success",
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
    });

    return json({
      ok: true,
      data: provider.data,
      meta: {
        request_id: requestId,
        source: "dataforseo",
        cached: false,
        actual_cost_usd: provider.actualCostUsd,
        cache_ttl_days: 7,
        duration_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    const providerError = error instanceof SerpCompetitorsProviderError ? error : null;
    const httpStatus = providerError?.httpStatus ?? 500;
    const code = providerError?.code ?? (
      /no such table/i.test(String(error?.message || ""))
        ? "PREVIEW_MIGRATION_REQUIRED"
        : "SERP_COMPETITORS_UNAVAILABLE"
    );

    await logUsage(env, {
      requestId,
      taskCount: providerError?.taskCount ?? null,
      resultCount: 0,
      actualCostUsd: providerError?.actualCostUsd ?? null,
      cacheHit: false,
      status: "error",
      httpStatus,
      durationMs: Date.now() - startedAt,
    });

    return json({
      ok: false,
      error: {
        code,
        message: code === "PREVIEW_MIGRATION_REQUIRED"
          ? "Preview D1 migration is required before Top 10 SERP snapshots can be used."
          : "Top 10 SERP competitors could not be loaded.",
      },
      meta: {
        request_id: requestId,
        actual_cost_usd: providerError?.actualCostUsd ?? 0,
      },
    }, code === "PREVIEW_MIGRATION_REQUIRED" ? 503 : httpStatus);
  }
}

export function onRequestGet() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for Top 10 SERP competitors." } }, 405);
}
