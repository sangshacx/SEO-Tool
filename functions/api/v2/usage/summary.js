const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
  });
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function integerValue(value) {
  return Math.trunc(numberValue(value));
}

function roundMoney(value) {
  return Math.round(numberValue(value) * 100000) / 100000;
}

function rate(part, total) {
  if (!total) {
    return 0;
  }

  return Math.round((part / total) * 10000) / 100;
}

export async function onRequestGet({ env }) {
  const startedAt = Date.now();

  if (!env.DB) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "INFRASTRUCTURE_NOT_CONFIGURED",
          message: "Usage storage is not configured.",
        },
      },
      503,
    );
  }

  try {
    const row = await env.DB
      .prepare(
        `SELECT
          COUNT(*) AS all_requests,
          COALESCE(SUM(actual_cost_usd), 0) AS all_cost_usd,
          COALESCE(SUM(CASE
            WHEN date(created_at) = date('now') THEN 1 ELSE 0
          END), 0) AS today_requests,
          COALESCE(SUM(CASE
            WHEN date(created_at) = date('now')
            THEN actual_cost_usd ELSE 0
          END), 0) AS today_cost_usd,
          COALESCE(SUM(CASE
            WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
            THEN 1 ELSE 0
          END), 0) AS month_requests,
          COALESCE(SUM(CASE
            WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
            THEN actual_cost_usd ELSE 0
          END), 0) AS month_cost_usd,
          COALESCE(SUM(CASE
            WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
              AND cache_hit = 1
            THEN 1 ELSE 0
          END), 0) AS month_cache_hits,
          COALESCE(SUM(CASE
            WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
              AND cache_hit = 0
              AND task_count > 0
            THEN 1 ELSE 0
          END), 0) AS month_provider_requests,
          COALESCE(SUM(CASE
            WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
              AND status != 'success'
            THEN 1 ELSE 0
          END), 0) AS month_failed_requests
        FROM api_usage`,
      )
      .first();

    const monthRequests = integerValue(row?.month_requests);
    const monthCacheHits = integerValue(row?.month_cache_hits);

    return jsonResponse({
      ok: true,
      data: {
        today: {
          requests: integerValue(row?.today_requests),
          actual_cost_usd: roundMoney(row?.today_cost_usd),
        },
        this_month: {
          requests: monthRequests,
          provider_requests: integerValue(row?.month_provider_requests),
          cache_hits: monthCacheHits,
          cache_hit_rate_percent: rate(monthCacheHits, monthRequests),
          failed_requests: integerValue(row?.month_failed_requests),
          actual_cost_usd: roundMoney(row?.month_cost_usd),
          saved_requests_by_cache: monthCacheHits,
        },
        all_time: {
          requests: integerValue(row?.all_requests),
          actual_cost_usd: roundMoney(row?.all_cost_usd),
        },
      },
      meta: {
        source: "d1",
        currency: "USD",
        timezone: "UTC",
        saved_cost_usd: null,
        saved_cost_note:
          "Saved request count is exact. Saved dollar value is not estimated because provider prices are not hardcoded.",
        generated_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
      },
    });
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "USAGE_SUMMARY_UNAVAILABLE",
          message: "Unable to load API usage summary.",
        },
        meta: {
          source: "d1",
          duration_ms: Date.now() - startedAt,
        },
      },
      500,
    );
  }
}

export async function onRequestPost() {
  return jsonResponse(
    {
      ok: false,
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Use GET for the usage summary.",
      },
    },
    405,
    { Allow: "GET" },
  );
}
