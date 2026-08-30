import {
  assessBacklinkOutreach,
  classifyWebsiteRelevance,
  combineOutreachAssessment,
  detectPossibleSiteNetwork,
} from "../../../../src/v2/intelligence/backlink-outreach.js";
import {
  isValidBacklinkDomain,
  normalizeBacklinkDomain,
} from "../../../../src/v2/backlinks/domain.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" };
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_DOMAINS = 10;
const MAX_TOPICS = 10;
const MAX_TOPIC_LENGTH = 80;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 64 * 1024;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

async function boundedRequestJson(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
  if (!request.body) throw new Error("INVALID_JSON");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(combined));
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function error(code, message, status) {
  return json({ ok: false, error: { code, message } }, status);
}

export function relevanceCacheKey(domain) {
  return `v2:backlink-relevance-evidence:v1:${domain}`;
}

function isSafePublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const domain = normalizeBacklinkDomain(url.hostname);
  return url.protocol === "https:"
    && isValidBacklinkDomain(domain)
    && domain !== "localhost"
    && !/^\d+(?:\.\d+){3}$/.test(url.hostname)
    && !url.hostname.includes(":");
}

async function boundedResponseText(response) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error("Public page is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Public page is too large");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function decodeEntities(text) {
  return text.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function extractEvidence(domain, html) {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const description = decodeEntities(
    html.match(/<meta[^>]+name=["']?description["']?[^>]+content=["']([^"']*)["'][^>]*>/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']?description["']?[^>]*>/i)?.[1]
      ?? "",
  ).replace(/\s+/g, " ").trim().slice(0, 600);
  const text = decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim().slice(0, 12000);
  return { domain, title, description, text, fetched_at: new Date().toISOString() };
}

export async function fetchPublicSiteEvidence(inputDomain, fetchImpl = fetch) {
  const domain = normalizeBacklinkDomain(inputDomain);
  let currentUrl = `https://${domain}/`;
  if (!isSafePublicUrl(currentUrl)) throw new Error("Unsafe public website URL");

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetchImpl(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "SEO-Pro-V2-Relevance/0.1" },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("Public website redirect limit exceeded");
      const nextUrl = new URL(location, currentUrl).toString();
      if (!isSafePublicUrl(nextUrl)) throw new Error("Unsafe public website redirect");
      currentUrl = nextUrl;
      continue;
    }
    if (!response.ok) throw new Error(`Public website returned HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error("Public website did not return HTML");
    return extractEvidence(domain, await boundedResponseText(response));
  }
  throw new Error("Public website redirect limit exceeded");
}

function normalizedDomains(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeBacklinkDomain))];
}

function normalizedTopics(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((topic) => typeof topic === "string" ? topic.trim().toLowerCase() : "").filter(Boolean))];
}

export async function onRequestPost({ request, env, data = {} }) {
  const startedAt = Date.now();
  if (!env?.CACHE) return error("BINDING_MISSING", "Preview cache binding is not configured.", 503);
  let body;
  try {
    body = await boundedRequestJson(request);
  } catch (parseError) {
    if (parseError instanceof Error && parseError.message === "PAYLOAD_TOO_LARGE") {
      return error("PAYLOAD_TOO_LARGE", "Request body must be 64 KB or smaller.", 413);
    }
    return error("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
  const domains = normalizedDomains(body?.domains);
  const topics = normalizedTopics(body?.topics);
  if (domains.length < 1 || domains.length > MAX_DOMAINS || domains.some((domain) => !isValidBacklinkDomain(domain))) {
    return error("INVALID_DOMAINS", "Choose between 1 and 10 valid root domains.", 400);
  }
  if (topics.length < 1 || topics.length > MAX_TOPICS || topics.some((topic) => topic.length > MAX_TOPIC_LENGTH)) {
    return error("INVALID_TOPICS", "Choose between 1 and 10 short target topics.", 400);
  }

  const fetchImpl = data.fetchImpl ?? fetch;
  const metricsByDomain = new Map((Array.isArray(body?.items) ? body.items : [])
    .map((item) => [normalizeBacklinkDomain(item?.domain), item?.metrics ?? {}]));
  const items = await Promise.all(domains.map(async (domain) => {
    const key = relevanceCacheKey(domain);
    let evidence;
    let cached = false;
    try {
      evidence = await env.CACHE.get(key, "json");
      cached = Boolean(evidence);
    } catch {
      return { domain, cached: false, relevance: classifyWebsiteRelevance({ domain, unavailable_reason: "cache_unavailable" }, topics) };
    }
    if (!evidence) {
      try {
        evidence = await fetchPublicSiteEvidence(domain, fetchImpl);
      } catch (fetchError) {
        evidence = {
          domain,
          unavailable_reason: fetchError instanceof Error ? fetchError.message.slice(0, 160) : "unavailable",
          fetched_at: new Date().toISOString(),
        };
      }
      try {
        await env.CACHE.put(key, JSON.stringify(evidence), { expirationTtl: CACHE_TTL_SECONDS });
      } catch {
        // The result remains usable even when cache storage is temporarily unavailable.
      }
    }
    return { domain, cached, evidence, relevance: classifyWebsiteRelevance(evidence, topics) };
  }));
  const networks = detectPossibleSiteNetwork(items.map((item) => item.evidence ?? { domain: item.domain }));
  for (const item of items) {
    if (networks[item.domain]) item.network_risk = networks[item.domain];
    const quality = assessBacklinkOutreach({ domain: item.domain, metrics: metricsByDomain.get(item.domain) ?? {} });
    item.outreach = combineOutreachAssessment(quality, item.relevance, item.network_risk);
    delete item.evidence;
  }
  return json({
    ok: true,
    data: { topics, items },
    meta: { source: "public_web", actual_cost_usd: 0, cache_ttl_days: 7, duration_ms: Date.now() - startedAt },
  });
}

export function onRequestGet() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for website relevance checks." } }, 405, { Allow: "POST" });
}
