import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function sql(name) {
  return readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

test("dashboard migrations create scoped snapshot storage and make api_usage.task_count nullable", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(await sql("0001_alpha_core.sql"));
  db.exec(await sql("0008_site_dashboard_snapshots.sql"));
  db.exec(await sql("0009_nullable_api_usage_task_count.sql"));
  db.prepare(
    `INSERT INTO site_dashboard_snapshots (
      site_domain, location_code, language_code, modules_json, captured_at, schema_version
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "example.com",
    2840,
    "en",
    JSON.stringify({ backlink_gap: { availability: "available", data: { rows: [{ domain: "gap.test" }] } } }),
    "2026-08-31T00:00:00.000Z",
    "1",
  );
  db.exec(await sql("0010_atomic_dashboard_modules.sql"));

  const snapshotColumns = db.prepare("SELECT name FROM pragma_table_info('site_dashboard_snapshots') ORDER BY cid").all().map((row) => row.name);
  assert.deepEqual(snapshotColumns, [
    "id",
    "site_domain",
    "location_code",
    "language_code",
    "modules_json",
    "captured_at",
    "schema_version",
  ]);

  const leaseColumns = db.prepare("SELECT name FROM pragma_table_info('dashboard_refresh_leases') ORDER BY cid").all().map((row) => row.name);
  assert.deepEqual(leaseColumns, [
    "lease_key",
    "request_id",
    "expires_at",
    "created_at",
  ]);

  const apiUsageColumns = db.prepare("SELECT name, \"notnull\" AS required FROM pragma_table_info('api_usage') WHERE name = 'task_count'").get();
  assert.equal(apiUsageColumns.name, "task_count");
  assert.equal(apiUsageColumns.required, 0);

  const indexes = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'site_dashboard_snapshots' ORDER BY name").all().map((row) => row.name);
  assert.ok(indexes.includes("idx_dashboard_scope_time"));

  const moduleColumns = db.prepare("SELECT name FROM pragma_table_info('site_dashboard_modules') ORDER BY cid").all().map((row) => row.name);
  assert.deepEqual(moduleColumns, [
    "site_domain",
    "location_code",
    "language_code",
    "module_id",
    "module_json",
    "updated_at",
    "schema_version",
    "revision",
  ]);
  const modulePk = db.prepare("SELECT name FROM pragma_table_info('site_dashboard_modules') WHERE pk > 0 ORDER BY pk").all().map((row) => row.name);
  assert.deepEqual(modulePk, ["site_domain", "location_code", "language_code", "module_id"]);
  const backlinkGap = db.prepare("SELECT module_json FROM site_dashboard_modules WHERE module_id = 'backlink_gap'").get();
  assert.deepEqual(JSON.parse(backlinkGap.module_json).data.rows, [{ domain: "gap.test" }]);
});

test("preview migration workflow tracks the dashboard schema and all recovery migrations", async () => {
  const [workflow, wrangler, migration0008, migration0009, migration0010] = await Promise.all([
    readFile(new URL("../.github/workflows/cloudflare-preview-migrate.yml", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.migrations.jsonc", import.meta.url), "utf8"),
    sql("0008_site_dashboard_snapshots.sql"),
    sql("0009_nullable_api_usage_task_count.sql"),
    sql("0010_atomic_dashboard_modules.sql"),
  ]);

  assert.match(workflow, /site_dashboard_snapshots/);
  assert.match(workflow, /dashboard_refresh_leases/);
  assert.match(workflow, /0008_site_dashboard_snapshots\.sql/);
  assert.match(workflow, /0009_nullable_api_usage_task_count\.sql/);
  assert.match(workflow, /0010_atomic_dashboard_modules\.sql/);
  assert.match(workflow, /site_dashboard_modules/);
  assert.match(workflow, /task_count/);
  assert.match(wrangler, /"migrations_dir": "migrations"/);

  assert.match(migration0008, /CREATE TABLE IF NOT EXISTS site_dashboard_snapshots/);
  assert.match(migration0008, /CREATE TABLE IF NOT EXISTS dashboard_refresh_leases/);
  assert.match(migration0008, /CREATE INDEX IF NOT EXISTS idx_dashboard_scope_time/);

  assert.match(migration0009, /CREATE TABLE api_usage_new/);
  assert.match(migration0009, /task_count INTEGER/);
  assert.doesNotMatch(migration0009, /task_count INTEGER NOT NULL/);
  assert.match(migration0010, /CREATE TABLE IF NOT EXISTS site_dashboard_modules/);
  assert.match(migration0010, /PRIMARY KEY \(site_domain, location_code, language_code, module_id\)/);
});
