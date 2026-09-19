import { summarizeAiPromptTrend } from "../intelligence/ai-prompt-trends.js";

function integer(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function cleanText(value, max = 500) {
  const text = String(value ?? "").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function boolInt(value) {
  if (value === true || value === 1 || value === "1") return 1;
  if (value === false || value === 0 || value === "0") return 0;
  return null;
}

async function resolveSite(db, domain) {
  if (!db || !domain) return null;
  return db.prepare(
    "SELECT id, domain FROM site_profiles WHERE domain = ? LIMIT 1",
  ).bind(String(domain).trim().toLowerCase()).first();
}

export async function upsertAiPromptTracker(db, {
  siteDomain,
  name = "",
  platform,
  modelName,
  prompt,
  webSearch = true,
  locationCode,
  languageCode,
  status = "active",
} = {}) {
  const site = await resolveSite(db, siteDomain);
  if (!site?.id) {
    const error = new Error("Prompt Tracker requires a saved own-site profile.");
    error.code = "MANAGED_SITE_REQUIRED";
    error.httpStatus = 409;
    throw error;
  }

  const row = await db.prepare(`
    INSERT INTO ai_prompt_trackers (
      site_profile_id, name, platform, model_name, prompt_text,
      web_search, location_code, language_code, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(
      site_profile_id, platform, model_name, prompt_text,
      web_search, location_code, language_code
    )
    DO UPDATE SET
      name = excluded.name,
      status = excluded.status,
      updated_at = CURRENT_TIMESTAMP
    RETURNING
      id, name, platform, model_name, prompt_text, web_search,
      location_code, language_code, status, created_at, updated_at
  `).bind(
    site.id,
    cleanText(name, 120),
    platform,
    cleanText(modelName, 160),
    cleanText(prompt, 500),
    webSearch ? 1 : 0,
    Number(locationCode),
    cleanText(languageCode, 32),
    status,
  ).first();

  return normalizeTrackerRow(row);
}

export async function updateAiPromptTrackerStatus(db, {
  siteDomain,
  trackerId,
  status,
} = {}) {
  const site = await resolveSite(db, siteDomain);
  if (!site?.id) {
    const error = new Error("Prompt Tracker requires a saved own-site profile.");
    error.code = "MANAGED_SITE_REQUIRED";
    error.httpStatus = 409;
    throw error;
  }
  const id = integer(trackerId);
  if (!id) {
    const error = new Error("A valid tracker id is required.");
    error.code = "INVALID_TRACKER_ID";
    error.httpStatus = 400;
    throw error;
  }

  const row = await db.prepare(`
    UPDATE ai_prompt_trackers
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND site_profile_id = ?
    RETURNING
      id, name, platform, model_name, prompt_text, web_search,
      location_code, language_code, status, created_at, updated_at
  `).bind(status, id, site.id).first();

  if (!row) {
    const error = new Error("Prompt Tracker item was not found for this site.");
    error.code = "TRACKER_NOT_FOUND";
    error.httpStatus = 404;
    throw error;
  }
  return normalizeTrackerRow(row);
}

function normalizeTrackerRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name ?? "",
    platform: row.platform,
    model_name: row.model_name,
    prompt: row.prompt_text,
    web_search: Number(row.web_search) === 1,
    location_code: Number(row.location_code),
    language_code: row.language_code,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseDomains(value) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

export async function getAiPromptTracker(db, {
  siteDomain,
  trackerId,
} = {}) {
  const site = await resolveSite(db, siteDomain);
  if (!site?.id) return null;
  const id = integer(trackerId);
  if (!id) return null;

  const row = await db.prepare(`
    SELECT
      id, name, platform, model_name, prompt_text, web_search,
      location_code, language_code, status, created_at, updated_at
    FROM ai_prompt_trackers
    WHERE id = ? AND site_profile_id = ?
    LIMIT 1
  `).bind(id, site.id).first();

  return normalizeTrackerRow(row);
}

export async function listAiPromptTrackers(db, {
  siteDomain,
  locationCode = null,
  languageCode = null,
  includePaused = true,
} = {}) {
  const site = await resolveSite(db, siteDomain);
  if (!site?.id) return [];

  const filters = ["t.site_profile_id = ?"];
  const values = [site.id];
  if (locationCode != null) {
    filters.push("t.location_code = ?");
    values.push(Number(locationCode));
  }
  if (languageCode) {
    filters.push("t.language_code = ?");
    values.push(String(languageCode));
  }
  if (!includePaused) filters.push("t.status = 'active'");

  const rows = await db.prepare(`
    SELECT
      t.id, t.name, t.platform, t.model_name, t.prompt_text, t.web_search,
      t.location_code, t.language_code, t.status, t.created_at, t.updated_at,
      o.observed_at AS latest_observed_at,
      o.target_domain_mentioned AS latest_target_domain_mentioned,
      o.target_domain_cited AS latest_target_domain_cited,
      o.citation_count AS latest_citation_count,
      o.actual_cost_usd AS latest_actual_cost_usd,
      agg.observation_count,
      agg.mention_observation_count,
      agg.citation_observation_count,
      agg.total_actual_cost_usd,
      (
        SELECT previous.observed_at
        FROM ai_prompt_observations previous
        WHERE previous.tracker_id = t.id
        ORDER BY previous.observed_at DESC, previous.id DESC
        LIMIT 1 OFFSET 1
      ) AS previous_observed_at,
      (
        SELECT previous.target_domain_mentioned
        FROM ai_prompt_observations previous
        WHERE previous.tracker_id = t.id
        ORDER BY previous.observed_at DESC, previous.id DESC
        LIMIT 1 OFFSET 1
      ) AS previous_target_domain_mentioned,
      (
        SELECT previous.target_domain_cited
        FROM ai_prompt_observations previous
        WHERE previous.tracker_id = t.id
        ORDER BY previous.observed_at DESC, previous.id DESC
        LIMIT 1 OFFSET 1
      ) AS previous_target_domain_cited
    FROM ai_prompt_trackers t
    LEFT JOIN (
      SELECT
        tracker_id,
        COUNT(*) AS observation_count,
        SUM(CASE WHEN target_domain_mentioned = 1 THEN 1 ELSE 0 END) AS mention_observation_count,
        SUM(CASE WHEN target_domain_cited = 1 THEN 1 ELSE 0 END) AS citation_observation_count,
        SUM(COALESCE(actual_cost_usd, 0)) AS total_actual_cost_usd
      FROM ai_prompt_observations
      GROUP BY tracker_id
    ) agg ON agg.tracker_id = t.id
    LEFT JOIN ai_prompt_observations o
      ON o.id = (
        SELECT id
        FROM ai_prompt_observations latest
        WHERE latest.tracker_id = t.id
        ORDER BY latest.observed_at DESC, latest.id DESC
        LIMIT 1
      )
    WHERE ${filters.join(" AND ")}
    ORDER BY t.status = 'active' DESC, t.updated_at DESC, t.id DESC
  `).bind(...values).all();

  return (rows?.results ?? []).map((row) => {
    const latest = row.latest_observed_at ? {
      observed_at: row.latest_observed_at,
      target_domain_mentioned: row.latest_target_domain_mentioned == null ? null : Number(row.latest_target_domain_mentioned) === 1,
      target_domain_cited: row.latest_target_domain_cited == null ? null : Number(row.latest_target_domain_cited) === 1,
      citation_count: Number(row.latest_citation_count ?? 0),
      actual_cost_usd: row.latest_actual_cost_usd == null ? null : Number(row.latest_actual_cost_usd),
    } : null;
    const previous = row.previous_observed_at ? {
      observed_at: row.previous_observed_at,
      target_domain_mentioned: row.previous_target_domain_mentioned == null ? null : Number(row.previous_target_domain_mentioned) === 1,
      target_domain_cited: row.previous_target_domain_cited == null ? null : Number(row.previous_target_domain_cited) === 1,
    } : null;
    const trend = summarizeAiPromptTrend({
      observationCount: row.observation_count,
      mentionObservationCount: row.mention_observation_count,
      citationObservationCount: row.citation_observation_count,
      totalActualCostUsd: row.total_actual_cost_usd,
      latest,
      previous,
    });
    return {
      ...normalizeTrackerRow(row),
      observation_count: trend.observation_count,
      latest_observation: latest,
      trend,
    };
  });
}

export async function recordAiPromptObservation(db, {
  siteDomain,
  trackerId,
  result,
  actualCostUsd = null,
  observedAt = new Date().toISOString(),
} = {}) {
  const tracker = await getAiPromptTracker(db, { siteDomain, trackerId });
  if (!tracker) {
    const error = new Error("Prompt Tracker item was not found for this site.");
    error.code = "TRACKER_NOT_FOUND";
    error.httpStatus = 404;
    throw error;
  }

  const domains = [...new Set(
    (Array.isArray(result?.annotations) ? result.annotations : [])
      .map((row) => String(row?.domain ?? "").trim().toLowerCase())
      .filter(Boolean)
  )].slice(0, 20);

  const row = await db.prepare(`
    INSERT INTO ai_prompt_observations (
      tracker_id, model_name, observed_at, provider_datetime,
      target_domain_mentioned, target_domain_cited,
      citation_count, citation_domains_json, fan_out_count,
      input_tokens, output_tokens, actual_cost_usd, model_money_spent_usd
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id, tracker_id, observed_at
  `).bind(
    tracker.id,
    cleanText(result?.model_name ?? tracker.model_name, 160),
    observedAt,
    result?.datetime ?? null,
    result?.target_domain_mentioned == null ? null : boolInt(result.target_domain_mentioned),
    result?.target_domain_cited == null ? null : boolInt(result.target_domain_cited),
    Array.isArray(result?.annotations) ? result.annotations.length : 0,
    JSON.stringify(domains),
    Array.isArray(result?.fan_out_queries) ? result.fan_out_queries.length : 0,
    integer(result?.input_tokens),
    integer(result?.output_tokens),
    actualCostUsd == null ? null : Number(actualCostUsd),
    result?.model_money_spent_usd == null ? null : Number(result.model_money_spent_usd),
  ).first();

  await db.prepare(
    "UPDATE ai_prompt_trackers SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(tracker.id).run();

  return {
    id: Number(row.id),
    tracker_id: Number(row.tracker_id),
    observed_at: row.observed_at,
  };
}

export async function listAiPromptObservations(db, {
  siteDomain,
  trackerId,
  limit = 20,
} = {}) {
  const tracker = await getAiPromptTracker(db, { siteDomain, trackerId });
  if (!tracker) return [];

  const rows = await db.prepare(`
    SELECT
      id, tracker_id, model_name, observed_at, provider_datetime,
      target_domain_mentioned, target_domain_cited,
      citation_count, citation_domains_json, fan_out_count,
      input_tokens, output_tokens, actual_cost_usd, model_money_spent_usd
    FROM ai_prompt_observations
    WHERE tracker_id = ?
    ORDER BY observed_at DESC, id DESC
    LIMIT ?
  `).bind(tracker.id, Math.max(1, Math.min(100, Number(limit) || 20))).all();

  return (rows?.results ?? []).map((row) => ({
    id: Number(row.id),
    tracker_id: Number(row.tracker_id),
    model_name: row.model_name,
    observed_at: row.observed_at,
    provider_datetime: row.provider_datetime,
    target_domain_mentioned: row.target_domain_mentioned == null ? null : Number(row.target_domain_mentioned) === 1,
    target_domain_cited: row.target_domain_cited == null ? null : Number(row.target_domain_cited) === 1,
    citation_count: Number(row.citation_count ?? 0),
    citation_domains: parseDomains(row.citation_domains_json),
    fan_out_count: Number(row.fan_out_count ?? 0),
    input_tokens: row.input_tokens == null ? null : Number(row.input_tokens),
    output_tokens: row.output_tokens == null ? null : Number(row.output_tokens),
    actual_cost_usd: row.actual_cost_usd == null ? null : Number(row.actual_cost_usd),
    model_money_spent_usd: row.model_money_spent_usd == null ? null : Number(row.model_money_spent_usd),
  }));
}
