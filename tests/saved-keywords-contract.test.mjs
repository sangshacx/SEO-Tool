import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  SAVED_KEYWORDS_CONTRACT_VERSION,
  normalizeSavedKeywordCreate,
  normalizeSavedKeywordDelete,
  normalizeSavedKeywordListQuery,
  normalizeSavedKeywordTagUpdate,
} from "../src/v2/contracts/saved-keywords.js";

test("Saved Keywords contract normalizes site, market, source, tags, and keyword", () => {
  const value = normalizeSavedKeywordCreate({
    site_domain: "https://www.Example.com/path",
    keyword: "  waterproof   membrane  ",
    location_code: 2840,
    language_code: "en",
    source: "keyword_gap",
    note: " High intent ",
    tags: ["Commercial", " commercial ", "Saudi"],
  });

  assert.equal(value.site_domain, "example.com");
  assert.equal(value.keyword, "waterproof membrane");
  assert.equal(value.normalized_keyword, "waterproof membrane");
  assert.equal(value.location_code, 2840);
  assert.equal(value.language_code, "en");
  assert.equal(value.source, "keyword_gap");
  assert.equal(value.note, "High intent");
  assert.deepEqual(value.tags, [
    { name: "Commercial", normalized_name: "commercial" },
    { name: "Saudi", normalized_name: "saudi" },
  ]);
});

test("Saved Keywords list contract keeps pagination and sort bounded", () => {
  const query = normalizeSavedKeywordListQuery(new URLSearchParams({
    site_domain: "example.com",
    q: " membrane ",
    tag: " Commercial ",
    page: "2",
    page_size: "100",
    sort: "keyword_difficulty",
    order: "asc",
  }));
  assert.deepEqual(query, {
    site_domain: "example.com",
    q: "membrane",
    tag: "commercial",
    page: 2,
    page_size: 100,
    sort: "keyword_difficulty",
    order: "asc",
  });

  assert.throws(
    () => normalizeSavedKeywordListQuery(new URLSearchParams({
      site_domain: "example.com",
      page_size: "1000",
    })),
    /page_size must be 25, 50, or 100/,
  );
});

test("Saved Keywords delete contract is site scoped", () => {
  assert.deepEqual(normalizeSavedKeywordDelete({
    site_domain: "www.example.com",
    id: 12,
  }), { site_domain: "example.com", id: 12 });
});

test("Saved Keywords migration creates site-scoped library and normalized tags", async () => {
  const sql = await readFile(new URL("../migrations/0012_saved_keywords.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS saved_keywords/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS saved_keyword_tags/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS saved_keyword_tag_assignments/);
  assert.match(sql, /FOREIGN KEY \(site_profile_id\) REFERENCES site_profiles\(id\) ON DELETE CASCADE/);
  assert.match(sql, /FOREIGN KEY \(keyword_id\) REFERENCES keywords\(id\) ON DELETE CASCADE/);
  assert.match(sql, /UNIQUE \(site_profile_id, keyword_id\)/);
});

test("Saved Keywords API is a zero-provider-cost internal contract", async () => {
  const apiSource = await readFile(new URL("../functions/api/v2/keywords/saved.js", import.meta.url), "utf8");
  const storageSource = await readFile(new URL("../src/v2/storage/saved-keywords.js", import.meta.url), "utf8");
  assert.doesNotMatch(apiSource, /DataForSEO|submitSeoResearchRequest|\bfetch\s*\(/);
  assert.doesNotMatch(storageSource, /DataForSEO|\bfetch\s*\(/);
  assert.match(apiSource, /actual_cost_usd:\s*0/);
  assert.match(apiSource, /provider_requests:\s*0/);
  assert.match(apiSource, /SAVED_KEYWORDS_CONTRACT_VERSION/);
  assert.equal(SAVED_KEYWORDS_CONTRACT_VERSION, "saved-keywords-v0.2");
});

test("Saved Keywords API exposes GET, POST, PATCH, DELETE with no provider request", async () => {
  const calls = [];
  globalThis.__SAVED_KEYWORD_STORAGE_FOR_TESTS__ = {
    async listSavedKeywords(_db, query) {
      calls.push(["list", query]);
      return { items: [], page: 1, page_size: 50, total: 0, total_pages: 1 };
    },
    async saveKeyword(_db, input) {
      calls.push(["save", input]);
      return { id: 7, site_domain: input.site_domain, keyword: input.keyword, tags: [] };
    },
    async addTagsToSavedKeywords(_db, input) {
      calls.push(["tag", input]);
      return { updated_count: input.ids.length, ids: input.ids, tags: input.tags.map((tag) => tag.name) };
    },
    async deleteSavedKeyword(_db, input) {
      calls.push(["delete", input]);
      return input;
    },
  };

  const api = await import(`../functions/api/v2/keywords/saved.js?test=${Date.now()}`);
  const headers = {
    "cf-access-jwt-assertion": "test-token",
    "content-type": "application/json",
  };

  const getResponse = await api.onRequestGet({
    request: new Request("https://preview.example/api/v2/keywords/saved?site_domain=example.com", {
      headers: { "cf-access-jwt-assertion": "test-token" },
    }),
    env: { DB: {} },
  });
  assert.equal(getResponse.status, 200);
  assert.equal((await getResponse.json()).meta.actual_cost_usd, 0);

  const postResponse = await api.onRequestPost({
    request: new Request("https://preview.example/api/v2/keywords/saved", {
      method: "POST",
      headers,
      body: JSON.stringify({
        site_domain: "example.com",
        keyword: "waterproof membrane",
        location_code: 2840,
        language_code: "en",
      }),
    }),
    env: { DB: {} },
  });
  assert.equal(postResponse.status, 200);
  assert.equal((await postResponse.json()).data.id, 7);

  const patchResponse = await api.onRequestPatch({
    request: new Request("https://preview.example/api/v2/keywords/saved", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ site_domain: "example.com", ids: [7, 8, 7], tags: ["Commercial", " commercial ", "Saudi"] }),
    }),
    env: { DB: {} },
  });
  assert.equal(patchResponse.status, 200);
  const patchBody = await patchResponse.json();
  assert.equal(patchBody.data.updated_count, 2);
  assert.deepEqual(patchBody.data.tags, ["Commercial", "Saudi"]);

  const deleteResponse = await api.onRequestDelete({
    request: new Request("https://preview.example/api/v2/keywords/saved", {
      method: "DELETE",
      headers,
      body: JSON.stringify({ site_domain: "example.com", id: 7 }),
    }),
    env: { DB: {} },
  });
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(calls.map((entry) => entry[0]), ["list", "save", "tag", "delete"]);
  delete globalThis.__SAVED_KEYWORD_STORAGE_FOR_TESTS__;
});


test("Saved Keywords tag-update contract is bounded, deduplicated, and site scoped", () => {
  const value = normalizeSavedKeywordTagUpdate({
    site_domain: "https://www.example.com/",
    ids: [3, "4", 3],
    tags: ["Commercial", " commercial ", "Saudi"],
  });
  assert.deepEqual(value, {
    site_domain: "example.com",
    ids: [3, 4],
    tags: [
      { name: "Commercial", normalized_name: "commercial" },
      { name: "Saudi", normalized_name: "saudi" },
    ],
  });

  assert.throws(
    () => normalizeSavedKeywordTagUpdate({ site_domain: "example.com", ids: [], tags: ["A"] }),
    /At least one saved keyword id/,
  );
  assert.throws(
    () => normalizeSavedKeywordTagUpdate({ site_domain: "example.com", ids: [1], tags: [] }),
    /At least one tag/,
  );
  assert.throws(
    () => normalizeSavedKeywordTagUpdate({
      site_domain: "example.com",
      ids: Array.from({ length: 101 }, (_, index) => index + 1),
      tags: ["A"],
    }),
    /No more than 100/,
  );
});

test("Saved Keywords tag storage uses site-scoped placeholders and normalized tag tables", async () => {
  const source = await readFile(new URL("../src/v2/storage/saved-keywords.js", import.meta.url), "utf8");
  assert.match(source, /addTagsToSavedKeywords/);
  assert.match(source, /INSERT INTO saved_keyword_tags/);
  assert.match(source, /INSERT OR IGNORE INTO saved_keyword_tag_assignments/);
  assert.match(source, /WHERE sk\.site_profile_id = \?/);
  assert.doesNotMatch(source, /DataForSEO|\bfetch\s*\(/);
});
