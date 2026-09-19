import { normalizeDashboardModule, normalizeDashboardScope } from "../dashboard/contracts.js";
import { writeDashboardSnapshot } from "./site-dashboard.js";

export async function recordManagedOrganicSnapshot({
  db,
  target,
  targetType,
  locationCode,
  languageCode,
  data,
  capturedAt = new Date().toISOString(),
}) {
  if (!db || targetType !== "domain" || typeof target !== "string") {
    return { inserted: false, reason: "unsupported_target" };
  }
  const managed = await db.prepare("SELECT domain FROM site_profiles WHERE domain = ? LIMIT 1").bind(target).first();
  if (!managed?.domain) return { inserted: false, reason: "unmanaged_site" };

  const scope = normalizeDashboardScope({
    domain: target,
    location_code: locationCode,
    language_code: languageCode,
  });
  const organic = normalizeDashboardModule("organic", {
    organic_keywords: data?.organic?.ranked_keywords ?? null,
    organic_traffic: data?.organic?.estimated_monthly_traffic ?? null,
    traffic_value: data?.organic?.estimated_paid_traffic_cost_usd ?? null,
  }, {
    source: "live",
    updated_at: capturedAt,
    provider_updated_at: data?.update_window?.last_updated_at ?? null,
    snapshot_at: capturedAt,
    scope,
  });

  const saved = await writeDashboardSnapshot(db, scope, { organic }, { now: () => new Date(capturedAt) });
  return {
    inserted: saved.inserted === true,
    deduped: saved.deduped === true,
    captured_at: saved.captured_at ?? capturedAt,
  };
}
