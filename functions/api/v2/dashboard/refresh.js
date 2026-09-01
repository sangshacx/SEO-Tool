import {
  DASHBOARD_REFRESH_MODULES,
  parseConfirmedLiveModules,
  refreshDashboard,
} from "../../../../src/v2/dashboard/refresh-dashboard.js";

const MAX_BODY_BYTES = 64 * 1024;
const ALLOW = "POST, OPTIONS";
const HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};
const TEST_REFRESH_DEPS = globalThis.__DASHBOARD_REFRESH_DEPS_FOR_TESTS__ ?? null;

class RequestError extends Error {
  constructor(code, httpStatus, message) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...headers } });
}

function failure(code, message, status, headers = {}) {
  return json({ ok: false, error: { code, message } }, status, headers);
}

function accessError(request) {
  if (!request?.headers?.get("cf-access-jwt-assertion")?.trim()) {
    return failure("ACCESS_AUTHENTICATION_REQUIRED", "Cloudflare Access authentication is required.", 401);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return failure("CROSS_ORIGIN_FORBIDDEN", "Cross-origin dashboard refresh is forbidden.", 403);
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    return failure("CROSS_ORIGIN_FORBIDDEN", "Cross-origin dashboard refresh is forbidden.", 403);
  }
  return null;
}

function validateModules(modules) {
  if (!Array.isArray(modules) || !modules.length) {
    throw new RequestError("INVALID_MODULES", 400, "Select at least one dashboard module.");
  }
  const seen = new Set();
  for (const moduleId of modules) {
    if (!DASHBOARD_REFRESH_MODULES.includes(moduleId)) {
      throw new RequestError("INVALID_MODULE", 400, "Select only supported dashboard refresh modules.");
    }
    if (seen.has(moduleId)) {
      throw new RequestError("DUPLICATE_MODULE", 400, "Each dashboard module may only be selected once.");
    }
    seen.add(moduleId);
  }
}

function validateLiveConfirmation(body) {
  const explicit = body.confirmed_live_modules ?? body.allow_live_modules ?? body.live_modules;
  if (explicit === undefined) return;
  if (!Array.isArray(explicit)) {
    throw new RequestError("INVALID_LIVE_CONFIRMATION", 400, "Live confirmations must be a module array.");
  }
  const seen = new Set();
  for (const moduleId of explicit) {
    if (!DASHBOARD_REFRESH_MODULES.includes(moduleId) || !body.modules.includes(moduleId) || seen.has(moduleId)) {
      throw new RequestError("INVALID_LIVE_CONFIRMATION", 400, "Confirm each selected live module exactly once.");
    }
    seen.add(moduleId);
  }
}

async function readJsonObject(request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new RequestError("UNSUPPORTED_MEDIA_TYPE", 415, "Content-Type must be application/json.");
  }
  const rawLength = request.headers.get("content-length");
  if (rawLength != null) {
    if (!/^\d+$/.test(rawLength.trim())) throw new RequestError("INVALID_CONTENT_LENGTH", 400, "Content-Length must be a non-negative integer.");
    if (Number(rawLength) > MAX_BODY_BYTES) throw new RequestError("PAYLOAD_TOO_LARGE", 413, "Request body must be 64 KB or smaller.");
  }
  if (!request.body) throw new RequestError("INVALID_JSON", 400, "Request body must be valid JSON.");

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new RequestError("PAYLOAD_TOO_LARGE", 413, "Request body must be 64 KB or smaller.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestError("INVALID_JSON", 400, "Request body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RequestError("INVALID_BODY", 400, "Request body must be a JSON object.");
  }
  validateModules(parsed.modules);
  validateLiveConfirmation(parsed);
  parseConfirmedLiveModules(parsed, parsed.modules);
  return parsed;
}

export async function onRequestPost({ request, env }) {
  const denied = accessError(request);
  if (denied) return denied;
  let body;
  try {
    body = await readJsonObject(request);
  } catch (error) {
    return error instanceof RequestError
      ? failure(error.code, error.message, error.httpStatus)
      : failure("INVALID_JSON", "Request body must be valid JSON.", 400);
  }

  try {
    const result = await refreshDashboard({ body, env, dependencies: TEST_REFRESH_DEPS ?? {} });
    return json(result.body, result.status);
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "DASHBOARD_REFRESH_FAILED";
    const status = /INVALID|VALIDATION|MARKET|SITE|MODULE/.test(code) ? 400 : 503;
    return failure(code, status === 400 ? error.message : "Dashboard refresh is temporarily unavailable.", status);
  }
}

export function onRequestOptions({ request } = {}) {
  const denied = accessError(request);
  if (denied) return denied;
  return new Response(null, { status: 204, headers: { Allow: ALLOW } });
}

export async function onRequest(context) {
  const handlers = { POST: onRequestPost, OPTIONS: onRequestOptions };
  const handler = handlers[context.request.method];
  return handler ? handler(context) : failure("METHOD_NOT_ALLOWED", "Method not allowed.", 405, { Allow: ALLOW });
}
