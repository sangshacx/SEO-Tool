import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/v2.html", import.meta.url), "utf8");
const shell = await readFile(new URL("../public/v2-shell.js", import.meta.url), "utf8");

test("loads the portable V2 shell assets", () => {
  assert.match(html, /href="\.\/v2-shell\.css"/);
  assert.match(html, /src="\.\/v2-shell\.js"/);
  assert.doesNotMatch(html, /seo-tool-dme\.pages\.dev/);
});

test("shell maps every existing tool group and keeps Content Brief secondary", () => {
  for (const selector of [
    ".backlinks", ".backlinkhistory", ".competitor", ".keywordgap", ".backlinkcompare",
    ".ideas", ".contentplan", ".backlinkbatch", ".refdomains", ".backlinkdetails",
    ".anchoranalysis", ".backlinkgap", ".backlinkprospects",
  ]) assert.ok(shell.includes(selector), `missing ${selector}`);
  assert.match(shell, /更多工具/);
  assert.match(shell, /Content Brief/);
});

test("site switching is explicitly non-submitting", () => {
  assert.match(shell, /applyActiveDomain/);
  assert.doesNotMatch(shell, /\.submit\(/);
  assert.doesNotMatch(shell, /requestSubmit/);
  assert.doesNotMatch(shell, /"batchDomains"/);
  assert.match(shell, /data-v2-site-rename/);
  assert.match(shell, /data-v2-site-remove/);
});

test("cross-tool snapshot handoffs route to Website Data before focusing", () => {
  assert.match(html, /function sendDomainToSnapshot\(domain\).*location\.hash="website"/s);
  assert.match(html, /生成 "\+domain\+" 快照".*location\.hash="website"/s);
});

test("usage summary is shared by Overview and Cost Settings", () => {
  assert.match(shell, /setAttribute\("data-v2-view", "overview settings"\)/);
  assert.match(shell, /split\(\/\\s\+\/\)\.includes\(view\)/);
});

test("existing static IDs remain unique", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});
