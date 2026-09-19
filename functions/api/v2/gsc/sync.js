import { queryGscSearchAnalytics } from "../../../../src/v2/providers/google-search-console.js";
import { getGscAccessToken } from "../../../../src/v2/gsc/connection-service.js";
import { GSC_DIMENSION_SETS, gscSyncDates, normalizeGscSyncRequest } from "../../../../src/v2/gsc/sync-plan.js";
import {
  completedGscSyncDates,
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

  const requestedDates = gscSyncDates(plan.target_date, plan.backfill_days);
  let completedDates;
  try {
    completedDates = await completedGscSyncDates(env.DB, {
      siteProfileId: mapping.site_profile_id,
      dates: requestedDates,
      dimensionSets: plan.dimension_sets,
      minimumRowLimit: plan.row_limit_per_set,
    });
  } catch (error) {
    return gscMappedError(error, "GSC_SYNC_HISTORY_CHECK_FAILED");
  }
  const datesToSync = requestedDates.filter((date) => !completedDates.has(date));
  const skippedDates = requestedDates.filter((date) => completedDates.has(date));

  if (!datesToSync.length) {
    const completedAt = new Date().toISOString();
    return gscJson({
      ok: true,
      data: {
        site_domain: siteDomain,
        property: mapping.property,
        target_date: plan.target_date,
        backfill_days: plan.backfill_days,
        requested_dates: requestedDates,
        synced_dates: [],
        skipped_dates: skippedDates,
        dimension_sets: plan.dimension_sets,
        row_limit_per_set: plan.row_limit_per_set,
        status: "success",
        results: [],
        errors: [],
        truncated_sets: [],
        truncated_partitions: [],
        rows_received: 0,
        rows_written: 0,
        disclaimer: "All requested dates already have successful sync runs at an equal or deeper row cap, so no Google request was made.",
      },
      meta: {
        actual_cost_usd: 0,
        provider_requests: 0,
        started_at: startedAt,
        completed_at: completedAt,
      },
    });
  }

  let token;
  try {
    token = await getGscAccessToken(env);
  } catch (error) {
    return gscMappedError(error, "GSC_SYNC_AUTH_FAILED");
  }

  const results = [];
  const errors = [];
  const truncatedSets = new Set();
  const truncatedPartitions = [];
  const syncedDates = [];
  let providerRequests = 0;
  let rowsReceived = 0;
  let rowsWritten = 0;

  for (const targetDate of datesToSync) {
    const dateStartedAt = new Date().toISOString();
    const dateResults = [];
    const dateErrors = [];
    const dateTruncatedSets = [];
    let dateProviderRequests = 0;
    let dateRowsReceived = 0;
    let dateRowsWritten = 0;

    for (const dimensionSet of plan.dimension_sets) {
      try {
        providerRequests += 1;
        dateProviderRequests += 1;
        const response = await queryGscSearchAnalytics({
          accessToken: token.accessToken,
          property: mapping.property,
          startDate: targetDate,
          endDate: targetDate,
          dimensions: GSC_DIMENSION_SETS[dimensionSet],
          rowLimit: plan.row_limit_per_set,
          startRow: 0,
          searchType: "web",
          dataState: "final",
        });

        const truncated = response.has_more === true;
        if (truncated) {
          truncatedSets.add(dimensionSet);
          dateTruncatedSets.push(dimensionSet);
          truncatedPartitions.push({ date: targetDate, dimension_set: dimensionSet });
        }
        rowsReceived += response.rows.length;
        dateRowsReceived += response.rows.length;

        const saved = await replaceGscAnalyticsPartition(env.DB, {
          siteProfileId: mapping.site_profile_id,
          property: mapping.property,
          date: targetDate,
          dimensionSet,
          rows: response.rows,
        });
        rowsWritten += saved.rows_written;
        dateRowsWritten += saved.rows_written;

        const result = {
          target_date: targetDate,
          dimension_set: dimensionSet,
          dimensions: GSC_DIMENSION_SETS[dimensionSet],
          rows_received: response.rows.length,
          rows_written: saved.rows_written,
          truncated,
        };
        dateResults.push(result);
        results.push(result);
      } catch (error) {
        const failure = {
          target_date: targetDate,
          dimension_set: dimensionSet,
          code: error?.code || "GSC_SYNC_DIMENSION_FAILED",
          message: error?.message || "Sync failed.",
        };
        dateErrors.push(failure);
        errors.push(failure);
      }
    }

    const dateCompletedAt = new Date().toISOString();
    const dateStatus = dateErrors.length
      ? dateResults.length ? "partial" : "error"
      : "success";
    if (dateResults.length) syncedDates.push(targetDate);

    try {
      await recordGscSyncRun(env.DB, {
        site_profile_id: mapping.site_profile_id,
        property: mapping.property,
        target_date: targetDate,
        dimension_sets: plan.dimension_sets,
        row_limit_per_set: plan.row_limit_per_set,
        provider_requests: dateProviderRequests,
        rows_received: dateRowsReceived,
        rows_written: dateRowsWritten,
        truncated_sets: dateTruncatedSets,
        status: dateStatus,
        error_code: dateErrors[0]?.code ?? null,
        started_at: dateStartedAt,
        completed_at: dateCompletedAt,
      });
    } catch (error) {
      console.error(JSON.stringify({
        message: "GSC sync run logging failed",
        target_date: targetDate,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  const completedAt = new Date().toISOString();
  const status = errors.length
    ? results.length ? "partial" : "error"
    : "success";

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
      backfill_days: plan.backfill_days,
      requested_dates: requestedDates,
      synced_dates: syncedDates,
      skipped_dates: skippedDates,
      dimension_sets: plan.dimension_sets,
      row_limit_per_set: plan.row_limit_per_set,
      status,
      results,
      errors,
      truncated_sets: [...truncatedSets],
      truncated_partitions: truncatedPartitions,
      rows_received: rowsReceived,
      rows_written: rowsWritten,
      disclaimer: truncatedPartitions.length
        ? "At least one date/dimension partition reached the configured row cap; stored data for that partition is intentionally partial."
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
