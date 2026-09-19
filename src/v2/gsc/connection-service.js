import { decryptSecret } from "../security/secret-crypto.js";
import { refreshGoogleAccessToken } from "../providers/google-oauth.js";
import { readGscConnection } from "../storage/gsc-connections.js";

function required(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error(name + " is not configured.");
    error.code = "GSC_CONFIGURATION_MISSING";
    error.httpStatus = 503;
    throw error;
  }
  return value.trim();
}

export async function getGscAccessToken(env) {
  if (!env?.DB) {
    const error = new Error("D1 binding is not configured.");
    error.code = "GSC_DB_MISSING";
    error.httpStatus = 503;
    throw error;
  }
  const connection = await readGscConnection(env.DB);
  if (!connection) {
    const error = new Error("Google Search Console is not connected.");
    error.code = "GSC_NOT_CONNECTED";
    error.httpStatus = 409;
    throw error;
  }
  const refreshToken = await decryptSecret({
    ciphertext: connection.refresh_token_ciphertext,
    iv: connection.refresh_token_iv,
    version: connection.encryption_version,
  }, required(env.GSC_TOKEN_ENCRYPTION_KEY, "GSC_TOKEN_ENCRYPTION_KEY"));
  const token = await refreshGoogleAccessToken({
    clientId: required(env.GOOGLE_OAUTH_CLIENT_ID, "GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: required(env.GOOGLE_OAUTH_CLIENT_SECRET, "GOOGLE_OAUTH_CLIENT_SECRET"),
    refreshToken,
  });
  return { accessToken: token.access_token, refreshToken, connection };
}
