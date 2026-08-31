import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/v2.html", import.meta.url), "utf8");
const shell = await readFile(new URL("../public/v2-shell.js", import.meta.url), "utf8");
const css = await readFile(new URL("../public/v2-market-selector.css", import.meta.url), "utf8").catch(() => "");
const context = await readFile(new URL("../public/v2-market-context.js", import.meta.url), "utf8");

test("loads portable market assets and accessible searchable controls", () => {
  assert.match(html, /href="\.\/v2-market-selector\.css"/);
  assert.match(shell, /data-v2-market-country/);
  assert.match(shell, /data-v2-market-language/);
  assert.doesNotMatch(shell, /role="combobox"|aria-autocomplete|aria-expanded/);
  assert.match(shell, /list="v2CountryOptions"/);
  assert.match(shell, /list="v2LanguageOptions"/);
  assert.match(shell, /id="v2CountryOptions"/);
  assert.match(shell, /id="v2LanguageOptions"/);
  assert.ok(css.length > 100);
});

test("site management exposes five competitors, validation, sync state and portable import/export", () => {
  assert.match(shell, /data-v2-sync-warning/);
  assert.match(shell, /data-v2-retry-sync/);
  assert.match(shell, /data-v2-site-error/);
  assert.match(shell, /data-v2-competitor="5"/);
  assert.match(shell, /data-v2-export-sites/);
  assert.match(shell, /data-v2-import-sites/);
  assert.match(shell, /data-v2-import-file/);
  assert.match(shell, /导入.*会覆盖同域名配置/);
  assert.match(context, /format=export/);
});

test("market controls bind changes without programmatic form submission", () => {
  assert.doesNotMatch(shell, /requestSubmit|\.submit\(/);
  assert.match(shell, /addEventListener\("change"/);
  assert.match(shell, /addEventListener\("input"/);
});

test("static and generated control IDs are unique", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g), ...shell.matchAll(/\sid=\\?"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});
