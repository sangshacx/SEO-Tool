import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS = [
  "0001_alpha_core.sql",
  "0004_backlink_history.sql",
  "0005_backlink_opportunities.sql",
  "0006_backlink_outreach_intelligence.sql",
  "0007_site_profiles.sql",
  "0008_site_dashboard_snapshots.sql",
  "0009_nullable_api_usage_task_count.sql",
];

export function d1For(database, { before, after } = {}) {
  const counts = new Map();
  const invoke = async (method, sql, values, operation) => {
    const key = `${method}:${sql}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    await before?.({ method, sql, values, count });
    const result = operation();
    await after?.({ method, sql, values, count, result });
    return result;
  };
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        bind(...values) {
          const bound = {
            _sql: sql,
            async all() { return invoke("all", sql, values, () => ({ results: statement.all(...values) })); },
            async first() { return invoke("first", sql, values, () => statement.get(...values) ?? null); },
            async run() {
              return invoke("run", sql, values, () => {
                const result = statement.run(...values);
                return { success: true, meta: { changes: result.changes } };
              });
            },
          };
          return bound;
        },
      };
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) {
          results.push(/^\s*SELECT/i.test(statement._sql) ? await statement.all() : await statement.run());
        }
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export function memoryCache(seed = {}) {
  const values = new Map(Object.entries(seed));
  const reads = [];
  const writes = [];
  return {
    values,
    reads,
    writes,
    async get(key, type) {
      reads.push(key);
      const value = values.get(key);
      if (value == null) return null;
      if ((type === "json" || type?.type === "json") && typeof value === "string") return JSON.parse(value);
      return value;
    },
    async put(key, value, options) {
      writes.push({ key, value, options });
      values.set(key, value);
    },
  };
}

export async function dashboardDatabase({ normalizedModules = true } = {}) {
  const raw = new DatabaseSync(":memory:");
  for (const file of MIGRATIONS) {
    raw.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  if (normalizedModules) {
    raw.exec(`CREATE TABLE IF NOT EXISTS site_dashboard_modules (
      site_domain TEXT NOT NULL,
      location_code INTEGER NOT NULL,
      language_code TEXT NOT NULL,
      module_id TEXT NOT NULL,
      module_json TEXT NOT NULL,
      updated_at TEXT,
      schema_version TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (site_domain, location_code, language_code, module_id)
    )`);
  }
  return { raw, d1: d1For(raw) };
}

export async function seedProfile(d1, {
  domain = "example.com",
  competitors = [],
  locationCode = 2840,
  languageCode = "en",
} = {}) {
  await d1.prepare(
    `INSERT INTO site_profiles (
      domain, label, location_code, location_name, country_iso_code,
      language_code, language_name, include_subdomains, competitors_json
    ) VALUES (?, ?, ?, 'United States', 'US', ?, 'English', 0, ?)`,
  ).bind(domain, domain, locationCode, languageCode, JSON.stringify(competitors)).run();
}

export function rankedKeywordsPayload({ domain = "example.com", cost = 0.1, taskCount = 1, padding = "" } = {}) {
  return {
    status_code: 20000,
    cost,
    tasks_count: taskCount,
    padding,
    tasks: [{
      status_code: 20000,
      cost,
      result: [{
        total_count: 12,
        metrics: { organic: { count: 12, etv: 34, estimated_paid_traffic_cost: 5 } },
        items: [{ keyword_data: { keyword: `${domain} keyword`, keyword_info: { search_volume: 100 } }, ranked_serp_element: { serp_item: { rank_group: 2, url: `https://${domain}/page` } } }],
      }],
    }],
  };
}

export function keywordGapPayload({ competitor = "rival.example", cost = 0.2, taskCount = 1, padding = "" } = {}) {
  return {
    status_code: 20000,
    cost,
    tasks_count: taskCount,
    padding,
    tasks: [{
      status_code: 20000,
      cost,
      result: [{
        total_count: 1,
        items: [{ keyword_data: { keyword: `${competitor} gap`, keyword_info: { search_volume: 90 } }, first_domain_serp_element: { rank_group: 3, etv: 8 } }],
      }],
    }],
  };
}

export function providerResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}
