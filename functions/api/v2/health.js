const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

export async function onRequestGet({ env }) {
  const startedAt = Date.now();
  const login = env.DATAFORSEO_LOGIN;
  const password = env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    return jsonResponse(
      {
        ok: false,
        service: "seo-pro-v2",
        provider: "dataforseo",
        configured: false,
        authenticated: false,
        error: {
          code: "PROVIDER_CREDENTIALS_MISSING",
          message: "DataForSEO Preview secrets are not configured.",
        },
        timestamp: new Date().toISOString(),
      },
      503,
    );
  }

  try {
    const authorization = btoa(`${login}:${password}`);
    const response = await fetch(
      "https://api.dataforseo.com/v3/appendix/user_data",
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${authorization}`,
          Accept: "application/json",
        },
      },
    );

    const data = await response.json();
    const authenticated =
      response.ok && data.status_code === 20000;

    return jsonResponse(
      {
        ok: authenticated,
        service: "seo-pro-v2",
        provider: "dataforseo",
        configured: true,
        authenticated,
        provider_status: {
          http_status: response.status,
          code: data.status_code ?? null,
          message: data.status_message ?? null,
        },
        duration_ms: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      authenticated ? 200 : 502,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        service: "seo-pro-v2",
        provider: "dataforseo",
        configured: true,
        authenticated: false,
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: "Unable to verify DataForSEO authentication.",
        },
        duration_ms: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      502,
    );
  }
}
