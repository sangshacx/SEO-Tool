const DATAFORSEO_BASE_URL = "https://api.dataforseo.com/v3";

export class DataForSEOProviderError extends Error {
  constructor(message, { code, httpStatus = 502, providerStatus = null } = {}) {
    super(message);
    this.name = "DataForSEOProviderError";
    this.code = code ?? "DATAFORSEO_ERROR";
    this.httpStatus = httpStatus;
    this.providerStatus = providerStatus;
  }
}

function getAuthorization(env) {
  const login = env.DATAFORSEO_LOGIN;
  const password = env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    throw new DataForSEOProviderError(
      "DataForSEO credentials are not configured.",
      {
        code: "PROVIDER_CREDENTIALS_MISSING",
        httpStatus: 503,
      },
    );
  }

  return `Basic ${btoa(`${login}:${password}`)}`;
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    throw new DataForSEOProviderError(
      "DataForSEO returned an invalid JSON response.",
      {
        code: "PROVIDER_INVALID_RESPONSE",
        httpStatus: 502,
        providerStatus: response.status,
      },
    );
  }
}

export async function fetchKeywordOverview({
  env,
  keyword,
  locationCode,
  languageCode,
  includeSerpInfo = false,
}) {
  const response = await fetch(
    `${DATAFORSEO_BASE_URL}/dataforseo_labs/google/keyword_overview/live`,
    {
      method: "POST",
      headers: {
        Authorization: getAuthorization(env),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify([
        {
          keywords: [keyword],
          location_code: locationCode,
          language_code: languageCode,
          include_clickstream_data: false,
          include_serp_info: includeSerpInfo === true,
          tag: includeSerpInfo
            ? "seo-pro-v2-serp-weakness"
            : "seo-pro-v2-keyword-overview",
        },
      ]),
    },
  );

  const payload = await parseJson(response);
  const task = payload.tasks?.[0] ?? null;
  const providerStatus = {
    http_status: response.status,
    code: task?.status_code ?? payload.status_code ?? null,
    message: task?.status_message ?? payload.status_message ?? null,
  };

  if (
    !response.ok ||
    payload.status_code !== 20000 ||
    !task ||
    task.status_code !== 20000
  ) {
    throw new DataForSEOProviderError(
      "DataForSEO could not complete the keyword overview request.",
      {
        code: "PROVIDER_REQUEST_FAILED",
        httpStatus: 502,
        providerStatus,
      },
    );
  }

  return {
    payload,
    task,
    result: task.result?.[0] ?? null,
    usage: {
      actual_cost_usd:
        typeof payload.cost === "number"
          ? payload.cost
          : typeof task.cost === "number"
            ? task.cost
            : null,
      task_count: payload.tasks_count ?? 1,
      result_count: task.result_count ?? 0,
    },
    providerStatus,
  };
}
