import { discoverGscSearchAppearances } from "../../../../src/v2/providers/google-search-console.js";
import { getGscAccessToken } from "../../../../src/v2/gsc/connection-service.js";
import {
  getGscSiteMapping,
  readGscSearchAppearanceCapabilities,
  replaceGscSearchAppearanceCapabilities,
  selectGscGenerativeAiAppearance,
} from "../../../../src/v2/storage/gsc-search-analytics.js";
import { normalizeRegistrableDomain } from "../../../../src/v2/storage/registrable-domain.js";
import { gscJson, gscMappedError, requireGscAccess } from "../../../../src/v2/gsc/http.js";

const DISCOVERY_WINDOWS = new Set([28, 90]);

function normalizeSiteDomain(value) {
  const domain = normalizeRegistrableDomain(value);
  if (!domain) {
    const error = new Error("A valid managed site domain is required.");
    error.code = "GSC_SITE_DOMAIN_REQUIRED";
    error.httpStatus = 400;
    throw error;
  }
  return domain;
}

function discoveryDates(days = 90, now = new Date()) {
  const windowDays = Number(days);
  if (!DISCOVERY_WINDOWS.has(windowDays)) {
    const error = new Error("Choose a 28 or 90 day search appearance discovery window.");
    error.code = "GSC_SEARCH_APPEARANCE_WINDOW_INVALID";
    error.httpStatus = 400;
    throw error;
  }
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 3));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - windowDays + 1);
  return {
    days: windowDays,
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
  };
}

async function readBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    const error = new Error("Content-Type must be application/json.");
    error.code = "UNSUPPORTED_MEDIA_TYPE";
    error.httpStatus = 415;
    throw error;
  }
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.code = "INVALID_JSON";
    error.httpStatus = 400;
    throw error;
  }
}

export async function onRequestGet({ request, env }) {
  const denied = requireGscAccess(request);
  if (denied) return denied;
  if (!env?.DB) return gscJson({ ok: false, error: { code: "GSC_DB_MISSING", message: "D1 binding is not configured." } }, 503);

  try {
    const domain = normalizeSiteDomain(new URL(request.url).searchParams.get("site_domain"));
    const mapping = await getGscSiteMapping(env.DB, domain);
    const capability = await readGscSearchAppearanceCapabilities(env.DB, domain);
    return gscJson({
      ok: true,
      data: {
        site_domain: domain,
        property: mapping?.property ?? null,
        mapped: Boolean(mapping),
        ...capability,
        sync_enabled: Boolean(mapping && capability.selected_appearance),
      },
      meta: { actual_cost_usd: 0, provider_requests: 0, source: "d1" },
    });
  } catch (error) {
    return gscMappedError(error, "GSC_GENERATIVE_AI_STATUS_FAILED");
  }
}

export async function onRequestPost({ request, env }) {
  const denied = requireGscAccess(request);
  if (denied) return denied;
  if (!env?.DB) return gscJson({ ok: false, error: { code: "GSC_DB_MISSING", message: "D1 binding is not configured." } }, 503);

  try {
    const body = await readBody(request);
    const domain = normalizeSiteDomain(body.site_domain);
    const action = String(body.action ?? "discover").trim().toLowerCase();

    if (action === "select" || action === "clear") {
      const selection = await selectGscGenerativeAiAppearance(env.DB, {
        siteDomain: domain,
        appearance: action === "clear" ? null : body.appearance,
      });
      const capability = await readGscSearchAppearanceCapabilities(env.DB, domain);
      return gscJson({
        ok: true,
        data: {
          site_domain: domain,
          ...capability,
          ...selection,
          sync_enabled: Boolean(capability.selected_appearance),
        },
        meta: { actual_cost_usd: 0, provider_requests: 0, source: "d1" },
      });
    }

    if (action !== "discover") {
      const error = new Error("Unsupported Generative AI capability action.");
      error.code = "GSC_GENERATIVE_AI_ACTION_INVALID";
      error.httpStatus = 400;
      throw error;
    }

    const mapping = await getGscSiteMapping(env.DB, domain);
    if (!mapping?.property) {
      const error = new Error("Map a Search Console property to this site before discovering search appearances.");
      error.code = "GSC_SITE_NOT_MAPPED";
      error.httpStatus = 409;
      throw error;
    }

    const dates = discoveryDates(body.days ?? 90);
    const token = await getGscAccessToken(env);
    const discovered = await discoverGscSearchAppearances({
      accessToken: token.accessToken,
      property: mapping.property,
      startDate: dates.start_date,
      endDate: dates.end_date,
      rowLimit: 250,
    });

    await replaceGscSearchAppearanceCapabilities(env.DB, {
      siteProfileId: mapping.site_profile_id,
      property: mapping.property,
      startDate: dates.start_date,
      endDate: dates.end_date,
      appearances: discovered.appearances,
    });
    const capability = await readGscSearchAppearanceCapabilities(env.DB, domain);

    return gscJson({
      ok: true,
      data: {
        site_domain: domain,
        property: mapping.property,
        discovery_window_days: dates.days,
        candidate_count: discovered.candidate_count,
        disclaimer: discovered.disclaimer,
        ...capability,
        sync_enabled: Boolean(capability.selected_appearance),
      },
      meta: { actual_cost_usd: 0, provider_requests: 1, source: "google_search_console" },
    });
  } catch (error) {
    return gscMappedError(error, "GSC_GENERATIVE_AI_CAPABILITY_FAILED");
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return gscJson({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or POST." } }, 405);
}

export { discoveryDates };
