import { normalizeRegistrableDomain } from "../storage/registrable-domain.js";

export const CLUSTER_INTELLIGENCE_CONTRACT_VERSION = "cluster-intelligence-v0.2";
export const CLUSTER_INTELLIGENCE_MAX_KEYWORDS = 250;

export class ClusterIntelligenceContractError extends Error {
  constructor(code, field, message = code) {
    super(message);
    this.name = "ClusterIntelligenceContractError";
    this.code = code;
    this.field = field;
    this.httpStatus = 400;
  }
}

function fail(code, field, message) {
  throw new ClusterIntelligenceContractError(code, field, message);
}

function cleanDomain(value) {
  const domain = normalizeRegistrableDomain(value);
  if (!domain) fail("INVALID_SITE_DOMAIN", "site_domain", "A valid site domain is required.");
  return domain;
}

export function normalizeClusterIntelligenceQuery(searchParams) {
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit == null || rawLimit === "" ? CLUSTER_INTELLIGENCE_MAX_KEYWORDS : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > CLUSTER_INTELLIGENCE_MAX_KEYWORDS) {
    fail("INVALID_LIMIT", "limit", "limit must be an integer between 1 and 250.");
  }
  return {
    site_domain: cleanDomain(searchParams.get("site_domain")),
    limit,
  };
}
