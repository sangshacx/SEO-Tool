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


test("site management uses the redesigned workspace hierarchy without changing site APIs", () => {
  assert.match(shell, /v2-sites-workspace/);
  assert.match(shell, /v2-sites-editor-grid/);
  assert.match(shell, /v2-site-competitor-details/);
  assert.match(shell, /v2-sites-list-section/);
  assert.match(shell, /data-v2-site-form/);
  assert.match(shell, /data-v2-export-sites/);
  assert.match(shell, /data-v2-import-sites/);
  assert.match(shell, /data-v2-competitor="5"/);
  assert.match(shell, /\/api\/v2\/sites/);
});


test("keyword research is reorganized into a tabbed workspace without replacing research APIs", () => {
  assert.match(shell, /createKeywordResearchWorkspace/);
  assert.match(shell, /data-v2-keyword-research-tab/);
  assert.match(shell, /data-v2-keyword-research-panel/);
  assert.match(shell, /关键词概览/);
  assert.match(shell, /Keyword Ideas/);
  assert.match(shell, /Content Plan/);
  assert.match(shell, /Cache First/);
  assert.match(shell, /Cost Guard/);
  assert.match(shell, /delete overview\.dataset\.v2View/);
  assert.match(shell, /createKeywordResearchWorkspace\(content\)/);
});


test("competitor research is reorganized into a three-tab workspace without changing research APIs", () => {
  assert.match(shell, /createCompetitorResearchWorkspace/);
  assert.match(shell, /data-v2-competitor-tab/);
  assert.match(shell, /data-v2-competitor-panel/);
  assert.match(shell, /自然搜索概览/);
  assert.match(shell, /Keyword Gap/);
  assert.match(shell, /外链比较/);
  assert.match(shell, /7 天缓存/);
  assert.match(shell, /Cost Guard/);
  assert.match(shell, /delete panel\.dataset\.v2View/);
  assert.match(shell, /createCompetitorResearchWorkspace\(content\)/);
});


test("backlink research is reorganized into a four-tab workspace without changing backlink APIs", () => {
  assert.match(shell, /createBacklinkResearchWorkspace/);
  assert.match(shell, /data-v2-backlink-tab/);
  assert.match(shell, /data-v2-backlink-panel/);
  assert.match(shell, /批量概览/);
  assert.match(shell, /Referring Domains/);
  assert.match(shell, /Backlink Details/);
  assert.match(shell, /Anchor Text/);
  assert.match(shell, /Cache First/);
  assert.match(shell, /Cost Guard/);
  assert.match(shell, /delete panel\.dataset\.v2View/);
  assert.match(shell, /createBacklinkResearchWorkspace\(content\)/);
});


test("opportunity workspace separates discovery from saved prospects without changing opportunity APIs", () => {
  assert.match(shell, /createOpportunityWorkspace/);
  assert.match(shell, /data-v2-opportunity-tab/);
  assert.match(shell, /data-v2-opportunity-panel/);
  assert.match(shell, /发现外链机会/);
  assert.match(shell, /Saved Link Prospects/);
  assert.match(shell, /OPPORTUNITY WORKSPACE/);
  assert.match(shell, /发现/);
  assert.match(shell, /保存/);
  assert.match(shell, /推进/);
  assert.match(shell, /delete panel\.dataset\.v2View/);
  assert.match(shell, /createOpportunityWorkspace\(content\)/);
});
