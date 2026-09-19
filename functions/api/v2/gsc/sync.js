import { queryGscSearchAnalytics } from "../../../../src/v2/providers/google-search-console.js";
import { getGscAccessToken } from "../../../../src/v2/gsc/connection-service.js";
import { GSC_DIMENSION_SETS, normalizeGscSyncRequest } from "../../../../src/v2/gsc/sync-plan.js";
import {
  getGscSiteMapping,
  latestGscSyncRun,
  recordGscSyncRun,
  replaceGscAnalyticsPartition,
} from "../../../../src/v2/storage/gsc-search-analytics.js";
import { normalizeRegistrableDomain } from "../../../../src/v2/storage/registrable-domain.js";
import { gscJson, gscMappedError, requireGscAccess } from "../../../../src/v2/gsc/http.js";

async function readBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    const error = new Error("Content-Type must be application/json.");
    error.code = "UNSUPPORTED_MEDIA_TYPE";
    error.httpStatus = 415;
    throw error;
  }
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.code = "INVALID_JSON";
    error.httpStatus = 400;
    throw error;
  }
}

function normalizeSiteDomain(value) {
  const domain = normalizeRegistrableDomain(value);
  if (!domain) {
    const error = new Error("A valid managed site domain is required.");
    error.code = "GSC_SITE_DOMAIN_REQUIRED";
    error.httpStatus = 400;
    throw error;
  }
  return domain;
}

export async function onRequestGet({ request, env }) {
  const denied = requireGscAccess(request);
  if (denied) return denied;
  if (!env?.DB) return gscJson({ ok: false, error: { code: "GSC_DB_MISSING", message: "D1 binding is not configured." } }, 503);
  try {
    const domain = normalizeSiteDomain(new URL(request.url).searchParams.get("site_domain"));
    const latest = await latestGscSyncRun(env.DB, domain);
    return gscJson({
      ok: true,
      data: { site_domain: domain, latest_sync: latest ?? null },
      meta: { actual_cost_usd: 0, provider_requests: 0 },
    });
  } catch (error) {
    return gscMappedError(error, "GSC_SYNC_STATUS_FAILED");
  }
}

export async function onRequestPost({ request, env }) {
  const denied = requireGscAccess(request);
  if (denied) return denied;
  if (!env?.DB) return gscJson({ ok: false, error: { code: "GSC_DB_MISSING", message: "D1 binding is not configured." } }, 503);

  const startedAt = new Date().toISOString();
  let body;
  let siteDomain;
  let plan;
  let mapping;

  try {
    body = await readBody(request);
    siteDomain = normalizeSiteDomain(body.site_domain);
    plan = normalizeGscSyncRequest(body);
    mapping = await getGscSiteMapping(env.DB, siteDomain);
    if (!mapping) {
      const error = new Error("Map a Search Console property to this site before syncing.");
      error.code = "GSC_SITE_NOT_MAPPED";
      error.httpStatus = 409;
      throw error;
    }
  } catch (error) {
    return gscMappedError(error, "GSC_SYNC_VALIDATION_FAILED");
  }

  let token;
  try {
    token = await getGscAccessToken(env);
  } catch (error) {
    return gscMappedError(error, "GSC_SYNC_AUTH_FAILED");
  }

  const results = [];
  const errors = [];
  const truncatedSets = [];
  let providerRequests = 0;
  let rowsReceived = 0;
  let rowsWritten = 0;

  for (const dimensionSet of plan.dimension_sets) {
    try {
      providerRequests += 1;
      const response = await queryGscSearchAnalytics({
        accessToken: token.accessToken,
        property: mapping.property,
        startDate: plan.target_date,
        endDate: plan.target_date,
        dimensions: GSC_DIMENSION_SETS[dimensionSet],
        rowLimit: plan.row_limit_per_set,
        startRow: 0,
        searchType: "web",
        dataState: "final",
      });

      const truncated = response.has_more === true;
      if (truncated) truncatedSets.push(dimensionSet);
      rowsReceived += response.rows.length;

      const saved = await replaceGscAnalyticsPartition(env.DB, {
        siteProfileId: mapping.site_profile_id,
        property: mapping.property,
        date: plan.target_date,
        dimensionSet,
        rows: response.rows,
      });
      rowsWritten += saved.rows_written;

      results.push({
        dimension_set: dimensionSet,
        dimensions: GSC_DIMENSION_SETS[dimensionSet],
        rows_received: response.rows.length,
        rows_written: saved.rows_written,
        truncated,
      });
    } catch (error) {
      errors.push({
        dimension_set: dimensionSet,
        code: error?.code || "GSC_SYNC_DIMENSION_FAILED",
        message: error?.message || "Sync failed.",
      });
    }
  }

  const completedAt = new Date().toISOString();
  const status = errors.length
    ? results.length ? "partial" : "error"
    : "success";
  const firstError = errors[0]?.code ?? null;

  try {
    await recordGscSyncRun(env.DB, {
      site_profile_id: mapping.site_profile_id,
      property: mapping.property,
      target_date: plan.target_date,
      dimension_sets: plan.dimension_sets,
      row_limit_per_set: plan.row_limit_per_set,
      provider_requests: providerRequests,
      rows_received: rowsReceived,
      rows_written: rowsWritten,
      truncated_sets: truncatedSets,
      status,
      error_code: firstError,
      started_at: startedAt,
      completed_at: completedAt,
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "GSC sync run logging failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  if (!results.length && errors.length) {
    const error = new Error(errors[0].message);
    error.code = errors[0].code;
    error.httpStatus = 502;
    return gscMappedError(error, "GSC_SYNC_FAILED");
  }

  return gscJson({
    ok: true,
    data: {
      site_domain: siteDomain,
      property: mapping.property,
      target_date: plan.target_date,
      dimension_sets: plan.dimension_sets,
      row_limit_per_set: plan.row_limit_per_set,
      status,
      results,
      errors,
      truncated_sets: truncatedSets,
      rows_received: rowsReceived,
      rows_written: rowsWritten,
      disclaimer: truncatedSets.length
        ? "At least one dimension set reached the configured row cap; stored data for that set is intentionally partial."
        : "Search Console may still omit some query/page rows because the Search Analytics API exposes top rows under internal limits.",
    },
    meta: {
      actual_cost_usd: 0,
      provider_requests: providerRequests,
      started_at: startedAt,
      completed_at: completedAt,
    },
  });
}
