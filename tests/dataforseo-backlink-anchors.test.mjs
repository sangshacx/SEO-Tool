import assert from "node:assert/strict";
import test from "node:test";

async function loadProvider() {
  try {
    return await import("../src/v2/providers/dataforseo-backlink-anchors.js");
  } catch {
    return {};
  }
}

test("sends the anchors request and normalizes the documented provider response", async (context) => {
  const providerModule = await loadProvider();
  assert.equal(typeof providerModule.fetchBacklinkAnchors, "function");
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({
      version: "0.1.20260828",
      status_code: 20000,
      status_message: "Ok.",
      time: "1.0 sec.",
      cost: 0.02012,
      tasks_count: 1,
      tasks_error: 0,
      tasks: [{
        id: "00000000-0000-0000-0000-000000000001",
        status_code: 20000,
        status_message: "Ok.",
        time: "0.9 sec.",
        cost: 0.02012,
        result_count: 1,
        path: ["v3", "backlinks", "anchors", "live"],
        data: { target: "great-ocean-waterproof.com" },
        result: [{
          target: "great-ocean-waterproof.com",
          total_count: 37,
          items_count: 1,
          items: [{
            type: "backlinks_anchor",
            anchor: "waterproof membrane",
            rank: 41,
            backlinks: 12,
            first_seen: "2026-08-01 01:02:03 +00:00",
            lost_date: null,
            backlinks_spam_score: 7,
            broken_backlinks: 1,
            broken_pages: 1,
            referring_domains: 8,
            referring_domains_nofollow: 2,
            referring_main_domains: 7,
            referring_main_domains_nofollow: 2,
            referring_ips: 6,
            referring_subnets: 5,
            referring_pages: 11,
            referring_pages_nofollow: 3,
            referring_links_tld: { com: 8, org: 3 },
            referring_links_types: { anchor: 11 },
            referring_links_attributes: { nofollow: 3 },
            referring_links_platform_types: { cms: 7, blogs: 4 },
            referring_links_semantic_locations: { article: 9, footer: 2 },
            referring_links_countries: { US: 8, GB: 3 },
          }],
        }],
      }],
    }), { headers: { "Content-Type": "application/json" } });
  };

  const result = await providerModule.fetchBacklinkAnchors({
    login: "login",
    password: "password",
    target: "great-ocean-waterproof.com",
    limit: 25,
    offset: 25,
    sort: "referring_domains",
    status: "live",
  });

  assert.equal(captured.url, "https://api.dataforseo.com/v3/backlinks/anchors/live");
  assert.deepEqual(JSON.parse(captured.options.body), [{
    target: "great-ocean-waterproof.com",
    limit: 25,
    offset: 25,
    internal_list_limit: 10,
    order_by: ["referring_domains,desc", "backlinks,desc"],
    backlinks_status_type: "live",
    include_subdomains: true,
    exclude_internal_backlinks: true,
    rank_scale: "one_hundred",
    tag: "seo-pro-v2-backlink-anchors",
  }]);
  assert.equal(result.actualCostUsd, 0.02012);
  assert.equal(result.resultCount, 1);
  assert.deepEqual(result.data.pagination, {
    total_count: 37,
    accessible_count: 37,
    items_count: 1,
    limit: 25,
    offset: 25,
    page: 2,
    total_pages: 2,
    has_previous: true,
    has_next: false,
    offset_cap: 20000,
  });
  assert.deepEqual(result.data.items[0], {
    anchor: "waterproof membrane",
    rank: 41,
    backlinks: 12,
    first_seen: "2026-08-01 01:02:03 +00:00",
    lost_date: null,
    spam_score: 7,
    broken_backlinks: 1,
    broken_pages: 1,
    referring_domains: 8,
    referring_domains_nofollow: 2,
    referring_main_domains: 7,
    referring_main_domains_nofollow: 2,
    referring_ips: 6,
    referring_subnets: 5,
    referring_pages: 11,
    referring_pages_nofollow: 3,
    top_tlds: { com: 8, org: 3 },
    link_types: { anchor: 11 },
    link_attributes: { nofollow: 3 },
    platform_types: { cms: 7, blogs: 4 },
    semantic_locations: { article: 9, footer: 2 },
    countries: { US: 8, GB: 3 },
  });
});
