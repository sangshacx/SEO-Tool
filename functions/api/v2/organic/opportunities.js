import { organicKeywordsCacheCandidates } from "../../../../src/v2/organic/organic-keywords-cache.js";
import { organicPagesCacheCandidates } from "../../../../src/v2/organic/organic-pages-cache.js";
import { buildOrganicOpportunities } from "../../../../src/v2/intelligence/organic-opportunities.js";
import { normalizeMarketRequest } from "../../../../src/v2/markets/request-market.js";
import { normalizeRelevantPagesDomain } from "../../../../src/v2/providers/dataforseo-relevant-pages.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function unwrap(entry) {
  return entry && typeof entry === "object" && Object.hasOwn(entry, "data") ? entry.data : entry;
}

async function readBest(cache, candidates) {
  for (const candidate of candidates) {
    const entry = await cache.get(candidate.key, "json");
    if (!entry) continue;
    return {
      data: unwrap(entry),
      cached_at: entry?.cached_at ?? unwrap(entry)?.generated_at ?? null,
      depth: candidate.depth,
    };
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  if (!env?.CACHE || !env?.DB) {
    return json({ ok: false, error: { code: "BINDINGS_MISSING", message: "Preview storage bindings are not configured." } }, 503);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400); }

  const domain = normalizeRelevantPagesDomain(body?.target ?? body?.domain);
  if (!domain) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "target", message: "Enter a valid root domain." } }, 400);
  }

  let locationCode;
  let languageCode;
  try { ({ locationCode, languageCode } = normalizeMarketRequest(body)); }
  catch {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "market", message: "Select a supported country and language combination." } }, 400);
  }

  const managed = await env.DB.prepare("SELECT domain FROM site_profiles WHERE domain = ? LIMIT 1").bind(domain).first();
  if (!managed?.domain) {
    return json({
      ok: false,
      error: { code: "MANAGED_SITE_REQUIRED", message: "Opportunity Center is for a saved own-site profile. Add or select this site first." },
      meta: { request_id: requestId, actual_cost_usd: 0, provider_requests: 0 },
    }, 409);
  }

  const [keywords, pages] = await Promise.all([
    readBest(env.CACHE, organicKeywordsCacheCandidates({
      target: domain,
      locationCode,
      languageCode,
      historicalSerpMode: "live",
      depth: 100,
    })),
    readBest(env.CACHE, organicPagesCacheCandidates({
      target: domain,
      locationCode,
      languageCode,
      depth: 100,
    })),
  ]);

  const sources = {
    organic_keywords: keywords ? { available: true, depth: keywords.depth, cached_at: keywords.cached_at } : null,
    top_pages: pages ? { available: true, depth: pages.depth, cached_at: pages.cached_at } : null,
  };
  const data = buildOrganicOpportunities({
    target: domain,
    keywordRows: keywords?.data?.items ?? [],
    pageRows: pages?.data?.items ?? [],
    sources,
  });
  const missing = [];
  if (!keywords) missing.push("organic_keywords");
  if (!pages) missing.push("top_pages");

  return json({
    ok: true,
    data: { ...data, missing_sources: missing },
    meta: {
      request_id: requestId,
      source: "cache_only",
      actual_cost_usd: 0,
      task_count: 0,
      provider_requests: 0,
      duration_ms: Date.now() - startedAt,
    },
  });
}

export function onRequestGet() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for Opportunity Center." } }, 405);
}
