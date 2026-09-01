import { aggregateDashboard } from "../../../../src/v2/dashboard/aggregate-dashboard.js";
import { normalizeDashboardScope } from "../../../../src/v2/dashboard/contracts.js";

const ALLOW = "GET, OPTIONS";
const HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};

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
    return failure("CROSS_ORIGIN_FORBIDDEN", "Cross-origin dashboard access is forbidden.", 403);
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    return failure("CROSS_ORIGIN_FORBIDDEN", "Cross-origin dashboard access is forbidden.", 403);
  }
  return null;
}

export async function onRequestGet({ request, env }) {
  const denied = accessError(request);
  if (denied) return denied;
  if (!env?.DB) {
    return failure("BINDING_MISSING", "Preview DB binding is not configured.", 503);
  }
  try {
    const url = new URL(request.url);
    const data = await aggregateDashboard({
      db: env.DB,
      cache: env.CACHE ?? { get: async () => null },
      scope: normalizeDashboardScope({
        domain: url.searchParams.get("site"),
        location_code: url.searchParams.get("location_code"),
        language_code: url.searchParams.get("language_code"),
      }),
    });
    return json({
      ok: true,
      data,
      meta: {
        actual_cost_usd: 0,
        task_count: 0,
        provider_requests: 0,
        updated_at: data.meta.updated_at ?? null,
      },
    });
  } catch (error) {
    const code = error?.code === "INVALID_SITE" || error?.message?.includes("Unsupported market")
      ? "VALIDATION_ERROR"
      : "DASHBOARD_UNAVAILABLE";
    const status = code === "VALIDATION_ERROR" ? 400 : 503;
    return failure(code, code === "VALIDATION_ERROR" ? "Choose a valid site and supported market." : "Dashboard data is temporarily unavailable.", status);
  }
}

export function onRequestOptions({ request } = {}) {
  const denied = accessError(request);
  if (denied) return denied;
  return new Response(null, { status: 204, headers: { Allow: ALLOW } });
}

export async function onRequest(context) {
  const handlers = { GET: onRequestGet, OPTIONS: onRequestOptions };
  const handler = handlers[context.request.method];
  return handler ? handler(context) : failure("METHOD_NOT_ALLOWED", "Method not allowed.", 405, { Allow: ALLOW });
}
