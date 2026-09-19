import { listGscProperties } from "../../../../src/v2/providers/google-search-console.js";
import { getGscAccessToken } from "../../../../src/v2/gsc/connection-service.js";
import { deleteGscMapping, listGscMappings, saveGscMapping } from "../../../../src/v2/storage/gsc-connections.js";
import { gscJson, gscMappedError, requireGscAccess } from "../../../../src/v2/gsc/http.js";

async function readBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    const error = new Error("Content-Type must be application/json.");
    error.code = "UNSUPPORTED_MEDIA_TYPE"; error.httpStatus = 415; throw error;
  }
  let body;
  try { body = await request.json(); }
  catch { const error = new Error("Request body must be valid JSON."); error.code = "INVALID_JSON"; error.httpStatus = 400; throw error; }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const error = new Error("Request body must be a JSON object."); error.code = "INVALID_BODY"; error.httpStatus = 400; throw error;
  }
  return body;
}

export async function onRequestGet({ request, env }) {
  const denied = requireGscAccess(request); if (denied) return denied;
  try { return gscJson({ ok: true, data: await listGscMappings(env.DB), meta: { actual_cost_usd: 0, provider_requests: 0 } }); }
  catch (error) { return gscMappedError(error, "GSC_MAPPING_LIST_FAILED"); }
}

export async function onRequestPost({ request, env }) {
  const denied = requireGscAccess(request); if (denied) return denied;
  try {
    const body = await readBody(request);
    const siteDomain = String(body.site_domain || "").trim().toLowerCase();
    const property = String(body.property || "").trim();
    if (!siteDomain || !property) { const error = new Error("site_domain and property are required."); error.code = "GSC_MAPPING_FIELDS_REQUIRED"; error.httpStatus = 400; throw error; }
    const token = await getGscAccessToken(env);
    const result = await listGscProperties({ accessToken: token.accessToken });
    const selected = result.properties.find((item) => item.property === property);
    if (!selected || selected.verified === false) { const error = new Error("Selected Search Console property is not currently accessible."); error.code = "GSC_PROPERTY_NOT_ACCESSIBLE"; error.httpStatus = 403; throw error; }
    if (selected.domain !== siteDomain) { const error = new Error("Search Console property domain does not match the managed site."); error.code = "GSC_PROPERTY_SITE_MISMATCH"; error.httpStatus = 409; throw error; }
    const mapping = await saveGscMapping(env.DB, {
      siteDomain, property: selected.property, propertyType: selected.property_type, permissionLevel: selected.permission_level,
    });
    return gscJson({ ok: true, data: mapping, meta: { actual_cost_usd: 0, provider_requests: 1 } });
  } catch (error) { return gscMappedError(error, "GSC_MAPPING_SAVE_FAILED"); }
}

export async function onRequestDelete({ request, env }) {
  const denied = requireGscAccess(request); if (denied) return denied;
  try {
    const body = await readBody(request);
    const siteDomain = String(body.site_domain || "").trim().toLowerCase();
    if (!siteDomain) { const error = new Error("site_domain is required."); error.code = "GSC_SITE_DOMAIN_REQUIRED"; error.httpStatus = 400; throw error; }
    return gscJson({ ok: true, data: await deleteGscMapping(env.DB, siteDomain), meta: { actual_cost_usd: 0, provider_requests: 0 } });
  } catch (error) { return gscMappedError(error, "GSC_MAPPING_DELETE_FAILED"); }
}
