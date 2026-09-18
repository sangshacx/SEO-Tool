import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  KEYWORD_CLUSTER_CONTRACT_VERSION,
  normalizeKeywordClusterAssignments,
  normalizeKeywordClusterCreate,
  normalizeKeywordClusterListQuery,
} from "../src/v2/contracts/keyword-clusters.js";

test("Topic Cluster create/list contracts are site scoped and deterministic", () => {
  assert.equal(KEYWORD_CLUSTER_CONTRACT_VERSION, "keyword-clusters-v0.1");
  assert.deepEqual(
    normalizeKeywordClusterListQuery(new URLSearchParams({ site_domain: "www.example.com" })),
    { site_domain: "example.com" },
  );
  assert.deepEqual(normalizeKeywordClusterCreate({
    site_domain: "https://www.example.com/",
    name: "  Waterproof   Membrane ",
  }), {
    site_domain: "example.com",
    name: "Waterproof Membrane",
    normalized_name: "waterproof membrane",
    source: "manual",
  });
});

test("Topic Cluster assignment contract enforces one primary and 100-keyword bound", () => {
  assert.deepEqual(normalizeKeywordClusterAssignments({
    site_domain: "example.com",
    cluster_id: "7",
    assignments: [
      { saved_keyword_id: 10, role: "primary" },
      { saved_keyword_id: "11", role: "supporting" },
      { saved_keyword_id: 11, role: "supporting" },
    ],
  }), {
    site_domain: "example.com",
    cluster_id: 7,
    assignments: [
      { saved_keyword_id: 10, role: "primary" },
      { saved_keyword_id: 11, role: "supporting" },
    ],
  });

  assert.throws(
    () => normalizeKeywordClusterAssignments({
      site_domain: "example.com",
      cluster_id: 7,
      assignments: [
        { saved_keyword_id: 10, role: "primary" },
        { saved_keyword_id: 11, role: "primary" },
      ],
    }),
    /at most one primary/,
  );
  assert.throws(
    () => normalizeKeywordClusterAssignments({
      site_domain: "example.com",
      cluster_id: 7,
      assignments: Array.from({ length: 101 }, (_, index) => ({
        saved_keyword_id: index + 1,
        role: "supporting",
      })),
    }),
    /No more than 100/,
  );
});

test("Topic Cluster migration links only Saved Keywords and enforces one-cluster/one-primary rules", async () => {
  const sql = await readFile(new URL("../migrations/0013_keyword_clusters.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS topic_clusters/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS topic_cluster_members/);
  assert.match(sql, /FOREIGN KEY \(site_profile_id\) REFERENCES site_profiles\(id\) ON DELETE CASCADE/);
  assert.match(sql, /FOREIGN KEY \(saved_keyword_id\) REFERENCES saved_keywords\(id\) ON DELETE CASCADE/);
  assert.match(sql, /UNIQUE \(saved_keyword_id\)/);
  assert.match(sql, /WHERE role = 'primary'/);
});

test("Topic Cluster API is internal-only and zero provider cost", async () => {
  const apiSource = await readFile(new URL("../functions/api/v2/keywords/clusters.js", import.meta.url), "utf8");
  const storageSource = await readFile(new URL("../src/v2/storage/keyword-clusters.js", import.meta.url), "utf8");
  assert.match(apiSource, /actual_cost_usd:\s*0/);
  assert.match(apiSource, /provider_requests:\s*0/);
  assert.doesNotMatch(apiSource, /DataForSEO|submitSeoResearchRequest|\bfetch\s*\(/);
  assert.doesNotMatch(storageSource, /DataForSEO|\bfetch\s*\(/);
});

test("Topic Cluster API exposes GET, POST, PATCH without a provider request", async () => {
  const calls = [];
  globalThis.__KEYWORD_CLUSTER_STORAGE_FOR_TESTS__ = {
    async listKeywordClusters(_db, input) {
      calls.push(["list", input]);
      return { site_domain: input.site_domain, clusters: [] };
    },
    async createKeywordCluster(_db, input) {
      calls.push(["create", input]);
      return { id: 1, site_domain: input.site_domain, name: input.name, primary: null, supporting: [] };
    },
    async assignKeywordClusterMembers(_db, input) {
      calls.push(["assign", input]);
      return {
        id: input.cluster_id,
        site_domain: input.site_domain,
        name: "Waterproof Membrane",
        primary: { saved_keyword_id: input.assignments[0].saved_keyword_id, role: "primary" },
        supporting: [],
      };
    },
  };

  const api = await import("../functions/api/v2/keywords/clusters.js?test=" + Date.now());
  const auth = { "cf-access-jwt-assertion": "test-token" };
  const headers = { ...auth, "content-type": "application/json" };

  const getResponse = await api.onRequestGet({
    request: new Request("https://preview.example/api/v2/keywords/clusters?site_domain=example.com", { headers: auth }),
    env: { DB: {} },
  });
  assert.equal(getResponse.status, 200);
  assert.equal((await getResponse.json()).meta.actual_cost_usd, 0);

  const createResponse = await api.onRequestPost({
    request: new Request("https://preview.example/api/v2/keywords/clusters", {
      method: "POST",
      headers,
      body: JSON.stringify({ site_domain: "example.com", name: "Waterproof Membrane" }),
    }),
    env: { DB: {} },
  });
  assert.equal(createResponse.status, 200);

  const assignResponse = await api.onRequestPatch({
    request: new Request("https://preview.example/api/v2/keywords/clusters", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        site_domain: "example.com",
        cluster_id: 1,
        assignments: [{ saved_keyword_id: 8, role: "primary" }],
      }),
    }),
    env: { DB: {} },
  });
  assert.equal(assignResponse.status, 200);
  assert.deepEqual(calls.map((entry) => entry[0]), ["list", "create", "assign"]);
  delete globalThis.__KEYWORD_CLUSTER_STORAGE_FOR_TESTS__;
});

test("Topic Cluster storage moves assigned keywords and replaces the target cluster membership as one batch", async () => {
  const source = await readFile(new URL("../src/v2/storage/keyword-clusters.js", import.meta.url), "utf8");
  assert.match(source, /DELETE FROM topic_cluster_members WHERE saved_keyword_id IN/);
  assert.match(source, /DELETE FROM topic_cluster_members WHERE cluster_id = \?/);
  assert.match(source, /INSERT INTO topic_cluster_members/);
  assert.match(source, /db\.batch\(statements\)/);
});
