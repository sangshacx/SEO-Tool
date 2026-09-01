import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationUrl = new URL("../migrations/0007_site_profiles.sql", import.meta.url);
const workflowUrl = new URL("../.github/workflows/cloudflare-preview-migrate.yml", import.meta.url);
const wranglerUrl = new URL("../wrangler.migrations.jsonc", import.meta.url);
const verifierUrl = new URL("../scripts/assert-d1-query-names.mjs", import.meta.url);
const siteProfileColumns = [
  "id", "domain", "label", "location_code", "location_name", "country_iso_code",
  "language_code", "language_name", "include_subdomains", "competitors_json", "created_at", "updated_at",
];

function verifyD1Names(names, expected) {
  return spawnSync(process.execPath, [verifierUrl.pathname, ...expected], {
    input: JSON.stringify([{ success: true, results: names.map((name) => ({ name })) }]),
    encoding: "utf8",
  });
}

test("creates the constrained site_profiles schema in SQLite", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const db = new DatabaseSync(":memory:");

  db.exec(sql);

  assert.match(sql, /CREATE TABLE IF NOT EXISTS site_profiles/);
  assert.match(sql, /UNIQUE\s*\(domain\)/i);
  assert.match(sql, /include_subdomains INTEGER NOT NULL DEFAULT 0 CHECK \(include_subdomains IN \(0,1\)\)/i);
  assert.match(sql, /competitors_json TEXT NOT NULL DEFAULT '\[\]'/i);
  assert.deepEqual(
    db.prepare("SELECT name FROM pragma_table_info('site_profiles') ORDER BY cid").all().map((column) => column.name),
    [
      "id",
      "domain",
      "label",
      "location_code",
      "location_name",
      "country_iso_code",
      "language_code",
      "language_name",
      "include_subdomains",
      "competitors_json",
      "created_at",
      "updated_at",
    ],
  );
});

test("fails verification when D1 query result names are missing or unexpected", () => {
  const expected = ["site_profiles", "d1_migrations"];
  assert.equal(verifyD1Names(expected, expected).status, 0);

  const missing = verifyD1Names(["site_profiles"], expected);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Expected exactly/);
});

test("uses exact, failing Preview migration verification commands", async () => {
  const [workflow, wrangler] = await Promise.all([
    readFile(workflowUrl, "utf8"),
    readFile(wranglerUrl, "utf8"),
  ]);

  assert.match(wrangler, /"migrations_dir": "migrations"/);
  assert.match(wrangler, /"migrations_table": "d1_migrations"/);
  assert.match(workflow, /d1 execute seo-pro-v2-preview --remote[\s\S]*?--json[\s\S]*?assert-d1-query-names\.mjs/);
  assert.match(workflow, new RegExp(siteProfileColumns.join("[\\s\\S]*?")));
  assert.match(workflow, /0007_site_profiles\.sql/);
  assert.match(workflow, /d1_migrations/);
  const verifierLines = workflow.split("\n").filter((line) => line.includes("node scripts/assert-d1-query-names.mjs"));
  assert.equal(verifierLines.length, 8);
  assert.equal(verifierLines.every((line) => line.trimEnd().endsWith("\\")), true);
});
