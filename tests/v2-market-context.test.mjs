import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMarketToRoot,
  compatibleLanguages,
  composeMarketWarnings,
  createProfileMarketSync,
  createMarketContext,
  loadSiteProfilesD1First,
  importSiteProfileEnvelope,
  marketRequestFields,
  orderedLocations,
  profileExportUrl,
  parseSiteProfileImportText,
  resolveProfileMarket,
  resolveActiveProfile,
  siteProfileFormPayload,
} from "../public/v2-market-context.js";

const catalog = {
  locations: [
    { location_code: 2682, location_name: "Saudi Arabia", country_iso_code: "SA", supported_language_codes: ["ar"] },
    { location_code: 2840, location_name: "United States", country_iso_code: "US", supported_language_codes: ["en", "es"] },
    { location_code: 2826, location_name: "United Kingdom", country_iso_code: "GB", supported_language_codes: ["en"] },
  ],
  languages: [
    { language_code: "ar", language_name: "Arabic" },
    { language_code: "en", language_name: "English" },
    { language_code: "es", language_name: "Spanish" },
  ],
  pinned_location_codes: [2840, 2826, 2682],
};

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("market context normalizes values, notifies subscribers and exposes request fields", () => {
  const context = createMarketContext({ location_code: 2682, location_name: "Saudi Arabia", language_code: "ar", language_name: "Arabic" });
  const seen = [];
  const unsubscribe = context.subscribe((market) => seen.push(market.language_code));
  assert.deepEqual(marketRequestFields(context), { location_code: 2682, language_code: "ar" });
  context.set({ location_code: 2840, location_name: "United States", language_code: "en", language_name: "English" });
  unsubscribe();
  context.set({ location_code: 2682, location_name: "Saudi Arabia", language_code: "ar", language_name: "Arabic" });
  assert.deepEqual(seen, ["ar", "en"]);
});

test("market application changes only compatible fields and never submits", () => {
  let submitEvents = 0;
  const fields = [{ value: "" }, { value: "" }];
  const root = {
    querySelectorAll(selector) {
      if (selector === "[data-v2-location-code]") return [fields[0]];
      if (selector === "[data-v2-language-code]") return [fields[1]];
      return [];
    },
    dispatchEvent() { submitEvents += 1; },
  };
  assert.equal(applyMarketToRoot(root, { location_code: 2682, language_code: "ar" }), true);
  assert.deepEqual(fields.map((field) => field.value), ["2682", "ar"]);
  assert.equal(submitEvents, 0);
});

test("pinned locations are first without duplicates and languages are pair-filtered", () => {
  assert.deepEqual(orderedLocations(catalog).map((item) => item.location_code), [2840, 2826, 2682]);
  assert.deepEqual(compatibleLanguages(catalog, 2682).map((item) => item.language_code), ["ar"]);
  assert.deepEqual(compatibleLanguages(catalog, 2840).map((item) => item.language_code), ["en", "es"]);
});

test("D1 non-empty profiles are authoritative and legacy data is never posted", async () => {
  const calls = [];
  const local = storage({ "seo-pro-v2.site-profiles.v1": JSON.stringify([{ domain: "legacy.example", label: "Legacy" }]) });
  const result = await loadSiteProfilesD1First({
    storage: local,
    catalog,
    fetchImpl: async (url, init = {}) => {
      calls.push([url, init.method || "GET"]);
      return jsonResponse({ ok: true, data: [{ domain: "server.example", label: "Server", location_code: 2682, location_name: "Saudi Arabia", country_iso_code: "SA", language_code: "ar", language_name: "Arabic", competitors: [] }] });
    },
  });
  assert.equal(result.source, "d1");
  assert.deepEqual(result.profiles.map((item) => item.domain), ["server.example"]);
  assert.deepEqual(calls, [["/api/v2/sites", "GET"]]);
});

test("legacy migration is idempotent and is marked complete only after successful writes", async () => {
  const legacy = [{ domain: "legacy.example", label: "Legacy" }];
  const local = storage({ "seo-pro-v2.site-profiles.v1": JSON.stringify(legacy) });
  let server = [];
  let postCount = 0;
  const fetchImpl = async (_url, init = {}) => {
    if ((init.method || "GET") === "POST") {
      postCount += 1;
      server.push(JSON.parse(init.body));
      return jsonResponse({ ok: true, data: server.at(-1), meta: { actual_cost_usd: 0 } });
    }
    return jsonResponse({ ok: true, data: server });
  };
  const first = await loadSiteProfilesD1First({ storage: local, catalog, fetchImpl });
  assert.equal(first.migrated, true);
  assert.equal(local.getItem("seo-pro-v2.site-profiles-d1-migrated.v1"), "complete");
  assert.equal(postCount, 1);
  await loadSiteProfilesD1First({ storage: local, catalog, fetchImpl });
  assert.equal(postCount, 1);

  const failedStorage = storage({ "seo-pro-v2.site-profiles.v1": JSON.stringify(legacy) });
  let reads = 0;
  const failed = await loadSiteProfilesD1First({
    storage: failedStorage,
    catalog,
    fetchImpl: async (_url, init = {}) => {
      if ((init.method || "GET") === "POST") return jsonResponse({ ok: false }, 500);
      reads += 1;
      return jsonResponse({ ok: true, data: [] });
    },
  });
  assert.equal(reads, 1);
  assert.equal(failed.source, "local-fallback");
  assert.equal(failedStorage.getItem("seo-pro-v2.site-profiles-d1-migrated.v1"), null);
});

test("D1 read failure provides an explicit temporary local fallback", async () => {
  const local = storage({ "seo-pro-v2.site-profiles.v1": JSON.stringify([{ domain: "local.example", label: "Local" }]) });
  const result = await loadSiteProfilesD1First({ storage: local, catalog, fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(result.source, "local-fallback");
  assert.match(result.warning, /未同步|临时/);
  assert.equal(result.profiles[0].location_code, 2840);
  assert.equal(result.profiles[0].language_code, "en");
});

test("malformed successful D1 list payloads use the explicit local fallback", async () => {
  for (const data of [null, { domain: "bad.example" }]) {
    const local = storage({ "seo-pro-v2.site-profiles.v1": JSON.stringify([{ domain: "local.example", label: "Local" }]) });
    const result = await loadSiteProfilesD1First({ storage: local, catalog, fetchImpl: async () => jsonResponse({ ok: true, data }) });
    assert.equal(result.source, "local-fallback");
    assert.equal(result.profiles[0].domain, "local.example");
    assert.match(result.warning, /未同步|临时/);
  }
});

test("resolves the saved active site before market context creation", () => {
  const profiles = [{ domain: "first.example" }, { domain: "second.example" }];
  assert.equal(resolveActiveProfile(profiles, "second.example").domain, "second.example");
  assert.equal(resolveActiveProfile(profiles, "missing.example").domain, "first.example");
});

test("market compatibility warning clears for a valid profile without changing sync state", () => {
  const invalid = resolveProfileMarket(catalog, { domain: "old.example", location_code: 9999, language_code: "xx" });
  assert.match(invalid.warning, /不受支持/);
  assert.deepEqual(
    { location_code: invalid.market.location_code, language_code: invalid.market.language_code },
    { location_code: 2840, language_code: "en" },
  );

  const dirtyState = { dirty_domains: ["dirty.example"], failed_domains: ["dirty.example"] };
  const valid = resolveProfileMarket(catalog, { domain: "valid.example", location_code: 2682, language_code: "ar" });
  assert.equal(valid.warning, "");
  assert.deepEqual(dirtyState, { dirty_domains: ["dirty.example"], failed_domains: ["dirty.example"] });
  assert.equal(
    composeMarketWarnings({ compatibility: valid.warning, dirtyDomains: dirtyState.dirty_domains }),
    "尚未同步：dirty.example",
  );
  assert.equal(valid.market.location_code, 2682);
  assert.equal(valid.market.language_code, "ar");
});

test("dirty market writes remain per-domain retryable until each latest revision succeeds", async () => {
  const attempts = new Map();
  const states = [];
  const sync = createProfileMarketSync({
    write: async (domain, market) => {
      attempts.set(domain, (attempts.get(domain) || 0) + 1);
      if (domain === "a.example" && attempts.get(domain) === 1) throw new Error("offline");
      return { domain, ...market };
    },
    onStateChange: (state) => states.push(state),
  });
  await sync.save("a.example", { location_code: 2682, language_code: "ar" });
  assert.equal(sync.get("a.example").status, "failed");
  await sync.save("b.example", { location_code: 2840, language_code: "en" });
  assert.deepEqual(sync.dirtyDomains(), ["a.example"]);
  assert.equal(sync.get("a.example").retryable, true);
  assert.deepEqual(states.at(-1), { dirty_domains: ["a.example"], failed_domains: ["a.example"] });
  const returnedProfile = resolveActiveProfile([{ domain: "a.example" }, { domain: "b.example" }], "a.example");
  assert.equal(returnedProfile.domain, "a.example");
  assert.equal(sync.get(returnedProfile.domain).status, "failed", "returning to A must retain its visible retry state");
  await sync.retry("a.example");
  assert.deepEqual(sync.dirtyDomains(), []);
  assert.equal(sync.get("a.example"), null);
  assert.deepEqual(states.at(-1), { dirty_domains: [], failed_domains: [] });
  assert.equal(attempts.get("a.example"), 2);
  assert.ok(states.some((state) => state.dirty_domains.includes("a.example")));
});

test("malformed post-migration rereads remain a local fallback and never claim D1 sync", async () => {
  const local = storage({ "seo-pro-v2.site-profiles.v1": JSON.stringify([{ domain: "local.example", label: "Local" }]) });
  let reads = 0;
  const result = await loadSiteProfilesD1First({
    storage: local,
    catalog,
    fetchImpl: async (_url, init = {}) => {
      if ((init.method || "GET") === "POST") return jsonResponse({ ok: true, data: { domain: "local.example" } });
      reads += 1;
      return jsonResponse({ ok: true, data: reads === 1 ? [] : null });
    },
  });
  assert.equal(result.source, "local-fallback");
  assert.equal(result.profiles[0].domain, "local.example");
  assert.match(result.warning, /未同步|临时/);
  assert.equal(local.getItem("seo-pro-v2.site-profiles-d1-migrated.v1"), null);
});

test("stale write completion cannot clear a newer dirty revision", async () => {
  const releases = [];
  const sync = createProfileMarketSync({ write: (_domain, market) => new Promise((resolve) => releases.push(() => resolve(market))) });
  const first = sync.save("a.example", { location_code: 2840, language_code: "en" });
  const second = sync.save("a.example", { location_code: 2682, language_code: "ar" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 1, "same-domain writes must be serialized");
  releases.shift()();
  await first;
  assert.equal(sync.get("a.example").market.location_code, 2682);
  await new Promise((resolve) => setImmediate(resolve));
  releases.shift()();
  await second;
  assert.equal(sync.get("a.example"), null);
});

test("profile edits preserve include_subdomains unless explicitly changed", () => {
  assert.equal(siteProfileFormPayload({ include_subdomains: true }, { label: "Changed" }).include_subdomains, true);
  assert.equal(siteProfileFormPayload({ include_subdomains: true }, { include_subdomains: false }).include_subdomains, false);
});

test("profile export is a relative versioned JSON endpoint", () => {
  assert.equal(profileExportUrl(), "/api/v2/sites?format=export");
});

test("profile import parses only a bounded version-one envelope", () => {
  const valid = { version: 1, profiles: [{ domain: "example.com" }] };
  assert.deepEqual(parseSiteProfileImportText(JSON.stringify(valid)), valid);
  assert.throws(() => parseSiteProfileImportText(JSON.stringify({ version: 2, profiles: [] })), /UNSUPPORTED_IMPORT_VERSION/);
  assert.throws(() => parseSiteProfileImportText(JSON.stringify({ version: 1, profiles: {} })), /INVALID_IMPORT_SHAPE/);
  assert.throws(() => parseSiteProfileImportText("x".repeat(65537)), /PAYLOAD_TOO_LARGE/);
});

test("profile import posts the exact envelope to the relative zero-cost endpoint", async () => {
  const calls = [];
  const envelope = { version: 1, profiles: [{ domain: "example.com" }] };
  const data = await importSiteProfileEnvelope(async (url, init) => {
    calls.push([url, init]);
    return jsonResponse({ ok: true, data: envelope });
  }, envelope);
  assert.deepEqual(data, envelope);
  assert.equal(calls[0][0], "/api/v2/sites?format=import");
  assert.equal(calls[0][1].method, "POST");
  assert.deepEqual(JSON.parse(calls[0][1].body), envelope);
});
