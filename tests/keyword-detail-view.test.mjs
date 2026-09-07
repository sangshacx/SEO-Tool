import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("keyword detail maps list rows without inventing missing values", async () => {
  const module = await import("../public/v2-keyword-detail.js");
  assert.deepEqual(module.keywordDetailFromCells("ideas", ["✓", "1", "waterproof membrane", "1,900", "23", "$2.45", "commercial"]), {
    keyword: "waterproof membrane", search_volume: "1,900", keyword_difficulty: "23", cpc: "$2.45", intent: "commercial", rank: "—", source: "Keyword Ideas", updated_at: "—",
  });
  assert.deepEqual(module.keywordDetailFromCells("competitor", ["1", "roof membrane", "4", "", "17", "", "transactional"]), {
    keyword: "roof membrane", search_volume: "—", keyword_difficulty: "17", cpc: "—", intent: "transactional", rank: "4", source: "Competitor Snapshot", updated_at: "—",
  });
  assert.deepEqual(module.keywordDetailFromCells("gap", ["", "1", "bitumen membrane", "8", "720", "31", "$1.10", "commercial"]), {
    keyword: "bitumen membrane", search_volume: "720", keyword_difficulty: "31", cpc: "$1.10", intent: "commercial", rank: "8", source: "Keyword Gap", updated_at: "—",
  });
});

test("opening list detail is zero-request; only explicit analyze submits existing form", async () => {
  const { createKeywordDetailController } = await import("../public/v2-keyword-detail.js");
  let rendered = null;
  let submits = 0;
  const input = { value: "" };
  const locationLike = { hash: "#competitors" };
  const submitButton = { disabled: false };
  const form = { requestSubmit(button) { assert.equal(button, submitButton); submits += 1; } };
  const controller = createKeywordDetailController({ input, form, submitButton, locationLike, render(detail) { rendered = detail; }, reveal() {} });

  const opened = controller.open({ keyword: " waterproof coating ", search_volume: 590, keyword_difficulty: null, cpc_usd: 1.4, intent: "commercial", position: 6 }, { source: "Competitor Snapshot" });
  assert.equal(opened.keyword, "waterproof coating");
  assert.equal(opened.search_volume, "590");
  assert.equal(opened.keyword_difficulty, "—");
  assert.equal(opened.cpc, "$1.40");
  assert.equal(opened.rank, "6");
  assert.equal(input.value, "waterproof coating");
  assert.equal(locationLike.hash, "keywords");
  assert.equal(submits, 0);
  assert.equal(rendered.keyword, "waterproof coating");

  assert.equal(controller.analyze(), true);
  assert.equal(submits, 1);
});

test("keyword detail source has no network path and bootstrap is wired through market context", async () => {
  const detailSource = await readFile(new URL("../public/v2-keyword-detail.js", import.meta.url), "utf8");
  assert.doesNotMatch(detailSource, /\bfetch\s*\(|submitSeoResearchRequest|\/api\//);
  const marketSource = await readFile(new URL("../public/v2-market-context.js", import.meta.url), "utf8");
  assert.match(marketSource, /import\s+["']\.\/v2-keyword-detail\.js["']/);
});
