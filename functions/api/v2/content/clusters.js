import { generateContentClusters } from "../../../../src/v2/content/content-clusters.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 64 * 1024;
const MAX_KEYWORDS = 100;
const INTENTS = new Set(["informational", "commercial", "transactional", "navigational"]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function normalizeRows(rows) {
  const seen = new Set();
  return rows.flatMap((row) => {
    const keyword = clean(row?.keyword, 80);
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) return [];
    seen.add(key);
    return [{
      keyword,
      intent: INTENTS.has(row?.intent) ? row.intent : "informational",
      priority: typeof row?.priority === "number" && Number.isFinite(row.priority) ? Math.min(100, Math.max(0, row.priority)) : null,
      page_type: clean(row?.page_type, 60),
      brief: row?.brief && typeof row.brief === "object" ? { slug: clean(row.brief.slug, 80) } : null,
    }];
  });
}

export async function onRequestPost({ request }) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) {
    return json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Request body must be 64 KB or smaller." } }, 413);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400);
  }

  if (!Array.isArray(body?.keywords) || body.keywords.length < 1 || body.keywords.length > MAX_KEYWORDS) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "keywords", message: "Provide between 1 and 100 keywords." } }, 400);
  }
  const rows = normalizeRows(body.keywords);
  if (!rows.length) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "keywords", message: "At least one valid keyword is required." } }, 400);
  }

  return json({
    ok: true,
    data: generateContentClusters(rows),
    meta: { actual_cost_usd: 0, provider: "internal", rules_based: true, input_count: rows.length },
  });
}

export function onRequestGet() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST to generate content clusters." } }, 405);
}
