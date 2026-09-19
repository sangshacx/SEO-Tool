const PREFIX = "v2:gsc:oauth-state:";
const TTL_SECONDS = 600;

function randomState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createGscOauthState(cache, { redirectUri, now = new Date().toISOString() } = {}) {
  if (!cache?.put) throw new TypeError("OAuth state cache is not configured.");
  if (typeof redirectUri !== "string" || !redirectUri.trim()) throw new TypeError("OAuth redirect URI is required.");
  const state = randomState();
  await cache.put(PREFIX + state, JSON.stringify({ redirect_uri: redirectUri.trim(), issued_at: now }), { expirationTtl: TTL_SECONDS });
  return { state, expires_in: TTL_SECONDS };
}

export async function consumeGscOauthState(cache, state) {
  if (!cache?.get || !cache?.delete) throw new TypeError("OAuth state cache is not configured.");
  const value = String(state ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(value)) return null;
  const key = PREFIX + value;
  const record = await cache.get(key, "json");
  if (!record) return null;
  await cache.delete(key);
  if (typeof record.redirect_uri !== "string" || !record.redirect_uri) return null;
  return record;
}
