import {
  isValidBacklinkDomain,
  normalizeBacklinkDomain,
} from "../../../../src/v2/backlinks/domain.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};
const MAX_BODY_BYTES = 64 * 1024;
const MAX_ITEMS = 100;
const MAX_NOTES_LENGTH = 2000;
const MAX_OFFSET = 10000;
const ALLOWED_LIMITS = new Set([25, 50, 100, 200]);
const STATUSES = new Set(["new", "researching", "outreach", "contacted", "won", "rejected"]);

class RequestBodyError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function errorResponse(code, message, status = 400, field) {
  return json({
    ok: false,
    error: { code, ...(field ? { field } : {}), message },
  }, status);
}

async function boundedRequestJson(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) throw new RequestBodyError("PAYLOAD_TOO_LARGE");
  if (!request.body) throw new RequestBodyError("INVALID_JSON");

  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RequestBodyError("PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(combined));
  } catch {
    throw new RequestBodyError("INVALID_JSON");
  }
}

async function parseBody(request) {
  try {
    return { body: await boundedRequestJson(request) };
  } catch (error) {
    if (error instanceof RequestBodyError && error.code === "PAYLOAD_TOO_LARGE") {
      return { response: errorResponse("PAYLOAD_TOO_LARGE", "Request body must be 64 KB or smaller.", 413) };
    }
    return { response: errorResponse("INVALID_JSON", "Request body must be valid JSON.") };
  }
}

function normalizeCompetitors(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeBacklinkDomain).filter(isValidBacklinkDomain))].sort().slice(0, 3);
}

function normalizedScore(value) {
  if (value == null || value === "") return null;
  const score = Number(value);
  return Number.isInteger(score) && score >= 0 && score <= 100 ? score : undefined;
}

function normalizedLabel(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > 100) return undefined;
  return value.trim();
}

function mapProspect(row) {
  let competitorDomains = [];
  try {
    const parsed = JSON.parse(row.competitor_domains_json || "[]");
    competitorDomains = Array.isArray(parsed) ? parsed : [];
  } catch {
    competitorDomains = [];
  }
  return {
    own_domain: row.own_domain,
    referring_domain: row.referring_domain,
    competitor_domains: competitorDomains,
    opportunity_score: row.opportunity_score,
    opportunity_label: row.opportunity_label,
    status: row.status,
    notes: row.notes,
    first_discovered_at: row.first_discovered_at,
    last_seen_at: row.last_seen_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function requestMeta(startedAt) {
  return {
    source: "d1",
    actual_cost_usd: 0,
    duration_ms: Date.now() - startedAt,
  };
}

export async function onRequestGet({ request, env }) {
  const startedAt = Date.now();
  if (!env?.DB) {
    return errorResponse("BINDING_MISSING", "Preview DB binding is not configured.", 503);
  }

  const url = new URL(request.url);
  const ownDomain = normalizeBacklinkDomain(url.searchParams.get("own_domain"));
  const status = String(url.searchParams.get("status") || "").trim().toLowerCase();
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  if (!isValidBacklinkDomain(ownDomain)) {
    return errorResponse("VALIDATION_ERROR", "Enter a valid own root domain without a path.", 400, "own_domain");
  }
  if (status && !STATUSES.has(status)) {
    return errorResponse("INVALID_STATUS", "Choose a supported prospect status.", 400, "status");
  }
  if (!Number.isInteger(limit) || !ALLOWED_LIMITS.has(limit)
    || !Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    return errorResponse("INVALID_PAGINATION", "Choose a supported limit and non-negative offset.", 400);
  }

  const where = status ? "own_domain = ? AND status = ?" : "own_domain = ?";
  const values = status ? [ownDomain, status] : [ownDomain];
  try {
    const count = env.DB
      .prepare(`SELECT COUNT(*) AS total_count FROM backlink_opportunities WHERE ${where}`)
      .bind(...values);
    const rows = env.DB
      .prepare(
        `SELECT own_domain, referring_domain, competitor_domains_json, opportunity_score, opportunity_label,
          status, notes, first_discovered_at, last_seen_at, created_at, updated_at
        FROM backlink_opportunities
        WHERE ${where}
        ORDER BY updated_at DESC, referring_domain ASC
        LIMIT ? OFFSET ?`,
      )
      .bind(...values, limit, offset);
    const [countResult, rowsResult] = await env.DB.batch([count, rows]);
    const totalCount = Number(countResult?.results?.[0]?.total_count ?? 0);
    const items = (rowsResult?.results ?? []).map(mapProspect);
    return json({
      ok: true,
      data: {
        own_domain: ownDomain,
        status: status || "all",
        items,
        pagination: {
          total_count: totalCount,
          items_count: items.length,
          limit,
          offset,
          has_previous: offset > 0,
          has_next: offset + items.length < totalCount,
        },
      },
      meta: requestMeta(startedAt),
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "backlink opportunities query failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return errorResponse("PROSPECTS_QUERY_FAILED", "Saved link prospects could not be loaded.", 500);
  }
}

export async function onRequestPost({ request, env }) {
  const startedAt = Date.now();
  if (!env?.DB) {
    return errorResponse("BINDING_MISSING", "Preview DB binding is not configured.", 503);
  }
  const parsed = await parseBody(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const ownDomain = normalizeBacklinkDomain(body?.own_domain);
  if (!isValidBacklinkDomain(ownDomain)) {
    return errorResponse("VALIDATION_ERROR", "Enter a valid own root domain without a path.", 400, "own_domain");
  }
  if (!Array.isArray(body?.items) || body.items.length < 1 || body.items.length > MAX_ITEMS) {
    return errorResponse("INVALID_ITEMS", "Save between 1 and 100 backlink opportunities.", 400, "items");
  }

  const unique = new Map();
  for (const item of body.items) {
    const referringDomain = normalizeBacklinkDomain(item?.referring_domain);
    const score = normalizedScore(item?.opportunity_score);
    const label = normalizedLabel(item?.opportunity_label);
    if (!isValidBacklinkDomain(referringDomain) || referringDomain === ownDomain
      || score === undefined || label === undefined) {
      return errorResponse("INVALID_ITEM", "Each opportunity must contain a valid referring domain and score.", 400, "items");
    }
    unique.set(referringDomain, {
      referring_domain: referringDomain,
      competitor_domains: normalizeCompetitors(item?.competitor_domains),
      opportunity_score: score,
      opportunity_label: label,
    });
  }
  const items = [...unique.values()];

  try {
    const statements = items.map((item) => env.DB.prepare(
      `INSERT INTO backlink_opportunities (
        own_domain, referring_domain, competitor_domains_json, opportunity_score, opportunity_label
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(own_domain, referring_domain) DO UPDATE SET
        competitor_domains_json = excluded.competitor_domains_json,
        opportunity_score = excluded.opportunity_score,
        opportunity_label = excluded.opportunity_label,
        last_seen_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      ownDomain,
      item.referring_domain,
      JSON.stringify(item.competitor_domains),
      item.opportunity_score,
      item.opportunity_label,
    ));
    await env.DB.batch(statements);
    return json({
      ok: true,
      data: { own_domain: ownDomain, saved_count: items.length, items },
      meta: requestMeta(startedAt),
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "backlink opportunities save failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return errorResponse("PROSPECTS_SAVE_FAILED", "Link prospects could not be saved.", 500);
  }
}

export async function onRequestPatch({ request, env }) {
  const startedAt = Date.now();
  if (!env?.DB) {
    return errorResponse("BINDING_MISSING", "Preview DB binding is not configured.", 503);
  }
  const parsed = await parseBody(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const ownDomain = normalizeBacklinkDomain(body?.own_domain);
  const referringDomain = normalizeBacklinkDomain(body?.referring_domain);
  if (!isValidBacklinkDomain(ownDomain) || !isValidBacklinkDomain(referringDomain)) {
    return errorResponse("VALIDATION_ERROR", "Enter valid own and referring root domains.", 400);
  }

  const hasStatus = Object.hasOwn(body, "status");
  const hasNotes = Object.hasOwn(body, "notes");
  const status = hasStatus ? String(body.status || "").trim().toLowerCase() : undefined;
  const notes = hasNotes && typeof body.notes === "string" ? body.notes.trim() : undefined;
  if (!hasStatus && !hasNotes) {
    return errorResponse("EMPTY_UPDATE", "Provide a status or notes update.", 400);
  }
  if (hasStatus && !STATUSES.has(status)) {
    return errorResponse("INVALID_STATUS", "Choose a supported prospect status.", 400, "status");
  }
  if (hasNotes && (notes === undefined || notes.length > MAX_NOTES_LENGTH)) {
    return errorResponse("INVALID_NOTES", "Notes must be 2,000 characters or fewer.", 400, "notes");
  }

  const assignments = [];
  const values = [];
  if (hasStatus) {
    assignments.push("status = ?");
    values.push(status);
  }
  if (hasNotes) {
    assignments.push("notes = ?");
    values.push(notes);
  }
  try {
    const result = await env.DB
      .prepare(
        `UPDATE backlink_opportunities
        SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
        WHERE own_domain = ? AND referring_domain = ?`,
      )
      .bind(...values, ownDomain, referringDomain)
      .run();
    if (Number(result?.meta?.changes ?? 0) < 1) {
      return errorResponse("PROSPECT_NOT_FOUND", "The saved link prospect no longer exists.", 404);
    }
    return json({
      ok: true,
      data: {
        own_domain: ownDomain,
        referring_domain: referringDomain,
        ...(hasStatus ? { status } : {}),
        ...(hasNotes ? { notes } : {}),
      },
      meta: requestMeta(startedAt),
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "backlink opportunity update failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return errorResponse("PROSPECT_UPDATE_FAILED", "The link prospect could not be updated.", 500);
  }
}

export function onRequestDelete() {
  return json({
    ok: false,
    error: { code: "METHOD_NOT_ALLOWED", message: "Use GET, POST, or PATCH for link prospects." },
  }, 405, { Allow: "GET, POST, PATCH" });
}
