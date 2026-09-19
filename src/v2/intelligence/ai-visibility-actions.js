function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentChange(current, previous) {
  const now = finite(current);
  const before = finite(previous);
  if (now === null || before === null || before === 0) return null;
  return Math.round(((now - before) / Math.abs(before)) * 10000) / 100;
}

function latest(rows = []) {
  return Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null;
}

export function aiVisibilityRecoveryPriority({ historical = [], newLost = [] } = {}) {
  const delta = latest(newLost);
  const current = latest(historical);
  const previous = Array.isArray(historical) && historical.length > 1 ? historical[historical.length - 2] : null;
  const netMentions = finite(delta?.net_mentions) ??
    ((finite(delta?.new_mentions) ?? 0) - (finite(delta?.lost_mentions) ?? 0));
  if (netMentions >= 0) return 0;

  const newMentions = finite(delta?.new_mentions) ?? 0;
  const lostMentions = finite(delta?.lost_mentions) ?? 0;
  const totalChange = newMentions + lostMentions;
  const lossShare = totalChange > 0 ? lostMentions / totalChange : 0;
  const currentMentions = finite(current?.mentions) ?? 0;
  const historyChange = percentChange(current?.mentions, previous?.mentions);

  const lossPoints = Math.round(Math.max(0, lossShare - 0.5) * 40 * 100) / 100;
  const footprintPoints = currentMentions >= 100 ? 12
    : currentMentions >= 30 ? 9
      : currentMentions >= 10 ? 6
        : currentMentions > 0 ? 3
          : 0;
  const trendPoints = historyChange !== null && historyChange <= -30 ? 18
    : historyChange !== null && historyChange <= -20 ? 14
      : historyChange !== null && historyChange <= -10 ? 8
        : 0;

  return Math.min(90, Math.round((50 + lossPoints + footprintPoints + trendPoints) * 100) / 100);
}

export function buildAiVisibilityRecoveryAction({
  target,
  platform,
  historical = [],
  newLost = [],
} = {}) {
  const domain = String(target ?? "").trim().toLowerCase();
  const delta = latest(newLost);
  if (!domain || !delta) return null;

  const newMentions = finite(delta.new_mentions) ?? 0;
  const lostMentions = finite(delta.lost_mentions) ?? 0;
  const netMentions = finite(delta.net_mentions) ?? newMentions - lostMentions;
  if (netMentions >= 0 || lostMentions <= newMentions) return null;

  const current = latest(historical);
  const previous = Array.isArray(historical) && historical.length > 1 ? historical[historical.length - 2] : null;
  const historyChange = percentChange(current?.mentions, previous?.mentions);
  const netVolume = finite(delta.net_ai_search_volume) ??
    ((finite(delta.new_ai_search_volume) ?? 0) - (finite(delta.lost_ai_search_volume) ?? 0));
  const score = aiVisibilityRecoveryPriority({ historical, newLost });
  const corroborated = historyChange !== null && historyChange < 0;
  const platformLabel = platform === "chat_gpt" ? "ChatGPT" : "Google AI Overview";

  const evidenceParts = [
    "lost mentions " + lostMentions,
    "new mentions " + newMentions,
    "net " + netMentions,
    historyChange !== null ? "monthly mentions " + (historyChange > 0 ? "+" : "") + historyChange + "%" : null,
    netVolume !== null ? "net AI search volume " + netVolume : null,
  ].filter(Boolean);

  return {
    rank: null,
    workstream: "ai_visibility_recovery",
    page: "https://" + domain + "/",
    action: "ai_visibility_recovery",
    action_label: "Recover AI visibility",
    priority_score: score,
    confidence: corroborated ? "high" : "medium",
    query: "AI visibility · " + platform,
    query_source: "dataforseo_ai_history",
    why_now:
      platformLabel + " shows a net loss in stored LLM mentions. " +
      evidenceParts.join(" · ") +
      ". Review lost citation/mention context before changing content.",
    evidence: {
      platform,
      period: delta.date ?? null,
      new_mentions: newMentions,
      lost_mentions: lostMentions,
      net_mentions: netMentions,
      new_ai_search_volume: finite(delta.new_ai_search_volume),
      lost_ai_search_volume: finite(delta.lost_ai_search_volume),
      net_ai_search_volume: netVolume,
      current_mentions: finite(current?.mentions),
      previous_mentions: finite(previous?.mentions),
      mentions_change_percent: historyChange,
    },
  };
}

export function mergeAiVisibilityActions(data = {}, candidates = [], { limit = 25 } = {}) {
  const existing = Array.isArray(data.action_queue) ? data.action_queue : [];
  const ai = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  const combined = [...existing, ...ai];
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
      ai_visibility: {
        candidate_count: ai.length,
        model: "ai-visibility-recovery-v0.1",
        disclaimer:
          "AI visibility recovery is deterministic triage from stored DataForSEO LLM mention history. It does not prove why a mention was gained or lost and does not imply traffic impact.",
      },
    },
  };
}
