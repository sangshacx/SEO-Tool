import { readBoundedJson } from "./bounded-json.js";

export const LLM_RESPONSE_PLATFORMS = Object.freeze(["chat_gpt", "claude", "gemini", "perplexity"]);

const PLATFORM_ENDPOINTS = Object.freeze({
  chat_gpt: {
    live: "https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/live",
    models: "https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/models",
    supports_web_search_flag: true,
    supports_web_search_country: true,
  },
  claude: {
    live: "https://api.dataforseo.com/v3/ai_optimization/claude/llm_responses/live",
    models: "https://api.dataforseo.com/v3/ai_optimization/claude/llm_responses/models",
    supports_web_search_flag: true,
    supports_web_search_country: true,
  },
  gemini: {
    live: "https://api.dataforseo.com/v3/ai_optimization/gemini/llm_responses/live",
    models: "https://api.dataforseo.com/v3/ai_optimization/gemini/llm_responses/models",
    supports_web_search_flag: true,
    supports_web_search_country: false,
  },
  perplexity: {
    live: "https://api.dataforseo.com/v3/ai_optimization/perplexity/llm_responses/live",
    models: "https://api.dataforseo.com/v3/ai_optimization/perplexity/llm_responses/models",
    supports_web_search_flag: false,
    supports_web_search_country: true,
  },
});

export class LlmPromptProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "LlmPromptProviderError";
    this.code = details.code ?? "LLM_PROMPT_PROVIDER_ERROR";
    this.httpStatus = details.httpStatus ?? 502;
    this.providerStatus = details.providerStatus ?? null;
    this.actualCostUsd = details.actualCostUsd ?? null;
  }
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boundedText(value, maxLength) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() + "…" : text;
}

function normalizeTargetDomain(value) {
  let raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  try {
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    const url = new URL(raw);
    const domain = url.hostname.replace(/^www\./, "").replace(/\.$/, "");
    return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)
      ? domain
      : null;
  } catch {
    return null;
  }
}

export function normalizeLlmPromptPlatform(value) {
  const platform = String(value ?? "").trim().toLowerCase();
  if (!LLM_RESPONSE_PLATFORMS.includes(platform)) {
    throw new LlmPromptProviderError("Choose a supported LLM response platform.", {
      code: "INVALID_LLM_PLATFORM",
      httpStatus: 400,
    });
  }
  return platform;
}

export function normalizeLlmPrompt(value) {
  const prompt = String(value ?? "").trim();
  if (!prompt || prompt.length > 500) {
    throw new LlmPromptProviderError("Prompt must contain 1 to 500 characters.", {
      code: "INVALID_LLM_PROMPT",
      httpStatus: 400,
    });
  }
  return prompt;
}

export function normalizeLlmModelName(value) {
  const model = String(value ?? "").trim();
  if (!model || model.length > 160 || !/^[a-z0-9][a-z0-9._:-]*$/i.test(model)) {
    throw new LlmPromptProviderError("Choose a valid LLM model.", {
      code: "INVALID_LLM_MODEL",
      httpStatus: 400,
    });
  }
  return model;
}

function normalizeCountryIso(value) {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function basicAuth(login, password) {
  return "Basic " + btoa(login + ":" + password);
}

function requireCredentials(login, password) {
  if (!login || !password) {
    throw new LlmPromptProviderError("DataForSEO credentials are not configured.", {
      code: "PROVIDER_CREDENTIALS_MISSING",
      httpStatus: 503,
    });
  }
}

function providerError({ response, payload, providerTask, actualCostUsd, message }) {
  if (!response.ok || payload?.status_code !== 20000 || providerTask?.status_code !== 20000) {
    throw new LlmPromptProviderError(message, {
      code: "PROVIDER_REQUEST_FAILED",
      providerStatus: providerTask?.status_code ?? payload?.status_code ?? response.status,
      actualCostUsd,
    });
  }
}

export async function fetchLlmResponseModels({ login, password, platform }) {
  requireCredentials(login, password);
  const normalizedPlatform = normalizeLlmPromptPlatform(platform);
  const config = PLATFORM_ENDPOINTS[normalizedPlatform];

  const response = await fetch(config.models, {
    method: "GET",
    headers: {
      Authorization: basicAuth(login, password),
      Accept: "application/json",
    },
  });

  let payload;
  try {
    payload = await readBoundedJson(response);
  } catch (error) {
    throw new LlmPromptProviderError("DataForSEO returned an invalid LLM models response.", {
      code: error?.code ?? "PROVIDER_INVALID_RESPONSE",
      providerStatus: response.status,
    });
  }

  const providerTask = payload?.tasks?.[0];
  const actualCostUsd = finite(payload?.cost) ?? finite(providerTask?.cost) ?? 0;
  providerError({
    response,
    payload,
    providerTask,
    actualCostUsd,
    message: "DataForSEO could not load the LLM model list.",
  });

  const models = (Array.isArray(providerTask?.result) ? providerTask.result : [])
    .map((item) => ({
      model_name: typeof item?.model_name === "string" ? item.model_name : null,
      reasoning: Boolean(item?.reasoning),
      web_search_supported: Boolean(item?.web_search_supported),
      task_post_supported: Boolean(item?.task_post_supported),
    }))
    .filter((item) => item.model_name);

  return {
    data: {
      platform: normalizedPlatform,
      models,
      generated_at: new Date().toISOString(),
      actual_cost_usd: 0,
    },
    actualCostUsd,
    resultCount: models.length,
  };
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function annotationRows(items = []) {
  const rows = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.type !== "message") continue;
    for (const section of Array.isArray(item?.sections) ? item.sections : []) {
      if (section?.type !== "text") continue;
      for (const annotation of Array.isArray(section?.annotations) ? section.annotations : []) {
        const url = typeof annotation?.url === "string" ? annotation.url.trim() : "";
        const key = url || [annotation?.title, annotation?.text].join("|");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push({
          title: boundedText(annotation?.title, 300),
          url: /^https?:\/\//i.test(url) ? url : null,
          domain: /^https?:\/\//i.test(url) ? hostnameFromUrl(url) : null,
          text: boundedText(annotation?.text, 600),
        });
        if (rows.length >= 20) return rows;
      }
    }
  }
  return rows;
}

function responseText(items = []) {
  const sections = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.type !== "message") continue;
    for (const section of Array.isArray(item?.sections) ? item.sections : []) {
      if (section?.type !== "text") continue;
      const text = boundedText(section?.text, 8000);
      if (text) sections.push(text);
    }
  }
  return boundedText(sections.join("\n\n"), 8000);
}

function targetSignals({ target, answer, annotations }) {
  const domain = normalizeTargetDomain(target);
  if (!domain) return { target_domain: null, target_domain_mentioned: null, target_domain_cited: null };
  const normalizedAnswer = String(answer ?? "").toLowerCase();
  return {
    target_domain: domain,
    target_domain_mentioned: normalizedAnswer.includes(domain),
    target_domain_cited: annotations.some((row) =>
      row.domain === domain || row.domain?.endsWith("." + domain)
    ),
  };
}

export async function fetchLlmPromptResponse({
  login,
  password,
  platform,
  userPrompt,
  modelName,
  target,
  maxOutputTokens = 1024,
  webSearch = true,
  countryIsoCode = null,
}) {
  requireCredentials(login, password);
  const normalizedPlatform = normalizeLlmPromptPlatform(platform);
  const prompt = normalizeLlmPrompt(userPrompt);
  const model = normalizeLlmModelName(modelName);
  const config = PLATFORM_ENDPOINTS[normalizedPlatform];
  const outputTokens = Number(maxOutputTokens);
  if (!Number.isInteger(outputTokens) || outputTokens < 16 || outputTokens > 4096) {
    throw new LlmPromptProviderError("max_output_tokens must be between 16 and 4096.", {
      code: "INVALID_MAX_OUTPUT_TOKENS",
      httpStatus: 400,
    });
  }

  const task = {
    user_prompt: prompt,
    model_name: model,
    max_output_tokens: outputTokens,
    tag: "seo-pro-v2-prompt-test",
  };
  if (config.supports_web_search_flag) task.web_search = webSearch === true;
  const country = normalizeCountryIso(countryIsoCode);
  if (country && config.supports_web_search_country && (normalizedPlatform === "perplexity" || webSearch === true)) {
    task.web_search_country_iso_code = country;
  }

  const response = await fetch(config.live, {
    method: "POST",
    headers: {
      Authorization: basicAuth(login, password),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify([task]),
  });

  let payload;
  try {
    payload = await readBoundedJson(response);
  } catch (error) {
    throw new LlmPromptProviderError("DataForSEO returned an invalid LLM prompt response.", {
      code: error?.code ?? "PROVIDER_INVALID_RESPONSE",
      providerStatus: response.status,
    });
  }

  const providerTask = payload?.tasks?.[0];
  const result = providerTask?.result?.[0] ?? null;
  const actualCostUsd = finite(payload?.cost) ?? finite(providerTask?.cost);
  providerError({
    response,
    payload,
    providerTask,
    actualCostUsd,
    message: "DataForSEO could not complete the LLM prompt test.",
  });

  const annotations = annotationRows(result?.items);
  const answer = responseText(result?.items);
  const signals = targetSignals({ target, answer, annotations });

  return {
    data: {
      platform: normalizedPlatform,
      requested_model: model,
      model_name: result?.model_name ?? model,
      prompt,
      answer,
      annotations,
      fan_out_queries: (Array.isArray(result?.fan_out_queries) ? result.fan_out_queries : [])
        .slice(0, 12)
        .map((value) => boundedText(typeof value === "string" ? value : value?.query, 300))
        .filter(Boolean),
      input_tokens: finite(result?.input_tokens),
      output_tokens: finite(result?.output_tokens),
      reasoning_tokens: finite(result?.reasoning_tokens),
      web_search: typeof result?.web_search === "boolean" ? result.web_search : normalizedPlatform === "perplexity" ? true : null,
      model_money_spent_usd: finite(result?.money_spent),
      datetime: result?.datetime ?? null,
      ...signals,
      generated_at: new Date().toISOString(),
      disclaimer:
        "Prompt Test is a single-model observation. The response can vary between runs and does not represent universal AI visibility. Reasoning content is intentionally not stored or exposed.",
    },
    actualCostUsd,
    taskCount: Number.isInteger(payload?.tasks_count) ? payload.tasks_count : 1,
    resultCount: result ? 1 : 0,
  };
}

export function llmPromptEndpointFor(platform, kind = "live") {
  const normalizedPlatform = normalizeLlmPromptPlatform(platform);
  return PLATFORM_ENDPOINTS[normalizedPlatform][kind] ?? null;
}
