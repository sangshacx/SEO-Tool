import { normalizeOrganicHistoryDomain, ORGANIC_HISTORY_MONTHS } from "../providers/dataforseo-organic-history.js";

export function buildOrganicHistoryCacheKey({
  target,
  locationCode,
  languageCode,
  months = 12,
}) {
  const domain = normalizeOrganicHistoryDomain(target);
  if (!domain) throw new TypeError("Invalid organic history target.");
  if (!ORGANIC_HISTORY_MONTHS.includes(Number(months))) throw new TypeError("Invalid organic history range.");
  return [
    "v2",
    "organic-history",
    "v1",
    encodeURIComponent(domain),
    Number(locationCode),
    String(languageCode).toLowerCase(),
    Number(months),
  ].join(":");
}

export function organicHistoryCacheCandidates(input) {
  const requested = Number(input?.months ?? 12);
  if (!ORGANIC_HISTORY_MONTHS.includes(requested)) throw new TypeError("Invalid organic history range.");
  return [...ORGANIC_HISTORY_MONTHS]
    .filter((months) => months >= requested)
    .sort((a, b) => b - a)
    .map((months) => ({
      months,
      key: buildOrganicHistoryCacheKey({ ...input, months }),
    }));
}

export function projectOrganicHistoryMonths(data, months) {
  const requested = Number(months);
  const points = Array.isArray(data?.points) ? data.points.slice(-requested) : [];
  return {
    ...data,
    months: requested,
    date_from: points[0]?.period ? points[0].period + "-01" : data?.date_from ?? null,
    returned_count: points.length,
    points,
  };
}
