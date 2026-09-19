import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchLlmPromptResponse,
  fetchLlmResponseModels,
  llmPromptEndpointFor,
  normalizeLlmPrompt,
  normalizeLlmPromptPlatform,
} from "../src/v2/providers/dataforseo-llm-responses.js";

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("LLM model list uses the free models endpoint and normalizes capabilities", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return response({
      status_code: 20000,
      cost: 0,
      tasks_count: 1,
      tasks: [{
        status_code: 20000,
        cost: 0,
        result_count: 2,
        result: [
          { model_name: "gpt-4.1-mini", reasoning: false, web_search_supported: true, task_post_supported: true },
          { model_name: "o3-mini", reasoning: true, web_search_supported: false, task_post_supported: true },
        ],
      }],
    });
  };

  const result = await fetchLlmResponseModels({
    login: "login",
    password: "password",
    platform: "chat_gpt",
  });

  assert.equal(captured.url, llmPromptEndpointFor("chat_gpt", "models"));
  assert.equal(captured.options.method, "GET");
  assert.equal(result.actualCostUsd, 0);
  assert.equal(result.data.models.length, 2);
  assert.deepEqual(result.data.models[0], {
    model_name: "gpt-4.1-mini",
    reasoning: false,
    web_search_supported: true,
    task_post_supported: true,
  });
});

test("LLM Prompt Test sends one bounded live task and excludes reasoning content from normalized output", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return response({
      status_code: 20000,
      cost: 0.0042,
      tasks_count: 1,
      tasks: [{
        status_code: 20000,
        cost: 0.0042,
        result_count: 1,
        result: [{
          model_name: "gpt-4.1-mini-2025-04-14",
          input_tokens: 120,
          output_tokens: 220,
          reasoning_tokens: 50,
          web_search: true,
          money_spent: 0.0036,
          datetime: "2026-09-19 08:00:00 +00:00",
          items: [
            {
              type: "reasoning",
              sections: [{ type: "summary_text", text: "private reasoning-like provider content that should not be exposed" }],
            },
            {
              type: "message",
              sections: [{
                type: "text",
                text: "Example.com is one supplier mentioned in the answer.",
                annotations: [
                  {
                    title: "Example guide",
                    url: "https://www.example.com/guide/",
                    text: "Example citation",
                  },
                  {
                    title: "Industry source",
                    url: "https://industry.example/article",
                    text: "Industry citation",
                  },
                ],
              }],
            },
          ],
          fan_out_queries: ["best waterproof membrane supplier", "waterproof membrane manufacturer"],
        }],
      }],
    });
  };

  const result = await fetchLlmPromptResponse({
    login: "login",
    password: "password",
    platform: "chat_gpt",
    userPrompt: "Which companies manufacture reliable waterproof membranes?",
    modelName: "gpt-4.1-mini",
    target: "example.com",
    maxOutputTokens: 1024,
    webSearch: true,
    countryIsoCode: "US",
  });

  assert.equal(captured.url, llmPromptEndpointFor("chat_gpt", "live"));
  const task = JSON.parse(captured.options.body)[0];
  assert.equal(task.user_prompt, "Which companies manufacture reliable waterproof membranes?");
  assert.equal(task.model_name, "gpt-4.1-mini");
  assert.equal(task.max_output_tokens, 1024);
  assert.equal(task.web_search, true);
  assert.equal(task.web_search_country_iso_code, "US");
  assert.equal(result.data.answer, "Example.com is one supplier mentioned in the answer.");
  assert.equal(result.data.answer.includes("private reasoning"), false);
  assert.equal(result.data.annotations.length, 2);
  assert.equal(result.data.target_domain_mentioned, true);
  assert.equal(result.data.target_domain_cited, true);
  assert.equal(result.data.model_money_spent_usd, 0.0036);
  assert.equal(result.actualCostUsd, 0.0042);
});

test("Gemini Prompt Test omits unsupported web-search country localization", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let task;
  globalThis.fetch = async (_url, options) => {
    task = JSON.parse(options.body)[0];
    return response({
      status_code: 20000,
      cost: 0.002,
      tasks_count: 1,
      tasks: [{
        status_code: 20000,
        cost: 0.002,
        result_count: 1,
        result: [{
          model_name: "gemini-2.5-flash",
          input_tokens: 10,
          output_tokens: 20,
          web_search: true,
          money_spent: 0.0014,
          items: [{ type: "message", sections: [{ type: "text", text: "Answer.", annotations: [] }] }],
        }],
      }],
    });
  };

  await fetchLlmPromptResponse({
    login: "login",
    password: "password",
    platform: "gemini",
    userPrompt: "Test prompt",
    modelName: "gemini-2.5-flash",
    webSearch: true,
    countryIsoCode: "SA",
  });

  assert.equal(task.web_search, true);
  assert.equal(Object.hasOwn(task, "web_search_country_iso_code"), false);
});

test("Perplexity Prompt Test relies on Sonar web search and can still localize by country", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let task;
  globalThis.fetch = async (_url, options) => {
    task = JSON.parse(options.body)[0];
    return response({
      status_code: 20000,
      cost: 0.003,
      tasks_count: 1,
      tasks: [{
        status_code: 20000,
        cost: 0.003,
        result_count: 1,
        result: [{
          model_name: "sonar",
          input_tokens: 10,
          output_tokens: 30,
          money_spent: 0.0024,
          items: [{ type: "message", sections: [{ type: "text", text: "Answer.", annotations: [] }] }],
        }],
      }],
    });
  };

  const result = await fetchLlmPromptResponse({
    login: "login",
    password: "password",
    platform: "perplexity",
    userPrompt: "Test prompt",
    modelName: "sonar",
    webSearch: true,
    countryIsoCode: "GB",
  });

  assert.equal(Object.hasOwn(task, "web_search"), false);
  assert.equal(task.web_search_country_iso_code, "GB");
  assert.equal(result.data.web_search, true);
});

test("Prompt validation prevents invalid requests before provider billing", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("provider should not run");
  };

  assert.throws(
    () => normalizeLlmPrompt(""),
    (error) => error?.code === "INVALID_LLM_PROMPT",
  );
  assert.throws(
    () => normalizeLlmPrompt("x".repeat(501)),
    (error) => error?.code === "INVALID_LLM_PROMPT",
  );
  assert.throws(
    () => normalizeLlmPromptPlatform("other"),
    (error) => error?.code === "INVALID_LLM_PLATFORM",
  );

  await assert.rejects(
    fetchLlmPromptResponse({
      login: "login",
      password: "password",
      platform: "chat_gpt",
      userPrompt: "",
      modelName: "gpt-4.1-mini",
    }),
    (error) => error?.code === "INVALID_LLM_PROMPT",
  );
  assert.equal(calls, 0);
});
