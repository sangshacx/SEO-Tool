import { generateContentBrief } from "../../../../src/v2/content/content-brief.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};
const INTENTS = new Set(["informational", "commercial", "transactional", "navigational"]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function onRequestPost({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400);
  }

  const keyword = clean(body?.keyword, 80);
  if (!keyword) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "keyword", message: "Keyword is required." } }, 400);
  }

  const intent = INTENTS.has(body?.intent) ? body.intent : "informational";
  const priority = typeof body?.priority === "number" && Number.isFinite(body.priority)
    ? Math.min(100, Math.max(0, body.priority))
    : null;
  const data = generateContentBrief({
    keyword,
    intent,
    priority,
    page_type: clean(body?.page_type, 60),
    funnel: clean(body?.funnel, 30),
    angle: clean(body?.angle, 240),
    source: clean(body?.source, 40),
    competitor_url: safeUrl(body?.competitor_url),
  });

  return json({
    ok: true,
    data,
    meta: { actual_cost_usd: 0, provider: "internal", deterministic: true },
  });
}

export function onRequestGet() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST to generate a content brief." } }, 405);
}
