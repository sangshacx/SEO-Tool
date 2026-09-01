import { analyzeBacklinkHistory } from "../intelligence/backlink-history.js";
import { backlinkGapCacheKey } from "../backlinks/domain.js";
import { buildCompetitorSnapshotCacheKey, buildKeywordGapCacheKey } from "./cache-keys.js";
import {
  DASHBOARD_MODULE_IDS,
  canonicalIso,
  fillUnavailableModules,
  normalizeDashboardModule,
  normalizeDashboardScope,
} from "./contracts.js";
import { readDashboardHistory, readLatestDashboard } from "../storage/site-dashboard.js";

const STATUSES = ["new", "researching", "outreach", "contacted", "won", "rejected"];

function maxIso(values) {
  return values.filter(Boolean).sort().at(-1) ?? null;
}

function oldestFreshness(values) {
  if (!values.length || values.some((value) => !value)) return null;
  return [...values].sort()[0];
}

function parseArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cacheEntry(value, label, warnings) {
  if (!value || typeof value !== "object") return { data: null, cachedAt: null, warning: null };
  if (Object.hasOwn(value, "data")) {
    const cachedAt = canonicalIso(value.cached_at ?? value.data?.generated_at);
    return {
      data: value.data,
      cachedAt,
      warning: cachedAt ? null : `${label} cache freshness is unavailable for legacy cached data.`,
    };
  }
  const cachedAt = canonicalIso(value.cached_at ?? value.generated_at);
  return {
    data: value,
    cachedAt,
    warning: cachedAt ? null : `${label} cache freshness is unavailable for legacy cached data.`,
  };
}

async function readSiteProfile(db, scope) {
  const row = await db.prepare(
    `SELECT domain, label, competitors_json
     FROM site_profiles
     WHERE domain = ?`,
  ).bind(scope.domain).first();
  return row
    ? { domain: row.domain, label: row.label, competitors: parseArray(row.competitors_json).filter((item) => typeof item === "string") }
    : { domain: scope.domain, label: scope.domain, competitors: [] };
}

async function readBacklinkModule(db, scope) {
  const row = await db.prepare(
    `SELECT domain_rank, backlinks, referring_domains, snapshot_at
     FROM backlink_snapshots
     WHERE domain = ?
     ORDER BY snapshot_at DESC, id DESC
     LIMIT 1`,
  ).bind(scope.domain).first();
  if (!row) return null;
  return normalizeDashboardModule("backlinks", {
    domain_rank: row.domain_rank,
    backlinks: row.backlinks,
    referring_domains: row.referring_domains,
  }, {
    source: "d1",
    updated_at: row.snapshot_at,
    snapshot_at: row.snapshot_at,
    scope,
  });
}

async function readBacklinkHistoryModule(db, scope) {
  const rows = await db.prepare(
    `SELECT snapshot_at, source, domain_rank, backlinks, referring_domains, referring_ips, health_score, spam_score, broken_backlinks
     FROM backlink_snapshots
     WHERE domain = ?
     ORDER BY snapshot_at ASC, id ASC`,
  ).bind(scope.domain).all();
  const points = rows.results ?? [];
  if (!points.length) return null;
  const analysis = analyzeBacklinkHistory(scope.domain, points);
  return normalizeDashboardModule("backlink_history", {
    points: analysis.points,
    summary: analysis.summary,
    alerts: analysis.alerts,
    disclaimer: analysis.disclaimer,
  }, {
    source: "d1",
    updated_at: analysis.latest?.snapshot_at ?? analysis.summary.period_end,
    snapshot_at: analysis.latest?.snapshot_at ?? analysis.summary.period_end,
    scope,
  });
}

async function readCompetitorModules(cache, scope, competitors, warnings) {
  const rows = [];
  const keywordRows = [];
  const backlinkRows = [];
  const competitorFreshness = [];
  const keywordFreshness = [];
  const backlinkFreshness = [];
  const enrichment = new Map();

  for (const competitor of competitors) {
    const snapshotEntry = cacheEntry(await cache.get(
      buildCompetitorSnapshotCacheKey(competitor, scope.location_code, scope.language_code),
      "json",
    ), "Competitor", warnings);
    if (snapshotEntry.warning) warnings.push(snapshotEntry.warning);

    const keywordEntry = cacheEntry(await cache.get(
      buildKeywordGapCacheKey(competitor, scope.domain, scope.location_code, scope.language_code),
      "json",
    ), "Keyword gap", warnings);
    if (keywordEntry.warning) warnings.push(keywordEntry.warning);
    const backlinkEntry = cacheEntry(await cache.get(
      await backlinkGapCacheKey({ ownDomain: scope.domain, competitors: [competitor], limit: 25, offset: 0 }),
      "json",
    ), "Backlink gap", warnings);
    if (backlinkEntry.warning) warnings.push(backlinkEntry.warning);
    const keywordGap = keywordEntry.data;
    const backlinkGap = backlinkEntry.data;
    const keywordCount = keywordGap?.total_gap_keywords ?? keywordGap?.opportunities?.length ?? null;
    const backlinkCount = backlinkGap?.pagination?.total_count ?? backlinkGap?.summary?.total_count ?? backlinkGap?.items?.length ?? null;
    const enriched = {};
    const provenance = {};
    const freshness = [];
    const rankedKeywords = snapshotEntry.data?.organic?.ranked_keywords ?? null;
    const estimatedTraffic = snapshotEntry.data?.organic?.estimated_monthly_traffic ?? null;
    if (rankedKeywords !== null) {
      enriched.ranked_keywords = rankedKeywords;
      provenance.ranked_keywords = { source: "kv_cache", updated_at: snapshotEntry.cachedAt };
      freshness.push(snapshotEntry.cachedAt);
    }
    if (estimatedTraffic !== null) {
      enriched.estimated_traffic = estimatedTraffic;
      freshness.push(snapshotEntry.cachedAt);
    }
    if (keywordCount !== null) {
      enriched.competitor_only_keywords = keywordCount;
      enriched.keyword_gap = keywordCount;
      provenance.keyword_gap = { source: "kv_cache", updated_at: keywordEntry.cachedAt };
      freshness.push(keywordEntry.cachedAt);
    }
    if (backlinkCount !== null) {
      enriched.backlink_gap = backlinkCount;
      provenance.backlink_gap = { source: "kv_cache", updated_at: backlinkEntry.cachedAt };
      freshness.push(backlinkEntry.cachedAt);
    }
    if (Object.keys(provenance).length) enriched.provenance = provenance;
    if (Object.keys(enriched).length) enrichment.set(competitor, { fields: enriched, freshness });
    if (snapshotEntry.data) {
      rows.push({ domain: competitor, shared_keywords: null, ...enriched });
      competitorFreshness.push(snapshotEntry.cachedAt, ...freshness);
    }
    for (const item of keywordGap?.opportunities ?? []) {
      keywordRows.push({
        keyword: item.keyword ?? null,
        competitor_domain: competitor,
        priority: item.intelligence?.gap_priority?.score ?? null,
        title: item.keyword ?? null,
      });
    }
    if (keywordGap) keywordFreshness.push(keywordEntry.cachedAt);
    for (const item of backlinkGap?.items ?? []) {
      backlinkRows.push({
        domain: item.domain ?? null,
        competitor_domain: competitor,
        opportunity_score: item.opportunity?.score ?? null,
        title: item.domain ?? null,
      });
    }
    if (backlinkGap) backlinkFreshness.push(backlinkEntry.cachedAt);
  }

  return {
    competitors: rows.length ? normalizeDashboardModule("competitors", { rows }, {
      source: "kv_cache",
      updated_at: oldestFreshness(competitorFreshness),
      scope,
    }) : null,
    keywordOpportunities: keywordRows.length ? normalizeDashboardModule("keyword_opportunities", {
      rows: keywordRows.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).slice(0, 10),
    }, {
      source: "kv_cache",
      updated_at: oldestFreshness(keywordFreshness),
      scope,
    }) : null,
    backlinkGap: backlinkRows.length ? normalizeDashboardModule("backlink_gap", {
      rows: backlinkRows.sort((a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0)).slice(0, 10),
    }, {
      source: "kv_cache",
      updated_at: oldestFreshness(backlinkFreshness),
      scope,
    }) : null,
    enrichment,
  };
}

async function readProspectModules(db, scope) {
  const list = db.prepare(
    `SELECT own_domain, referring_domain, competitor_domains_json, opportunity_score, opportunity_label, status, notes,
      quality_score, relevance_score, outreach_recommendation, outreach_confidence, outreach_reasons_json,
      outreach_risk_types_json, relevance_checked_at, first_discovered_at, last_seen_at, created_at, updated_at
     FROM backlink_opportunities
     WHERE own_domain = ?
     ORDER BY updated_at DESC, referring_domain ASC
     LIMIT 500`,
  ).bind(scope.domain);
  const aggregate = db.prepare(
    `SELECT
      COUNT(*) AS total_count,
      SUM(CASE WHEN status IN ('new', 'researching') THEN 1 ELSE 0 END) AS pending_count,
      ${STATUSES.map((status) => `SUM(CASE WHEN status = '${status}' THEN 1 ELSE 0 END) AS ${status}_count`).join(",\n      ")}
     FROM backlink_opportunities
     WHERE own_domain = ?`,
  ).bind(scope.domain);
  const [listResult, aggregateResult] = await db.batch([list, aggregate]);
  const items = (listResult.results ?? []).map((row) => ({
    own_domain: row.own_domain,
    referring_domain: row.referring_domain,
    competitor_domains: parseArray(row.competitor_domains_json).filter((item) => typeof item === "string"),
    opportunity_score: row.opportunity_score,
    opportunity_label: row.opportunity_label,
    status: row.status,
    notes: row.notes,
    quality_score: row.quality_score ?? null,
    relevance_score: row.relevance_score ?? null,
    outreach_recommendation: row.outreach_recommendation ?? null,
    outreach_confidence: row.outreach_confidence ?? null,
    outreach_reasons: parseArray(row.outreach_reasons_json).filter((item) => typeof item === "string"),
    outreach_risk_types: parseArray(row.outreach_risk_types_json).filter((item) => typeof item === "string"),
    relevance_checked_at: row.relevance_checked_at ?? null,
    first_discovered_at: row.first_discovered_at,
    last_seen_at: row.last_seen_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const counts = aggregateResult.results?.[0] ?? {};
  const statusCounts = Object.fromEntries(STATUSES.map((status) => [status, Number(counts[`${status}_count`] ?? 0)]));
  const updatedAt = maxIso(items.map((item) => canonicalIso(item.updated_at)));

  return {
    backlink_opportunities: normalizeDashboardModule("backlink_opportunities", {
      items,
      total_count: Number(counts.total_count ?? 0),
      pending_count: Number(counts.pending_count ?? 0),
      status_counts: statusCounts,
    }, {
      source: "d1",
      updated_at: updatedAt,
      scope,
    }),
    workflow: normalizeDashboardModule("workflow", {
      total_count: Number(counts.total_count ?? 0),
      pending_count: Number(counts.pending_count ?? 0),
      status_counts: statusCounts,
      recent_items: items.slice(0, 10),
    }, {
      source: "d1",
      updated_at: updatedAt,
      scope,
    }),
  };
}

export async function aggregateDashboard({ db, cache, scope: inputScope }) {
  const scope = normalizeDashboardScope(inputScope);
  const latest = await readLatestDashboard(db, scope);
  const warnings = [...latest.warnings];
  const modules = fillUnavailableModules(latest.modules, scope);
  const profile = await readSiteProfile(db, scope);

  if (modules.backlinks.availability === "unavailable") {
    try {
      const backlinks = await readBacklinkModule(db, scope);
      if (backlinks) modules.backlinks = backlinks;
    } catch {
      warnings.push("Backlink overview is temporarily unavailable.");
    }
  }

  try {
    const backlinkHistory = await readBacklinkHistoryModule(db, scope);
    if (backlinkHistory) {
      modules.backlink_history = backlinkHistory;
      if (modules.backlinks.availability === "available") {
        modules.backlinks.data = {
          ...modules.backlinks.data,
          trends: { backlinks: backlinkHistory.data.points },
        };
      }
    }
  } catch {
    warnings.push("Backlink history is temporarily unavailable.");
  }

  try {
    const competitorModules = await readCompetitorModules(cache, scope, profile.competitors, warnings);
    if (modules.competitors.availability === "unavailable" && competitorModules.competitors) {
      modules.competitors = competitorModules.competitors;
    } else if (modules.competitors.availability === "available") {
      const contributorFreshness = [];
      modules.competitors.data = {
        ...modules.competitors.data,
        rows: (modules.competitors.data?.rows ?? []).map((row) => {
          const enrichment = competitorModules.enrichment.get(row.domain);
          if (!enrichment) {
            contributorFreshness.push(modules.competitors.updated_at);
            return { ...row, shared_keywords: null };
          }
          const cached = enrichment.fields;
          const retainedStoredMetric = [
            "ranked_keywords",
            "estimated_traffic",
            "competitor_only_keywords",
            "keyword_gap",
            "backlink_gap",
          ].some((field) => row[field] != null && !Object.hasOwn(cached, field));
          if (retainedStoredMetric) {
            contributorFreshness.push(modules.competitors.updated_at);
          }
          contributorFreshness.push(...enrichment.freshness);
          const merged = {
            ...row,
            ...cached,
            shared_keywords: null,
          };
          if (cached.provenance) {
            merged.provenance = { ...(row.provenance ?? {}), ...cached.provenance };
          }
          return merged;
        }),
      };
      modules.competitors.updated_at = oldestFreshness(contributorFreshness);
      modules.competitors.freshness.updated_at = modules.competitors.updated_at;
    }
    if (modules.keyword_opportunities.availability === "unavailable" && competitorModules.keywordOpportunities) {
      modules.keyword_opportunities = competitorModules.keywordOpportunities;
    }
    if (modules.backlink_gap.availability === "unavailable" && competitorModules.backlinkGap) {
      modules.backlink_gap = competitorModules.backlinkGap;
    }
  } catch {
    warnings.push("Competitor cache data is temporarily unavailable.");
  }

  try {
    const prospectModules = await readProspectModules(db, scope);
    modules.backlink_opportunities = prospectModules.backlink_opportunities;
    modules.workflow = prospectModules.workflow;
  } catch {
    warnings.push("Workflow prospect data is temporarily unavailable.");
  }

  try {
    const history = await readDashboardHistory(db, scope, 365);
    if (modules.organic.availability === "available") {
      modules.organic.data = {
        ...modules.organic.data,
        trends: { organic: history.organic },
      };
    }
    if (modules.backlinks.availability === "available" && !modules.backlinks.data?.trends?.backlinks) {
      modules.backlinks.data = {
        ...modules.backlinks.data,
        trends: { backlinks: history.backlinks },
      };
    }
  } catch {
    warnings.push("Dashboard history is temporarily unavailable.");
  }

  return {
    scope: {
      site: scope.site,
      domain: scope.domain,
      location_code: scope.location_code,
      location_name: scope.location_name,
      language_code: scope.language_code,
      language_name: scope.language_name,
    },
    modules,
    warnings,
    meta: {
      source: "d1",
      updated_at: latest.captured_at ?? maxIso(DASHBOARD_MODULE_IDS.map((moduleId) => modules[moduleId]?.updated_at)),
      actual_cost_usd: 0,
      task_count: 0,
      provider_requests: 0,
    },
  };
}
