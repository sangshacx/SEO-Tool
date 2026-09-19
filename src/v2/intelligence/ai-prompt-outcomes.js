function bool(value) {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}

function observedChange(baseline, post) {
  if (!baseline) {
    return { code: "insufficient_baseline", label: "Need baseline", kind: "neutral" };
  }
  if (!post) {
    return { code: "waiting", label: "Waiting for next Prompt Test", kind: "neutral" };
  }

  const beforeCited = bool(baseline.target_domain_cited);
  const afterCited = bool(post.target_domain_cited);
  if (beforeCited === false && afterCited === true) {
    return { code: "citation_recovered", label: "Citation recovered", kind: "positive" };
  }
  if (beforeCited === true && afterCited === false) {
    return { code: "citation_lost", label: "Citation lost", kind: "negative" };
  }

  const beforeMentioned = bool(baseline.target_domain_mentioned);
  const afterMentioned = bool(post.target_domain_mentioned);
  if (beforeMentioned === false && afterMentioned === true) {
    return { code: "mention_recovered", label: "Mention recovered", kind: "positive" };
  }
  if (beforeMentioned === true && afterMentioned === false) {
    return { code: "mention_lost", label: "Mention lost", kind: "negative" };
  }
  return { code: "stable", label: "No signal change yet", kind: "neutral" };
}

export function summarizeAiPromptWorkflowOutcome({
  event,
  tracker,
  baseline = null,
  post = null,
} = {}) {
  const status = !baseline
    ? "insufficient_baseline"
    : !post
      ? "waiting_for_post_observation"
      : "ready";
  return {
    workflow_id: Number(event?.workflow_id ?? 0),
    event_id: Number(event?.event_id ?? 0),
    tracker_id: Number(tracker?.id ?? event?.tracker_id ?? 0),
    tracker_name: tracker?.name || null,
    prompt: tracker?.prompt || event?.query_text || null,
    platform: tracker?.platform || null,
    model_name: tracker?.model_name || null,
    completed_at: event?.created_at ?? null,
    status,
    baseline: baseline ? {
      observed_at: baseline.observed_at ?? null,
      target_domain_mentioned: bool(baseline.target_domain_mentioned),
      target_domain_cited: bool(baseline.target_domain_cited),
      citation_count: Number(baseline.citation_count ?? 0),
    } : null,
    after: post ? {
      observed_at: post.observed_at ?? null,
      target_domain_mentioned: bool(post.target_domain_mentioned),
      target_domain_cited: bool(post.target_domain_cited),
      citation_count: Number(post.citation_count ?? 0),
      actual_cost_usd: post.actual_cost_usd == null ? null : Number(post.actual_cost_usd),
    } : null,
    observed: observedChange(baseline, post),
    disclaimer:
      "AI Prompt outcome compares saved observations before and after workflow completion. A recovered or lost model response is observational and does not prove the workflow action caused the change.",
  };
}
