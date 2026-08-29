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

export function referringDomainsCacheKey({ domain, limit, offset, sort }) {
  return ["v2", "referring-domains", "v1", domain, "subdomains", "live", limit, offset, sort].join(":");
}

export function backlinkDetailsCacheKey({ domain, limit, offset, sort, status, follow }) {
  return ["v2", "backlink-details", "v1", domain, "subdomains", status, follow, limit, offset, sort].join(":");
}

export function backlinkAnchorsCacheKey({ domain, limit, offset, sort, status }) {
  return ["v2", "backlink-anchors", "v1", domain, "subdomains", status, limit, offset, sort].join(":");
}

export async function backlinkGapCacheKey({ ownDomain, competitors, limit, offset }) {
  const canonical = JSON.stringify({
    own_domain: ownDomain,
    competitor_domains: [...competitors].sort(),
    limit,
    offset,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `v2:backlink-gap:v2:${hash}`;
}
