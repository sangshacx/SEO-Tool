import assert from "node:assert/strict";
import test from "node:test";

import * as domainModule from "../src/v2/backlinks/domain.js";

test("builds an anchor cache key from provider inputs only", () => {
  assert.equal(typeof domainModule.backlinkAnchorsCacheKey, "function");
  assert.equal(
    domainModule.backlinkAnchorsCacheKey({
      domain: "great-ocean-waterproof.com",
      limit: 25,
      offset: 50,
      sort: "backlinks",
      status: "live",
    }),
    "v2:backlink-anchors:v1:great-ocean-waterproof.com:subdomains:live:25:50:backlinks",
  );
});
