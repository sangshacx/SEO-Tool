import {
  backlinkSnapshotCacheKey,
  isValidBacklinkDomain,
  normalizeBacklinkDomain,
} from "../../../../src/v2/backlinks/domain.js";
import { enrichBacklinkSummary } from "../../../../src/v2/intelligence/backlink-health.js";
import { compareBacklinkProfiles } from "../../../../src/v2/intelligence/backlink-comparison.js";

const MAX_BODY_BYTES = 64 * 1024;
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function onRequestPost({ request, env }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Request body must be 64 KB or smaller." } }, 413);
  }
  if (!env?.CACHE) {
    return json({ ok: false, error: { code: "BINDING_MISSING", message: "Preview CACHE binding is not configured." } }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400);
  }

  const ownDomain = normalizeBacklinkDomain(body?.own_domain);
  const competitorDomain = normalizeBacklinkDomain(body?.competitor_domain);
  if (!isValidBacklinkDomain(ownDomain) || !isValidBacklinkDomain(competitorDomain)) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", message: "Enter two valid root domains without paths." } }, 400);
  }
  if (ownDomain === competitorDomain) {
    return json({ ok: false, error: { code: "SAME_DOMAIN", message: "Choose two different domains to compare." } }, 400);
  }

  const domains = [ownDomain, competitorDomain];
  let snapshots;
  try {
    snapshots = await Promise.all(domains.map((domain) => env.CACHE.get(backlinkSnapshotCacheKey(domain), "json")));
  } catch (error) {
    console.error(JSON.stringify({
      message: "backlink comparison cache read failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return json({ ok: false, error: { code: "CACHE_READ_FAILED", message: "Backlink snapshots could not be read." }, meta: { request_id: requestId } }, 502);
  }

  const missingDomains = domains.filter((_, index) => !snapshots[index]);
  if (missingDomains.length) {
    return json({
      ok: false,
      error: {
        code: "SNAPSHOT_CACHE_REQUIRED",
        message: "Create backlink snapshots for the missing domains before comparing.",
        missing_domains: missingDomains,
      },
      meta: { request_id: requestId, cached: true, actual_cost_usd: 0, duration_ms: Date.now() - startedAt },
    }, 409);
  }

  const own = enrichBacklinkSummary(snapshots[0]);
  const competitor = enrichBacklinkSummary(snapshots[1]);
  return json({
    ok: true,
    data: compareBacklinkProfiles(own, competitor),
    meta: { request_id: requestId, cached: true, actual_cost_usd: 0, duration_ms: Date.now() - startedAt },
  });
}

export function onRequestGet() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for backlink comparisons." } }, 405);
}
