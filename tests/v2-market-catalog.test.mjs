import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

import {
  LANGUAGES,
  LOCATIONS,
  MARKET_CATALOG_VERSION,
  findLanguage,
  findLocation,
  isSupportedMarket,
  pinnedLocations,
} from "../src/v2/markets/catalog.js";

const execFileAsync = promisify(execFile);

test("finds checked-in DataForSEO country and language records", () => {
  assert.equal(findLocation(2840).country_iso_code, "US");
  assert.equal(findLocation(2682).location_name, "Saudi Arabia");
  assert.equal(findLanguage("ar").language_name, "Arabic");
  assert.equal(findLanguage("sq").language_name, "Albanian");
  assert.equal(findLanguage("EN").language_code, "en");
  assert.equal(findLocation("not-a-code"), null);
  assert.equal(findLanguage("not-a-language"), null);
});

test("accepts only catalog markets without making provider calls", () => {
  assert.equal(isSupportedMarket(2840, "en"), true);
  assert.equal(isSupportedMarket(2682, "ar"), true);
  assert.equal(isSupportedMarket(2008, "sq"), true);
  assert.equal(isSupportedMarket(2008, "ar"), false);
  assert.equal(isSupportedMarket(999999, "en"), false);
  assert.equal(isSupportedMarket(2840, "zz"), false);
});

test("resolves every canonical language and supported pair case-insensitively", () => {
  for (const language of LANGUAGES) {
    assert.equal(findLanguage(language.language_code)?.language_code, language.language_code);
    assert.equal(findLanguage(language.language_code.toLowerCase())?.language_code, language.language_code);
  }

  for (const location of LOCATIONS) {
    for (const languageCode of location.supported_language_codes) {
      assert.equal(isSupportedMarket(location.location_code, languageCode), true);
      assert.equal(isSupportedMarket(location.location_code, languageCode.toLowerCase()), true);
    }
  }
});

test("pins every documented common market once in documented order", () => {
  assert.deepEqual(
    pinnedLocations().map((location) => location.location_code),
    [2840, 2826, 2124, 2036, 2682, 2784, 2702, 2356],
  );
  assert.equal(
    new Set(pinnedLocations().map((location) => location.location_code)).size,
    pinnedLocations().length,
  );
});

test("does not allow callers to mutate catalog data", () => {
  assert.throws(() => {
    findLocation(2840).location_name = "Changed";
  }, TypeError);
  assert.throws(() => {
    LOCATIONS.push({});
  }, TypeError);
  assert.throws(() => {
    LANGUAGES.push({});
  }, TypeError);
  assert.throws(() => {
    findLocation(2840).supported_language_codes.pop();
  }, TypeError);

  const pinned = pinnedLocations();
  assert.throws(() => {
    pinned.pop();
  }, TypeError);
  assert.equal(findLocation(2840).location_name, "United States");
});

test("keeps the public JSON catalog exactly aligned with the module", async () => {
  const publicCatalog = JSON.parse(
    await readFile(new URL("../public/data/v2-markets.json", import.meta.url), "utf8"),
  );

  assert.deepEqual(publicCatalog, {
    version: MARKET_CATALOG_VERSION,
    locations: LOCATIONS,
    languages: LANGUAGES,
    pinned_location_codes: [2840, 2826, 2124, 2036, 2682, 2784, 2702, 2356],
  });
});

test("generated catalog artifacts are current", async () => {
  await execFileAsync(process.execPath, ["scripts/generate-v2-market-catalog.mjs", "--check"]);
});
