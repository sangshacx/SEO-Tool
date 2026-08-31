import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  SiteProfileError,
  deleteSiteProfile,
  exportSiteProfiles,
  listSiteProfiles,
  normalizeSiteProfile,
  importSiteProfiles,
  patchSiteProfile,
  upsertSiteProfile,
} from "../src/v2/storage/site-profiles.js";

function d1For(database, { afterStandaloneDelete, failBatchAt = -1 } = {}) {
  let inBatch = false;
  let batchChain = Promise.resolve();
  const db = {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        bind(...values) {
          const bound = {
            all: async () => ({ results: statement.all(...values) }),
            first: async () => statement.get(...values) ?? null,
            run: async () => {
              const result = statement.run(...values);
              if (!inBatch && /^\s*DELETE\s+FROM\s+site_profiles/i.test(sql)) afterStandaloneDelete?.();
              return { success: true, meta: { changes: result.changes } };
            },
            _sql: sql,
          };
          return bound;
        },
      };
    },
    batch: async (statements) => {
      const operation = batchChain.catch(() => {}).then(async () => {
      inBatch = true;
      database.exec("BEGIN");
      try {
        const results = [];
        for (let index = 0; index < statements.length; index += 1) {
          if (index === failBatchAt) throw new Error("INJECTED_BATCH_FAILURE");
          results.push(/^\s*DELETE\s+/i.test(statements[index]._sql)
            ? await statements[index].run()
            : { success: true, ...await statements[index].all() });
        }
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      } finally {
        inBatch = false;
      }
      });
      batchChain = operation;
      return operation;
    },
  };
  return db;
}

async function profileDb() {
  const database = new DatabaseSync(":memory:");
  database.exec(await readFile(new URL("../migrations/0007_site_profiles.sql", import.meta.url), "utf8"));
  return d1For(database);
}

function errorWith(code, status) {
  return (error) => error instanceof SiteProfileError && error.code === code && error.httpStatus === status;
}

test("normalizes domains and derives canonical market names from the catalog", () => {
  const profile = normalizeSiteProfile({
    domain: "https://WWW.Example.COM/path?ignored=yes",
    label: "  Example profile  ",
    location_code: 2682,
    location_name: "Caller supplied name",
    country_iso_code: "ZZ",
    language_code: "AR",
    language_name: "Caller supplied language",
    include_subdomains: true,
    competitors: ["https://WWW.Competitor.com/path", "Second.example"],
  });

  assert.deepEqual(profile, {
    domain: "example.com",
    label: "Example profile",
    location_code: 2682,
    location_name: "Saudi Arabia",
    country_iso_code: "SA",
    language_code: "ar",
    language_name: "Arabic",
    include_subdomains: true,
    competitors: ["competitor.com", "second.example"],
  });
});

test("rejects unsafe domains and unsupported markets", () => {
  assert.throws(
    () => normalizeSiteProfile({ domain: "localhost" }),
    errorWith("INVALID_DOMAIN", 400),
  );
  assert.throws(
    () => normalizeSiteProfile({ domain: "example.com", location_code: 2840, language_code: "ar" }),
    errorWith("UNSUPPORTED_MARKET", 400),
  );
});

test("rejects exact and post-normalization duplicate competitors", () => {
  for (const competitors of [
    ["rival.example", "rival.example"],
    ["shop.rival.co.uk", "https://blog.rival.co.uk/path"],
  ]) {
    assert.throws(
      () => normalizeSiteProfile({ domain: "example.com", competitors }),
      errorWith("DUPLICATE_COMPETITOR", 400),
    );
  }
});

test("rejects more than five raw competitor inputs before normalization", () => {
  assert.throws(
    () => normalizeSiteProfile({
      domain: "example.com",
      competitors: ["one.example", "two.example", "three.example", "four.example", "five.example", "five.example"],
    }),
    errorWith("TOO_MANY_COMPETITORS", 400),
  );
});

test("normalizes site and competitor inputs to registrable root domains", () => {
  assert.deepEqual(normalizeSiteProfile({
    domain: "https://blog.example.com/path",
    competitors: ["https://news.rival.co.uk/article"],
  }), {
    domain: "example.com",
    label: "example.com",
    location_code: 2840,
    location_name: "United States",
    country_iso_code: "US",
    language_code: "en",
    language_name: "English",
    include_subdomains: false,
    competitors: ["rival.co.uk"],
  });
});

test("treats configured private suffixes as registrable boundaries", () => {
  const profile = normalizeSiteProfile({
    domain: "blog.team.github.io",
    competitors: ["cdn.other.github.io"],
  });

  assert.equal(profile.domain, "team.github.io");
  assert.deepEqual(profile.competitors, ["other.github.io"]);
});

test("rejects a competitor expressed as another subdomain of the site root", () => {
  assert.throws(
    () => normalizeSiteProfile({ domain: "blog.example.com", competitors: ["shop.example.com"] }),
    errorWith("INVALID_COMPETITOR", 400),
  );
});

test("upserts concurrent writes for one normalized domain without duplicate profiles", async () => {
  const db = await profileDb();
  const saved = await Promise.all([
    upsertSiteProfile(db, { domain: "Beta.example", label: "Beta", location_code: 2682, language_code: "ar" }),
    upsertSiteProfile(db, { domain: "https://www.beta.example/path", label: "Updated Beta", location_code: 2682, language_code: "ar" }),
  ]);
  await upsertSiteProfile(db, { domain: "alpha.example", label: "Alpha" });

  assert.equal(saved.every((profile) => profile.domain === "beta.example" && profile.language_code === "ar"), true);
  assert.equal(saved.every((profile) => profile.location_name === "Saudi Arabia"), true);
  assert.deepEqual((await listSiteProfiles(db)).map((profile) => profile.domain), ["alpha.example", "beta.example"]);
});

test("uses normalized root domains for upsert and deletion keys", async () => {
  const db = await profileDb();
  await upsertSiteProfile(db, { domain: "blog.example.com", label: "Blog" });
  await upsertSiteProfile(db, { domain: "shop.example.com", label: "Shop" });
  await upsertSiteProfile(db, { domain: "other.example" });

  assert.deepEqual((await listSiteProfiles(db)).map((profile) => profile.domain), ["example.com", "other.example"]);
  assert.deepEqual(await deleteSiteProfile(db, "https://cdn.example.com/path"), { domain: "example.com" });
});

test("exports canonical profiles in a deterministic versioned portable envelope", async () => {
  const db = await profileDb();
  await upsertSiteProfile(db, { domain: "zulu.example", competitors: ["b.example", "a.example"] });
  await upsertSiteProfile(db, { domain: "alpha.example", label: "Alpha" });

  assert.deepEqual(await exportSiteProfiles(db), {
    version: 1,
    profiles: [
    {
      domain: "alpha.example",
      label: "Alpha",
      location_code: 2840,
      location_name: "United States",
      country_iso_code: "US",
      language_code: "en",
      language_name: "English",
      include_subdomains: false,
      competitors: [],
    },
    {
      domain: "zulu.example",
      label: "zulu.example",
      location_code: 2840,
      location_name: "United States",
      country_iso_code: "US",
      language_code: "en",
      language_name: "English",
      include_subdomains: false,
      competitors: ["a.example", "b.example"],
    },
    ],
  });
});

test("patch updates only explicit fields and keeps concurrent market and editorial changes", async () => {
  for (const order of ["editorial-first", "market-first"]) {
    const db = await profileDb();
    await upsertSiteProfile(db, { domain: "example.com", label: "Old", competitors: ["old.example"] });
    const editorial = () => patchSiteProfile(db, { domain: "example.com", label: "New", competitors: ["new.example"] });
    const market = () => patchSiteProfile(db, { domain: "example.com", location_code: 2682, language_code: "ar" });
    if (order === "editorial-first") { await editorial(); await market(); } else { await market(); await editorial(); }
    assert.deepEqual(await listSiteProfiles(db), [{
      domain: "example.com", label: "New", location_code: 2682, location_name: "Saudi Arabia",
      country_iso_code: "SA", language_code: "ar", language_name: "Arabic", include_subdomains: false,
      competitors: ["new.example"],
    }]);
  }
});

test("patch requires both market identifiers and returns 404 without insertion", async () => {
  const db = await profileDb();
  await assert.rejects(patchSiteProfile(db, { domain: "missing.example", label: "X" }), errorWith("PROFILE_NOT_FOUND", 404));
  await upsertSiteProfile(db, { domain: "example.com" });
  await assert.rejects(patchSiteProfile(db, { domain: "example.com", location_code: 2682 }), errorWith("INCOMPLETE_MARKET", 400));
});

test("versioned export imports into a separate database with canonical round-trip equality", async () => {
  const source = await profileDb();
  await upsertSiteProfile(source, { domain: "blog.example.com", label: "Example", location_code: 2682, language_code: "ar", competitors: ["www.rival.co.uk"] });
  await upsertSiteProfile(source, { domain: "second.example" });
  const envelope = await exportSiteProfiles(source);
  const target = await profileDb();
  assert.deepEqual(await importSiteProfiles(target, envelope), envelope);
  assert.deepEqual(await exportSiteProfiles(target), envelope);
});

test("import fully validates version, shape, count, duplicates, and markets before a batch write", async () => {
  const db = await profileDb();
  await upsertSiteProfile(db, { domain: "existing.example", label: "Keep" });
  for (const [input, code] of [
    [{ version: 2, profiles: [] }, "UNSUPPORTED_IMPORT_VERSION"],
    [{ version: 1, profiles: {} }, "INVALID_IMPORT_SHAPE"],
    [{ version: 1, profiles: [], extra: true }, "INVALID_IMPORT_SHAPE"],
    [{ version: 1, profiles: Array.from({ length: 101 }, (_, i) => ({ domain: `site-${i}.example` })) }, "TOO_MANY_PROFILES"],
    [{ version: 1, profiles: [{ domain: "www.example.com" }, { domain: "blog.example.com" }] }, "DUPLICATE_PROFILE"],
    [{ version: 1, profiles: [{ domain: "bad.example", location_code: 2840, language_code: "ar" }] }, "UNSUPPORTED_MARKET"],
  ]) {
    await assert.rejects(importSiteProfiles(db, input), (error) => error.code === code);
    assert.equal((await listSiteProfiles(db))[0].label, "Keep");
  }
});

test("import batch failure rolls back every upsert", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(await readFile(new URL("../migrations/0007_site_profiles.sql", import.meta.url), "utf8"));
  const seed = d1For(database);
  await upsertSiteProfile(seed, { domain: "existing.example", label: "Keep" });
  const failing = d1For(database, { failBatchAt: 1 });
  await assert.rejects(importSiteProfiles(failing, {
    version: 1,
    profiles: [{ domain: "first.example" }, { domain: "second.example" }],
  }), /INJECTED_BATCH_FAILURE/);
  assert.deepEqual((await listSiteProfiles(seed)).map((profile) => profile.domain), ["existing.example"]);
});

test("allows only one of two concurrent deletions to remove a profile", async () => {
  const db = await profileDb();
  await upsertSiteProfile(db, { domain: "alpha.example" });
  await upsertSiteProfile(db, { domain: "beta.example" });

  const results = await Promise.allSettled([
    deleteSiteProfile(db, "alpha.example"),
    deleteSiteProfile(db, "beta.example"),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && errorWith("LAST_PROFILE", 409)(result.reason)).length, 1);
  assert.equal((await listSiteProfiles(db)).length, 1);
});

test("keeps a guarded final-profile delete as a conflict when an upsert interleaves", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(await readFile(new URL("../migrations/0007_site_profiles.sql", import.meta.url), "utf8"));
  const seed = d1For(database);
  await upsertSiteProfile(seed, { domain: "alpha.example" });
  const db = d1For(database, {
    afterStandaloneDelete: () => database.prepare("INSERT INTO site_profiles (domain, label) VALUES ('beta.example', 'Beta')").run(),
  });

  await assert.rejects(deleteSiteProfile(db, "alpha.example"), errorWith("LAST_PROFILE", 409));
});
