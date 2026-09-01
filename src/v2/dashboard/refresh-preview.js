import { backlinkGapCacheKey, backlinkSnapshotCacheKey } from "../backlinks/domain.js";
import { buildCompetitorSnapshotCacheKey, buildKeywordGapCacheKey } from "./cache-keys.js";
import { canonicalIso, normalizeDashboardScope, orderedRefreshModules } from "./contracts.js";

const COMPETITOR_DEPENDENT = new Set(["competitors", "keyword_opportunities", "backlink_opportunities"]);

function validDomain(domain) {
  return typeof domain === "string"
    && domain.length <= 253
    && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain);
}

function parseCompetitors(raw) {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(validDomain).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function cachedAt(value) {
  return canonicalIso(value?.cached_at ?? value?.generated_at ?? value?.data?.generated_at);
}

function oldestKnown(values, expectedCount) {
  const valid = values.map(canonicalIso).filter(Boolean).sort();
  return valid.length === expectedCount ? valid[0] : null;
}

function reviewResult(status, extra = {}) {
  return {
    status,
    cached: status !== "confirmation_required",
    actual_cost_usd: 0,
    estimated_cost_usd: null,
    task_count: 0,
    cache_write_ok: true,
    updated_at: null,
    ...extra,
  };
}

function confirmation(message) {
  return reviewResult("confirmation_required", {
    cached: false,
    error: { code: "LIVE_REQUEST_CONFIRMATION_REQUIRED", message },
  });
}

function skipped() {
  return reviewResult("skip", {
    cached: true,
    error: { code: "NO_PROVIDER", message: "No competitors are configured for this site." },
  });
}

export async function readDashboardRefreshProfile(db, inputScope) {
  const scope = normalizeDashboardScope(inputScope);
  const row = await db.prepare(
    "SELECT competitors_json FROM site_profiles WHERE domain = ?",
  ).bind(scope.domain).first();
  return { scope, competitors: parseCompetitors(row?.competitors_json) };
}

export async function classifyDashboardRefresh({ db, cache, scope: inputScope, selectedModules, competitors: providedCompetitors }) {
  const scope = normalizeDashboardScope(inputScope);
  const selected = orderedRefreshModules(selectedModules);
  const competitors = providedCompetitors ?? (await readDashboardRefreshProfile(db, scope)).competitors;
  const modules = Object.create(null);

  for (const moduleId of selected) {
    if (COMPETITOR_DEPENDENT.has(moduleId) && !competitors.length) {
      modules[moduleId] = skipped();
      continue;
    }
    if (moduleId === "organic") {
      const cached = await cache?.get(buildCompetitorSnapshotCacheKey(scope.domain, scope.location_code, scope.language_code), "json");
      modules[moduleId] = cached
        ? reviewResult("ready", { updated_at: cachedAt(cached) })
        : confirmation("No cached organic overview exists.");
      continue;
    }
    if (moduleId === "backlinks") {
      const cached = await cache?.get(backlinkSnapshotCacheKey(scope.domain), "json");
      const row = await db.prepare(
        `SELECT snapshot_at FROM backlink_snapshots
         WHERE domain = ? ORDER BY snapshot_at DESC, id DESC LIMIT 1`,
      ).bind(scope.domain).first();
      modules[moduleId] = cached || row
        ? reviewResult("ready", { updated_at: cachedAt(cached) ?? canonicalIso(row?.snapshot_at) })
        : confirmation("No cached backlink overview exists.");
      continue;
    }

    const entries = [];
    for (const competitor of competitors) {
      let key;
      if (moduleId === "competitors") {
        key = buildCompetitorSnapshotCacheKey(competitor, scope.location_code, scope.language_code);
      } else if (moduleId === "keyword_opportunities") {
        key = buildKeywordGapCacheKey(competitor, scope.domain, scope.location_code, scope.language_code);
      } else {
        key = await backlinkGapCacheKey({ ownDomain: scope.domain, competitors: [competitor], limit: 25, offset: 0 });
      }
      entries.push(await cache?.get(key, "json"));
    }
    const missing = entries.some((entry) => !entry);
    if (missing) {
      const label = moduleId === "competitors" ? "competitor snapshots"
        : moduleId === "keyword_opportunities" ? "keyword gap snapshots"
          : "backlink gap snapshots";
      modules[moduleId] = confirmation(`One or more ${label} need a live refresh.`);
    } else {
      modules[moduleId] = reviewResult("ready", {
        updated_at: oldestKnown(entries.map(cachedAt), entries.length),
      });
    }
  }

  return { scope, competitors, modules };
}

export function liveConfirmationMissing(review, confirmedLiveModules) {
  return Object.entries(review ?? {}).find(
    ([moduleId, result]) => result?.status === "confirmation_required" && !confirmedLiveModules.has(moduleId),
  )?.[0] ?? null;
}
