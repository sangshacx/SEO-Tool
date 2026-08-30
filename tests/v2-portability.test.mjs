import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function publicSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await publicSources(full));
    else if (/\.(?:html|js|css)$/.test(entry.name)) output.push([full, await readFile(full, "utf8")]);
  }
  return output;
}

test("public application sources are independent of the Preview hostname", async () => {
  const sources = await publicSources(fileURLToPath(new URL("../public", import.meta.url)));
  for (const [file, source] of sources) {
    assert.doesNotMatch(source, /seo-tool-dme\.pages\.dev|localhost:\d+/i, file);
    assert.doesNotMatch(source, /https?:\/\/[^"'\s]+\/api\/v2\//i, file);
  }
});
