import {
  scoreKeywordPotential,
} from "../../../../src/v2/scoring/keyword-potential.js";
import {
  scoreSeoOpportunity,
} from "../../../../src/v2/scoring/seo-opportunity.js";
import { normalizeMarketRequest } from "../../../../src/v2/markets/request-market.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function validationError(message, field) {
  return jsonResponse({
    ok: false,
    error: { code: "VALIDATION_ERROR", message, field },
  }, 400);
}

function normalizeKeyword(value) {
  return typeof value === "string"
    ? value.trim().replace(/s+/g, " ")
    : "";
}

function keywordOverviewFromRow(row) {
  return {
    metrics: {
      search_volume: row.search_volume,
      keyword_difficulty: row.keyword_difficulty,
      cpc_usd: row.cpc_usd,
      competition: row.competition,
      competition_level: row.competition_level,
    },
    intent: {
      primary: row.intent_primary,
    },
    trend: {
      change: {
        monthly: row.trend_monthly,
        quarterly: row.trend_quarterly,
        yearly: row.trend_yearly,
      },
    },
  };
}

function serpWeaknessFromRow(row) {
  if (!row.serp_snapshot_id) {
    return null;
  }

  return {
    version: row.serp_score_version,
    ranking_weakness: row.ranking_weakness,
    organic_click_opportunity:
      row.organic_click_opportunity,
    confidence_score: row.serp_confidence_score,
  };
}

export async function onRequestPost({ request, env }) {
  const startedAt = Date.now();
  let body;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({
      ok: false,
      error: {
        code: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      },
    }, 400);
  }

  const keyword = normalizeKeyword(body?.keyword);
  const normalizedKeyword = keyword.toLowerCase();
  let locationCode;
  let languageCode;
  try {
    ({ locationCode, languageCode } = normalizeMarketRequest(body));
  } catch {
    return validationError("Select a supported country and language combination.", "market");
  }

  if (!keyword) {
    return validationError("Keyword is required.", "keyword");
  }

  if (!env.DB) {
    return jsonResponse({
      ok: false,
      error: {
        code: "INFRASTRUCTURE_NOT_CONFIGURED",
        message: "Opportunity storage is not configured.",
      },
    }, 503);
  }

  try {
    const sql =
      "SELECT " +
      "k.id AS keyword_id, " +
      "km.id AS metric_id, km.search_volume, " +
      "km.keyword_difficulty, km.cpc_usd, km.competition, " +
      "km.competition_level, km.intent_primary, " +
      "km.trend_monthly, km.trend_quarterly, km.trend_yearly, " +
      "km.provider_updated_at, km.fetched_at AS metric_fetched_at, " +
      "sw.id AS serp_snapshot_id, " +
      "sw.score_version AS serp_score_version, " +
      "sw.ranking_weakness, sw.organic_click_opportunity, " +
      "sw.confidence_score AS serp_confidence_score, " +
      "sw.fetched_at AS serp_fetched_at " +
      "FROM keywords k " +
      "LEFT JOIN keyword_metrics km ON km.id = (" +
      "SELECT id FROM keyword_metrics " +
      "WHERE keyword_id = k.id ORDER BY fetched_at DESC LIMIT 1" +
      ") " +
      "LEFT JOIN serp_weakness_snapshots sw ON sw.id = (" +
      "SELECT id FROM serp_weakness_snapshots " +
      "WHERE keyword_id = k.id ORDER BY fetched_at DESC LIMIT 1" +
      ") " +
      "WHERE k.normalized_keyword = ? " +
      "AND k.language_code = ? AND k.location_code = ?";

    const row = await env.DB
      .prepare(sql)
      .bind(
        normalizedKeyword,
        languageCode,
        locationCode,
      )
      .first();

    if (!row?.keyword_id || !row?.metric_id) {
      return jsonResponse({
        ok: false,
        error: {
          code: "KEYWORD_METRICS_NOT_FOUND",
          message: "Run Keyword Overview first.",
        },
      }, 404);
    }

    const keywordPotential = scoreKeywordPotential(
      keywordOverviewFromRow(row),
    );
    const serpWeakness = serpWeaknessFromRow(row);
    const opportunity = scoreSeoOpportunity({
      keywordPotential,
      serpWeakness,
    });

    return jsonResponse({
      ok: true,
      data: {
        keyword,
        location_code: locationCode,
        language_code: languageCode,
        seo_opportunity: opportunity,
        inputs: {
          keyword_potential: keywordPotential,
          serp_weakness: serpWeakness,
        },
      },
      meta: {
        source: "d1",
        actual_cost_usd: 0,
        metric_fetched_at: row.metric_fetched_at,
        serp_fetched_at: row.serp_fetched_at ?? null,
        duration_ms: Date.now() - startedAt,
      },
    });
  } catch {
    return jsonResponse({
      ok: false,
      error: {
        code: "OPPORTUNITY_UNAVAILABLE",
        message: "Unable to calculate SEO opportunity.",
      },
      meta: {
        source: "d1",
        actual_cost_usd: 0,
        duration_ms: Date.now() - startedAt,
      },
    }, 500);
  }
}

export async function onRequestGet() {
  return jsonResponse({
    ok: false,
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "Use POST for SEO opportunity analysis.",
    },
  }, 405, { Allow: "POST" });
}
