import { organicKeywordsCacheCandidates } from "../../../../src/v2/organic/organic-keywords-cache.js";
import { organicPagesCacheCandidates } from "../../../../src/v2/organic/organic-pages-cache.js";
import { buildOrganicOpportunities } from "../../../../src/v2/intelligence/organic-opportunities.js";
import { normalizeMarketRequest } from "../../../../src/v2/markets/request-market.js";
import { normalizeRelevantPagesDomain } from "../../../../src/v2/providers/dataforseo-relevant-pages.js";
import { readGscCannibalizationCandidates, readGscIntelligence } from "../../../../src/v2/storage/gsc-search-analytics.js";
import { enrichGscIntelligenceRows } from "../../../../src/v2/gsc/intelligence.js";
import { applyDecisionWorkflow } from "../../../../src/v2/intelligence/decision-workflow.js";
import { mergeCannibalizationActions } from "../../../../src/v2/intelligence/cannibalization-actions.js";
import { buildAiVisibilityRecoveryAction, mergeAiVisibilityActions } from "../../../../src/v2/intelligence/ai-visibility-actions.js";
import { readAiVisibilityHistorical, readAiVisibilityNewLost } from "../../../../src/v2/storage/ai-visibility.js";
import { buildAiPromptRecoveryAction, mergeAiPromptRecoveryActions } from "../../../../src/v2/intelligence/ai-prompt-actions.js";
import { listAiPromptTrackers } from "../../../../src/v2/storage/ai-prompt-tracker.js";
import { getSeoActionWorkflowStats, listSeoActionWorkflow, listSeoActionWorkflowEvents, readSeoActionOutcomes } from "../../../../src/v2/storage/seo-action-workflow.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function unwrap(entry) {
  return entry && typeof entry === "object" && Object.hasOwn(entry, "data") ? entry.data : entry;
}

async function readBest(cache, candidates) {
  for (const candidate of candidates) {
    const entry = await cache.get(candidate.key, "json");
    if (!entry) continue;
    return {
      data: unwrap(entry),
      cached_at: entry?.cached_at ?? unwrap(entry)?.generated_at ?? null,
      depth: candidate.depth,
    };
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  if (!env?.CACHE || !env?.DB) {
    return json({ ok: false, error: { code: "BINDINGS_MISSING", message: "Preview storage bindings are not configured." } }, 503);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400); }

  const domain = normalizeRelevantPagesDomain(body?.target ?? body?.domain);
  if (!domain) {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "target", message: "Enter a valid root domain." } }, 400);
  }

  let locationCode;
  let languageCode;
  try { ({ locationCode, languageCode } = normalizeMarketRequest(body)); }
  catch {
    return json({ ok: false, error: { code: "VALIDATION_ERROR", field: "market", message: "Select a supported country and language combination." } }, 400);
  }

  const managed = await env.DB.prepare("SELECT id, domain FROM site_profiles WHERE domain = ? LIMIT 1").bind(domain).first();
  if (!managed?.domain) {
    return json({
      ok: false,
      error: { code: "MANAGED_SITE_REQUIRED", message: "Opportunity Center is for a saved own-site profile. Add or select this site first." },
      meta: { request_id: requestId, actual_cost_usd: 0, provider_requests: 0 },
    }, 409);
  }

  const [keywords, pages] = await Promise.all([
    readBest(env.CACHE, organicKeywordsCacheCandidates({
      target: domain,
      locationCode,
      languageCode,
      historicalSerpMode: "live",
      depth: 100,
    })),
    readBest(env.CACHE, organicPagesCacheCandidates({
      target: domain,
      locationCode,
      languageCode,
      depth: 100,
    })),
  ]);

  let gscStored = null;
  let gscQueryPageStored = null;
  let gscCannibalizationStored = null;
  let gscRows = [];
  let gscQueryPageRows = [];
  try {
    [gscStored, gscQueryPageStored, gscCannibalizationStored] = await Promise.all([
      readGscIntelligence(env.DB, {
        siteDomain: domain,
        view: "pages",
        days: 28,
        limit: 200,
      }),
      readGscIntelligence(env.DB, {
        siteDomain: domain,
        view: "query_page",
        days: 28,
        limit: 200,
      }),
      readGscCannibalizationCandidates(env.DB, {
        siteDomain: domain,
        days: 28,
        limit: 50,
      }),
    ]);
    const pageComparisonAvailable =
      Number(gscStored?.coverage?.current_days ?? 0) > 0 &&
      Number(gscStored?.coverage?.previous_days ?? 0) > 0;
    const queryPageComparisonAvailable =
      Number(gscQueryPageStored?.coverage?.current_days ?? 0) > 0 &&
      Number(gscQueryPageStored?.coverage?.previous_days ?? 0) > 0;
    gscRows = enrichGscIntelligenceRows(gscStored?.rows ?? [], {
      view: "pages",
      comparisonAvailable: pageComparisonAvailable,
    });
    gscQueryPageRows = enrichGscIntelligenceRows(gscQueryPageStored?.rows ?? [], {
      view: "query_page",
      comparisonAvailable: queryPageComparisonAvailable,
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "Opportunity Center GSC evidence read failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  const aiPlatforms = [
    "google",
    ...(Number(locationCode) === 2840 && String(languageCode).toLowerCase() === "en" ? ["chat_gpt"] : []),
  ];
  let aiVisibilityEvidence = [];
  try {
    aiVisibilityEvidence = await Promise.all(aiPlatforms.map(async (platform) => {
      const [historical, newLost] = await Promise.all([
        readAiVisibilityHistorical(env.DB, {
          target: domain,
          platform,
          locationCode,
          languageCode,
          limit: 24,
        }),
        readAiVisibilityNewLost(env.DB, {
          target: domain,
          platform,
          locationCode,
          languageCode,
          limit: 24,
        }),
      ]);
      return {
        platform,
        historical,
        new_lost: newLost,
        action: buildAiVisibilityRecoveryAction({
          target: domain,
          platform,
          historical,
          newLost,
        }),
      };
    }));
  } catch (error) {
    console.error(JSON.stringify({
      message: "Opportunity Center AI visibility evidence read failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    aiVisibilityEvidence = [];
  }

  let aiPromptTrackers = [];
  try {
    aiPromptTrackers = await listAiPromptTrackers(env.DB, {
      siteDomain: domain,
      locationCode,
      languageCode,
      includePaused: true,
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "Opportunity Center Prompt Tracker evidence read failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    aiPromptTrackers = [];
  }
  const aiPromptActions = aiPromptTrackers
    .map((tracker) => buildAiPromptRecoveryAction({ target: domain, tracker }))
    .filter(Boolean);

  const sources = {
    organic_keywords: keywords ? { available: true, depth: keywords.depth, cached_at: keywords.cached_at } : null,
    top_pages: pages ? { available: true, depth: pages.depth, cached_at: pages.cached_at } : null,
    gsc_pages: (gscStored?.latest_date || gscQueryPageStored?.latest_date) ? {
      available: true,
      latest_date: gscStored?.latest_date ?? gscQueryPageStored?.latest_date ?? null,
      coverage: gscStored?.coverage ?? gscQueryPageStored?.coverage ?? null,
      stored_rows: gscRows.length,
      query_page_rows: gscQueryPageRows.length,
    } : null,
    ai_visibility: aiVisibilityEvidence.some((item) => item.historical.length || item.new_lost.length) ? {
      available: true,
      source: "d1",
      platforms: aiVisibilityEvidence
        .filter((item) => item.historical.length || item.new_lost.length)
        .map((item) => item.platform),
    } : null,
    ai_prompt_tracker: aiPromptTrackers.some((item) => (item?.trend?.observation_count ?? 0) > 0) ? {
      available: true,
      source: "d1",
      tracked_prompts: aiPromptTrackers.length,
      observed_prompts: aiPromptTrackers.filter((item) => (item?.trend?.observation_count ?? 0) > 0).length,
    } : null,
  };
  const baseData = buildOrganicOpportunities({
    target: domain,
    keywordRows: keywords?.data?.items ?? [],
    pageRows: pages?.data?.items ?? [],
    gscPageRows: gscRows,
    gscQueryPageRows,
    sources,
  });
  const rawData = mergeAiPromptRecoveryActions(
    mergeAiVisibilityActions(
      mergeCannibalizationActions(
        baseData,
        gscCannibalizationStored?.rows ?? [],
        { limit: 25 },
      ),
      aiVisibilityEvidence.map((item) => item.action).filter(Boolean),
      { limit: 25 },
    ),
    aiPromptActions,
    { limit: 25 },
  );

  let workflowRows = [];
  let workflowEvents = [];
  let workflowStats = null;
  let workflowOutcomes = [];
  let workflowSource = "d1";
  try {
    [workflowRows, workflowEvents, workflowStats, workflowOutcomes] = await Promise.all([
      listSeoActionWorkflow(env.DB, domain),
      listSeoActionWorkflowEvents(env.DB, domain, { limit: 30 }),
      getSeoActionWorkflowStats(env.DB, domain),
      readSeoActionOutcomes(env.DB, domain, { limit: 10, windowDays: 7 }),
    ]);
  } catch (error) {
    workflowSource = "unavailable";
    console.error(JSON.stringify({
      message: "Decision workflow read failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
  const data = applyDecisionWorkflow(rawData, workflowRows, new Date());
  data.workflow_summary = {
    ...(data.workflow_summary ?? {}),
    source: workflowSource,
    activity_count: workflowEvents.length,
  };
  data.gsc_overlap_summary = {
    candidate_count: gscCannibalizationStored?.rows?.length ?? 0,
    latest_date: gscCannibalizationStored?.latest_date ?? null,
    model: "gsc-query-overlap-v0.1",
    actual_cost_usd: 0,
  };
  data.ai_visibility_summary = {
    candidate_count: aiVisibilityEvidence.filter((item) => item.action).length,
    platforms: aiVisibilityEvidence.map((item) => ({
      platform: item.platform,
      historical_points: item.historical.length,
      new_lost_points: item.new_lost.length,
      recovery_candidate: Boolean(item.action),
    })),
    model: "ai-visibility-recovery-v0.1",
    source: "d1",
    actual_cost_usd: 0,
  };
  data.ai_prompt_tracker_summary = {
    tracked_prompts: aiPromptTrackers.length,
    observed_prompts: aiPromptTrackers.filter((item) => (item?.trend?.observation_count ?? 0) > 0).length,
    candidate_count: aiPromptActions.length,
    total_observations: aiPromptTrackers.reduce((sum, item) => sum + (Number(item?.trend?.observation_count) || 0), 0),
    total_actual_cost_usd: Math.round(aiPromptTrackers.reduce((sum, item) => sum + (Number(item?.trend?.total_actual_cost_usd) || 0), 0) * 1e8) / 1e8,
    model: "ai-prompt-recovery-v0.1",
    source: "d1",
    actual_cost_usd: 0,
  };
  data.workflow_stats = workflowStats;
  data.workflow_activity = workflowEvents;
  data.workflow_outcomes = workflowOutcomes;
  const missing = [];
  if (!keywords) missing.push("organic_keywords");
  if (!pages) missing.push("top_pages");

  return json({
    ok: true,
    data: {
      ...data,
      missing_sources: missing,
      optional_missing_sources: [
        ...(!sources.gsc_pages ? ["gsc_pages"] : []),
        ...(!sources.ai_visibility ? ["ai_visibility_history"] : []),
        ...(!sources.ai_prompt_tracker ? ["ai_prompt_tracker"] : []),
      ],
    },
    meta: {
      request_id: requestId,
      source: "cache_d1_only",
      actual_cost_usd: 0,
      task_count: 0,
      provider_requests: 0,
      duration_ms: Date.now() - startedAt,
    },
  });
}

export function onRequestGet() {
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for Opportunity Center." } }, 405);
}
