import {
  KeywordIdeasProviderError,
  fetchKeywordIdeas,
} from "../../../../src/v2/providers/dataforseo-keyword-ideas.js";
import { normalizeKeywordOverview } from "../../../../src/v2/normalizers/keyword-overview.js";
import { enrichKeywordIdeas } from "../../../../src/v2/scoring/keyword-relevance.js";
import { recordApiUsage } from "../../../../src/v2/storage/keyword-overview.js";

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const JSON_HEADERS = { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function cleanKeyword(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function groupFor(keyword, intent, seed) {
  const value = keyword.toLowerCase();
  const words = value.split(" ");
  if (/^(how|what|why|when|where|which|who|can|does|is)\b/.test(value)) return "Questions";
  if (/\b(vs|versus|compare|comparison|alternative|alternatives)\b/.test(value)) return "Comparisons";
  if (/\b(best|top|review|reviews|price|prices|cost|cheap|affordable)\b/.test(value)) return "Commercial research";
  if (intent === "transactional" || /\b(buy|supplier|suppliers|manufacturer|manufacturers|wholesale|quote|near me)\b/.test(value)) return "Transactional";
  const seedWords = new Set(seed.toLowerCase().split(" "));
  const stop = new Set(["a","an","and","for","in","of","on","the","to","with"]);
  const modifier = words.find((word) => !seedWords.has(word) && !stop.has(word) && word.length > 2);
  return modifier ? modifier.charAt(0).toUpperCase() + modifier.slice(1) : "Core topic";
}

function cacheKey(seed, locationCode, languageCode, limit) {
  return ["v2", "keyword-ideas", encodeURIComponent(seed.toLowerCase()), locationCode, languageCode, limit].join(":");
}

async function logUsage(env, values) {
  try {
    await recordApiUsage({ env, ...values, provider: "dataforseo", endpoint: "dataforseo_labs/google/keyword_ideas/live", operation: "keyword_ideas" });
  } catch {
    // Analytics failure must not break the user request.
  }
}

async function persistRun(env, seed, locationCode, languageCode, limit, ideas, actualCost) {
  const normalizedSeed = seed.toLowerCase();
  await env.DB.prepare("INSERT INTO keywords (keyword, normalized_keyword, language_code, location_code) VALUES (?, ?, ?, ?) ON CONFLICT(normalized_keyword, language_code, location_code) DO UPDATE SET keyword = excluded.keyword, updated_at = CURRENT_TIMESTAMP")
    .bind(seed, normalizedSeed, languageCode, locationCode).run();
  const seedRow = await env.DB.prepare("SELECT id FROM keywords WHERE normalized_keyword = ? AND language_code = ? AND location_code = ?")
    .bind(normalizedSeed, languageCode, locationCode).first();
  const run = await env.DB.prepare("INSERT INTO keyword_idea_runs (seed_keyword_id, provider, requested_limit, result_count, actual_cost_usd) VALUES (?, 'dataforseo', ?, ?, ?) RETURNING id")
    .bind(seedRow.id, limit, ideas.length, actualCost).first();

  for (let offset = 0; offset < ideas.length; offset += 20) {
    const statements = [];
    ideas.slice(offset, offset + 20).forEach((idea) => {
      const normalized = idea.keyword.toLowerCase();
      statements.push(env.DB.prepare("INSERT INTO keywords (keyword, normalized_keyword, language_code, location_code) VALUES (?, ?, ?, ?) ON CONFLICT(normalized_keyword, language_code, location_code) DO UPDATE SET keyword = excluded.keyword, updated_at = CURRENT_TIMESTAMP")
        .bind(idea.keyword, normalized, languageCode, locationCode));
      statements.push(env.DB.prepare("INSERT INTO keyword_metrics (keyword_id, provider, search_volume, keyword_difficulty, cpc_usd, competition, competition_level, intent_primary, intent_secondary_json, monthly_searches_json, trend_monthly, trend_quarterly, trend_yearly, provider_updated_at, actual_cost_usd) SELECT id, 'dataforseo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL FROM keywords WHERE normalized_keyword = ? AND language_code = ? AND location_code = ?")
        .bind(idea.metrics.search_volume, idea.metrics.keyword_difficulty, idea.metrics.cpc_usd, idea.metrics.competition, idea.metrics.competition_level, idea.intent.primary, JSON.stringify(idea.intent.secondary), JSON.stringify(idea.trend.monthly_searches), idea.trend.change.monthly, idea.trend.change.quarterly, idea.trend.change.yearly, idea.data_freshness.keyword_metrics_updated_at, normalized, languageCode, locationCode));
      statements.push(env.DB.prepare("INSERT OR REPLACE INTO keyword_idea_members (run_id, keyword_id, rank_order, potential_score, confidence_score, group_label) SELECT ?, id, ?, ?, ?, ? FROM keywords WHERE normalized_keyword = ? AND language_code = ? AND location_code = ?")
        .bind(run.id, idea.rank, idea.intelligence.keyword_potential?.score ?? null, idea.intelligence.keyword_potential?.confidence_score ?? null, idea.group, normalized, languageCode, locationCode));
    });
    if (statements.length) await env.DB.batch(statements);
  }
}

export async function onRequestPost({ request, env }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400); }

  const seed = cleanKeyword(body?.seed_keyword ?? body?.keyword);
  const locationCode = Number.isInteger(body?.location_code) ? body.location_code : 2840;
  const languageCode = typeof body?.language_code === "string" ? body.language_code : "en";
  const limit = body?.limit === undefined ? 25 : body.limit;

  if (!seed || seed.length > 80 || seed.split(" ").length > 10) return json({ ok: false, error: { code: "VALIDATION_ERROR", message: "Seed keyword must be 1-80 characters and no more than 10 words.", field: "seed_keyword" } }, 400);
  if (!Number.isInteger(limit) || limit < 10 || limit > 50) return json({ ok: false, error: { code: "VALIDATION_ERROR", message: "Limit must be an integer from 10 to 50.", field: "limit" } }, 400);

  const key = cacheKey(seed, locationCode, languageCode, limit);
  const cached = await env.CACHE.get(key, "json");
  if (cached) {
    const ideas = enrichKeywordIdeas(cached.ideas, seed);
    const data = { ...cached, ideas };
    await logUsage(env, { requestId, taskCount: 0, resultCount: ideas.length, actualCostUsd: 0, cacheHit: true, status: "success", httpStatus: 200, durationMs: Date.now() - startedAt });
    return json({ ok: true, data, meta: { request_id: requestId, cached: true, cache_ttl_days: 30, actual_cost_usd: 0, result_count: ideas.length } });
  }

  try {
    const provider = await fetchKeywordIdeas({ env, seedKeyword: seed, locationCode, languageCode, limit });
    const seen = new Set();
    const normalizedIdeas = provider.items.map((item) => normalizeKeywordOverview({ items: [item], location_code: locationCode, language_code: languageCode }))
      .filter((idea) => idea?.keyword)
      .filter((idea) => { const key = idea.keyword.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; })
      .map((idea) => ({ ...idea, group: groupFor(idea.keyword, idea.intent.primary, seed) }));
    const ideas = enrichKeywordIdeas(normalizedIdeas, seed);

    const data = { seed_keyword: seed, location_code: locationCode, language_code: languageCode, ideas };
    await persistRun(env, seed, locationCode, languageCode, limit, ideas, provider.usage.actual_cost_usd);
    await env.CACHE.put(key, JSON.stringify(data), { expirationTtl: CACHE_TTL_SECONDS });
    await logUsage(env, { requestId, taskCount: provider.usage.task_count, resultCount: ideas.length, actualCostUsd: provider.usage.actual_cost_usd, cacheHit: false, status: "success", httpStatus: 200, durationMs: Date.now() - startedAt });
    return json({ ok: true, data, meta: { request_id: requestId, cached: false, cache_ttl_days: 30, actual_cost_usd: provider.usage.actual_cost_usd, result_count: ideas.length } });
  } catch (error) {
    const known = error instanceof KeywordIdeasProviderError;
    const status = known ? error.httpStatus : 500;
    await logUsage(env, { requestId, taskCount: 1, resultCount: 0, actualCostUsd: null, cacheHit: false, status: "error", httpStatus: status, durationMs: Date.now() - startedAt });
    return json({ ok: false, error: { code: known ? error.code : "INTERNAL_ERROR", message: known ? error.message : "Keyword ideas could not be completed.", provider_status: known ? error.providerStatus : undefined }, meta: { request_id: requestId } }, status);
  }
}

export function onRequestGet() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for keyword ideas." } }, 405);
}
