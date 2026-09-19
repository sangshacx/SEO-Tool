function workflowKey(page, action, query) {
  return [String(page || "").trim(), String(action || "").trim(), String(query || "").trim()].join("\n");
}

function parseTime(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function applyDecisionWorkflow(data = {}, workflowRows = [], now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const workflowMap = new Map(
    (Array.isArray(workflowRows) ? workflowRows : []).map((row) => [
      workflowKey(row.page_url, row.action_code, row.query),
      row,
    ]),
  );

  const workflowState = (page, action, query) => {
    const row = workflowMap.get(workflowKey(page, action, query)) ?? null;
    let effectiveStatus = row?.status ?? "new";
    let suppressed = false;
    let snoozeExpired = false;
    if (effectiveStatus === "done") {
      suppressed = true;
    } else if (effectiveStatus === "snoozed") {
      const until = parseTime(row?.snooze_until);
      if (until !== null && until > nowMs) {
        suppressed = true;
      } else {
        effectiveStatus = "new";
        snoozeExpired = true;
      }
    }
    return {
      status: effectiveStatus,
      persisted_status: row?.status ?? null,
      note: row?.note ?? "",
      snooze_until: row?.snooze_until ?? null,
      snooze_expired: snoozeExpired,
      updated_at: row?.updated_at ?? null,
      suppressed,
    };
  };

  const active = [];
  const counts = { new: 0, in_progress: 0, done: 0, snoozed: 0, suppressed: 0 };

  for (const item of Array.isArray(data.action_queue) ? data.action_queue : []) {
    const state = workflowState(item.page, item.action, item.query);
    counts[state.status] = (counts[state.status] ?? 0) + 1;
    if (state.suppressed) counts.suppressed += 1;

    const enriched = {
      ...item,
      workflow: {
        status: state.status,
        persisted_status: state.persisted_status,
        note: state.note,
        snooze_until: state.snooze_until,
        snooze_expired: state.snooze_expired,
        updated_at: state.updated_at,
      },
    };
    if (!state.suppressed) active.push(enriched);
  }

  const opportunities = (Array.isArray(data.opportunities) ? data.opportunities : []).map((item) => {
    const next = item?.next_best_action;
    if (!next?.page) return item;
    const state = workflowState(next.page, next.action, next.query);
    return {
      ...item,
      workflow: {
        status: state.status,
        persisted_status: state.persisted_status,
        note: state.note,
        snooze_until: state.snooze_until,
        snooze_expired: state.snooze_expired,
        suppressed: state.suppressed,
        updated_at: state.updated_at,
      },
    };
  });

  const visibleQueue = active.slice(0, 5);
  return {
    ...data,
    opportunities,
    action_queue: visibleQueue,
    next_best_action: visibleQueue[0] ?? null,
    workflow_summary: {
      ...counts,
      active: visibleQueue.length,
      active_candidates: active.length,
      source: "d1",
    },
  };
}
