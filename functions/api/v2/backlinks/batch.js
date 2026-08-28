import {
  backlinkSnapshotCacheKey,
  isValidBacklinkDomain,
  normalizeBacklinkDomain,
} from "../../../../src/v2/backlinks/domain.js";
import { summarizeBacklinkBatch } from "../../../../src/v2/intelligence/backlink-batch.js";
import { enrichBacklinkSummary } from "../../../../src/v2/intelligence/backlink-health.js";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_DOMAINS = 200;
const CHUNK_SIZE = 50;
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function readSnapshots(cache, domains) {
  const rows = [];
  for (let index = 0; index < domains.length; index += CHUNK_SIZE) {
    const chunk = domains.slice(index, index + CHUNK_SIZE);
    const values = await Promise.all(chunk.map((domain) => cache.get(backlinkSnapshotCacheKey(domain), "json")));
    rows.push(...chunk.map((domain, offset) => ({ domain, value: values[offset] })));
  }
  return rows;
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

  if (!Array.isArray(body?.domains) || !body.domains.length) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", message: "Provide an array with at least one domain." } }, 400);
  }
  if (body.domains.length > MAX_DOMAINS) {
    return json({ ok: false, error: { code: "TOO_MANY_DOMAINS", message: `A batch is limited to ${MAX_DOMAINS} domains.` } }, 400);
  }

  const normalizedDomains = body.domains.map(normalizeBacklinkDomain);
  const invalidDomains = normalizedDomains.filter((domain) => !isValidBacklinkDomain(domain));
  if (invalidDomains.length) {
    return json({
      ok: false,
      error: {
        code: "INVALID_DOMAINS",
        message: "One or more entries are not valid root domains.",
        invalid_domains: invalidDomains.slice(0, 20).map((domain) => domain || "(empty)"),
      },
    }, 400);
  }
  const domains = [...new Set(normalizedDomains)];

  let snapshots;
  try {
    snapshots = await readSnapshots(env.CACHE, domains);
  } catch (error) {
    console.error(JSON.stringify({
      message: "batch backlink cache read failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return json({ ok: false, error: { code: "CACHE_READ_FAILED", message: "Backlink snapshots could not be read." }, meta: { request_id: requestId } }, 502);
  }

  const available = snapshots.filter((item) => item.value).map((item) => enrichBacklinkSummary(item.value));
  const missingDomains = snapshots.filter((item) => !item.value).map((item) => item.domain);
  const data = summarizeBacklinkBatch(available);
  data.requested_domains = domains.length;
  data.missing_domains = missingDomains;

  return json({
    ok: true,
    data,
    meta: {
      request_id: requestId,
      cached: true,
      cached_domains: available.length,
      missing_domains: missingDomains.length,
      actual_cost_usd: 0,
      max_domains: MAX_DOMAINS,
      chunk_size: CHUNK_SIZE,
      duration_ms: Date.now() - startedAt,
    },
  });
}

export function onRequestGet() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for batch backlink analysis." } }, 405);
}
