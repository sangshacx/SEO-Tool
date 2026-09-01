import { classifyDashboardRefresh } from "../../../../src/v2/dashboard/refresh-preview.js";
import { DASHBOARD_REFRESH_MODULES, DashboardContractError } from "../../../../src/v2/dashboard/contracts.js";

const MAX_BODY_BYTES = 64 * 1024;
const ALLOW = "POST, OPTIONS";
const HEADERS = { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" };

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
    return failure("CROSS_ORIGIN_FORBIDDEN", "Cross-origin dashboard refresh preview is forbidden.", 403);
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    return failure("CROSS_ORIGIN_FORBIDDEN", "Cross-origin dashboard refresh preview is forbidden.", 403);
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
    if (seen.has(moduleId)) throw new RequestError("DUPLICATE_MODULE", 400, "Each dashboard module may only be selected once.");
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
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new RequestError("INVALID_JSON", 400, "Request body must be valid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("INVALID_BODY", 400, "Request body must be a JSON object.");
  validateModules(body.modules);
  return body;
}

export async function onRequestPost({ request, env }) {
  const denied = accessError(request);
  if (denied) return denied;
  let body;
  try {
    body = await readJsonObject(request);
    if (!env?.DB || !env?.CACHE) return failure("BINDING_MISSING", "Preview dashboard bindings are not configured.", 503);
    const result = await classifyDashboardRefresh({ db: env.DB, cache: env.CACHE, scope: body, selectedModules: body.modules });
    return json({
      ok: true,
      data: { scope: result.scope, modules: result.modules },
      meta: { preview_only: true, actual_cost_usd: 0, total_actual_cost_usd: 0, task_count: 0 },
    });
  } catch (error) {
    if (error instanceof RequestError) return failure(error.code, error.message, error.httpStatus);
    if (error instanceof DashboardContractError) return failure(error.code, error.message, 400);
    return failure("DASHBOARD_PREVIEW_UNAVAILABLE", "Dashboard refresh state is temporarily unavailable.", 503);
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
