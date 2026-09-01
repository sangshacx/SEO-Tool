import { findLanguage, findLocation } from "../markets/catalog.js";
import { normalizeMarketRequest } from "../markets/request-market.js";
import { normalizeRegistrableDomain } from "../storage/registrable-domain.js";

export const DASHBOARD_SCHEMA_VERSION = "dashboard-v1";
export const DASHBOARD_MAX_BYTES = 64 * 1024;
export const DASHBOARD_DEDUP_MS = 15 * 60 * 1000;
export const DASHBOARD_MODULE_IDS = Object.freeze([
  "organic",
  "top_keywords",
  "backlinks",
  "backlink_history",
  "competitors",
  "keyword_opportunities",
  "backlink_gap",
  "backlink_opportunities",
  "workflow",
]);
export const DASHBOARD_REFRESH_MODULES = Object.freeze([
  "organic",
  "backlinks",
  "competitors",
  "keyword_opportunities",
  "backlink_opportunities",
]);

const SOURCES = new Set(["d1", "kv_cache", "live"]);
const MODULE_SET = new Set(DASHBOARD_MODULE_IDS);

export class DashboardContractError extends Error {
  constructor(message, code = "DASHBOARD_CONTRACT_ERROR") {
    super(message);
    this.name = "DashboardContractError";
    this.code = code;
  }
}

export function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value ?? "")).byteLength;
}

export function canonicalIso(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function orderedClone(value) {
  if (Array.isArray(value)) return value.map(orderedClone);
  if (!value || typeof value !== "object") return value;
  const clone = Object.create(null);
  for (const key of Object.keys(value).sort()) clone[key] = orderedClone(value[key]);
  return clone;
}

export function stableStringify(value) {
  return JSON.stringify(orderedClone(value));
}

function ensureSize(label, value) {
  if (utf8ByteLength(value) > DASHBOARD_MAX_BYTES) {
    throw new DashboardContractError(`${label} must be 64 KiB UTF-8 or smaller.`, "PAYLOAD_TOO_LARGE");
  }
}

function unavailable(moduleId, scope = null) {
  return {
    availability: "unavailable",
    data: null,
    source: null,
    updated_at: null,
    freshness: { updated_at: null },
    scope: scope ? moduleScope(scope) : null,
    schema_version: DASHBOARD_SCHEMA_VERSION,
  };
}

function moduleScope(scope) {
  return {
    site: scope.site,
    country: scope.location_name,
    language: scope.language_name,
    location_code: scope.location_code,
    language_code: scope.language_code,
  };
}

export function normalizeDashboardScope(input = {}) {
  const domain = normalizeRegistrableDomain(input.site ?? input.domain);
  if (!domain) {
    throw new DashboardContractError("Dashboard scope requires a valid root domain.", "INVALID_SITE");
  }
  const { locationCode, languageCode } = normalizeMarketRequest(input);
  const location = findLocation(locationCode);
  const language = findLanguage(languageCode);
  return {
    domain,
    site: domain,
    location_code: location.location_code,
    location_name: location.location_name,
    country_iso_code: location.country_iso_code,
    language_code: language.language_code,
    language_name: language.language_name,
  };
}

export function normalizeDashboardModule(moduleId, data, meta = {}) {
  if (!MODULE_SET.has(moduleId)) {
    throw new DashboardContractError(`Unsupported dashboard module: ${moduleId}`, "INVALID_MODULE");
  }
  const scope = meta.scope ? normalizeDashboardScope(meta.scope) : null;
  if (data == null) return unavailable(moduleId, scope);

  if (!SOURCES.has(meta.source)) {
    throw new DashboardContractError(`Dashboard module ${moduleId} requires a supported source.`, "INVALID_SOURCE");
  }
  const freshnessValue = meta.updated_at ?? meta.cached_at ?? meta.freshness?.updated_at;
  const updatedAt = canonicalIso(freshnessValue);
  if (freshnessValue != null && !updatedAt) {
    throw new DashboardContractError(`Dashboard module ${moduleId} freshness must be canonical ISO when known.`, "INVALID_FRESHNESS");
  }

  const normalized = {
    availability: "available",
    data: orderedClone(data),
    source: meta.source,
    updated_at: updatedAt,
    freshness: {
      updated_at: updatedAt,
      provider_updated_at: canonicalIso(meta.provider_updated_at ?? meta.freshness?.provider_updated_at),
      snapshot_at: canonicalIso(meta.snapshot_at ?? meta.freshness?.snapshot_at),
      cached_at: canonicalIso(meta.cached_at ?? meta.freshness?.cached_at),
    },
    scope: scope ? moduleScope(scope) : null,
    schema_version: DASHBOARD_SCHEMA_VERSION,
  };
  ensureSize(`Dashboard module ${moduleId}`, stableStringify(normalized));
  return JSON.parse(stableStringify(normalized));
}

export function normalizeStoredModules(modules, scope) {
  const result = Object.create(null);
  for (const moduleId of DASHBOARD_MODULE_IDS) {
    if (!Object.hasOwn(modules ?? {}, moduleId)) continue;
    const value = modules[moduleId];
    result[moduleId] = value?.availability === "available" || value?.availability === "unavailable"
      ? JSON.parse(stableStringify(value))
      : normalizeDashboardModule(moduleId, value?.data ?? value, {
        source: value?.source,
        updated_at: value?.updated_at,
        cached_at: value?.cached_at,
        provider_updated_at: value?.provider_updated_at,
        snapshot_at: value?.snapshot_at,
        freshness: value?.freshness,
        scope: value?.scope ? {
          domain: value.scope.site,
          location_code: value.scope.location_code,
          language_code: value.scope.language_code,
        } : scope,
      });
  }
  return result;
}

export function fillUnavailableModules(modules, scope) {
  const result = {};
  for (const moduleId of DASHBOARD_MODULE_IDS) {
    result[moduleId] = Object.hasOwn(modules ?? {}, moduleId)
      ? JSON.parse(stableStringify(modules[moduleId]))
      : unavailable(moduleId, scope);
  }
  return result;
}

export function dashboardScopeCacheKey(scope) {
  return [scope.domain, scope.location_code, scope.language_code].join(":");
}

export function orderedRefreshModules(selectedModules = []) {
  return DASHBOARD_REFRESH_MODULES.filter((moduleId) => selectedModules.includes(moduleId));
}
