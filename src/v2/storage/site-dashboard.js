import {
  DASHBOARD_DEDUP_MS,
  DASHBOARD_MAX_BYTES,
  DASHBOARD_MODULE_IDS,
  DASHBOARD_SCHEMA_VERSION,
  DashboardContractError,
  canonicalIso,
  fillUnavailableModules,
  normalizeDashboardScope,
  normalizeStoredModules,
  stableStringify,
  utf8ByteLength,
} from "../dashboard/contracts.js";

function parseModulesJson(raw) {
  if (typeof raw !== "string") return {};
  if (utf8ByteLength(raw) > DASHBOARD_MAX_BYTES) {
    throw new DashboardContractError("Dashboard snapshot JSON must be 64 KiB UTF-8 or smaller.", "PAYLOAD_TOO_LARGE");
  }
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function monotonicCapturedAt(previousCapturedAt, now) {
  const current = now instanceof Date ? now : new Date(now);
  const currentIso = current.toISOString();
  const previous = canonicalIso(previousCapturedAt);
  if (!previous || Date.parse(currentIso) > Date.parse(previous)) return currentIso;
  return new Date(Date.parse(previous) + 1).toISOString();
}

async function snapshotRows(db, scope, limit = 50) {
  const result = await db.prepare(
    `SELECT id, site_domain, location_code, language_code, modules_json, captured_at, schema_version
     FROM site_dashboard_snapshots
     WHERE site_domain = ? AND location_code = ? AND language_code = ?
     ORDER BY captured_at DESC, id DESC
     LIMIT ?`,
  ).bind(scope.domain, scope.location_code, scope.language_code, limit).all();
  return result.results ?? [];
}

function parsedSnapshot(row, scope, warnings, label) {
  if (!row) {
    return {
      row: null,
      valid: false,
      storedModules: {},
      modules: fillUnavailableModules({}, scope),
    };
  }
  try {
    const storedModules = normalizeStoredModules(parseModulesJson(row.modules_json), scope);
    return {
      row,
      valid: true,
      storedModules,
      modules: fillUnavailableModules(storedModules, scope),
    };
  } catch (error) {
    warnings?.push(`${label} snapshot could not be parsed and was ignored.`);
    return {
      row: null,
      valid: false,
      storedModules: {},
      modules: fillUnavailableModules({}, scope),
    };
  }
}

async function currentModuleRows(db, scope) {
  const result = await db.prepare(
    `SELECT module_id, module_json, updated_at, schema_version
     FROM site_dashboard_modules
     WHERE site_domain = ? AND location_code = ? AND language_code = ?
     ORDER BY module_id ASC`,
  ).bind(scope.domain, scope.location_code, scope.language_code).all();
  return result.results ?? [];
}

function parsedCurrentModules(rows, scope, warnings) {
  const raw = Object.create(null);
  for (const row of rows) {
    if (!DASHBOARD_MODULE_IDS.includes(row.module_id)) continue;
    try {
      const parsed = parseModulesJson(row.module_json);
      raw[row.module_id] = parsed;
    } catch {
      warnings.push(`Current ${row.module_id} module could not be parsed and was ignored.`);
    }
  }
  return normalizeStoredModules(raw, scope);
}

export async function readLatestDashboard(db, inputScope) {
  const scope = normalizeDashboardScope(inputScope);
  const warnings = [];
  const [rows, moduleRows] = await Promise.all([
    snapshotRows(db, scope),
    currentModuleRows(db, scope),
  ]);
  const validSnapshots = [];
  for (const [index, row] of rows.entries()) {
    const parsed = parsedSnapshot(row, scope, warnings, index === 0 ? "Latest" : "Older");
    if (parsed.valid) validSnapshots.push(parsed);
    if (validSnapshots.length >= 2) break;
  }
  const storedModules = parsedCurrentModules(moduleRows, scope, warnings);
  const latest = Object.keys(storedModules).length
    ? {
      row: validSnapshots[0]?.row ?? null,
      storedModules,
      modules: fillUnavailableModules(storedModules, scope),
    }
    : (validSnapshots[0] ?? parsedSnapshot(null, scope, warnings, "Latest"));
  const previous = validSnapshots[1] ?? parsedSnapshot(null, scope, warnings, "Previous");
  for (const moduleId of DASHBOARD_MODULE_IDS) {
    if (latest.modules[moduleId]?.availability === "available" && previous.modules[moduleId]?.availability === "available") {
      latest.modules[moduleId].previous = previous.modules[moduleId].data;
      latest.modules[moduleId].previous_snapshot_at = previous.row?.captured_at ?? null;
    }
  }
  return {
    scope,
    captured_at: latest.row?.captured_at ?? null,
    schema_version: latest.row?.schema_version ?? DASHBOARD_SCHEMA_VERSION,
    modules: latest.modules,
    stored_modules: latest.storedModules,
    warnings,
  };
}

export async function writeDashboardSnapshot(db, inputScope, modules, { now = () => new Date() } = {}) {
  const scope = normalizeDashboardScope(inputScope);
  const latest = await readLatestDashboard(db, scope);
  const nextModules = normalizeStoredModules(modules, scope);
  if (!Object.keys(nextModules).length) {
    return { inserted: false, deduped: false, captured_at: latest.captured_at, modules: latest.modules };
  }

  const merged = { ...latest.stored_modules, ...nextModules };
  const mergedJson = stableStringify(merged);
  if (utf8ByteLength(mergedJson) > DASHBOARD_MAX_BYTES) {
    throw new DashboardContractError("Dashboard snapshot JSON must be 64 KiB UTF-8 or smaller.", "PAYLOAD_TOO_LARGE");
  }

  const capturedAt = monotonicCapturedAt(latest.captured_at, now());
  if (latest.captured_at && stableStringify(latest.stored_modules) === mergedJson
    && Date.parse(capturedAt) - Date.parse(latest.captured_at) < DASHBOARD_DEDUP_MS) {
    return {
      inserted: false,
      deduped: true,
      captured_at: latest.captured_at,
      modules: latest.modules,
    };
  }

  const upserts = Object.entries(nextModules).map(([moduleId, module]) => db.prepare(
    `INSERT INTO site_dashboard_modules (
      site_domain, location_code, language_code, module_id, module_json, updated_at, schema_version, revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(site_domain, location_code, language_code, module_id) DO UPDATE SET
      module_json = excluded.module_json,
      updated_at = excluded.updated_at,
      schema_version = excluded.schema_version,
      revision = site_dashboard_modules.revision + 1`,
  ).bind(
    scope.domain,
    scope.location_code,
    scope.language_code,
    moduleId,
    stableStringify(module),
    module.updated_at ?? null,
    DASHBOARD_SCHEMA_VERSION,
  ));
  for (const upsert of upserts) await upsert.run();

  await db.prepare(
    `INSERT INTO site_dashboard_snapshots (
      site_domain, location_code, language_code, modules_json, captured_at, schema_version
    )
    SELECT ?, ?, ?, json_group_object(module_id, json(module_json)), ?, ?
    FROM site_dashboard_modules
    WHERE site_domain = ? AND location_code = ? AND language_code = ?`,
  ).bind(
    scope.domain,
    scope.location_code,
    scope.language_code,
    capturedAt,
    DASHBOARD_SCHEMA_VERSION,
    scope.domain,
    scope.location_code,
    scope.language_code,
  ).run();

  const saved = await readLatestDashboard(db, scope);
  return {
    inserted: true,
    deduped: false,
    captured_at: capturedAt,
    modules: saved.modules,
  };
}

function organicPoint(row) {
  const organic = row.modules?.organic;
  if (organic?.availability !== "available") return null;
  return {
    captured_at: row.captured_at,
    organic_keywords: organic.data?.organic_keywords ?? null,
    organic_traffic: organic.data?.organic_traffic ?? null,
    traffic_value: organic.data?.traffic_value ?? null,
  };
}

function backlinksPoint(row) {
  const backlinks = row.modules?.backlinks;
  if (backlinks?.availability !== "available") return null;
  return {
    captured_at: row.captured_at,
    domain_rank: backlinks.data?.domain_rank ?? null,
    backlinks: backlinks.data?.backlinks ?? null,
    referring_domains: backlinks.data?.referring_domains ?? null,
  };
}

export async function readDashboardHistory(db, inputScope, rangeDays = 365) {
  const scope = normalizeDashboardScope(inputScope);
  const cutoff = new Date(Date.now() - Number(rangeDays) * 86400000).toISOString();
  const rowsResult = await db.prepare(
    `SELECT modules_json, captured_at
     FROM site_dashboard_snapshots
     WHERE site_domain = ? AND location_code = ? AND language_code = ? AND captured_at >= ?
     ORDER BY captured_at ASC, id ASC`,
  ).bind(scope.domain, scope.location_code, scope.language_code, cutoff).all();

  const parsed = [];
  for (const row of rowsResult.results ?? []) {
    try {
      parsed.push({
        captured_at: row.captured_at,
        modules: fillUnavailableModules(normalizeStoredModules(parseModulesJson(row.modules_json), scope), scope),
      });
    } catch {
      // Ignore malformed history rows; current aggregate still loads.
    }
  }

  return {
    organic: parsed.map(organicPoint).filter(Boolean),
    backlinks: parsed.map(backlinksPoint).filter(Boolean),
  };
}

export async function acquireDashboardRefreshLease(db, leaseKey, requestId, expiresAt, now = new Date().toISOString()) {
  const result = await db.prepare(
    `INSERT INTO dashboard_refresh_leases (lease_key, request_id, expires_at)
     VALUES (?, ?, ?)
     ON CONFLICT(lease_key) DO UPDATE SET
       request_id = excluded.request_id,
       expires_at = excluded.expires_at,
       created_at = CURRENT_TIMESTAMP
     WHERE dashboard_refresh_leases.expires_at < ?`,
  ).bind(leaseKey, requestId, expiresAt, now).run();
  return Number(result?.meta?.changes ?? 0) > 0;
}

export async function releaseDashboardRefreshLease(db, leaseKey, requestId) {
  const result = await db.prepare(
    "DELETE FROM dashboard_refresh_leases WHERE lease_key = ? AND request_id = ?",
  ).bind(leaseKey, requestId).run();
  return Number(result?.meta?.changes ?? 0) > 0;
}

export async function renewDashboardRefreshLease(db, leaseKey, requestId, expiresAt, now = new Date().toISOString()) {
  const result = await db.prepare(
    `UPDATE dashboard_refresh_leases
     SET expires_at = ?
     WHERE lease_key = ? AND request_id = ? AND expires_at >= ?`,
  ).bind(expiresAt, leaseKey, requestId, now).run();
  return Number(result?.meta?.changes ?? 0) > 0;
}

export async function ownsDashboardRefreshLease(db, leaseKey, requestId, now = new Date().toISOString()) {
  const row = await db.prepare(
    `SELECT request_id
     FROM dashboard_refresh_leases
     WHERE lease_key = ? AND request_id = ? AND expires_at >= ?`,
  ).bind(leaseKey, requestId, now).first();
  return row?.request_id === requestId;
}
