import {
  SAVED_KEYWORDS_CONTRACT_VERSION,
  SavedKeywordContractError,
  normalizeSavedKeywordBulkDelete,
  normalizeSavedKeywordCreate,
  normalizeSavedKeywordDelete,
  normalizeSavedKeywordListQuery,
  normalizeSavedKeywordTagUpdate,
} from "../../../../src/v2/contracts/saved-keywords.js";
import * as savedKeywordStorage from "../../../../src/v2/storage/saved-keywords.js";

const MAX_BODY_BYTES = 64 * 1024;
const ALLOW = "GET, POST, PATCH, DELETE, OPTIONS";
const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=UTF-8",
};

const STORAGE = globalThis.__SAVED_KEYWORD_STORAGE_FOR_TESTS__ ?? savedKeywordStorage;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...headers },
  });
}

function failure(code, message, status, field) {
  return json({
    ok: false,
    error: { code, message, ...(field ? { field } : {}) },
  }, status);
}

function success(data) {
  return json({
    ok: true,
    data,
    meta: {
      contract_version: SAVED_KEYWORDS_CONTRACT_VERSION,
      actual_cost_usd: 0,
      provider_requests: 0,
    },
  });
}

function accessError(request) {
  if (!request?.headers?.get("cf-access-jwt-assertion")?.trim()) {
    return failure("ACCESS_AUTHENTICATION_REQUIRED", "Cloudflare Access authentication is required.", 401);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return failure("CROSS_ORIGIN_FORBIDDEN", "Cross-origin Saved Keywords access is forbidden.", 403);
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    return failure("CROSS_ORIGIN_FORBIDDEN", "Cross-origin Saved Keywords access is forbidden.", 403);
  }
  return null;
}

function bindingError(env) {
  return env?.DB
    ? null
    : failure("BINDING_MISSING", "Preview DB binding is not configured.", 503);
}

class RequestError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.httpStatus = status;
  }
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
  if (rawLength != null && (!/^\d+$/.test(rawLength.trim()) || Number(rawLength) > MAX_BODY_BYTES)) {
    throw new RequestError(
      /^\d+$/.test(rawLength.trim()) ? "PAYLOAD_TOO_LARGE" : "INVALID_CONTENT_LENGTH",
      /^\d+$/.test(rawLength.trim()) ? 413 : 400,
      /^\d+$/.test(rawLength.trim()) ? "Request body must be 64 KB or smaller." : "Content-Length must be a non-negative integer.",
    );
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new RequestError("PAYLOAD_TOO_LARGE", 413, "Request body must be 64 KB or smaller.");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RequestError("INVALID_JSON", 400, "Request body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RequestError("INVALID_BODY", 400, "Request body must be a JSON object.");
  }
  return parsed;
}

function mappedError(error) {
  if (error instanceof SavedKeywordContractError) {
    return failure(error.code, error.message, error.httpStatus, error.field);
  }
  const status = Number(error?.httpStatus);
  const code = typeof error?.code === "string" ? error.code : "SAVED_KEYWORD_OPERATION_FAILED";
  if ([400, 404, 409, 413, 415, 503].includes(status)) {
    return failure(code, code, status);
  }
  console.error(JSON.stringify({ message: "saved keyword operation failed", code }));
  return failure("SAVED_KEYWORD_OPERATION_FAILED", "Saved Keywords could not be processed.", 500);
}

export async function onRequestGet({ request, env }) {
  const denied = accessError(request);
  if (denied) return denied;
  const missing = bindingError(env);
  if (missing) return missing;
  try {
    const query = normalizeSavedKeywordListQuery(new URL(request.url).searchParams);
    return success(await STORAGE.listSavedKeywords(env.DB, query));
  } catch (error) {
    return mappedError(error);
  }
}

export async function onRequestPost({ request, env }) {
  const denied = accessError(request);
  if (denied) return denied;
  const missing = bindingError(env);
  if (missing) return missing;
  try {
    const body = await readJsonObject(request);
    const input = normalizeSavedKeywordCreate(body);
    return success(await STORAGE.saveKeyword(env.DB, input));
  } catch (error) {
    return mappedError(error);
  }
}

export async function onRequestPatch({ request, env }) {
  const denied = accessError(request);
  if (denied) return denied;
  const missing = bindingError(env);
  if (missing) return missing;
  try {
    const body = await readJsonObject(request);
    const input = normalizeSavedKeywordTagUpdate(body);
    return success(await STORAGE.addTagsToSavedKeywords(env.DB, input));
  } catch (error) {
    return mappedError(error);
  }
}

export async function onRequestDelete({ request, env }) {
  const denied = accessError(request);
  if (denied) return denied;
  const missing = bindingError(env);
  if (missing) return missing;
  try {
    const body = await readJsonObject(request);
    if (Array.isArray(body?.ids)) {
      const input = normalizeSavedKeywordBulkDelete(body);
      return success(await STORAGE.deleteSavedKeywords(env.DB, input));
    }
    const input = normalizeSavedKeywordDelete(body);
    return success(await STORAGE.deleteSavedKeyword(env.DB, input));
  } catch (error) {
    return mappedError(error);
  }
}

export function onRequestOptions({ request } = {}) {
  const denied = accessError(request);
  if (denied) return denied;
  return new Response(null, { status: 204, headers: { Allow: ALLOW } });
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
    : failure("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
}
