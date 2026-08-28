const DATAFORSEO_URL = "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live";

export class KeywordIdeasProviderError extends Error {
  constructor(message, { code = "KEYWORD_IDEAS_PROVIDER_ERROR", httpStatus = 502, providerStatus = null } = {}) {
    super(message);
    this.name = "KeywordIdeasProviderError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.providerStatus = providerStatus;
  }
}

function authorization(env) {
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
    throw new KeywordIdeasProviderError("DataForSEO credentials are not configured.", {
      code: "PROVIDER_CREDENTIALS_MISSING",
      httpStatus: 503,
    });
  }
  return "Basic " + btoa(env.DATAFORSEO_LOGIN + ":" + env.DATAFORSEO_PASSWORD);
}

export async function fetchKeywordIdeas({ env, seedKeyword, locationCode, languageCode, limit }) {
  const response = await fetch(DATAFORSEO_URL, {
    method: "POST",
    headers: {
      Authorization: authorization(env),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify([{
      keywords: [seedKeyword],
      location_code: locationCode,
      language_code: languageCode,
      limit,
      include_serp_info: false,
      include_clickstream_data: false,
      order_by: ["keyword_info.search_volume,desc", "keyword_properties.keyword_difficulty,asc"],
      tag: "seo-pro-v2-keyword-ideas",
    }]),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new KeywordIdeasProviderError("DataForSEO returned invalid JSON.", {
      code: "PROVIDER_INVALID_RESPONSE",
      providerStatus: response.status,
    });
  }

  const task = payload.tasks?.[0] ?? null;
  const providerStatus = {
    http_status: response.status,
    code: task?.status_code ?? payload.status_code ?? null,
    message: task?.status_message ?? payload.status_message ?? null,
  };

  if (!response.ok || payload.status_code !== 20000 || !task || task.status_code !== 20000) {
    throw new KeywordIdeasProviderError("DataForSEO could not complete the keyword ideas request.", {
      code: "PROVIDER_REQUEST_FAILED",
      providerStatus,
    });
  }

  const result = task.result?.[0] ?? null;
  return {
    items: Array.isArray(result?.items) ? result.items : [],
    usage: {
      actual_cost_usd: typeof payload.cost === "number" ? payload.cost : (typeof task.cost === "number" ? task.cost : null),
      task_count: payload.tasks_count ?? 1,
      result_count: task.result_count ?? result?.items?.length ?? 0,
    },
    providerStatus,
  };
}
