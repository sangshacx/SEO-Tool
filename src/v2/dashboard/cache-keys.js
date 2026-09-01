export function buildCompetitorSnapshotCacheKey(domain, locationCode, languageCode) {
  return ["v2", "competitor-snapshot", domain, locationCode, languageCode].join(":");
}

export function buildKeywordGapCacheKey(competitorDomain, ownDomain, locationCode, languageCode) {
  return ["v2", "keyword-gap", competitorDomain, ownDomain, locationCode, languageCode].join(":");
}
