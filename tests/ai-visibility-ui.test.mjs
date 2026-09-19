import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  aiPlatformAvailability,
  buildAiVisibilityBody,
  parseAiCompetitorDomains,
  pickDefaultPromptModel,
} from "../public/v2-ai-visibility.js";

const shell = await readFile(new URL("../public/v2-shell.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/v2.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/v2-ai-visibility.css", import.meta.url), "utf8");
const ui = await readFile(new URL("../public/v2-ai-visibility.js", import.meta.url), "utf8");

test("AI Visibility competitor parser keeps own site first and deduplicates normalized domains", () => {
  assert.deepEqual(
    parseAiCompetitorDomains(
      "https://www.competitor.com/path\ncompetitor.com; second.example",
      "https://www.example.com/",
    ),
    ["example.com", "competitor.com", "second.example"],
  );
});

test("AI Visibility competitor parser requires at least one competitor and rejects invalid domains", () => {
  assert.throws(
    () => parseAiCompetitorDomains("", "example.com"),
    (error) => error?.code === "COMPETITOR_REQUIRED",
  );
  assert.throws(
    () => parseAiCompetitorDomains("not a domain", "example.com"),
    (error) => error?.code === "INVALID_COMPETITOR_DOMAIN",
  );
});

test("AI Visibility request body reuses the active managed-site market", () => {
  assert.deepEqual(
    buildAiVisibilityBody(
      {
        domain: "example.com",
        location_code: 2840,
        language_code: "en",
      },
      "google",
      { limit: 25 },
    ),
    {
      target: "example.com",
      location_code: 2840,
      language_code: "en",
      platform: "google",
      limit: 25,
    },
  );
});

test("ChatGPT AI Visibility is guarded to the currently supported US English market", () => {
  assert.equal(
    aiPlatformAvailability({ location_code: 2840, language_code: "en" }, "chat_gpt").available,
    true,
  );
  const unsupported = aiPlatformAvailability(
    { location_code: 2682, language_code: "ar" },
    "chat_gpt",
  );
  assert.equal(unsupported.available, false);
  assert.match(unsupported.message, /United States \/ English/);
  assert.equal(
    aiPlatformAvailability({ location_code: 2682, language_code: "ar" }, "google").available,
    true,
  );
});

test("V2 shell mounts AI Visibility as a first-class research workspace", () => {
  assert.match(shell, /createAiVisibilityWorkspace, mountAiVisibility/);
  assert.match(shell, /id: "ai-visibility", label: "AI 可见度", group: "research"/);
  assert.match(shell, /content\.append\(createAiVisibilityWorkspace\(\)\)/);
  assert.match(shell, /mountAiVisibility\(\{ root: shell, context, fetchImpl \}\)/);
});

test("AI Visibility UI is cache-first and makes paid refresh explicit", () => {
  assert.match(ui, /读取缓存/);
  assert.match(ui, /允许本次付费刷新/);
  assert.match(ui, /allow_live_request: true/);
  assert.match(ui, /force_refresh: true/);
  assert.match(ui, /LIVE_REQUEST_CONFIRMATION_REQUIRED/);
  assert.match(ui, /\/api\/v2\/ai\/visibility/);
  assert.match(ui, /\/api\/v2\/ai\/compare/);
  assert.match(ui, /\/api\/v2\/ai\/pages/);
  assert.match(ui, /\/api\/v2\/ai\/history/);
  assert.match(ui, /\/api\/v2\/ai\/mentions/);
  assert.match(ui, /读取 D1 · \$0/);
  assert.match(ui, /回填 Historical/);
  assert.match(ui, /回填 New\/Lost/);
  assert.match(ui, /series === "new_lost"/);
  assert.match(ui, /Citation Explorer/);
  assert.match(ui, /读取 Citation 缓存/);
  assert.match(ui, /data-v2-ai-refresh-mentions/);
  assert.match(ui, /answer_excerpt/);
  assert.match(ui, /target_source_count/);
  assert.match(ui, /fan_out_queries/);
});

test("AI Visibility stylesheet is loaded and defines the dedicated workspace primitives", () => {
  assert.match(html, /href="\.\/v2-ai-visibility\.css"/);
  assert.match(css, /\.v2-ai-visibility/);
  assert.match(css, /\.v2-ai-cost-guard/);
  assert.match(css, /\.v2-ai-metrics/);
  assert.match(css, /\.v2-ai-tablewrap/);
  assert.match(css, /\.v2-ai-history-note/);
  assert.match(css, /\.v2-ai-citation-list/);
  assert.match(css, /\.v2-ai-citation-card/);
  assert.match(css, /\.v2-ai-citation-answer/);
  assert.match(css, /\.v2-ai-citation-sources/);
});


test("Custom Prompt Tracker chooses cost-conscious non-reasoning defaults without hardcoding one model version", () => {
  assert.equal(
    pickDefaultPromptModel([
      {model_name:"gpt-5-pro",reasoning:true},
      {model_name:"gpt-5-mini",reasoning:false},
      {model_name:"gpt-4.1",reasoning:false},
    ],"chat_gpt")?.model_name,
    "gpt-5-mini",
  );
  assert.equal(
    pickDefaultPromptModel([
      {model_name:"gemini-pro",reasoning:false},
      {model_name:"gemini-flash",reasoning:false},
    ],"gemini")?.model_name,
    "gemini-flash",
  );
  assert.equal(
    pickDefaultPromptModel([
      {model_name:"sonar-pro",reasoning:false},
      {model_name:"sonar",reasoning:false},
    ],"perplexity")?.model_name,
    "sonar-pro",
  );
});

test("Custom Prompt Tracker keeps model discovery free and paid prompt execution behind Cost Guard", () => {
  assert.match(ui,/\/api\/v2\/ai\/prompt-models/);
  assert.match(ui,/\/api\/v2\/ai\/prompt-test/);
  assert.match(ui,/CUSTOM PROMPT TRACKER/);
  assert.match(ui,/Models list · \$0/);
  assert.match(ui,/读取相同 Prompt 缓存 · \$0/);
  assert.match(ui,/运行 Prompt Test · 付费/);
  assert.match(ui,/allow_live_request: true/);
  assert.match(ui,/force_refresh: true/);
  assert.match(ui,/maxLength="500"|maxlength="500"/i);
  assert.match(ui,/reasoning 内容/);
  assert.match(ui,/data-v2-ai-prompt-result-cited/);
  assert.match(ui,/data-v2-ai-prompt-result-cost/);
});

test("Custom Prompt Tracker styling includes responsive model, answer, citation and token surfaces", () => {
  assert.match(css,/\.v2-ai-prompt-form/);
  assert.match(css,/\.v2-ai-prompt-metrics/);
  assert.match(css,/\.v2-ai-prompt-output/);
  assert.match(css,/\.v2-ai-prompt-fanout/);
  assert.match(css,/\.v2-ai-prompt-guidance/);
});


test("Custom Prompt Tracker UI persists prompt definitions separately from paid observations", () => {
  assert.match(ui,/\/api\/v2\/ai\/prompt-tracker/);
  assert.match(ui,/Save Tracker · \$0/);
  assert.match(ui,/SAVED PROMPTS · D1/);
  assert.match(ui,/Refresh Saved · \$0/);
  assert.match(ui,/Observation History/);
  assert.match(ui,/tracker_id: currentTrackerId/);
  assert.match(ui,/observation_recorded/);
  assert.match(ui,/clearCurrentTracker/);
  assert.match(ui,/TRACKER|Tracker #/);
  assert.match(ui,/Pause/);
  assert.match(ui,/Resume/);
});

test("Saved Prompt UI marks manual configuration edits dirty so observations cannot attach to stale tracker ids", () => {
  assert.match(ui,/\[promptPlatform, "change", \(\) => \{/);
  assert.match(ui,/\[promptModel, "change", \(\) => \{/);
  assert.match(ui,/\[promptWebSearch, "change", \(\) => clearCurrentTracker\(\)\]/);
  assert.match(ui,/\[promptText, "input", \(\) => \{/);
  assert.match(ui,/currentTrackerId = null/);
});

test("Saved Prompt tables and history have dedicated compact workspace styling", () => {
  assert.match(css,/\.v2-ai-current-tracker/);
  assert.match(css,/\.v2-ai-tracker-head/);
  assert.match(css,/\.v2-ai-tracker-tablewrap/);
  assert.match(css,/\.v2-ai-tracker-actions/);
  assert.match(css,/tr\[data-current="true"\]/);
});


test("Saved Prompt trend UI shows descriptive D1 rates, latest change and cumulative spend without a synthetic score", () => {
  assert.match(ui,/data-v2-ai-tracker-summary-active/);
  assert.match(ui,/data-v2-ai-tracker-summary-runs/);
  assert.match(ui,/data-v2-ai-tracker-summary-mention-rate/);
  assert.match(ui,/data-v2-ai-tracker-summary-citation-rate/);
  assert.match(ui,/data-v2-ai-tracker-summary-spend/);
  assert.match(ui,/Mention Rate/);
  assert.match(ui,/Citation Rate/);
  assert.match(ui,/Latest Change/);
  assert.match(ui,/Total Spend/);
  assert.match(ui,/trend\.change/);
  assert.match(ui,/data\.kind|dataset\.kind/);
  assert.doesNotMatch(ui,/AI Prompt Score|Prompt Score/);
});

test("Prompt observation refresh runs only after real Prompt Test observations, not Citation Explorer refreshes", () => {
  const promptStart=ui.indexOf("const loadPromptTest");
  const promptEnd=ui.indexOf("const listeners",promptStart);
  const promptBlock=ui.slice(promptStart,promptEnd);
  const citationStart=ui.indexOf("const loadMentions");
  const citationEnd=ui.indexOf("const clearCurrentTracker",citationStart);
  const citationBlock=ui.slice(citationStart,citationEnd);
  assert.match(promptBlock,/observation_recorded/);
  assert.match(promptBlock,/loadSavedTrackers/);
  assert.doesNotMatch(citationBlock,/observation_recorded/);
});

test("LLM Mentions platform changes do not reinitialize independent Custom Prompt Tracker controls", () => {
  const marker='[platform, "change", () => {';
  const start=ui.indexOf(marker);
  const end=ui.indexOf("}],",start);
  const block=ui.slice(start,end);
  assert.match(block,/renderCitationExplorer/);
  assert.match(block,/loadOverview/);
  assert.match(block,/loadStoredHistory/);
  assert.doesNotMatch(block,/loadPromptModels/);
  assert.doesNotMatch(block,/renderPromptTestResult/);
});
