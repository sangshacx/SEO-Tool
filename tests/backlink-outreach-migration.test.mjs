import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/cloudflare-preview-migrate.yml", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/0006_backlink_outreach_intelligence.sql", import.meta.url), "utf8");

test("uses Wrangler's tracked Preview migration workflow", () => {
  assert.match(workflow, /d1 migrations apply seo-pro-v2-preview --remote/);
  assert.match(workflow, /d1_migrations/);
  assert.match(workflow, /quality_score/);
  assert.match(workflow, /relevance_checked_at/);
});

test("enables strictly public fetches for Preview Pages Functions", () => {
  assert.match(workflow, /global_fetch_strictly_public/);
  assert.match(workflow, /accounts\/\$\{CLOUDFLARE_ACCOUNT_ID\}\/pages\/projects\/seo-tool/);
});

test("adds constrained outreach intelligence fields and an owner index", () => {
  for (const field of ["quality_score", "relevance_score", "outreach_recommendation", "outreach_confidence", "outreach_reasons_json", "outreach_risk_types_json", "relevance_checked_at"]) {
    assert.match(migration, new RegExp(`ADD COLUMN ${field}\\b`), field);
  }
  assert.match(migration, /BETWEEN 0 AND 100/);
  assert.match(migration, /research_first.*possible.*low_value.*skip/s);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS/);
});
