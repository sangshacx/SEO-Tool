import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shell = await readFile(new URL("../public/v2-shell.js", import.meta.url), "utf8");
const organic = await readFile(new URL("../public/v2-organic-intelligence.js", import.meta.url), "utf8");

test("V2 shell creates and mounts Organic Intelligence after market context is ready", () => {
  assert.match(shell, /createOrganicIntelligenceWorkspace/);
  assert.match(shell, /mountOrganicIntelligence/);
  assert.match(shell, /content\.prepend\(createOrganicIntelligenceWorkspace\(\)\)/);
  assert.match(shell, /mountOrganicIntelligence\(\{ root: shell, context, fetchImpl \}\)/);
});

test("Organic Intelligence uses the dedicated API and explicit live-request confirmation", () => {
  assert.match(organic, /\/api\/v2\/organic\/keywords/);
  assert.match(organic, /allow_live_request:allowPaid\.checked/);
  assert.match(organic, /LIVE_REQUEST_CONFIRMATION_REQUIRED/);
  assert.match(organic, /Organic Keywords 已读取：缓存命中，本次费用 \$0/);
});
