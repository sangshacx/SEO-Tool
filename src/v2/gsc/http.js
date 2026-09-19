import { AccessRequestError, assertCloudflareAccess } from "../security/access-request.js";
import { GoogleOauthError } from "../providers/google-oauth.js";
import { GscProviderError } from "../providers/google-search-console.js";

export const GSC_JSON_HEADERS = { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" };

export function gscJson(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...GSC_JSON_HEADERS, ...headers } });
}

export function requireGscAccess(request, options) {
  try { assertCloudflareAccess(request, options); return null; }
  catch (error) {
    if (error instanceof AccessRequestError) return gscJson({ ok: false, error: { code: error.code, message: error.message } }, error.httpStatus);
    throw error;
  }
}

export function gscMappedError(error, fallbackCode = "GSC_OPERATION_FAILED") {
  const status = Number(error?.httpStatus);
  const code = typeof error?.code === "string" ? error.code : fallbackCode;
  if (error instanceof GoogleOauthError || error instanceof GscProviderError || [400,401,403,404,409,429,503].includes(status)) {
    return gscJson({ ok: false, error: { code, message: error?.message || code } }, status || 502);
  }
  console.error(JSON.stringify({ message: "GSC operation failed", code, error: error instanceof Error ? error.message : String(error) }));
  return gscJson({ ok: false, error: { code: fallbackCode, message: "Google Search Console operation failed." } }, 500);
}
