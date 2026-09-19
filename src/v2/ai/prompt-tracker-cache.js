export const PROMPT_RESULT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const PROMPT_MODELS_CACHE_TTL_SECONDS = 24 * 60 * 60;

function text(value) {
  return String(value ?? "").trim();
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildPromptModelsCacheKey(platform) {
  return ["v2", "ai-prompt", "models", text(platform).toLowerCase()].join(":");
}

export async function buildPromptResultCacheKey({
  target,
  platform,
  modelName,
  prompt,
  webSearch,
  countryIsoCode,
  maxOutputTokens,
}) {
  const scope = JSON.stringify({
    target: text(target).toLowerCase(),
    platform: text(platform).toLowerCase(),
    model_name: text(modelName),
    prompt: text(prompt),
    web_search: webSearch === true,
    country_iso_code: text(countryIsoCode).toUpperCase(),
    max_output_tokens: Number(maxOutputTokens) || 0,
  });
  return "v2:ai-prompt:result:" + await sha256(scope);
}

export async function readPromptModelsCache(cache, platform) {
  if (!cache?.get) return null;
  const key = buildPromptModelsCacheKey(platform);
  const entry = await cache.get(key, "json");
  if (!entry) return null;
  return {
    key,
    data: entry?.data ?? entry,
    cached_at: entry?.cached_at ?? null,
  };
}

export async function writePromptModelsCache(cache, platform, data, {
  cachedAt = new Date().toISOString(),
  ttlSeconds = PROMPT_MODELS_CACHE_TTL_SECONDS,
} = {}) {
  if (!cache?.put) throw new TypeError("Prompt models cache binding is required.");
  const key = buildPromptModelsCacheKey(platform);
  await cache.put(key, JSON.stringify({ data, cached_at: cachedAt }), { expirationTtl: ttlSeconds });
  return { key, cached_at: cachedAt, ttl_seconds: ttlSeconds };
}

export async function readPromptResultCache(cache, input) {
  if (!cache?.get) return null;
  const key = await buildPromptResultCacheKey(input);
  const entry = await cache.get(key, "json");
  if (!entry) return null;
  return {
    key,
    data: entry?.data ?? entry,
    cached_at: entry?.cached_at ?? entry?.data?.generated_at ?? null,
  };
}

export async function writePromptResultCache(cache, input, data, {
  cachedAt = new Date().toISOString(),
  ttlSeconds = PROMPT_RESULT_CACHE_TTL_SECONDS,
} = {}) {
  if (!cache?.put) throw new TypeError("Prompt result cache binding is required.");
  const key = await buildPromptResultCacheKey(input);
  await cache.put(key, JSON.stringify({ data, cached_at: cachedAt }), { expirationTtl: ttlSeconds });
  return { key, cached_at: cachedAt, ttl_seconds: ttlSeconds };
}
