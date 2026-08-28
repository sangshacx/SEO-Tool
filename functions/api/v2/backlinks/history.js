import {
  isValidBacklinkDomain,
  normalizeBacklinkDomain,
} from "../../../../src/v2/backlinks/domain.js";
import { analyzeBacklinkHistory } from "../../../../src/v2/intelligence/backlink-history.js";

const ALLOWED_DAYS = new Set([0, 30, 90, 180, 365]);
const MAX_POINTS = 500;
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function onRequestGet({ request, env }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  if (!env?.DB) {
    return json({ ok: false, error: { code: "BINDING_MISSING", message: "Preview DB binding is not configured." } }, 503);
  }

  const url = new URL(request.url);
  const domain = normalizeBacklinkDomain(url.searchParams.get("domain"));
  const days = Number(url.searchParams.get("days") ?? 90);
  if (!isValidBacklinkDomain(domain)) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "domain", message: "Enter a valid root domain without a path." } }, 400);
  }
  if (!Number.isInteger(days) || !ALLOWED_DAYS.has(days)) {
    return json({ ok: false, error: { code: "INVALID_RANGE", field: "days", message: "Choose 30, 90, 180, 365, or 0 for all history." } }, 400);
  }

  try {
    let statement = env.DB.prepare(
      "SELECT domain_rank, backlinks, referring_domains, referring_ips, health_score, spam_score, " +
      "broken_backlinks, source, snapshot_at FROM backlink_snapshots WHERE domain = ? " +
      "ORDER BY snapshot_at DESC LIMIT 500",
    ).bind(domain);
    if (days > 0) {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      statement = env.DB.prepare(
        "SELECT domain_rank, backlinks, referring_domains, referring_ips, health_score, spam_score, " +
        "broken_backlinks, source, snapshot_at FROM backlink_snapshots WHERE domain = ? AND snapshot_at >= ? " +
        "ORDER BY snapshot_at DESC LIMIT 500",
      ).bind(domain, cutoff);
    }
    const result = await statement.all();
    const rows = (result.results ?? []).reverse();
    return json({
      ok: true,
      data: analyzeBacklinkHistory(domain, rows),
      meta: {
        request_id: requestId,
        source: "d1",
        days,
        max_points: MAX_POINTS,
        actual_cost_usd: 0,
        duration_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "backlink history query failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return json({ ok: false, error: { code: "HISTORY_QUERY_FAILED", message: "Backlink history could not be loaded." }, meta: { request_id: requestId } }, 500);
  }
}

export function onRequestPost() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use GET for backlink history." } }, 405);
}
