export const GSC_DIMENSION_SETS = Object.freeze({
  query: Object.freeze(["query"]),
  page: Object.freeze(["page"]),
  query_page: Object.freeze(["query", "page"]),
  country: Object.freeze(["country"]),
  device: Object.freeze(["device"]),
});
export const DEFAULT_GSC_DIMENSION_SETS = Object.freeze(["query", "page", "query_page"]);
export const GSC_SYNC_ROW_LIMITS = Object.freeze([1000, 2500, 5000]);
export const GSC_BACKFILL_DAYS = Object.freeze([1, 3, 7]);

function isoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + "T00:00:00Z"))) return null;
  return value;
}

export function defaultGscSyncDate(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 3)).toISOString().slice(0, 10);
}

export function normalizeGscSyncRequest(input = {}, now = new Date()) {
  const targetDate = isoDate(input.target_date) || defaultGscSyncDate(now);
  const today = now.toISOString().slice(0, 10);
  if (targetDate >= today) {
    const error = new TypeError("GSC sync date must be before today.");
    error.code = "GSC_INVALID_SYNC_DATE";
    throw error;
  }

  const rawSets = Array.isArray(input.dimension_sets) && input.dimension_sets.length
    ? input.dimension_sets
    : DEFAULT_GSC_DIMENSION_SETS;
  const sets = [...new Set(rawSets.map((value) => String(value).trim()).filter(Boolean))];
  if (!sets.length || sets.some((value) => !Object.hasOwn(GSC_DIMENSION_SETS, value))) {
    const error = new TypeError("Choose supported GSC dimension sets.");
    error.code = "GSC_INVALID_DIMENSION_SETS";
    throw error;
  }

  const rowLimit = Number(input.row_limit_per_set ?? 2500);
  if (!GSC_SYNC_ROW_LIMITS.includes(rowLimit)) {
    const error = new TypeError("Choose a GSC row limit of 1000, 2500, or 5000.");
    error.code = "GSC_INVALID_ROW_LIMIT";
    throw error;
  }

  const backfillDays = Number(input.backfill_days ?? 1);
  if (!GSC_BACKFILL_DAYS.includes(backfillDays)) {
    const error = new TypeError("Choose a GSC backfill window of 1, 3, or 7 days.");
    error.code = "GSC_INVALID_BACKFILL_DAYS";
    throw error;
  }
  if (backfillDays > 1 && rowLimit > 1000) {
    const error = new TypeError("Multi-day GSC backfill is capped at 1,000 rows per dimension set.");
    error.code = "GSC_BACKFILL_ROW_LIMIT";
    throw error;
  }

  return {
    target_date: targetDate,
    dimension_sets: sets,
    row_limit_per_set: rowLimit,
    backfill_days: backfillDays,
  };
}

export function gscSyncDates(targetDate, backfillDays = 1) {
  const days = Number(backfillDays);
  if (!GSC_BACKFILL_DAYS.includes(days)) throw new TypeError("Unsupported GSC backfill window.");
  const end = new Date(targetDate + "T00:00:00Z");
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - index);
    return date.toISOString().slice(0, 10);
  }).sort();
}
