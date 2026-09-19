import { buildGoogleAuthorizationUrl } from "../../../../../src/v2/providers/google-oauth.js";
import { createGscOauthState } from "../../../../../src/v2/gsc/oauth-state.js";
import { gscJson, gscMappedError, requireGscAccess } from "../../../../../src/v2/gsc/http.js";

export async function onRequestGet({ request, env }) {
  const denied = requireGscAccess(request);
  if (denied) return denied;
  if (!env?.CACHE) return gscJson({ ok: false, error: { code: "GSC_CACHE_MISSING", message: "OAuth state cache is not configured." } }, 503);
  try {
    const redirectUri = String(env.GOOGLE_OAUTH_REDIRECT_URI || new URL("/api/v2/gsc/connect/callback", request.url).toString()).trim();
    const state = await createGscOauthState(env.CACHE, { redirectUri });
    const location = buildGoogleAuthorizationUrl({
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      redirectUri,
      state: state.state,
      promptConsent: true,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: location, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return gscMappedError(error, "GSC_CONNECT_START_FAILED");
  }
}

export function onRequestPost() {
  return gscJson({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use GET to start Google OAuth." } }, 405, { Allow: "GET" });
}
