import { normalizeRegistrableDomain } from "../storage/registrable-domain.js";

export const KEYWORD_CLUSTER_CONTRACT_VERSION = "keyword-clusters-v0.1";
export const KEYWORD_CLUSTER_SOURCES = Object.freeze(["manual", "rules", "serp_overlap"]);
export const KEYWORD_CLUSTER_ROLES = Object.freeze(["primary", "supporting"]);

const SOURCE_SET = new Set(KEYWORD_CLUSTER_SOURCES);
const ROLE_SET = new Set(KEYWORD_CLUSTER_ROLES);

export class KeywordClusterContractError extends Error {
  constructor(code, field, message = code) {
    super(message);
    this.name = "KeywordClusterContractError";
    this.code = code;
    this.field = field;
    this.httpStatus = 400;
  }
}

function fail(code, field, message) {
  throw new KeywordClusterContractError(code, field, message);
}

function cleanDomain(value) {
  const domain = normalizeRegistrableDomain(value);
  if (!domain) fail("INVALID_SITE_DOMAIN", "site_domain", "A valid site domain is required.");
  return domain;
}

function cleanName(value) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 80) {
    fail("INVALID_CLUSTER_NAME", "name", "Cluster name must be 1-80 characters.");
  }
  return name;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    fail("INVALID_ID", field, field + " must be a positive integer.");
  }
  return number;
}

export function normalizeKeywordClusterListQuery(searchParams) {
  return {
    site_domain: cleanDomain(searchParams.get("site_domain")),
  };
}

export function normalizeKeywordClusterCreate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("INVALID_BODY", "body", "Request body must be a JSON object.");
  }
  const name = cleanName(input.name);
  const source = input.source == null ? "manual" : String(input.source).trim();
  if (!SOURCE_SET.has(source)) {
    fail("INVALID_SOURCE", "source", "Unsupported cluster source.");
  }
  return {
    site_domain: cleanDomain(input.site_domain),
    name,
    normalized_name: name.toLowerCase(),
    source,
  };
}

export function normalizeKeywordClusterAssignments(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("INVALID_BODY", "body", "Request body must be a JSON object.");
  }
  if (!Array.isArray(input.assignments) || !input.assignments.length) {
    fail("INVALID_ASSIGNMENTS", "assignments", "At least one keyword assignment is required.");
  }
  if (input.assignments.length > 100) {
    fail("TOO_MANY_ASSIGNMENTS", "assignments", "No more than 100 keywords may be assigned at once.");
  }

  const cluster_id = positiveInteger(input.cluster_id, "cluster_id");
  const assignments = [];
  const byKeyword = new Map();
  let primaryCount = 0;

  for (const raw of input.assignments) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      fail("INVALID_ASSIGNMENT", "assignments", "Each assignment must be an object.");
    }
    const saved_keyword_id = positiveInteger(raw.saved_keyword_id, "saved_keyword_id");
    const role = String(raw.role || "").trim().toLowerCase();
    if (!ROLE_SET.has(role)) {
      fail("INVALID_ROLE", "role", "Role must be primary or supporting.");
    }
    const existing = byKeyword.get(saved_keyword_id);
    if (existing && existing !== role) {
      fail("CONFLICTING_ASSIGNMENT", "assignments", "A saved keyword cannot have multiple roles in one request.");
    }
    if (existing) continue;
    byKeyword.set(saved_keyword_id, role);
    if (role === "primary") primaryCount += 1;
    assignments.push({ saved_keyword_id, role });
  }

  if (primaryCount > 1) {
    fail("MULTIPLE_PRIMARY_KEYWORDS", "assignments", "A cluster may contain at most one primary keyword.");
  }

  return {
    site_domain: cleanDomain(input.site_domain),
    cluster_id,
    assignments,
  };
}
