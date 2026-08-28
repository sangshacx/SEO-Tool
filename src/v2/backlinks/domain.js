export function normalizeBacklinkDomain(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0]
    : "";
}

export function isValidBacklinkDomain(domain) {
  return domain.length <= 253
    && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain);
}

export function backlinkSnapshotCacheKey(domain) {
  return ["v2", "backlink-snapshot", "v1", domain, "subdomains", "live"].join(":");
}
