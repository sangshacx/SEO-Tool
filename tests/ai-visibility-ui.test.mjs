import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  aiPlatformAvailability,
  buildAiVisibilityBody,
  parseAiCompetitorDomains,
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
  assert.match(ui, /读取 D1 · \$0/);
  assert.match(ui, /回填 Historical/);
  assert.match(ui, /回填 New\/Lost/);
  assert.match(ui, /series === "new_lost"/);
});

test("AI Visibility stylesheet is loaded and defines the dedicated workspace primitives", () => {
  assert.match(html, /href="\.\/v2-ai-visibility\.css"/);
  assert.match(css, /\.v2-ai-visibility/);
  assert.match(css, /\.v2-ai-cost-guard/);
  assert.match(css, /\.v2-ai-metrics/);
  assert.match(css, /\.v2-ai-tablewrap/);
  assert.match(css, /\.v2-ai-history-note/);
});
