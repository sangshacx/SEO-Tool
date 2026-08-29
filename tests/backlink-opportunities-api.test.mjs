import assert from "node:assert/strict";
import test from "node:test";

async function loadApi() {
  try {
    return await import("../functions/api/v2/backlinks/opportunities.js");
  } catch {
    return {};
  }
}

function jsonRequest(method, body) {
  return new Request("https://preview.example/api/v2/backlinks/opportunities", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function statementFactory(statements) {
  return (sql) => ({
    bind: (...values) => {
      const statement = { sql, values };
      statements.push(statement);
      return statement;
    },
  });
}

test("lists saved prospects for one own domain with status filtering and pagination", async () => {
  const { onRequestGet } = await loadApi();
  assert.equal(typeof onRequestGet, "function");
  const statements = [];
  const response = await onRequestGet({
    request: new Request("https://preview.example/api/v2/backlinks/opportunities?own_domain=Own-Site.com&status=researching&limit=25&offset=0"),
    env: {
      DB: {
        prepare: statementFactory(statements),
        batch: async () => [
          { results: [{ total_count: 1 }] },
          { results: [{
            own_domain: "own-site.com",
            referring_domain: "industry-journal.com",
            competitor_domains_json: "[\"competitor-a.com\",\"competitor-b.com\"]",
            opportunity_score: 87,
            opportunity_label: "High priority",
            status: "researching",
            notes: "Find the editor",
            first_discovered_at: "2026-08-29 10:00:00",
            last_seen_at: "2026-08-29 11:00:00",
            created_at: "2026-08-29 10:00:00",
            updated_at: "2026-08-29 11:00:00",
          }] },
        ],
      },
    },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.data.items[0].competitor_domains, ["competitor-a.com", "competitor-b.com"]);
  assert.equal(body.data.items[0].status, "researching");
  assert.deepEqual(body.data.pagination, {
    total_count: 1,
    items_count: 1,
    limit: 25,
    offset: 0,
    has_previous: false,
    has_next: false,
  });
  assert.match(statements[0].sql, /status = \?/);
  assert.deepEqual(statements[0].values, ["own-site.com", "researching"]);
  assert.deepEqual(statements[1].values, ["own-site.com", "researching", 25, 0]);
  assert.equal(body.meta.actual_cost_usd, 0);
});

test("batch upserts normalized unique prospects without overwriting workflow fields", async () => {
  const { onRequestPost } = await loadApi();
  assert.equal(typeof onRequestPost, "function");
  const statements = [];
  let batched = [];
  const response = await onRequestPost({
    request: jsonRequest("POST", {
      own_domain: "https://Own-Site.com/",
      items: [
        {
          referring_domain: "Industry-Journal.com",
          competitor_domains: ["Competitor-B.com", "competitor-a.com"],
          opportunity_score: 87,
          opportunity_label: "High priority",
        },
        {
          referring_domain: "industry-journal.com",
          competitor_domains: ["competitor-a.com"],
          opportunity_score: 85,
          opportunity_label: "High priority",
        },
        {
          referring_domain: "directory.example",
          competitor_domains: ["competitor-a.com"],
          opportunity_score: 61,
          opportunity_label: "Good opportunity",
        },
      ],
    }),
    env: {
      DB: {
        prepare: statementFactory(statements),
        batch: async (rows) => {
          batched = rows;
          return rows.map(() => ({ success: true, meta: { changes: 1 } }));
        },
      },
    },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.saved_count, 2);
  assert.equal(batched.length, 2);
  assert.deepEqual(body.data.items.map((item) => item.referring_domain), ["industry-journal.com", "directory.example"]);
  assert.deepEqual(JSON.parse(batched[0].values[2]), ["competitor-a.com"]);
  assert.match(batched[0].sql, /ON CONFLICT\s*\(own_domain, referring_domain\)\s*DO UPDATE/i);
  assert.doesNotMatch(batched[0].sql, /status\s*=\s*excluded\.status/i);
  assert.doesNotMatch(batched[0].sql, /notes\s*=\s*excluded\.notes/i);
  assert.equal(body.meta.actual_cost_usd, 0);
});

test("updates prospect status and notes while keeping the domain pair immutable", async () => {
  const { onRequestPatch } = await loadApi();
  assert.equal(typeof onRequestPatch, "function");
  let statement;
  const response = await onRequestPatch({
    request: jsonRequest("PATCH", {
      own_domain: "own-site.com",
      referring_domain: "industry-journal.com",
      status: "contacted",
      notes: "Emailed editor on Friday",
    }),
    env: {
      DB: {
        prepare: (sql) => ({
          bind: (...values) => ({
            run: async () => {
              statement = { sql, values };
              return { success: true, meta: { changes: 1 } };
            },
          }),
        }),
      },
    },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.status, "contacted");
  assert.equal(body.data.notes, "Emailed editor on Friday");
  assert.match(statement.sql, /SET status = \?, notes = \?, updated_at = CURRENT_TIMESTAMP/);
  assert.deepEqual(statement.values, ["contacted", "Emailed editor on Friday", "own-site.com", "industry-journal.com"]);
  assert.equal(body.meta.actual_cost_usd, 0);
});

test("returns 404 when the prospect to update does not exist", async () => {
  const { onRequestPatch } = await loadApi();
  const response = await onRequestPatch({
    request: jsonRequest("PATCH", {
      own_domain: "own-site.com",
      referring_domain: "missing.example",
      status: "rejected",
    }),
    env: {
      DB: {
        prepare: () => ({
          bind: () => ({ run: async () => ({ success: true, meta: { changes: 0 } }) }),
        }),
      },
    },
  });

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "PROSPECT_NOT_FOUND");
});

test("validates bindings, domains, workflow values, limits, and batch size", async () => {
  const { onRequestGet, onRequestPost, onRequestPatch } = await loadApi();
  assert.equal((await onRequestGet({ request: new Request("https://preview.example/api/v2/backlinks/opportunities?own_domain=own.com"), env: {} })).status, 503);

  const cases = [
    [onRequestGet, { request: new Request("https://preview.example/api/v2/backlinks/opportunities?own_domain=bad%20domain"), env: { DB: {} } }, "VALIDATION_ERROR"],
    [onRequestGet, { request: new Request("https://preview.example/api/v2/backlinks/opportunities?own_domain=own.com&status=unknown"), env: { DB: {} } }, "INVALID_STATUS"],
    [onRequestGet, { request: new Request("https://preview.example/api/v2/backlinks/opportunities?own_domain=own.com&limit=500"), env: { DB: {} } }, "INVALID_PAGINATION"],
    [onRequestPost, { request: jsonRequest("POST", { own_domain: "own.com", items: [] }), env: { DB: {} } }, "INVALID_ITEMS"],
    [onRequestPost, { request: jsonRequest("POST", { own_domain: "own.com", items: Array.from({ length: 101 }, (_, index) => ({ referring_domain: `d${index}.com` })) }), env: { DB: {} } }, "INVALID_ITEMS"],
    [onRequestPost, { request: jsonRequest("POST", { own_domain: "own.com", items: [{ referring_domain: "bad domain" }] }), env: { DB: {} } }, "INVALID_ITEM"],
    [onRequestPatch, { request: jsonRequest("PATCH", { own_domain: "own.com", referring_domain: "source.com", status: "unknown" }), env: { DB: {} } }, "INVALID_STATUS"],
    [onRequestPatch, { request: jsonRequest("PATCH", { own_domain: "own.com", referring_domain: "source.com", notes: "x".repeat(2001) }), env: { DB: {} } }, "INVALID_NOTES"],
  ];

  for (const [handler, context, code] of cases) {
    const response = await handler(context);
    assert.equal(response.status, 400, code);
    assert.equal((await response.json()).error.code, code);
  }
});

test("rejects oversized streamed bodies and unsupported methods", async () => {
  const { onRequestPost, onRequestDelete } = await loadApi();
  const request = new Request("https://preview.example/api/v2/backlinks/opportunities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat((64 * 1024) + 1) }),
  });
  const oversized = await onRequestPost({ request, env: { DB: {} } });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, "PAYLOAD_TOO_LARGE");

  assert.equal(typeof onRequestDelete, "function");
  const unsupported = await onRequestDelete();
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("Allow"), "GET, POST, PATCH");
});
