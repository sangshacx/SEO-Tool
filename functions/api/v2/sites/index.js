import * as siteProfileStorage from "../../../../src/v2/storage/site-profiles.js";

const MAX_BODY_BYTES = 64 * 1024;
const ALLOW = "GET, POST, PATCH, DELETE, OPTIONS";
const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=UTF-8",
};

function accessError(request) {
  if (!request?.headers?.get("cf-access-jwt-assertion")?.trim()) {
    return failure("ACCESS_AUTHENTICATION_REQUIRED", "Cloudflare Access authentication is required.", 401);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return failure("CROSS_ORIGIN_FORBIDDEN", "Cross-origin site-profile access is forbidden.", 403);
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    return failure("CROSS_ORIGIN_FORBIDDEN", "Cross-origin site-profile access is forbidden.", 403);
  }
  return null;
}

class RequestError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.httpStatus = status;
  }
}

const STORAGE = globalThis.__SITE_PROFILE_STORAGE_FOR_TESTS__ ?? siteProfileStorage;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });
}

function failure(code, message, status, headers = {}) {
  return json({ ok: false, error: { code, message } }, status, headers);
}

function success(data) {
  return json({
    ok: true,
    data,
    meta: { actual_cost_usd: 0, provider_requests: 0 },
  });
}

function bindingError(env) {
  return env?.DB ? null : failure("BINDING_MISSING", "Preview DB binding is not configured.", 503);
}

function mappedError(error) {
  const status = Number(error?.httpStatus);
  const code = typeof error?.code === "string" ? error.code : "SITE_PROFILE_OPERATION_FAILED";
  if ([400, 404, 409, 413, 415, 503].includes(status)) {
    return failure(code, code, status);
  }
  console.error(JSON.stringify({ message: "site profile operation failed", code }));
  return failure("SITE_PROFILE_OPERATION_FAILED", "Site profiles could not be processed.", 500);
}

function assertJsonMediaType(request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new RequestError("UNSUPPORTED_MEDIA_TYPE", 415, "Content-Type must be application/json.");
  }
}

async function readJsonObject(request) {
  assertJsonMediaType(request);
  const rawLength = request.headers.get("content-length");
  if (rawLength != null) {
    if (!/^\d+$/.test(rawLength.trim())) {
      throw new RequestError("INVALID_CONTENT_LENGTH", 400, "Content-Length must be a non-negative integer.");
    }
    if (Number(rawLength) > MAX_BODY_BYTES) {
      throw new RequestError("PAYLOAD_TOO_LARGE", 413, "Request body must be 64 KB or smaller.");
    }
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
  return parsed;
}

async function bodyOrError(request) {
  try {
    return { body: await readJsonObject(request) };
  } catch (error) {
    if (error instanceof RequestError) {
      return { response: failure(error.code, error.message, error.httpStatus) };
    }
    return { response: failure("INVALID_JSON", "Request body must be valid JSON.", 400) };
  }
}

export async function onRequestGet({ request, env }) {
  const denied = accessError(request);
  if (denied) return denied;
  const missing = bindingError(env);
  if (missing) return missing;
  const format = new URL(request.url).searchParams.get("format");
  if (format != null && format !== "export") {
    return failure("INVALID_FORMAT", "format must be export when provided.", 400);
  }
  try {
    const data = format === "export"
      ? await STORAGE.exportSiteProfiles(env.DB)
      : await STORAGE.listSiteProfiles(env.DB);
    return success(data);
  } catch (error) {
    return mappedError(error);
  }
}

export async function onRequestPost({ request, env }) {
  const denied = accessError(request);
  if (denied) return denied;
  const missing = bindingError(env);
  if (missing) return missing;
  const format = new URL(request.url).searchParams.get("format");
  if (format != null && format !== "import") {
    return failure("INVALID_FORMAT", "format must be import when provided.", 400);
  }
  const parsed = await bodyOrError(request);
  if (parsed.response) return parsed.response;
  try {
    if (format === "import") {
      return success(await STORAGE.importSiteProfiles(env.DB, parsed.body));
    }
    return success(await STORAGE.upsertSiteProfile(env.DB, parsed.body));
  } catch (error) {
    return mappedError(error);
  }
}

export async function onRequestPatch({ request, env }) {
  const denied = accessError(request);
  if (denied) return denied;
  const missing = bindingError(env);
  if (missing) return missing;
  const parsed = await bodyOrError(request);
  if (parsed.response) return parsed.response;
  try {
    return success(await STORAGE.patchSiteProfile(env.DB, parsed.body));
  } catch (error) {
    return mappedError(error);
  }
}

export async function onRequestDelete({ request, env }) {
  const denied = accessError(request);
  if (denied) return denied;
  const missing = bindingError(env);
  if (missing) return missing;
  const parsed = await bodyOrError(request);
  if (parsed.response) return parsed.response;
  try {
    return success(await STORAGE.deleteSiteProfile(env.DB, parsed.body.domain));
  } catch (error) {
    return mappedError(error);
  }
}

export function onRequestOptions({ request } = {}) {
  const denied = accessError(request);
  if (denied) return denied;
  return new Response(null, {
    status: 204,
    headers: {
      Allow: ALLOW,
    },
  });
}

export async function onRequest(context) {
  const handlers = {
    GET: onRequestGet,
    POST: onRequestPost,
    PATCH: onRequestPatch,
    DELETE: onRequestDelete,
    OPTIONS: onRequestOptions,
  };
  const handler = handlers[context.request.method];
  return handler
    ? handler(context)
    : failure("METHOD_NOT_ALLOWED", "Method not allowed.", 405, { Allow: ALLOW });
}
