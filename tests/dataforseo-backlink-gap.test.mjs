import assert from "node:assert/strict";
import test from "node:test";

async function loadProvider() {
  try {
    return await import("../src/v2/providers/dataforseo-backlink-gap.js");
  } catch {
    return {};
  }
}

test("requests domain intersection and normalizes competitor coverage", async (context) => {
  const providerModule = await loadProvider();
  assert.equal(typeof providerModule.fetchBacklinkGap, "function");
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({
      version: "0.1.20260829",
      status_code: 20000,
      status_message: "Ok.",
      cost: 0.02015,
      tasks_count: 1,
      tasks_error: 0,
      tasks: [{
        status_code: 20000,
        status_message: "Ok.",
        cost: 0.02015,
        result_count: 1,
        result: [{
          targets: { "1": "competitor-a.com", "2": "competitor-b.com" },
          total_count: 42,
          items_count: 1,
          items: [{
            domain_intersection: {
              "1": {
                target: "www.industry-journal.com",
                rank: 80,
                backlinks: 12,
                referring_pages: 10,
                referring_pages_nofollow: 2,
                backlinks_spam_score: 6,
                broken_backlinks: 1,
                first_seen: "2025-01-01 00:00:00 +00:00",
              },
              "2": {
                target: "industry-journal.com",
                rank: 70,
                backlinks: 7,
                referring_pages: 6,
                referring_pages_nofollow: 1,
                backlinks_spam_score: 4,
                broken_backlinks: 0,
                first_seen: "2025-02-01 00:00:00 +00:00",
              },
            },
          }],
          summary: { intersections_count: 42 },
        }],
      }],
    }), { headers: { "Content-Type": "application/json" } });
  };

  const result = await providerModule.fetchBacklinkGap({
    login: "login",
    password: "password",
    ownDomain: "own-site.com",
    competitors: ["competitor-a.com", "competitor-b.com"],
    limit: 25,
    offset: 25,
  });

  assert.equal(captured.url, "https://api.dataforseo.com/v3/backlinks/domain_intersection/live");
  assert.deepEqual(JSON.parse(captured.options.body), [{
    targets: { "1": "competitor-a.com", "2": "competitor-b.com" },
    exclude_targets: ["own-site.com"],
    limit: 25,
    offset: 25,
    internal_list_limit: 5,
    order_by: ["1.rank,desc", "2.rank,desc"],
    backlinks_status_type: "live",
    intersection_mode: "all",
    include_subdomains: true,
    include_indirect_links: false,
    exclude_internal_backlinks: true,
    rank_scale: "one_hundred",
    tag: "seo-pro-v2-backlink-gap",
  }]);
  assert.equal(result.actualCostUsd, 0.02015);
  assert.equal(result.resultCount, 1);
  assert.deepEqual(result.data.pagination, {
    total_count: 42,
    accessible_count: 42,
    items_count: 1,
    limit: 25,
    offset: 25,
    page: 2,
    total_pages: 2,
    has_previous: true,
    has_next: false,
    offset_cap: 20000,
  });
  assert.equal(result.data.items[0].domain, "industry-journal.com");
  assert.deepEqual(result.data.items[0].competitors.map((item) => item.domain), ["competitor-a.com", "competitor-b.com"]);
  assert.equal(result.data.items[0].competitors[0].spam_score, 6);
});

test("preserves a merged result that links to only one requested competitor", async (context) => {
  const { fetchBacklinkGap } = await loadProvider();
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    version: "0.1.20260829",
    status_code: 20000,
    status_message: "Ok.",
    cost: 0.02015,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [{
      status_code: 20000,
      status_message: "Ok.",
      cost: 0.02015,
      result_count: 1,
      result: [{
        targets: { "1": "competitor-a.com", "2": "competitor-b.com" },
        total_count: 1,
        items_count: 1,
        items: [{
          domain_intersection: {
            "2": {
              type: "backlinks_domain_intersection",
              target: "one-competitor-source.com",
              rank: 55,
              backlinks: 4,
              first_seen: "2025-04-01 00:00:00 +00:00",
              lost_date: null,
              backlinks_spam_score: 7,
              broken_backlinks: 0,
              broken_pages: 0,
              referring_domains: 1,
              referring_domains_nofollow: 0,
              referring_main_domains: 1,
              referring_main_domains_nofollow: 0,
              referring_ips: 1,
              referring_subnets: 1,
              referring_pages: 4,
              referring_links_tld: { com: 4 },
              referring_links_types: { anchor: 4 },
              referring_links_attributes: null,
              referring_links_platform_types: { blogs: 4 },
              referring_links_semantic_locations: { article: 4 },
              referring_links_countries: null,
              referring_pages_nofollow: 1,
            },
          },
          summary: { intersections_count: 1 },
        }],
      }],
    }],
  }));

  const result = await fetchBacklinkGap({
    login: "login",
    password: "password",
    ownDomain: "own-site.com",
    competitors: ["competitor-a.com", "competitor-b.com"],
    limit: 25,
    offset: 0,
  });

  assert.equal(result.data.items[0].domain, "one-competitor-source.com");
  assert.deepEqual(result.data.items[0].competitors.map((item) => item.domain), ["competitor-b.com"]);
  assert.equal(result.data.items[0].metrics.coverage_count, 1);
  assert.equal(result.data.items[0].metrics.coverage_percent, 50);
});

test("rejects an oversized provider response before buffering it", async (context) => {
  const { fetchBacklinkGap } = await loadProvider();
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response("{}", {
    headers: { "Content-Length": String((4 * 1024 * 1024) + 1) },
  });

  await assert.rejects(
    fetchBacklinkGap({
      login: "login",
      password: "password",
      ownDomain: "own-site.com",
      competitors: ["competitor-a.com"],
      limit: 25,
      offset: 0,
    }),
    (error) => error?.code === "PROVIDER_RESPONSE_TOO_LARGE",
  );
});

test("returns a structured provider error for malformed JSON", async (context) => {
  const { fetchBacklinkGap } = await loadProvider();
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response("{broken");

  await assert.rejects(
    fetchBacklinkGap({
      login: "login",
      password: "password",
      ownDomain: "own-site.com",
      competitors: ["competitor-a.com"],
      limit: 25,
      offset: 0,
    }),
    (error) => error?.code === "PROVIDER_INVALID_RESPONSE",
  );
});
