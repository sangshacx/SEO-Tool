import { normalizeRelevantPagesDomain } from "../../../../src/v2/providers/dataforseo-relevant-pages.js";
import {
  listSeoActionWorkflow,
  upsertSeoActionWorkflow,
} from "../../../../src/v2/storage/seo-action-workflow.js";

const ALLOW = "GET, POST, OPTIONS";
const MAX_BODY_BYTES = 32 * 1024;
const HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=UTF-8",
};

const ACTIONS = new Set(["reclaim", "recover", "ctr_opportunity", "optimize", "scale", "protect", "monitor"]);
const STATUSES = new Set(["new", "in_progress", "done", "snoozed"]);

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...headers } });
}

function denied(request) {
  if (!request?.headers?.get("cf-access-jwt-assertion")?.trim()) {
    return json({ ok: false, error: { code: "ACCESS_AUTHENTICATION_REQUIRED", message: "Cloudflare Access authentication is required." } }, 401);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ ok: false, error: { code: "CROSS_ORIGIN_FORBIDDEN", message: "Cross-origin workflow access is forbidden." } }, 403);
  }
  return null;
}

function validPageForDomain(pageUrl, domain) {
  try {
    const url = new URL(pageUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^www\\./, "");
    const target = String(domain).toLowerCase().replace(/^www\\./, "");
    if (!(host === target || host.endsWith("." + target))) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function readBody(request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    const error = new Error("Content-Type must be application/json.");
    error.code = "UNSUPPORTED_MEDIA_TYPE";
    error.httpStatus = 415;
    throw error;
  }
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > MAX_BODY_BYTES) {
    const error = new Error("Request body must be 32 KB or smaller.");
    error.code = "PAYLOAD_TOO_LARGE";
    error.httpStatus = 413;
    throw error;
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    const error = new Error("Request body must be 32 KB or smaller.");
    error.code = "PAYLOAD_TOO_LARGE";
    error.httpStatus = 413;
    throw error;
  }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch {
    const error = new Error("Request body must be valid JSON.");
    error.code = "INVALID_JSON";
    error.httpStatus = 400;
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const error = new Error("Request body must be a JSON object.");
    error.code = "INVALID_BODY";
    error.httpStatus = 400;
    throw error;
  }
  return parsed;
}

function normalizeInput(body) {
  const siteDomain = normalizeRelevantPagesDomain(body.site_domain ?? body.domain);
  if (!siteDomain) {
    const error = new Error("Enter a valid saved site domain.");
    error.code = "VALIDATION_ERROR";
    error.field = "site_domain";
    error.httpStatus = 400;
    throw error;
  }
  const pageUrl = validPageForDomain(String(body.page_url ?? body.page ?? ""), siteDomain);
  if (!pageUrl) {
    const error = new Error("Page URL must belong to the selected site.");
    error.code = "VALIDATION_ERROR";
    error.field = "page_url";
    error.httpStatus = 400;
    throw error;
  }
  const actionCode = String(body.action_code ?? body.action ?? "").trim();
  if (!ACTIONS.has(actionCode)) {
    const error = new Error("Unsupported SEO action code.");
    error.code = "VALIDATION_ERROR";
    error.field = "action_code";
    error.httpStatus = 400;
    throw error;
  }
  const status = String(body.status ?? "").trim();
  if (!STATUSES.has(status)) {
    const error = new Error("Status must be new, in_progress, done, or snoozed.");
    error.code = "VALIDATION_ERROR";
    error.field = "status";
    error.httpStatus = 400;
    throw error;
  }
  const query = String(body.query ?? "").trim();
  if (query.length > 500) {
    const error = new Error("Query must be 500 characters or fewer.");
    error.code = "VALIDATION_ERROR";
    error.field = "query";
    error.httpStatus = 400;
    throw error;
  }
  const note = String(body.note ?? "").trim();
  if (note.length > 2000) {
    const error = new Error("Note must be 2,000 characters or fewer.");
    error.code = "VALIDATION_ERROR";
    error.field = "note";
    error.httpStatus = 400;
    throw error;
  }

  let snoozeUntil = null;
  if (status === "snoozed") {
    const parsed = new Date(body.snooze_until ?? "");
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      const error = new Error("Snoozed actions need a future snooze_until timestamp.");
      error.code = "VALIDATION_ERROR";
      error.field = "snooze_until";
      error.httpStatus = 400;
      throw error;
    }
    if (parsed.getTime() > Date.now() + 366 * 86400000) {
      const error = new Error("Snooze cannot exceed 366 days.");
      error.code = "VALIDATION_ERROR";
      error.field = "snooze_until";
      error.httpStatus = 400;
      throw error;
    }
    snoozeUntil = parsed.toISOString();
  }

  const priorityScore = body.priority_score == null || body.priority_score === ""
    ? null
    : Number(body.priority_score);
  if (priorityScore !== null && (!Number.isFinite(priorityScore) || priorityScore < 0 || priorityScore > 100)) {
    const error = new Error("Priority score must be between 0 and 100.");
    error.code = "VALIDATION_ERROR";
    error.field = "priority_score";
    error.httpStatus = 400;
    throw error;
  }

  return {
    site_domain: siteDomain,
    page_url: pageUrl,
    action_code: actionCode,
    query,
    status,
    note,
    snooze_until: snoozeUntil,
    priority_score: priorityScore,
  };
}

function mappedError(error) {
  const status = Number(error?.httpStatus);
  const code = typeof error?.code === "string" ? error.code : "SEO_ACTION_WORKFLOW_FAILED";
  if ([400, 404, 413, 415].includes(status)) {
    return json({ ok: false, error: { code, message: error.message, ...(error.field ? { field: error.field } : {}) } }, status);
  }
  console.error(JSON.stringify({ message: "SEO action workflow failed", code, error: error instanceof Error ? error.message : String(error) }));
  return json({ ok: false, error: { code: "SEO_ACTION_WORKFLOW_FAILED", message: "SEO action workflow could not be processed." } }, 500);
}

export async function onRequestGet({ request, env }) {
  const access = denied(request);
  if (access) return access;
  if (!env?.DB) return json({ ok: false, error: { code: "BINDING_MISSING", message: "Preview DB binding is not configured." } }, 503);
  const domain = normalizeRelevantPagesDomain(new URL(request.url).searchParams.get("site_domain"));
  if (!domain) return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "site_domain", message: "Enter a valid saved site domain." } }, 400);
  try {
    return json({
      ok: true,
      data: { site_domain: domain, items: await listSeoActionWorkflow(env.DB, domain) },
      meta: { actual_cost_usd: 0, provider_requests: 0 },
    });
  } catch (error) {
    return mappedError(error);
  }
}

export async function onRequestPost({ request, env }) {
  const access = denied(request);
  if (access) return access;
  if (!env?.DB) return json({ ok: false, error: { code: "BINDING_MISSING", message: "Preview DB binding is not configured." } }, 503);
  try {
    const body = await readBody(request);
    const input = normalizeInput(body);
    const item = await upsertSeoActionWorkflow(env.DB, input);
    return json({
      ok: true,
      data: item,
      meta: { actual_cost_usd: 0, provider_requests: 0 },
    });
  } catch (error) {
    return mappedError(error);
  }
}

export function onRequestOptions({ request } = {}) {
  const access = denied(request);
  if (access) return access;
  return new Response(null, { status: 204, headers: { Allow: ALLOW } });
}

export async function onRequest(context) {
  const handlers = { GET: onRequestGet, POST: onRequestPost, OPTIONS: onRequestOptions };
  const handler = handlers[context.request.method];
  return handler
    ? handler(context)
    : json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }, 405, { Allow: ALLOW });
}
