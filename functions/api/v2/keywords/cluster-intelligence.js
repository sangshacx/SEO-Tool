import {
  CLUSTER_INTELLIGENCE_CONTRACT_VERSION,
  ClusterIntelligenceContractError,
  normalizeClusterIntelligenceQuery,
} from "../../../../src/v2/contracts/keyword-cluster-intelligence.js";
import { buildClusterIntelligence } from "../../../../src/v2/intelligence/keyword-cluster-intelligence.js";
import * as clusterIntelligenceStorage from "../../../../src/v2/storage/keyword-cluster-intelligence.js";

const STORAGE = globalThis.__CLUSTER_INTELLIGENCE_STORAGE_FOR_TESTS__ ?? clusterIntelligenceStorage;

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
      contract_version: CLUSTER_INTELLIGENCE_CONTRACT_VERSION,
      actual_cost_usd: 0,
      provider_requests: 0,
      rules_based: true,
    },
  });
}

function accessError(request) {
  if (!request?.headers?.get("cf-access-jwt-assertion")?.trim()) {
    return failure("ACCESS_AUTHENTICATION_REQUIRED", "Cloudflare Access authentication is required.", 401);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return failure("CROSS_ORIGIN_FORBIDDEN", "Cross-origin Cluster Intelligence access is forbidden.", 403);
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    return failure("CROSS_ORIGIN_FORBIDDEN", "Cross-origin Cluster Intelligence access is forbidden.", 403);
  }
  return null;
}

function mappedError(error) {
  if (error instanceof ClusterIntelligenceContractError) {
    return failure(error.code, error.message, error.httpStatus, error.field);
  }
  const status = Number(error?.httpStatus);
  const code = typeof error?.code === "string" ? error.code : "CLUSTER_INTELLIGENCE_FAILED";
  if ([400, 404, 409, 503].includes(status)) {
    return failure(code, code, status);
  }
  console.error(JSON.stringify({ message: "cluster intelligence failed", code }));
  return failure("CLUSTER_INTELLIGENCE_FAILED", "Cluster Intelligence could not be generated.", 500);
}

export async function onRequestGet({ request, env }) {
  const denied = accessError(request);
  if (denied) return denied;
  if (!env?.DB) return failure("BINDING_MISSING", "Preview DB binding is not configured.", 503);

  try {
    const query = normalizeClusterIntelligenceQuery(new URL(request.url).searchParams);
    const input = await STORAGE.loadClusterIntelligenceInput(env.DB, query);
    return success(buildClusterIntelligence(input));
  } catch (error) {
    return mappedError(error);
  }
}

export function onRequestOptions({ request } = {}) {
  const denied = accessError(request);
  if (denied) return denied;
  return new Response(null, { status: 204, headers: { Allow: "GET, OPTIONS" } });
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "OPTIONS") return onRequestOptions(context);
  return failure("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
}
