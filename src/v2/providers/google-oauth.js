import { readBoundedJson } from "./bounded-json.js";

export const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
export const GSC_READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export class GoogleOauthError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "GoogleOauthError";
    this.code = details.code ?? "GOOGLE_OAUTH_ERROR";
    this.httpStatus = details.httpStatus ?? 502;
    this.providerStatus = details.providerStatus ?? null;
  }
}

function requireValue(value, code, message) {
  if (typeof value !== "string" || !value.trim()) {
    throw new GoogleOauthError(message, { code, httpStatus: 503 });
  }
  return value.trim();
}

export function buildGoogleAuthorizationUrl({ clientId, redirectUri, state, promptConsent = true }) {
  const id = requireValue(clientId, "GOOGLE_CLIENT_ID_MISSING", "Google OAuth client ID is not configured.");
  const redirect = requireValue(redirectUri, "GOOGLE_REDIRECT_URI_MISSING", "Google OAuth redirect URI is required.");
  const stateValue = requireValue(state, "GOOGLE_OAUTH_STATE_MISSING", "Google OAuth state is required.");
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", id);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GSC_READONLY_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", stateValue);
  if (promptConsent) url.searchParams.set("prompt", "consent");
  return url.toString();
}

async function tokenRequest(params) {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  let payload;
  try { payload = await readBoundedJson(response); }
  catch (error) {
    throw new GoogleOauthError("Google OAuth returned an invalid response.", {
      code: error?.code ?? "GOOGLE_OAUTH_INVALID_RESPONSE",
      providerStatus: response.status,
    });
  }
  if (!response.ok || payload?.error) {
    throw new GoogleOauthError(payload?.error_description || payload?.error || "Google OAuth token request failed.", {
      code: "GOOGLE_OAUTH_TOKEN_REQUEST_FAILED",
      httpStatus: response.status === 400 ? 400 : 502,
      providerStatus: response.status,
    });
  }
  return {
    access_token: typeof payload.access_token === "string" ? payload.access_token : null,
    refresh_token: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    expires_in: Number.isFinite(Number(payload.expires_in)) ? Number(payload.expires_in) : null,
    scope: typeof payload.scope === "string" ? payload.scope : null,
    token_type: typeof payload.token_type === "string" ? payload.token_type : null,
  };
}

export async function exchangeGoogleAuthorizationCode({ clientId, clientSecret, code, redirectUri }) {
  const result = await tokenRequest({
    client_id: requireValue(clientId, "GOOGLE_CLIENT_ID_MISSING", "Google OAuth client ID is not configured."),
    client_secret: requireValue(clientSecret, "GOOGLE_CLIENT_SECRET_MISSING", "Google OAuth client secret is not configured."),
    code: requireValue(code, "GOOGLE_AUTH_CODE_MISSING", "Google OAuth authorization code is required."),
    grant_type: "authorization_code",
    redirect_uri: requireValue(redirectUri, "GOOGLE_REDIRECT_URI_MISSING", "Google OAuth redirect URI is required."),
  });
  if (!result.access_token) throw new GoogleOauthError("Google OAuth did not return an access token.", { code: "GOOGLE_ACCESS_TOKEN_MISSING", httpStatus: 502 });
  return result;
}

export async function refreshGoogleAccessToken({ clientId, clientSecret, refreshToken }) {
  const result = await tokenRequest({
    client_id: requireValue(clientId, "GOOGLE_CLIENT_ID_MISSING", "Google OAuth client ID is not configured."),
    client_secret: requireValue(clientSecret, "GOOGLE_CLIENT_SECRET_MISSING", "Google OAuth client secret is not configured."),
    refresh_token: requireValue(refreshToken, "GOOGLE_REFRESH_TOKEN_MISSING", "Google OAuth refresh token is required."),
    grant_type: "refresh_token",
  });
  if (!result.access_token) throw new GoogleOauthError("Google OAuth did not return a refreshed access token.", { code: "GOOGLE_ACCESS_TOKEN_MISSING", httpStatus: 502 });
  return result;
}

export async function revokeGoogleToken(token) {
  const value = requireValue(token, "GOOGLE_REVOKE_TOKEN_MISSING", "A Google OAuth token is required.");
  const response = await fetch(GOOGLE_REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: value }).toString(),
  });
  if (!response.ok) {
    throw new GoogleOauthError("Google OAuth token revocation failed.", {
      code: "GOOGLE_TOKEN_REVOCATION_FAILED",
      httpStatus: 502,
      providerStatus: response.status,
    });
  }
  return true;
}
