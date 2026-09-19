import { readGscConnection, listGscMappings } from "../../../../src/v2/storage/gsc-connections.js";
import { gscJson, gscMappedError, requireGscAccess } from "../../../../src/v2/gsc/http.js";

export async function onRequestGet({ request, env }) {
  const denied = requireGscAccess(request);
  if (denied) return denied;
  if (!env?.DB) return gscJson({ ok: false, error: { code: "GSC_DB_MISSING", message: "D1 binding is not configured." } }, 503);
  try {
    const [connection, mappings] = await Promise.all([readGscConnection(env.DB), listGscMappings(env.DB)]);
    return gscJson({
      ok: true,
      data: {
        connected: Boolean(connection),
        scope: connection?.scope ?? null,
        token_type: connection?.token_type ?? null,
        connected_at: connection?.connected_at ?? null,
        updated_at: connection?.updated_at ?? null,
        mappings,
        oauth_configured: Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GSC_TOKEN_ENCRYPTION_KEY),
      },
      meta: { actual_cost_usd: 0, provider_requests: 0 },
    });
  } catch (error) {
    return gscMappedError(error, "GSC_STATUS_FAILED");
  }
}
