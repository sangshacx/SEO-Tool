import assert from "node:assert/strict";
import test from "node:test";

import { buildOrganicCompetitorsCacheKey } from "../src/v2/organic/organic-competitors-cache.js";

test("Organic Competitors cache key isolates target and market and records discovery policy", () => {
  const a=buildOrganicCompetitorsCacheKey({target:"example.com",locationCode:2840,languageCode:"en"});
  const b=buildOrganicCompetitorsCacheKey({target:"example.com",locationCode:2682,languageCode:"en"});
  assert.notEqual(a,b);
  assert.match(a,/max20/);
  assert.match(a,/exclude-top/);
  assert.match(a,/100$/);
});
