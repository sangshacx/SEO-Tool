import { findLanguage, findLocation, isSupportedMarket } from "../markets/catalog.js";
import { normalizeRegistrableDomain } from "./registrable-domain.js";

const DEFAULT_LOCATION_CODE = 2840;
const DEFAULT_LANGUAGE_CODE = "en";
const MAX_COMPETITORS = 5;
const MAX_LABEL_LENGTH = 80;
const MAX_IMPORT_PROFILES = 100;

export class SiteProfileError extends Error {
  constructor(code, httpStatus) {
    super(code);
    this.name = "SiteProfileError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function fail(code, httpStatus = 400) {
  throw new SiteProfileError(code, httpStatus);
}

function normalizeDomain(value, code = "INVALID_DOMAIN") {
  const domain = normalizeRegistrableDomain(value);
  if (!domain) fail(code);
  return domain;
}

function normalizeLabel(value, domain) {
  return String(value ?? domain).trim().slice(0, MAX_LABEL_LENGTH) || domain;
}

function normalizeIncludeSubdomains(value) {
  if (value == null) return false;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return fail("INVALID_INCLUDE_SUBDOMAINS");
}

function normalizeCompetitors(value, domain) {
  if (value == null) return [];
  if (!Array.isArray(value)) return fail("INVALID_COMPETITORS");
  if (value.length > MAX_COMPETITORS) return fail("TOO_MANY_COMPETITORS");

  const competitors = [];
  const seen = new Set();
  for (const raw of value) {
    const competitor = normalizeDomain(raw, "INVALID_COMPETITOR");
    if (competitor === domain) fail("INVALID_COMPETITOR");
    if (seen.has(competitor)) fail("DUPLICATE_COMPETITOR");
    seen.add(competitor);
    competitors.push(competitor);
  }
  if (competitors.length > MAX_COMPETITORS) fail("TOO_MANY_COMPETITORS");
  return competitors.sort();
}

function normalizedMarket(input) {
  const locationCode = Number(input?.location_code ?? DEFAULT_LOCATION_CODE);
  const languageCode = input?.language_code ?? DEFAULT_LANGUAGE_CODE;
  if (!Number.isInteger(locationCode) || !isSupportedMarket(locationCode, languageCode)) {
    return fail("UNSUPPORTED_MARKET");
  }

  const location = findLocation(locationCode);
  const language = findLanguage(languageCode);
  return {
    location_code: location.location_code,
    location_name: location.location_name,
    country_iso_code: location.country_iso_code,
    language_code: language.language_code,
    language_name: language.language_name,
  };
}

export function normalizeSiteProfile(input) {
  if (!input || typeof input !== "object") return fail("INVALID_PROFILE");
  const domain = normalizeDomain(input.domain);
  return {
    domain,
    label: normalizeLabel(input.label, domain),
    ...normalizedMarket(input),
    include_subdomains: normalizeIncludeSubdomains(input.include_subdomains),
    competitors: normalizeCompetitors(input.competitors ?? input.competitor_domains, domain),
  };
}

function rowToProfile(row) {
  let competitors = [];
  try {
    const parsed = JSON.parse(row.competitors_json);
    competitors = Array.isArray(parsed) ? parsed.filter((domain) => typeof domain === "string") : [];
  } catch {
    competitors = [];
  }
  return {
    domain: row.domain,
    label: row.label,
    location_code: row.location_code,
    location_name: row.location_name,
    country_iso_code: row.country_iso_code,
    language_code: row.language_code,
    language_name: row.language_name,
    include_subdomains: Number(row.include_subdomains) === 1,
    competitors,
  };
}

function upsertStatement(db, normalized) {
  return db.prepare(`
    INSERT INTO site_profiles (${PROFILE_COLUMNS})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET
      label = excluded.label,
      location_code = excluded.location_code,
      location_name = excluded.location_name,
      country_iso_code = excluded.country_iso_code,
      language_code = excluded.language_code,
      language_name = excluded.language_name,
      include_subdomains = excluded.include_subdomains,
      competitors_json = excluded.competitors_json,
      updated_at = CURRENT_TIMESTAMP
    RETURNING ${PROFILE_COLUMNS}
  `).bind(
    normalized.domain,
    normalized.label,
    normalized.location_code,
    normalized.location_name,
    normalized.country_iso_code,
    normalized.language_code,
    normalized.language_name,
    normalized.include_subdomains ? 1 : 0,
    JSON.stringify(normalized.competitors),
  );
}

const PROFILE_COLUMNS = `
  domain,
  label,
  location_code,
  location_name,
  country_iso_code,
  language_code,
  language_name,
  include_subdomains,
  competitors_json
`;

export async function listSiteProfiles(db) {
  const result = await db.prepare(`SELECT ${PROFILE_COLUMNS} FROM site_profiles ORDER BY domain ASC`).bind().all();
  return (result.results ?? []).map(rowToProfile);
}

export async function upsertSiteProfile(db, profile) {
  const normalized = normalizeSiteProfile(profile);
  const row = await upsertStatement(db, normalized).first();

  if (!row) throw new Error("Unable to persist site profile.");
  return rowToProfile(row);
}

export async function patchSiteProfile(db, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("INVALID_PROFILE");
  const domain = normalizeDomain(input.domain);
  const assignments = [];
  const values = [];
  const add = (column, value) => { assignments.push(`${column} = ?`); values.push(value); };

  if (Object.hasOwn(input, "label")) add("label", normalizeLabel(input.label, domain));
  if (Object.hasOwn(input, "include_subdomains")) add("include_subdomains", normalizeIncludeSubdomains(input.include_subdomains) ? 1 : 0);
  const hasCompetitors = Object.hasOwn(input, "competitors");
  const hasLegacyCompetitors = Object.hasOwn(input, "competitor_domains");
  if (hasCompetitors || hasLegacyCompetitors) {
    add("competitors_json", JSON.stringify(normalizeCompetitors(hasCompetitors ? input.competitors : input.competitor_domains, domain)));
  }

  const hasLocation = Object.hasOwn(input, "location_code");
  const hasLanguage = Object.hasOwn(input, "language_code");
  if (hasLocation !== hasLanguage) fail("INCOMPLETE_MARKET");
  if (hasLocation) {
    const market = normalizedMarket(input);
    add("location_code", market.location_code);
    add("location_name", market.location_name);
    add("country_iso_code", market.country_iso_code);
    add("language_code", market.language_code);
    add("language_name", market.language_name);
  }
  if (!assignments.length) fail("EMPTY_PATCH");
  assignments.push("updated_at = CURRENT_TIMESTAMP");
  const row = await db.prepare(`
    UPDATE site_profiles
    SET ${assignments.join(", ")}
    WHERE domain = ?
    RETURNING ${PROFILE_COLUMNS}
  `).bind(...values, domain).first();
  if (!row) fail("PROFILE_NOT_FOUND", 404);
  return rowToProfile(row);
}

export async function importSiteProfiles(db, envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) fail("INVALID_IMPORT_SHAPE");
  const envelopeKeys = Object.keys(envelope).sort();
  if (envelopeKeys.length !== 2 || envelopeKeys[0] !== "profiles" || envelopeKeys[1] !== "version") fail("INVALID_IMPORT_SHAPE");
  if (envelope.version !== 1) fail("UNSUPPORTED_IMPORT_VERSION");
  if (!Array.isArray(envelope.profiles)) fail("INVALID_IMPORT_SHAPE");
  if (envelope.profiles.length > MAX_IMPORT_PROFILES) fail("TOO_MANY_PROFILES");

  const normalized = envelope.profiles.map(normalizeSiteProfile);
  const seen = new Set();
  for (const profile of normalized) {
    if (seen.has(profile.domain)) fail("DUPLICATE_PROFILE");
    seen.add(profile.domain);
  }
  if (normalized.length) {
    const results = await db.batch(normalized.map((profile) => upsertStatement(db, profile)));
    if (!Array.isArray(results) || results.length !== normalized.length || results.some((result) => result?.success === false)) {
      throw new Error("Unable to import site profiles atomically.");
    }
  }
  return exportSiteProfiles(db);
}

export async function deleteSiteProfile(db, domain) {
  const normalizedDomain = normalizeDomain(domain);
  const [result, stateResult] = await db.batch([
    db.prepare(`
      DELETE FROM site_profiles
      WHERE domain = ?
        AND (SELECT COUNT(*) FROM site_profiles) > 1
    `).bind(normalizedDomain),
    db.prepare(`
      SELECT
        COUNT(*) AS count,
        EXISTS(SELECT 1 FROM site_profiles WHERE domain = ?) AS profile_exists
      FROM site_profiles
    `).bind(normalizedDomain),
  ]);
  if (Number(result?.meta?.changes) > 0) return { domain: normalizedDomain };

  const state = stateResult?.results?.[0] ?? null;
  if (!Number(state?.profile_exists)) fail("PROFILE_NOT_FOUND", 404);
  if (Number(state.count) <= 1) fail("LAST_PROFILE", 409);
  fail("PROFILE_NOT_FOUND", 404);
}

export async function exportSiteProfiles(db) {
  return {
    version: 1,
    profiles: await listSiteProfiles(db),
  };
}
