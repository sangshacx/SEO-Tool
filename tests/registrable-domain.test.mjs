import assert from "node:assert/strict";
import test from "node:test";

import {
  PUBLIC_SUFFIX_EXCEPTION_RULES,
  PUBLIC_SUFFIX_WILDCARD_RULES,
} from "../src/v2/storage/public-suffix-list.generated.js";
import { normalizeRegistrableDomain } from "../src/v2/storage/registrable-domain.js";

test("uses longest exact rules from the complete ICANN and private PSL sections", () => {
  assert.equal(normalizeRegistrableDomain("www.example.com"), "example.com");
  assert.equal(normalizeRegistrableDomain("shop.example.co.uk"), "example.co.uk");
  assert.equal(normalizeRegistrableDomain("shop.example.com.bd"), "example.com.bd");
  assert.equal(normalizeRegistrableDomain("alpha.s3.amazonaws.com"), "alpha.s3.amazonaws.com");
  assert.equal(normalizeRegistrableDomain("beta.s3.amazonaws.com"), "beta.s3.amazonaws.com");
});

test("supports wildcard rules at root depth and arbitrary label depth", () => {
  assert.equal(normalizeRegistrableDomain("foo.ck"), null);
  assert.equal(normalizeRegistrableDomain("site.foo.ck"), "site.foo.ck");
  assert.equal(normalizeRegistrableDomain("foo.compute.amazonaws.com"), null);
  assert.equal(
    normalizeRegistrableDomain("tenant.foo.compute.amazonaws.com"),
    "tenant.foo.compute.amazonaws.com",
  );
});

test("applies PSL exception rules before wildcard rules", () => {
  assert.equal(normalizeRegistrableDomain("www.ck"), "www.ck");
  assert.equal(normalizeRegistrableDomain("deep.www.ck"), "www.ck");
});

test("every pinned wildcard rule preserves separate registrants", () => {
  assert.ok(PUBLIC_SUFFIX_WILDCARD_RULES.length > 0);
  for (const suffix of PUBLIC_SUFFIX_WILDCARD_RULES) {
    const wildcardDomain = `wildcard.${suffix}`;
    assert.equal(
      normalizeRegistrableDomain(`alpha.${wildcardDomain}`),
      `alpha.${wildcardDomain}`,
      `wildcard rule *.${suffix}`,
    );
    assert.equal(
      normalizeRegistrableDomain(`beta.${wildcardDomain}`),
      `beta.${wildcardDomain}`,
      `wildcard rule *.${suffix}`,
    );
  }
});

test("every pinned exception rule overrides its corresponding wildcard", () => {
  assert.ok(PUBLIC_SUFFIX_EXCEPTION_RULES.length > 0);
  for (const exception of PUBLIC_SUFFIX_EXCEPTION_RULES) {
    assert.equal(
      normalizeRegistrableDomain(exception),
      exception,
      `exception rule !${exception}`,
    );
    assert.equal(
      normalizeRegistrableDomain(`deep.${exception}`),
      exception,
      `exception rule !${exception}`,
    );
  }
});
