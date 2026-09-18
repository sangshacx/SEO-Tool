import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buildSavedKeywordListUrl,
  savedKeywordCreatePayload,
} from "../public/v2-keyword-library.js";

test("Keyword Library list URL is site scoped and keeps filters explicit", () => {
  const url = buildSavedKeywordListUrl({
    siteDomain: "great-ocean-waterproof.com",
    q: "waterproof membrane",
    tag: "Commercial",
    page: 2,
    pageSize: 50,
    sort: "keyword_difficulty",
    order: "asc",
  });
  const parsed = new URL(url, "https://preview.example");
  assert.equal(parsed.pathname, "/api/v2/keywords/saved");
  assert.equal(parsed.searchParams.get("site_domain"), "great-ocean-waterproof.com");
  assert.equal(parsed.searchParams.get("q"), "waterproof membrane");
  assert.equal(parsed.searchParams.get("tag"), "Commercial");
  assert.equal(parsed.searchParams.get("page"), "2");
  assert.equal(parsed.searchParams.get("sort"), "keyword_difficulty");
  assert.equal(parsed.searchParams.get("order"), "asc");
});

test("Keyword Explorer save payload reuses current site and market without a provider request", () => {
  const payload = savedKeywordCreatePayload({
    market: {
      domain: "great-ocean-waterproof.com",
      location_code: 2840,
      language_code: "en",
    },
    keyword: "  waterproof   membrane ",
  });
  assert.deepEqual(payload, {
    site_domain: "great-ocean-waterproof.com",
    keyword: "waterproof membrane",
    location_code: 2840,
    language_code: "en",
    source: "keyword_explorer",
    tags: [],
  });
  assert.throws(
    () => savedKeywordCreatePayload({
      market: { location_code: 2840, language_code: "en" },
      keyword: "waterproof membrane",
    }),
    /网站管理/,
  );
});

test("Keyword Library UI only calls the internal Saved Keywords API", async () => {
  const source = await readFile(new URL("../public/v2-keyword-library.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/v2\/keywords\/saved/);
  assert.match(source, /保存到关键词库/);
  assert.match(source, /本次费用 \$0/);
  assert.doesNotMatch(source, /DataForSEO|submitSeoResearchRequest|\/api\/v2\/keywords\/overview|\/api\/v2\/keywords\/ideas/);
});

test("V2 shell exposes Keyword Library as a first-class research view", async () => {
  const source = await readFile(new URL("../public/v2-shell.js", import.meta.url), "utf8");
  assert.match(source, /v2-keyword-library\.js/);
  assert.match(source, /id: "keyword-library", label: "关键词库"/);
  assert.match(source, /createKeywordLibrarySection/);
  assert.match(source, /mountKeywordLibrary/);
});
