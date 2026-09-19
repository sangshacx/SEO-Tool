import { normalizeOrganicCompetitorDomain } from "../providers/dataforseo-organic-competitors.js";

export function buildOrganicCompetitorsCacheKey({
  target,
  locationCode,
  languageCode,
}) {
  const domain = normalizeOrganicCompetitorDomain(target);
  if (!domain) throw new TypeError("Invalid organic competitors target.");
  return [
    "v2",
    "organic-competitors",
    "v1",
    encodeURIComponent(domain),
    Number(locationCode),
    String(languageCode).toLowerCase(),
    "max20",
    "exclude-top",
    "100",
  ].join(":");
}
