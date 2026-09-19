function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function priorityFor(tracker = {}) {
  const trend = tracker?.trend ?? {};
  const code = trend?.change?.code;
  if (!["citation_lost", "mention_lost"].includes(code)) return 0;
  const observations = Math.max(0, Number(trend.observation_count) || 0);
  const evidencePoints = observations >= 10 ? 10 : observations >= 5 ? 7 : observations >= 3 ? 4 : 0;
  const base = code === "citation_lost" ? 76 : 68;
  return Math.min(90, base + evidencePoints);
}

export function buildAiPromptRecoveryAction({ target, tracker } = {}) {
  const domain = String(target ?? "").trim().toLowerCase();
  if (!domain || !tracker || tracker.status !== "active") return null;

  const trend = tracker.trend ?? {};
  const count = Number(trend.observation_count) || 0;
  if (count < 2) return null;

  const change = trend?.change?.code;
  if (!["citation_lost", "mention_lost"].includes(change)) return null;

  const isCitationLoss = change === "citation_lost";
  const score = priorityFor(tracker);
  const prompt = String(tracker.prompt ?? "").trim();
  if (!prompt) return null;

  const whyParts = [
    isCitationLoss
      ? "The latest saved observation lost the target-domain citation."
      : "The latest saved observation lost the target-domain mention.",
    "observations " + count,
    trend.mention_rate_percent != null ? "mention rate " + trend.mention_rate_percent + "%" : null,
    trend.citation_rate_percent != null ? "citation rate " + trend.citation_rate_percent + "%" : null,
    tracker.platform ? "platform " + tracker.platform : null,
    tracker.model_name ? "model " + tracker.model_name : null,
  ].filter(Boolean);

  return {
    rank: null,
    workstream: "ai_prompt_recovery",
    page: "https://" + domain + "/",
    action: "ai_prompt_recovery",
    action_label: isCitationLoss ? "Review lost AI citation" : "Review lost AI mention",
    priority_score: score,
    confidence: count >= 3 ? "high" : "medium",
    query: prompt,
    query_source: "ai_prompt_tracker_d1",
    why_now: whyParts.join(" · ") + ". Compare the saved observation history before changing content.",
    evidence: {
      tracker_id: Number(tracker.id),
      tracker_name: tracker.name || null,
      platform: tracker.platform || null,
      model_name: tracker.model_name || null,
      observation_count: count,
      mention_rate_percent: finite(trend.mention_rate_percent),
      citation_rate_percent: finite(trend.citation_rate_percent),
      change_code: change,
      latest_observed_at: trend.latest_observed_at ?? null,
      previous_observed_at: trend.previous_observed_at ?? null,
      total_actual_cost_usd: finite(trend.total_actual_cost_usd) ?? 0,
    },
  };
}

export function mergeAiPromptRecoveryActions(data = {}, candidates = [], { limit = 25 } = {}) {
  const existing = Array.isArray(data.action_queue) ? data.action_queue : [];
  const promptActions = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  const combined = [...existing, ...promptActions];
  const seen = new Set();
  const unique = combined.filter((item) => {
    const key = [item.page, item.action, item.query || ""].join("\n");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) =>
    (finite(b.priority_score) ?? 0) - (finite(a.priority_score) ?? 0) ||
    String(a.page || "").localeCompare(String(b.page || "")) ||
    String(a.action || "").localeCompare(String(b.action || ""))
  );

  const bounded = unique.slice(0, Math.max(1, Number(limit) || 25))
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    ...data,
    action_queue: bounded,
    next_best_action: bounded[0] ?? data.next_best_action ?? null,
    supplemental_signals: {
      ...(data.supplemental_signals ?? {}),
      ai_prompt_tracker: {
        candidate_count: promptActions.length,
        model: "ai-prompt-recovery-v0.1",
        disclaimer:
          "Tracked Prompt recovery is deterministic triage from repeated saved prompt observations. A changed model answer is not proof of a site change or traffic impact.",
      },
    },
  };
}
