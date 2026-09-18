import {
  KEYWORD_CLUSTER_CONTRACT_VERSION,
  KeywordClusterContractError,
  normalizeKeywordClusterAssignments,
  normalizeKeywordClusterCreate,
  normalizeKeywordClusterListQuery,
} from "../../../../src/v2/contracts/keyword-clusters.js";
import * as keywordClusterStorage from "../../../../src/v2/storage/keyword-clusters.js";

const MAX_BODY_BYTES = 64 * 1024;
const ALLOW = "GET, POST, PATCH, OPTIONS";
const STORAGE = globalThis.__KEYWORD_CLUSTER_STORAGE_FOR_TESTS__ ?? keywordClusterStorage;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function failure(code, message, status, field) {
  return json({ ok: false, error: { code, message, ...(field ? { field } : {}) } }, status);
}

function success(data) {
  return json({
    ok: true,
    data,
    meta: {
      contract_version: KEYWORD_CLUSTER_CONTRACT_VERSION,
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
    return failure("CROSS_ORIGIN_FORBIDDEN", "Cross-origin Topic Cluster access is forbidden.", 403);
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    return failure("CROSS_ORIGIN_FORBIDDEN", "Cross-origin Topic Cluster access is forbidden.", 403);
  }
  return null;
}

function bindingError(env) {
  return env?.DB ? null : failure("BINDING_MISSING", "Preview DB binding is not configured.", 503);
}

class RequestError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.httpStatus = status;
  }
}

async function readJsonObject(request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new RequestError("UNSUPPORTED_MEDIA_TYPE", 415, "Content-Type must be application/json.");
  }
  const rawLength = request.headers.get("content-length");
  if (rawLength != null && (!/^\d+$/.test(rawLength.trim()) || Number(rawLength) > MAX_BODY_BYTES)) {
    throw new RequestError(
      /^\d+$/.test(rawLength.trim()) ? "PAYLOAD_TOO_LARGE" : "INVALID_CONTENT_LENGTH",
      /^\d+$/.test(rawLength.trim()) ? 413 : 400,
      /^\d+$/.test(rawLength.trim()) ? "Request body must be 64 KB or smaller." : "Content-Length must be a non-negative integer.",
    );
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new RequestError("PAYLOAD_TOO_LARGE", 413, "Request body must be 64 KB or smaller.");
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new RequestError("INVALID_BODY", 400, "Request body must be a JSON object.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError("INVALID_JSON", 400, "Request body must be valid JSON.");
  }
}

function mappedError(error) {
  if (error instanceof KeywordClusterContractError) {
    return failure(error.code, error.message, error.httpStatus, error.field);
  }
  if (error instanceof RequestError) {
    return failure(error.code, error.message, error.httpStatus);
  }
  const status = Number(error?.httpStatus);
  const code = typeof error?.code === "string" ? error.code : "KEYWORD_CLUSTER_OPERATION_FAILED";
  if ([400, 404, 409, 413, 415, 503].includes(status)) {
    return failure(code, code, status);
  }
  console.error(JSON.stringify({ message: "keyword cluster operation failed", code }));
  return failure("KEYWORD_CLUSTER_OPERATION_FAILED", "Topic Cluster operation failed.", 500);
}

export async function onRequestGet({ request, env }) {
  const denied = accessError(request);
  if (denied) return denied;
  const missing = bindingError(env);
  if (missing) return missing;
  try {
    const input = normalizeKeywordClusterListQuery(new URL(request.url).searchParams);
    return success(await STORAGE.listKeywordClusters(env.DB, input));
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
    const input = normalizeKeywordClusterCreate(await readJsonObject(request));
    return success(await STORAGE.createKeywordCluster(env.DB, input));
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
    const input = normalizeKeywordClusterAssignments(await readJsonObject(request));
    return success(await STORAGE.assignKeywordClusterMembers(env.DB, input));
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
    OPTIONS: onRequestOptions,
  };
  const handler = handlers[context.request.method];
  return handler ? handler(context) : failure("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
}
