export const AI_VISIBILITY_CACHE_TTL_SECONDS = 14 * 24 * 60 * 60;

function clean(value) {
  return encodeURIComponent(String(value ?? "").trim().toLowerCase());
}

export function buildAiVisibilityCacheKey({
  target,
  platform,
  locationCode,
  languageCode,
  view = "target",
  limit = null,
}) {
  const parts = [
    "v2",
    "ai-visibility",
    clean(view),
    clean(target),
    clean(platform),
    String(Number(locationCode) || 0),
    clean(languageCode),
  ];
  if (limit !== null && limit !== undefined) parts.push(String(Number(limit) || 0));
  return parts.join(":");
}

export async function readAiVisibilityCache(cache, input) {
  if (!cache?.get) return null;
  const key = buildAiVisibilityCacheKey(input);
  const entry = await cache.get(key, "json");
  if (!entry) return null;
  const data = entry && typeof entry === "object" && Object.hasOwn(entry, "data")
    ? entry.data
    : entry;
  return {
    key,
    data,
    cached_at: entry?.cached_at ?? data?.generated_at ?? null,
  };
}

export async function writeAiVisibilityCache(cache, input, data, {
  cachedAt = new Date().toISOString(),
  ttlSeconds = AI_VISIBILITY_CACHE_TTL_SECONDS,
} = {}) {
  if (!cache?.put) throw new TypeError("AI visibility cache binding is required.");
  const key = buildAiVisibilityCacheKey(input);
  await cache.put(
    key,
    JSON.stringify({ data, cached_at: cachedAt }),
    { expirationTtl: ttlSeconds },
  );
  return { key, cached_at: cachedAt, ttl_seconds: ttlSeconds };
}
