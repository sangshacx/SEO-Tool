import { listGscProperties } from "../../../../src/v2/providers/google-search-console.js";
import { getGscAccessToken } from "../../../../src/v2/gsc/connection-service.js";
import { listGscMappings } from "../../../../src/v2/storage/gsc-connections.js";
import { gscJson, gscMappedError, requireGscAccess } from "../../../../src/v2/gsc/http.js";

export async function onRequestGet({ request, env }) {
  const denied = requireGscAccess(request);
  if (denied) return denied;
  try {
    const token = await getGscAccessToken(env);
    const [properties, mappings] = await Promise.all([
      listGscProperties({ accessToken: token.accessToken }),
      listGscMappings(env.DB),
    ]);
    return gscJson({
      ok: true,
      data: { properties: properties.properties, mappings },
      meta: { actual_cost_usd: 0, provider_requests: 1 },
    });
  } catch (error) {
    return gscMappedError(error, "GSC_PROPERTIES_FAILED");
  }
}
