import { GSC_READONLY_SCOPE, exchangeGoogleAuthorizationCode } from "../../../../../src/v2/providers/google-oauth.js";
import { encryptSecret } from "../../../../../src/v2/security/secret-crypto.js";
import { consumeGscOauthState } from "../../../../../src/v2/gsc/oauth-state.js";
import { saveGscConnection } from "../../../../../src/v2/storage/gsc-connections.js";
import { gscJson, gscMappedError, requireGscAccess } from "../../../../../src/v2/gsc/http.js";

function finishUrl(redirectUri, state, code) {
  const origin = new URL(redirectUri).origin;
  const url = new URL("/", origin);
  url.searchParams.set("gsc", state);
  if (code) url.searchParams.set("code", code);
  url.hash = "settings";
  return url.toString();
}

export async function onRequestGet({ request, env }) {
  const denied = requireGscAccess(request, { allowCrossSiteNavigation: true });
  if (denied) return denied;
  if (!env?.CACHE || !env?.DB) return gscJson({ ok: false, error: { code: "GSC_BINDINGS_MISSING", message: "GSC storage bindings are not configured." } }, 503);
  const url = new URL(request.url);
  const stateValue = url.searchParams.get("state");
  let stateRecord;
  try { stateRecord = await consumeGscOauthState(env.CACHE, stateValue); }
  catch (error) { return gscMappedError(error, "GSC_OAUTH_STATE_FAILED"); }
  if (!stateRecord) return gscJson({ ok: false, error: { code: "GSC_OAUTH_STATE_INVALID", message: "OAuth state is invalid, expired, or already used." } }, 400);
  if (url.searchParams.get("error")) {
    return Response.redirect(finishUrl(stateRecord.redirect_uri, "error", "GOOGLE_AUTH_DENIED"), 302);
  }
  const code = url.searchParams.get("code");
  if (!code) return Response.redirect(finishUrl(stateRecord.redirect_uri, "error", "GOOGLE_AUTH_CODE_MISSING"), 302);
  try {
    const token = await exchangeGoogleAuthorizationCode({
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      code,
      redirectUri: stateRecord.redirect_uri,
    });
    if (!token.refresh_token) {
      const error = new Error("Google did not return an offline refresh token.");
      error.code = "GSC_REFRESH_TOKEN_NOT_RETURNED";
      error.httpStatus = 409;
      throw error;
    }
    const encrypted = await encryptSecret(token.refresh_token, env.GSC_TOKEN_ENCRYPTION_KEY);
    await saveGscConnection(env.DB, {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      version: encrypted.version,
      scope: token.scope || GSC_READONLY_SCOPE,
      tokenType: token.token_type,
    });
    return Response.redirect(finishUrl(stateRecord.redirect_uri, "connected"), 302);
  } catch (error) {
    const mapped = gscMappedError(error, "GSC_OAUTH_CALLBACK_FAILED");
    if (mapped.status >= 500) return mapped;
    return Response.redirect(finishUrl(stateRecord.redirect_uri, "error", error?.code || "GSC_OAUTH_CALLBACK_FAILED"), 302);
  }
}
