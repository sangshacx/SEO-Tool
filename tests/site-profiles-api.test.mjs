import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const apiUrl = new URL("../functions/api/v2/sites/index.js", import.meta.url);

function request(method, body, headers = {}) {
  return new Request("https://preview.example/api/v2/sites", {
    method,
    headers: body === undefined
      ? { "cf-access-jwt-assertion": "trusted-test-assertion", ...headers }
      : { "content-type": "application/json", "cf-access-jwt-assertion": "trusted-test-assertion", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

function memoryStorage(seed = []) {
  let profiles = structuredClone(seed);
  const calls = [];
  return {
    calls,
    storage: {
      async listSiteProfiles() { calls.push("list"); return structuredClone(profiles); },
      async exportSiteProfiles() { calls.push("export"); return { version: 1, profiles: structuredClone(profiles) }; },
      async upsertSiteProfile(_db, profile) {
        calls.push(["upsert", structuredClone(profile)]);
        const saved = { ...profile, label: profile.label ?? profile.domain };
        profiles = [...profiles.filter((item) => item.domain !== saved.domain), saved];
        return structuredClone(saved);
      },
      async patchSiteProfile(_db, patch) {
        calls.push(["patch", structuredClone(patch)]);
        const index = profiles.findIndex((item) => item.domain === patch.domain);
        if (index < 0) throw Object.assign(new Error("PROFILE_NOT_FOUND"), { code: "PROFILE_NOT_FOUND", httpStatus: 404 });
        profiles[index] = { ...profiles[index], ...patch };
        return structuredClone(profiles[index]);
      },
      async importSiteProfiles(_db, envelope) {
        calls.push(["import", structuredClone(envelope)]);
        profiles = structuredClone(envelope.profiles);
        return { version: 1, profiles: structuredClone(profiles) };
      },
      async deleteSiteProfile(_db, domain) { calls.push(["delete", domain]); return { domain }; },
    },
  };
}

async function handlers(storage) {
  const url = new URL(`${apiUrl.href}?case=${crypto.randomUUID()}`);
  globalThis.__SITE_PROFILE_STORAGE_FOR_TESTS__ = storage;
  try { return await import(url); } finally { delete globalThis.__SITE_PROFILE_STORAGE_FOR_TESTS__; }
}

async function payload(response) { return response.json(); }

test("GET lists profiles and export preserves the versioned storage envelope", async () => {
  const fixture = memoryStorage([{ domain: "example.com", competitors: [] }]);
  const api = await handlers(fixture.storage);
  const list = await api.onRequestGet({ request: request("GET"), env: { DB: {} } });
  assert.equal(list.status, 200);
  assert.deepEqual((await payload(list)).data, [{ domain: "example.com", competitors: [] }]);
  const exported = await api.onRequestGet({ request: new Request("https://preview.example/api/v2/sites?format=export", { headers: { "cf-access-jwt-assertion": "trusted-test-assertion" } }), env: { DB: {} } });
  assert.deepEqual((await payload(exported)).data, { version: 1, profiles: [{ domain: "example.com", competitors: [] }] });
  assert.deepEqual((await payload(await api.onRequestGet({ request: new Request("https://preview.example/api/v2/sites?format=bad", { headers: { "cf-access-jwt-assertion": "trusted-test-assertion" } }), env: { DB: {} } }))).error.code, "INVALID_FORMAT");
});

test("POST upserts a complete JSON object with zero-cost metadata", async () => {
  const fixture = memoryStorage();
  const api = await handlers(fixture.storage);
  const response = await api.onRequestPost({ request: request("POST", { domain: "example.com", location_code: 2682, language_code: "ar" }), env: { DB: {} } });
  const body = await payload(response);
  assert.equal(response.status, 200);
  assert.equal(body.meta.actual_cost_usd, 0);
  assert.equal(body.meta.provider_requests, 0);
  assert.deepEqual(fixture.calls[0][1], { domain: "example.com", location_code: 2682, language_code: "ar" });
});

test("PATCH delegates one atomic partial update and gives own competitors key precedence", async () => {
  const existing = { domain: "example.com", label: "Old", location_code: 2840, language_code: "en", include_subdomains: true, competitors: ["old.example"] };
  for (const [patch, expected] of [
    [{ domain: "example.com", label: "New" }, undefined],
    [{ domain: "example.com", competitors: [] , competitor_domains: ["legacy.example"] }, []],
    [{ domain: "example.com", competitors: null, competitor_domains: ["legacy.example"] }, null],
    [{ domain: "example.com", competitor_domains: ["legacy.example"] }, ["legacy.example"]],
  ]) {
    const fixture = memoryStorage([existing]);
    const api = await handlers(fixture.storage);
    const response = await api.onRequestPatch({ request: request("PATCH", patch), env: { DB: {} } });
    assert.equal(response.status, 200);
    const submitted = fixture.calls.find((call) => Array.isArray(call) && call[0] === "patch")[1];
    assert.equal(Object.hasOwn(submitted, "include_subdomains"), false);
    assert.deepEqual(Object.hasOwn(submitted, "competitors") ? submitted.competitors : submitted.competitor_domains, expected);
    if (Object.hasOwn(patch, "competitors")) assert.deepEqual(submitted.competitors, patch.competitors);
  }
});

test("PATCH returns 404 without upserting an unknown profile", async () => {
  const fixture = memoryStorage();
  const api = await handlers(fixture.storage);
  const response = await api.onRequestPatch({ request: request("PATCH", { domain: "missing.example", label: "X" }), env: { DB: {} } });
  assert.equal(response.status, 404);
  assert.equal((await payload(response)).error.code, "PROFILE_NOT_FOUND");
  assert.deepEqual(fixture.calls, [["patch", { domain: "missing.example", label: "X" }]]);
});

test("requires a Cloudflare Access assertion and rejects untrusted origins before storage", async () => {
  const fixture = memoryStorage([{ domain: "example.com", competitors: [] }]);
  const api = await handlers(fixture.storage);
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    const body = method === "GET" ? undefined : { domain: "example.com" };
    const unauthenticated = request(method, body, { "cf-access-jwt-assertion": "" });
    assert.equal((await api.onRequest({ request: unauthenticated, env: { DB: {} } })).status, 401);
    const crossOrigin = request(method, body, { origin: "https://evil.example" });
    assert.equal((await api.onRequest({ request: crossOrigin, env: { DB: {} } })).status, 403);
  }
  assert.deepEqual(fixture.calls, []);
  const allowed = request("GET", undefined, { origin: "https://preview.example" });
  assert.equal((await api.onRequest({ request: allowed, env: { DB: {} } })).status, 200);
  assert.equal((await payload(await api.onRequest({ request: request("GET"), env: { DB: {} } }))).ok, true);
  assert.equal((await api.onRequest({ request: request("OPTIONS", undefined, { origin: "https://evil.example" }), env: { DB: {} } })).status, 403);
});

test("POST format=import accepts only the versioned import envelope", async () => {
  const fixture = memoryStorage();
  const api = await handlers(fixture.storage);
  const envelope = { version: 1, profiles: [{ domain: "example.com", competitors: [] }] };
  const imported = await api.onRequestPost({ request: new Request("https://preview.example/api/v2/sites?format=import", {
    method: "POST", headers: { "content-type": "application/json", "cf-access-jwt-assertion": "trusted-test-assertion" }, body: JSON.stringify(envelope),
  }), env: { DB: {} } });
  assert.equal(imported.status, 200);
  assert.deepEqual(fixture.calls.at(-1), ["import", envelope]);
  const invalidFormat = await api.onRequestPost({ request: new Request("https://preview.example/api/v2/sites?format=export", {
    method: "POST", headers: { "content-type": "application/json", "cf-access-jwt-assertion": "trusted-test-assertion" }, body: JSON.stringify(envelope),
  }), env: { DB: {} } });
  assert.equal(invalidFormat.status, 400);
  assert.equal((await payload(invalidFormat)).error.code, "INVALID_FORMAT");
});

test("DELETE delegates storage errors and successes", async () => {
  const ok = memoryStorage();
  let api = await handlers(ok.storage);
  let response = await api.onRequestDelete({ request: request("DELETE", { domain: "example.com" }), env: { DB: {} } });
  assert.equal(response.status, 200);
  assert.deepEqual(ok.calls, [["delete", "example.com"]]);
  api = await handlers({ ...ok.storage, async deleteSiteProfile() { throw Object.assign(new Error("LAST_PROFILE"), { code: "LAST_PROFILE", httpStatus: 409 }); } });
  response = await api.onRequestDelete({ request: request("DELETE", { domain: "example.com" }), env: { DB: {} } });
  assert.equal(response.status, 409);
  assert.equal((await payload(response)).error.code, "LAST_PROFILE");
});

test("enforces media type, object JSON, honest Content-Length, and cumulative 64 KiB streaming", async () => {
  const api = await handlers(memoryStorage().storage);
  const env = { DB: {} };
  assert.equal((await api.onRequestPost({ request: request("POST", "{}", { "content-type": "text/plain" }), env })).status, 415);
  assert.equal((await api.onRequestPost({ request: request("POST", "[]"), env })).status, 400);
  assert.equal((await api.onRequestPost({ request: request("POST", "{}", { "content-length": "65537" }), env })).status, 413);
  assert.equal((await api.onRequestPost({ request: request("POST", "{}", { "content-length": "not-a-number" }), env })).status, 400);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(40000)); controller.enqueue(new Uint8Array(30000)); controller.close(); } });
  const oversized = new Request("https://preview.example/api/v2/sites", { method: "POST", headers: { "content-type": "application/json", "cf-access-jwt-assertion": "trusted-test-assertion" }, body: stream, duplex: "half" });
  assert.equal((await api.onRequestPost({ request: oversized, env })).status, 413);
});

test("returns structured missing-binding, method, CORS, validation, and storage errors", async () => {
  const fixture = memoryStorage();
  const api = await handlers(fixture.storage);
  assert.equal((await api.onRequestGet({ request: request("GET"), env: {} })).status, 503);
  const options = await api.onRequestOptions({ request: request("OPTIONS") });
  assert.equal(options.status, 204);
  assert.match(options.headers.get("allow"), /GET/);
  assert.equal(options.headers.get("access-control-allow-origin"), null);
  const routed = await api.onRequest({ request: request("PUT"), env: { DB: {} } });
  assert.equal(routed.status, 405);
  assert.equal(routed.headers.get("allow"), "GET, POST, PATCH, DELETE, OPTIONS");
  const validatingApi = await handlers(null);
  const invalid = await validatingApi.onRequestPost({ request: request("POST", { domain: "localhost" }), env: { DB: {} } });
  assert.equal(invalid.status, 400);
  const broken = await handlers({ ...fixture.storage, async listSiteProfiles() { throw new Error("secret db detail"); } });
  const originalError = console.error;
  console.error = () => {};
  const failed = await broken.onRequestGet({ request: request("GET"), env: { DB: {} } }).finally(() => { console.error = originalError; });
  assert.equal(failed.status, 500);
  assert.doesNotMatch(JSON.stringify(await payload(failed)), /secret db detail/);
});

async function importClosure(entry) {
  const seen = new Set();
  async function visit(file) {
    const absolute = resolve(file);
    if (seen.has(absolute)) return;
    seen.add(absolute);
    const source = await readFile(absolute, "utf8");
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g)) {
      if (!match[1].startsWith(".")) continue;
      let target = resolve(dirname(absolute), match[1]);
      if (!extname(target)) target += ".js";
      await visit(target);
    }
  }
  await visit(entry);
  return seen;
}

test("complete local import closure is statically free of provider, credential, usage-log and network paths", async () => {
  const files = await importClosure(new URL(apiUrl).pathname);
  assert.ok([...files].some((file) => file.endsWith("registrable-domain.js")));
  assert.ok([...files].some((file) => file.endsWith("public-suffix-list.generated.js")));
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(|DATAFORSEO_(?:LOGIN|PASSWORD)|recordApiUsage|api_usage/i, file);
  }
});

test("fresh-process sentinels prove every route avoids fetch and provider credentials", async () => {
  const script = String.raw`
    globalThis.fetch = () => { throw new Error("FETCH_CALLED"); };
    const touched = [];
    const env = new Proxy({ DB: {} }, { get(t, p) { if (/DATAFORSEO|LOGIN|PASSWORD|API_USAGE/i.test(String(p))) touched.push(String(p)); return t[p]; } });
    globalThis.__SITE_PROFILE_STORAGE_FOR_TESTS__ = {
      listSiteProfiles: async () => [{ domain: "example.com", competitors: [] }],
      exportSiteProfiles: async () => ({ version: 1, profiles: [] }),
      upsertSiteProfile: async (_db, body) => body,
      deleteSiteProfile: async (_db, domain) => ({ domain }),
    };
    const api = await import(${JSON.stringify(apiUrl.href)});
    const req = (method, body, suffix = "") => new Request("https://x/api/v2/sites" + suffix, { method, headers: body ? {"content-type":"application/json","cf-access-jwt-assertion":"test"} : {"cf-access-jwt-assertion":"test"}, body: body ? JSON.stringify(body) : undefined });
    await api.onRequestGet({ request: req("GET"), env });
    await api.onRequestGet({ request: req("GET", null, "?format=export"), env });
    await api.onRequestPost({ request: req("POST", {domain:"example.com"}), env });
    await api.onRequestPatch({ request: req("PATCH", {domain:"example.com",label:"X"}), env });
    await api.onRequestDelete({ request: req("DELETE", {domain:"example.com"}), env });
    if (touched.length) throw new Error("CREDENTIAL_TOUCHED:" + touched.join(","));
  `;
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
