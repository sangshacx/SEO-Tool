import { decryptSecret } from "../../../../src/v2/security/secret-crypto.js";
import { revokeGoogleToken } from "../../../../src/v2/providers/google-oauth.js";
import { deleteGscConnection, readGscConnection } from "../../../../src/v2/storage/gsc-connections.js";
import { gscJson, gscMappedError, requireGscAccess } from "../../../../src/v2/gsc/http.js";

export async function onRequestPost({ request, env }) {
  const denied = requireGscAccess(request); if (denied) return denied;
  if (!env?.DB) return gscJson({ ok: false, error: { code: "GSC_DB_MISSING", message: "D1 binding is not configured." } }, 503);
  try {
    const connection = await readGscConnection(env.DB);
    let revoke_warning = null;
    if (connection) {
      try {
        const refreshToken = await decryptSecret({
          ciphertext: connection.refresh_token_ciphertext, iv: connection.refresh_token_iv, version: connection.encryption_version,
        }, env.GSC_TOKEN_ENCRYPTION_KEY);
        await revokeGoogleToken(refreshToken);
      } catch (error) {
        revoke_warning = "Google token revocation could not be confirmed; local credentials were removed."; 
        console.error(JSON.stringify({ message: "GSC revoke warning", error: error instanceof Error ? error.message : String(error) }));
      }
    }
    await deleteGscConnection(env.DB);
    return gscJson({ ok: true, data: { connected: false, revoke_warning }, meta: { actual_cost_usd: 0, provider_requests: connection ? 1 : 0 } });
  } catch (error) { return gscMappedError(error, "GSC_DISCONNECT_FAILED"); }
}
